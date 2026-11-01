"""Guard the single data-refresh owner and prevent shell-expression injection."""
from pathlib import Path
import ast
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / '.github' / 'workflows'
OWNER = WORKFLOWS / 'fetch-campsite-data.yml'


def shell_expression_steps(text):
    """Inspect parsed shell strings, excluding job/step conditions and env values."""
    workflow = yaml.safe_load(text)
    return [f'{job_name}/{index}'
            for job_name, job in workflow.get('jobs', {}).items()
            for index, step in enumerate(job.get('steps', []))
            if isinstance(step.get('run'), str) and '${{' in step['run']]


class WorkflowSafetyTests(unittest.TestCase):
    def test_services_share_branch_writer_lock_and_verify_only_exact_output(self):
        workflow = yaml.safe_load(OWNER.read_text())
        self.assertEqual(workflow['concurrency']['group'], 'kamptrail-data-refresh-${{ github.ref }}')
        self.assertFalse(workflow['concurrency']['cancel-in-progress'])
        jobs=workflow['jobs'];job=jobs['services']
        self.assertIn("inputs.source != 'services'",jobs['fetch-data']['if'])
        self.assertEqual(job['if'], "${{ inputs.source == 'services' }}")
        self.assertNotIn('concurrency',job)
        self.assertEqual(job['env']['SERVICE_STATE'], "${{ inputs.service_state || 'UT' }}")
        steps=job['steps'];run='\n'.join(step.get('run','') for step in steps)
        self.assertIn('[[ "$SERVICE_STATE" == UT ]]',run)
        self.assertIn('--no-deps --require-hashes -r scripts/requirements-services.txt',run)
        self.assertIn('--region "$SERVICE_STATE"',run)
        self.assertNotIn('--allow-reviewed-shrink',run)
        commit=next(step['run'] for step in steps if step.get('id')=='commit')
        self.assertIn('git rev-parse FETCH_HEAD',commit)
        self.assertIn('git add -A data/sources/services data/services data/health.json',commit)
        normal='\n'.join(step.get('run','') for step in jobs['fetch-data']['steps'])
        self.assertNotIn('fetch_osm_poi.py',normal)
        self.assertNotIn('import_services.py --region legacy',normal)
        self.assertIn('promote_services.py',normal)
        self.assertIn('--accepted-ref origin/main --check-only',normal)
        self.assertIn('git push origin "HEAD:refs/heads/$GITHUB_REF_NAME"',commit)
        self.assertNotIn('--force',commit)
        verify=jobs['verify-services']
        self.assertEqual(verify['permissions'],{'contents':'read'})
        self.assertEqual(verify['with']['ref'],'${{ needs.services.outputs.commit_sha }}')
        self.assertNotIn('secrets',verify)


    def test_weekly_national_services_bind_same_run_and_preserve_exact_failure_snapshot(self):
        workflow = yaml.safe_load(OWNER.read_text())
        stage = workflow['jobs']['national-services-stage']
        self.assertEqual(stage['if'], "${{ github.event_name == 'schedule' }}")
        self.assertEqual(stage['uses'], './.github/workflows/stage-national-services.yml')
        self.assertEqual(stage['permissions'], {'contents': 'read'})
        self.assertEqual(stage['with'], {'states': 'ALL'})
        writer = workflow['jobs']['fetch-data']
        self.assertEqual(writer['needs'], 'national-services-stage')
        self.assertIn('always()', writer['if'])
        self.assertEqual(writer['env']['SERVICES_BATCH'], '${{ github.run_id }}-${{ github.sha }}')
        download = next(s for s in writer['steps'] if s.get('id') == 'service-candidate')
        self.assertEqual(download['with']['name'], '${{ needs.national-services-stage.outputs.candidate_artifact }}')
        self.assertNotIn('run-id', download['with'])  # default is this caller run, never an arbitrary completed artifact
        failure = next(s for s in writer['steps'] if 'Report national staging' in s.get('name', ''))
        self.assertNotIn('record_health', failure['run'])
        self.assertNotIn('python', failure['run'])
        staged_text = (WORKFLOWS / 'stage-national-services.yml').read_text()
        staged = yaml.safe_load(staged_text)
        self.assertEqual(staged['permissions'], {'contents': 'read'})
        self.assertEqual(staged['jobs']['state']['strategy']['max-parallel'], 2)
        self.assertNotIn('git push', staged_text)
        trigger = yaml.load(staged_text, Loader=yaml.BaseLoader)['on']
        self.assertIn('workflow_call', trigger)
        self.assertNotIn('schedule', trigger)
        # Preserve RIDB duplicate cleanup and the existing serialized rebase/retry owner.
        self.assertIn('rm -f "data/campsites/${state}(1).geojson"', OWNER.read_text())
        self.assertIn('git add -A data/campsites', OWNER.read_text())
        self.assertIn('git pull --rebase origin main', OWNER.read_text())

    def test_elevation_uses_owner_lock_and_selected_branch(self):
        workflow = yaml.safe_load(OWNER.read_text())
        jobs = workflow['jobs']
        self.assertIn("inputs.source != 'elevation'", jobs['fetch-data']['if'])
        self.assertEqual(jobs['elevation']['if'], "${{ inputs.source == 'elevation' }}")
        self.assertEqual(jobs['elevation']['timeout-minutes'], 360)
        self.assertNotIn('concurrency', jobs['elevation'])
        steps = jobs['elevation']['steps']
        checkout = next(s for s in steps if s.get('uses') == 'actions/checkout@v4')
        self.assertEqual(checkout['with']['ref'], '${{ github.ref_name }}')
        commit = next(s for s in steps if s.get('id') == 'commit')['run']
        self.assertIn('git rev-parse FETCH_HEAD', commit)
        self.assertIn('git push origin "HEAD:refs/heads/$GITHUB_REF_NAME"', commit)
        self.assertNotIn('--force', commit)
        self.assertNotRegex(commit, r'\bmain\b')
        self.assertIn('git add -A data/sources/elevation.json data/campsites/elevation data/campsites/search-index.json', commit)
        self.assertIn('commit_sha=%s', commit)

    def test_elevation_failure_checkpoints_precede_publication_commit(self):
        steps = yaml.safe_load(OWNER.read_text())['jobs']['elevation']['steps']
        sample = next(s for s in steps if s.get('id') == 'sample')
        self.assertEqual(sample['timeout-minutes'], 330)
        self.assertNotIn('continue-on-error', sample)
        self.assertIn('--catalogue data/campsites/search-index.json', sample['run'])
        commit_index = next(i for i, s in enumerate(steps) if s.get('id') == 'commit')
        checkpoint_steps = [s for s in steps if s.get('id') == 'checkpoint' or s.get('uses') in
                            ('actions/cache/save@v4', 'actions/upload-artifact@v4')]
        self.assertEqual(len(checkpoint_steps), 3)
        for step in checkpoint_steps:
            self.assertIn('always()', step['if'])
            self.assertLess(steps.index(step), commit_index)
        artifact = next(s for s in checkpoint_steps if s.get('uses') == 'actions/upload-artifact@v4')
        self.assertEqual(artifact['with']['retention-days'], 7)
        self.assertTrue(artifact['with']['include-hidden-files'])
        self.assertEqual(artifact['with']['path'], '.elevation-checkpoint/elevation.json')
        restore = next(s for s in steps if s.get('id') == 'restore')
        self.assertTrue(restore['with']['key'].startswith('kamptrail-elevation-v1-'))
        self.assertNotIn('inputs.', restore['with']['key'])

    def test_elevation_verifies_exact_result_without_write_permissions_or_secrets(self):
        jobs = yaml.safe_load(OWNER.read_text())['jobs']
        verify = jobs['verify-elevation']
        self.assertEqual(verify['needs'], 'elevation')
        self.assertEqual(verify['permissions'], {'contents': 'read'})
        self.assertEqual(verify['uses'], './.github/workflows/test.yml')
        self.assertEqual(verify['with']['ref'], '${{ needs.elevation.outputs.commit_sha }}')
        self.assertNotIn('secrets', verify)
        self.assertEqual(jobs['elevation']['outputs']['commit_sha'], '${{ steps.commit.outputs.commit_sha }}')
        regression = yaml.safe_load((WORKFLOWS / 'test.yml').read_text())
        # BaseLoader preserves the GitHub YAML 1.2 "on" key instead of YAML 1.1's boolean.
        trigger = yaml.load((WORKFLOWS / 'test.yml').read_text(), Loader=yaml.BaseLoader)['on']
        self.assertEqual(trigger['workflow_call']['inputs']['ref']['type'], 'string')
        checkout = next(s for s in regression['jobs']['regression']['steps'] if s.get('uses') == 'actions/checkout@v4')
        self.assertEqual(checkout['with']['ref'], '${{ inputs.ref || github.sha }}')

    def test_checkpoint_bootstrap_merge_and_failure_preservation_execute_offline(self):
        steps = yaml.safe_load(OWNER.read_text())['jobs']['elevation']['steps']
        scripts = {step['id']: step['run'].split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
                   for step in steps if step.get('id') in ('prepare', 'checkpoint')}
        with gzip.open(ROOT / 'data/sources/elevation-seed.json.gz', 'rt') as file:
            seed = json.load(file)
        first, second = list(seed['coordinates'])[:2]
        baseline = dict(seed, coordinates={first: seed['coordinates'][first]})
        restored = dict(seed, coordinates={first: dict(seed['coordinates'][first], elevation_m=12),
                                          second: seed['coordinates'][second]})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'data/sources'
            source.mkdir(parents=True)
            checkpoint = root / '.elevation-checkpoint/elevation.json'
            checkpoint.parent.mkdir()
            checkpoint.write_text(json.dumps(restored))
            with gzip.open(source / 'elevation-seed.json.gz', 'wt') as file:
                json.dump(baseline, file)
            env = dict(os.environ, PYTHONPATH=str(ROOT / 'scripts'), GITHUB_OUTPUT=str(root / 'outputs'))
            def run(name):
                return subprocess.run([sys.executable, '-c', scripts[name]], cwd=root, env=env,
                                      capture_output=True, text=True)
            result = run('prepare')
            self.assertEqual(result.returncode, 0, result.stderr)
            merged = json.loads((source / 'elevation.json').read_text())
            self.assertEqual(set(merged['coordinates']), {first, second})
            self.assertEqual(merged['coordinates'][first], baseline['coordinates'][first])
            # An existing canonical cache makes the compressed bootstrap irrelevant.
            (source / 'elevation-seed.json.gz').write_bytes(b'not gzip')
            self.assertEqual(run('prepare').returncode, 0)
            result = run('checkpoint')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / 'outputs').read_text(), 'ready=true\n')
            saved = checkpoint.read_bytes()
            merged['coordinates'][first]['source']['units'] = 'feet'
            (source / 'elevation.json').write_text(json.dumps(merged))
            self.assertNotEqual(run('checkpoint').returncode, 0)
            self.assertEqual(checkpoint.read_bytes(), saved)

    def test_weekly_refresh_covers_every_state(self):
        tree = ast.parse((ROOT / 'scripts/fetch_recreation_gov_data.py').read_text())
        states = next(ast.literal_eval(node.value) for node in tree.body
                      if isinstance(node, ast.Assign) and any(
                          isinstance(target, ast.Name) and target.id == 'US_STATES'
                          for target in node.targets))
        default = re.search(r"STATE_INPUT:.*?\|\| '([^']+)'", OWNER.read_text()).group(1).split()
        self.assertEqual(len(default), 50)
        self.assertEqual(set(default), set(states))

    def test_release_covers_bot_refreshes_and_only_builds_main(self):
        release = (WORKFLOWS / 'publish-hostinger.yml').read_text()
        for file in WORKFLOWS.glob('fetch-*.yml'):
            name = re.search(r'^name: (.+)$', file.read_text(), re.M).group(1)
            self.assertIn(f'      - {name}\n', release)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", release)
        self.assertIn('          ref: main\n', release)
        self.assertIn('    branches: [main]', release)
        self.assertNotIn('download-artifact', release)

    def test_scheduled_refresh_is_tested_before_it_commits(self):
        # A push by this workflow does not trigger the test workflow. The refreshed tree must pass
        # npm test and the Python suite in the same job, before the commit step, or nothing lands.
        text = OWNER.read_text()
        job = text[text.index('\n  fetch-data:'):text.index('\n  agencies:')]
        verify = job.index('- name: Verify the refreshed tree before committing')
        commit = job.index('- name: Commit successful source and snapshot updates')
        self.assertLess(verify, commit)
        step = job[verify:job.index('- name:', verify + 1)]
        self.assertIn('npm test', step)
        self.assertIn('node scripts/check-id-continuity.js', step)
        self.assertIn("python -m unittest discover -s scripts/tests -p 'test_*.py'", step)
        self.assertIn('set -euo pipefail', step)
        self.assertNotIn('continue-on-error', step)
        commit_step = job[commit:]
        self.assertNotRegex(commit_step.split('\n      - ')[0], r'if:\s*\$\{\{\s*always\(\)')
        self.assertIn('setup-php', job[:verify])

    def test_exactly_one_data_schedule(self):
        scheduled = [file.name for file in WORKFLOWS.glob('fetch-*.yml')
                     if re.search(r'^  schedule:', file.read_text(), re.M)]
        self.assertEqual(scheduled, [OWNER.name])
        self.assertIn("cron: '0 3 * * 0'", OWNER.read_text())

    def test_manual_entry_points_delegate_instead_of_racing_writes(self):
        for file in WORKFLOWS.glob('fetch-*.yml'):
            text = file.read_text()
            self.assertIn('contents: write', text, file.name)
            if file != OWNER:
                self.assertIn('uses: ./.github/workflows/fetch-campsite-data.yml', text, file.name)
                self.assertNotIn('run:', text, file.name)
                self.assertNotRegex(text, r'^concurrency:', file.name)
        self.assertIn('group: kamptrail-data-refresh', OWNER.read_text())

    def test_owner_merges_and_does_not_copy_merged_over_source(self):
        text = OWNER.read_text()
        self.assertIn('node scripts/merge_campsite_data.js --state="$state"', text)
        self.assertNotRegex(text, r'\bcp\s+[^\n]*_merged\.geojson')
        self.assertIn('from fetch_recreation_gov_data import US_STATES', text)

    def test_agency_refresh_verifies_the_data_commit_instead_of_the_dispatch_parent(self):
        jobs = yaml.safe_load(OWNER.read_text())['jobs']
        agency, verify = jobs['agencies'], jobs['verify-agencies']
        self.assertEqual(verify['needs'], 'agencies')
        self.assertEqual(verify['with']['ref'], '${{ needs.agencies.outputs.commit_sha }}')
        self.assertEqual(agency['outputs']['commit_sha'], '${{ steps.commit.outputs.commit_sha }}')
        commit = next(step for step in agency['steps'] if step.get('id') == 'commit')['run']
        self.assertLess(commit.index('Selected branch moved'), commit.index('git commit'))
        self.assertIn('git rev-parse HEAD', commit)
        self.assertIn('"$GITHUB_OUTPUT"', commit)
        tests = yaml.safe_load((WORKFLOWS / 'test.yml').read_text())
        checkout = tests['jobs']['regression']['steps'][0]
        self.assertEqual(checkout['with']['ref'], '${{ inputs.ref || github.sha }}')

    def test_shell_blocks_receive_inputs_only_through_env(self):
        text = OWNER.read_text()
        self.assertEqual(shell_expression_steps(text), [])
        self.assertIn('STATE_INPUT: ${{ inputs.states', text)
        self.assertIn('PAGE_SIZE: ${{ inputs.page_size', text)

    def test_shell_check_separates_jobs_and_accepts_literal_block_styles(self):
        text = '''jobs:
  first:
    steps:
      - run: |
          echo "$STATE_INPUT"
  second:
    if: ${{ inputs.source == 'agency' }}
    env:
      EXPECTED_CATALOGUE: ${{ inputs.expected_catalogue }}
    steps:
      - run: |-
          echo "$EXPECTED_CATALOGUE"
'''
        self.assertEqual(shell_expression_steps(text), [])

    def test_shell_check_rejects_direct_input_expressions_in_every_scalar_style(self):
        for style in ('|', '|-', '>', '>-'):
            with self.subTest(style=style):
                text = f'''jobs:
  refresh:
    steps:
      - run: {style}
          echo "${{{{ inputs.states }}}}"
'''
                self.assertEqual(shell_expression_steps(text), ['refresh/0'])
        self.assertEqual(shell_expression_steps('''jobs:
  refresh:
    steps:
      - run: echo "${{ inputs.states }}"
'''), ['refresh/0'])


if __name__ == '__main__':
    unittest.main()
