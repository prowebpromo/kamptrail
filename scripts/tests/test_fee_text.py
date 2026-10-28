import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fee_text  # noqa: E402
import fetch_usfs_recreation  # noqa: E402


class FeeTextTests(unittest.TestCase):
    def check(self, text, status, cost=None):
        self.assertEqual(fee_text.classify(text), (status, cost), text)

    def test_explicit_free(self):
        for t in ('No fee', '<p>No Fees.</p>', 'None', 'Free', 'This is a free facility.', '$0',
                  'Campground is in non-fee status.', 'Camping Fee: Free, Stay Limit: 14 days.',
                  'At this time we are not charging any use fees at this recreation site.'):
            self.check(t, 'free', 0)

    def test_conditional_keeps_charges_separate(self):
        self.check('Camping: No fee Trailhead : $5/vehicle/day', 'conditional')
        self.check('Camping - No camping fee but an Adventure Pass is required', 'conditional')
        self.check('$33.00 per night during summer season. No fee when water and trash service are off.', 'conditional')

    def test_paid_and_unknown(self):
        self.check('$10 per night for overnight camping. No fee for day use.', 'paid', 10)
        self.check('No fee for riding on trails. Camping fees at North Fruita Desert Campground', 'paid')
        self.check('For current fees, please go to Recreation.gov', 'paid')
        self.check('Day-use picnicking is free.', 'unknown')
        self.check('N/A', 'unknown')
        self.check('', 'unknown')

    def test_usfs_feature_preserves_wording_and_source(self):
        f = fetch_usfs_recreation.to_feature({'recareaid': 77, 'recareaname': 'Tiffany Springs', 'latitude': '48.7', 'longitude': '-120.0',
                                              'recareaurl': 'https://www.fs.usda.gov/recarea/okawen/recarea/?recid=77', 'markeractivity': 'Campground Camping',
                                              'feedescription': '<p>No fee.</p>', 'openstatus': 'open'}, '2026-10-28')
        p = f['properties']
        self.assertEqual((p['id'], p['fee_status'], p['cost'], p['fee_text'], p['fee_checked']), ('usfs:77', 'free', 0, 'No fee.', '2026-10-28'))
        self.assertEqual(p['type'], 'established')
        self.assertIsNone(fetch_usfs_recreation.to_feature({'recareaid': 1, 'recareaname': 'X', 'latitude': 0, 'longitude': 0}, 'd'))


if __name__ == '__main__':
    unittest.main()
