"""Guard the single data-refresh owner and prevent shell-expression injection."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / '.github' / 'workflows'
OWNER = WORKFLOWS / 'fetch-campsite-data.yml'


class WorkflowSafetyTests(unittest.TestCase):
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
        for block in re.findall(r'        run: \|\n(.*?)(?=\n      - |\Z)', text, re.S):
            self.assertNotIn('${{', block)
        self.assertIn('STATE_INPUT: ${{ inputs.states', text)
        self.assertIn('PAGE_SIZE: ${{ inputs.page_size', text)


if __name__ == '__main__':
    unittest.main()
