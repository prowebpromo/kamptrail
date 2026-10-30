"""The national tooling can create a review branch, never publish production."""
from pathlib import Path
import re
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[2]


class ServicesReviewWorkflowTests(unittest.TestCase):
    def test_manual_main_only_minimum_permissions_and_native_credential_handling(self):
        text = (ROOT / '.github/workflows/prepare-national-services-review.yml').read_text()
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        self.assertEqual(set(workflow['on']), {'workflow_dispatch'})
        self.assertEqual(workflow['permissions'], {'contents': 'write', 'actions': 'read'})
        self.assertEqual(workflow['concurrency']['cancel-in-progress'], 'false')
        job = workflow['jobs']['prepare']
        self.assertIn("github.repository == 'prowebpromo/kamptrail'", job['if'])
        self.assertIn("github.ref == 'refs/heads/main'", job['if'])
        self.assertIn("github.event_name == 'workflow_dispatch'", job['if'])
        self.assertNotIn('secrets.', text); self.assertNotIn('pull-requests:', text)
        for step in job['steps']:
            if step.get('uses'):
                self.assertRegex(step['uses'], r'@[a-f0-9]{40}$')
            self.assertNotIn('${{', step.get('run', ''))
        download = next(s for s in job['steps'] if s.get('uses', '').startswith('actions/download-artifact@'))
        self.assertEqual(download['with']['run-id'], '${{ steps.plan.outputs.run_id }}')
        self.assertEqual(download['with']['artifact-ids'], '${{ steps.plan.outputs.artifact_ids }}')
        self.assertEqual(download['with']['repository'], '${{ github.repository }}')
        self.assertEqual(download['with']['github-token'], '${{ github.token }}')
        self.assertEqual(download['with']['merge-multiple'], 'false')

    def test_immutable_zip_preflight_precedes_native_unzip_and_branch_only_helper(self):
        text = (ROOT / '.github/workflows/prepare-national-services-review.yml').read_text()
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        steps = workflow['jobs']['prepare']['steps']
        preflight = next(i for i, s in enumerate(steps) if ' check-zips ' in s.get('run', ''))
        download = next(i for i, s in enumerate(steps) if s.get('uses', '').startswith('actions/download-artifact@'))
        prepare = next(i for i, s in enumerate(steps) if ' prepare ' in s.get('run', ''))
        self.assertLess(preflight, download); self.assertLess(download, prepare)
        self.assertIn('crypto.createHash(\'sha256\')', text)
        self.assertNotRegex(text, r'git\s+(?:push|merge)|publish-hostinger|deploy_site|workflow_run:|pull_request:')
        helper = (ROOT / 'scripts/prepare_services_review.py').read_text()
        self.assertIn("return 'refs/heads/data/services-national-'", helper)
        self.assertIn("'push', '--force-with-lease=' + ref + ':'", helper)
        self.assertNotRegex(helper, r"git\('(?:merge|reset)'|git\('push',\s*'--force'")
        self.assertNotIn('GITHUB_TOKEN', helper); self.assertNotIn('urllib.request', helper)


if __name__ == '__main__':
    unittest.main()
