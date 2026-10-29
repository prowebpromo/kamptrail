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
                  'Campground is in non-fee status.', 'Camping Fee: Free, Stay Limit: 14 days.'):
            self.check(t, 'free', 0)

    def test_conditional_keeps_charges_separate(self):
        self.check('Camping: No fee Trailhead : $5/vehicle/day', 'conditional')
        self.check('Camping - No camping fee but an Adventure Pass is required', 'conditional')
        self.check('$33.00 per night during summer season. No fee when water and trash service are off.', 'conditional')
        self.check('Fees are not collected at this time', 'conditional')
        # USFS Jerry Johnson (82782): a current waiver is not a permanent free claim.
        self.check('No fee currently charged.', 'conditional')
        self.check('No fee currently charged for parking.', 'unknown')
        self.check('At this time we are not charging any use fees at this recreation site.', 'conditional')
        self.check('For current fees, please go to <a href="https://www.recreation.gov/">Recreation.gov</a> Open after season, First Come/First Served; No fee, No Toilets, No Water', 'conditional')
        self.check('Camping is free. No permit is required for hiking. A vehicle pass is required.', 'conditional')

    def test_mandatory_campground_payment_not_reservability(self):
        for name in ('Creek Pasture Campground', 'Superbowl Campground', 'Hamburger Rock Campground', 'The campground at Sand Island Recreation Area'):
            self.check(name + ' is first come, first served and payment must be made upon arrival at the self-register kiosk at the campground using cash, check, or the Scan & Pay feature on the Recreation.gov mobile app. There is no fee for day use.', 'paid')
        for text in ('Reservations must be made upon arrival at the campground.',
                     'Payment must be made upon arrival for parking.',
                     'Nearby Campground is first come, first served and payment must be made upon arrival.',
                     'It is not true that Creek Pasture Campground is first come, first served and payment must be made upon arrival.'):
            self.check(text, 'unknown')

    def test_commercial_and_explicitly_adjacent_land_permits_do_not_qualify_camping(self):
        basic = 'There are no permits, passes, or fees required to visit this wilderness area. It is free.'
        exceptions = [
            'However, commercial, competitive, and large organized group events require a special recreation permit . Contact the local managing field office for more information about special recreation permits.',
            'Recreational activities on any nearby state trust land require a permit from the State of Arizona.',
            'Visitors should note that entering the adjacent San Carlos Indian Reservation, which shares the wilderness’ northeastern border, requires a recreation permit from the tribe.',
        ]
        self.check(basic + ' '.join(exceptions), 'free', 0)
        self.check('The Shores and Christmas recreation sites are available at no cost on a first come, first served basis. A permit is not required for private, non-commercial use of the sites. Use of public lands in connection with commercial recreational use requires a BLM Special Recreation Permit.', 'free', 0)
        for requirement in ('A camping permit is required.', 'All campers must purchase a vehicle permit.',
                            'Commercial camping is free but a camping permit is required.',
                            'Visits to the Sand Tank Mountains, located south of Interstate 8, require a free Barry M. Goldwater Range permit .'):
            self.check(basic + ' '.join(exceptions) + ' ' + requirement, 'conditional')

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

    def test_blm_explicit_no_permit_or_fee_requirement_to_camp(self):
        wording = 'There is no permit or fee requirement to camp. All sites are first-come, first-served.'
        self.check(wording, 'free', 0)
        self.check(wording + ' A $5 vehicle permit is required.', 'conditional')
        self.check(wording + ' An Adventure Pass is required.', 'conditional')
        self.check(wording + ' You must purchase a vehicle permit.', 'conditional')
        self.check(wording + ' A vehicle permit is required.', 'conditional')
        self.check('It is not true that there is no permit or fee requirement to camp.', 'unknown')
        self.check('There is no permit or fee requirement to park.', 'unknown')
        self.check('There is no permit or fee requirement to camp. Camping is no longer free.', 'paid')

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
