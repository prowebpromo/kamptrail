"""Guard the single data-refresh owner and prevent shell-expression injection."""
from pathlib import Path
import ast
import re
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
