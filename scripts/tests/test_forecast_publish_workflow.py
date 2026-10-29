"""Ensure the forecast channel cannot publish untrusted or unvalidated artifacts."""
from pathlib import Path
import re
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class ForecastWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (ROOT / '.github/workflows/publish-forecasts.yml').read_text()
        cls.workflow = yaml.load(cls.text, Loader=yaml.BaseLoader)

    def test_only_trusted_main_events_and_separate_serialized_data_channel(self):
        self.assertEqual(set(self.workflow['on']), {'schedule', 'workflow_dispatch'})
        self.assertEqual(self.workflow['permissions'], {'contents': 'read'})
        self.assertEqual(self.workflow['concurrency']['cancel-in-progress'], 'false')
        for job in self.workflow['jobs'].values():
            self.assertIn("github.repository == 'prowebpromo/kamptrail'", job['if'])
            self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertNotRegex(self.text, r'(?i)(git\s+(push|commit)|publish-hostinger|workflow_run|pull_request|id-token:)')

    def test_write_authority_is_isolated_after_readonly_validation(self):
        jobs = self.workflow['jobs']
        self.assertEqual(set(jobs), {'produce', 'publish'})
        self.assertEqual(jobs['produce']['permissions'], {'contents': 'read'})
        self.assertEqual(jobs['publish']['permissions'], {'contents': 'write'})
        self.assertEqual(jobs['publish']['needs'], 'produce')
        producer_runs = '\n'.join(step.get('run', '') for step in jobs['produce']['steps'])
        self.assertIn('scripts/fetch_forecasts.py', producer_runs)
        self.assertIn('scripts/publish_forecasts.py', producer_runs)
        self.assertIn("python -m unittest discover -s scripts/tests -p 'test_fetch_forecasts.py'", producer_runs)
        self.assertIn("python3 -m unittest discover -s scripts/tests -p 'test_publish_forecasts.py'", producer_runs)
        self.assertLess(producer_runs.index('test_fetch_forecasts.py'), producer_runs.index('python scripts/fetch_forecasts.py'))
        self.assertNotIn('--publish', producer_runs)
        write_steps = [step for step in jobs['publish']['steps'] if '--publish' in step.get('run', '')]
        self.assertEqual(len(write_steps), 1)
        self.assertEqual(write_steps[0]['env'], {'GITHUB_TOKEN': '${{ github.token }}'})
        self.assertNotIn('secrets.', self.text)

    def test_actions_are_pinned_and_artifacts_are_same_run_only(self):
        for job in self.workflow['jobs'].values():
            for step in job['steps']:
                if 'uses' in step:
                    self.assertRegex(step['uses'], r'@[a-f0-9]{40}$')
                if step.get('uses', '').startswith('actions/checkout@'):
                    self.assertEqual(step['with']['persist-credentials'], 'false')
                    self.assertEqual(step['with']['ref'], '${{ github.sha }}')
                if step.get('uses', '').startswith('actions/download-artifact@'):
                    self.assertEqual(step['with']['name'], 'forecast-publication-${{ github.run_id }}-${{ github.run_attempt }}')
                    self.assertNotIn('run-id', step['with'])
                    self.assertNotIn('github-token', step['with'])
        self.assertIn('environment/forecast-linux-64.lock', self.text)
        self.assertIn('sha256sum --check --status', self.text)
        for block in re.findall(r'        run: \|\n(.*?)(?=\n      - |\Z)', self.text, re.S):
            self.assertNotIn('${{', block)


if __name__ == '__main__':
    unittest.main()
