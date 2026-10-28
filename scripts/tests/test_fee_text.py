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
        # A pointer elsewhere does not establish the camping charge.
        self.check('For current fees, please go to Recreation.gov', 'unknown')
        self.check('Fee information', 'unknown')
        self.check('Day-use picnicking is free.', 'unknown')
        self.check('N/A', 'unknown')
        self.check('', 'unknown')

    def test_negation_is_never_free(self):
        self.check('Camping is not free.', 'paid')
        self.check('Camping is no longer free as of 2025.', 'paid')
        self.check('Camping is not free. Free drinking water is available.', 'paid')

    def test_free_ancillary_services_are_not_free_camping(self):
        for t in ('Free drinking water is available.', 'Free showers and Wi-Fi for registered campers.', 'Water is free at the spigot.',
                  'Parking is free.', 'None for Day Use', 'Monument access and visitor information and services is free.'):
            self.check(t, 'unknown')
        self.check('Parking is free. Camping is $12 per night.', 'paid', 12)
        self.check('Free dump station. Camping fee applies.', 'paid')
        self.check('Single Campsites - $20 per night Extra Vehicles - $8 per vehicle, per night Day Use - No fee', 'paid', 20)

    def test_free_statements_still_count(self):
        for t in ('No fee for day use or camping.', 'Free - dispersed camping', 'Camping and day use are free.', 'Not a fee site.',
                  'This is a no-charge campground.', 'no use fee', 'There is no fee to camp.', 'None. Please note the concessionaire manages the area.'):
            self.check(t, 'free', 0)
        self.check('Fee-free after September 29.', 'conditional')
        self.check('There is no fee to camp here. You just need to make sure you have a valid trail pass.', 'conditional')
        self.check('Campsites: Free Group Shelter: $75', 'conditional')

    def test_charge_statements_without_amounts(self):
        for t in ('There is a fee for overnight camping.', 'This is a fee campground. Fee envelopes are provided.', 'User fee station at the entrance.'):
            self.check(t, 'paid')
        self.check('10$ / night, April 1 to November 30.', 'paid', 10)

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
