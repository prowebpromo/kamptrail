"""Actual pilot wording and scope regressions for narrow structured USFS fees."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_usfs_recreation as usfs


def row(**changes):
    value = {'recareaid': 75504, 'recareaname': 'Rio Chama Campground, Small Group Sites',
             'longitude': -106.672734, 'latitude': 36.355135,
             '_geometry': {'x': -106.672734, 'y': 36.355135}, 'markeractivity': 'Group Camping',
             '_camping_activities': ['Group Camping'], '_discovery': 'primary_markeractivity',
             'feedescription': None,
             'recareadescription': 'The Rio Chama is a developed no-fee campground where reservations are not required. '
                 'Located along the Rio Chama Wild & Scenic River, the developed campground offers a great place '
                 'for families, groups, or RVs to come camp on the river\'s edge. '
                 'Uses: camping, hiking, fishing, and river access. Facilities: This site offers two group sites '
                 'with two picnic tables and fire rings, and one vault toilet and trash bin. '
                 'Special Instructions: Smaller RVs (up to 20 feet) can be accommodated at some sites. '
                 'No drinking water is available. Forest Road 151 is not recommended for travel when wet.',
             'recareaurl': 'https://www.fs.usda.gov/recarea/santafe/recarea/?recid=75504'}
    value.update(changes)
    return value


class StructuredFeeTests(unittest.TestCase):
    def properties(self, value):
        with patch.object(usfs, 'load_fee_reviews', return_value={}):
            return usfs.to_feature(value, '2026-10-30')['properties']

    def test_actual_rio_chama_statement_preserves_source_scope_and_dates(self):
        p = self.properties(row())
        self.assertEqual((p['fee_status'], p['cost']), ('free', 0))
        self.assertEqual(p['fee_source_field'], 'recareadescription')
        statement = 'The Rio Chama is a developed no-fee campground where reservations are not required.'
        self.assertEqual(p['fee_text'], statement)
        e = next(e for e in p['fee_evidence_records'] if e['source_field'] == 'recareadescription')
        self.assertEqual(e['classification_text'], statement)
        self.assertIn('river', e['text'])  # Full narrative is retained, not erased.
        self.assertEqual(e['retrieved_at'], '2026-10-30')
        self.assertIsNone(e['source_updated_at'])
        self.assertEqual(p['fee_checked'], '2026-10-30')

    def test_actual_aspen_standard_fee_does_not_invent_currency_or_amount(self):
        p = self.properties(row(recareaid=11263, recareaname='Aspen Grove',
            feedescription='Standard Fees 20.00 per night. Interagency passes accepted. Senior Passes save 50%.',
            recareadescription='Aspen Campground is located in the Eagle Lake Recreation Area.'))
        self.assertEqual((p['fee_status'], p['cost']), ('paid', None))
        self.assertEqual(p['fee_source_field'], 'feedescription')

    def test_other_subjects_ancillary_history_negation_and_season_are_not_free(self):
        cases = [
            'Nearby Rio Chama is a developed no-fee campground.',
            'Another Campground is a developed no-fee campground.',
            'The Rio Chama is not a developed no-fee campground.',
            'Historically, the Rio Chama is a developed no-fee campground.',
            'The Rio Chama was a developed no-fee campground.',
            'The Rio Chama is a developed no-fee campground during winter only.',
            'The Rio Chama is a developed no-fee campground. Camping fees are now charged.',
            'The Rio Chama is a developed no-fee campground. Camping is no longer free.',
            'The Rio Chama is a developed no-fee campground. No camping is allowed.',
            'The Rio Chama is a developed no-fee campground. Day use only.',
            'The Rio Chama is a developed no-fee campground. A permit is required.',
            'The Rio Chama is a developed no-fee campground. Overnight use costs $12.',
            'The Rio Chama is a developed no-fee campground. It is free only in winter.',
            'The Rio Chama is a developed no-fee campground. Camping costs 20 per night.',
            'The Rio Chama is a developed no-fee campground. It became a paid campground in 2025.',
            'The Rio Chama is a developed no-fee campground. This information applies only in winter.',
            'The Rio Chama is a developed no-fee campground. Standard Fees 20.00 per night.',
            'The Rio Chama is a developed no-fee campground. Camping is available for a nightly charge.',
            'The Rio Chama is a developed no-fee campground. Camping requires paid reservations.',
            'The Rio Chama is a developed no-fee campground. All overnight campers must pay a reservation charge.',
            'The Rio Chama is a developed no-fee campground. This is not correct.',
            'The Rio Chama is a developed no-fee campground. That information is outdated.',
            'The Rio Chama is a developed no-fee campground. It is not accurate.',
            'The Rio Chama is a developed no-fee campground. This information is wrong.',
            'The Rio Chama is a day-use area with free parking.',
            'This campground has free showers. Nearby Another Campground is fee-free.',
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual(self.properties(row(recareadescription=text))['fee_status'], 'unknown')

    def test_nonempty_fee_field_is_not_bypassed_and_permit_restriction_qualifies(self):
        for field, expected in [('See Recreation.gov for current rate.', 'unknown'), ('$12 per night', 'paid')]:
            with self.subTest(field=field):
                self.assertEqual(self.properties(row(feedescription=field))['fee_status'], expected)
        p = self.properties(row(restrictions='A camping permit is required.'))
        self.assertEqual((p['fee_status'], p['cost']), ('conditional', None))

    def test_a_maintained_paid_review_conflicts_with_the_scoped_free_statement(self):
        observation = {'recareaid': 75504, 'name': row()['recareaname'],
            'text': '$12 per night', 'source': 'US Forest Service',
            'source_field': 'official_page.Fee Site and Info', 'source_url': row()['recareaurl'],
            'retrieved_at': '2026-10-30', 'source_updated_at': None,
            'review_after': '2026-11-29', 'identity_coordinates': [-106.672734, 36.355135]}
        with patch.object(usfs, 'load_fee_reviews', return_value={75504: observation}), \
                patch.object(usfs.fee_rechecks, 'validation', return_value=True):
            p = usfs.to_feature(row(), '2026-10-30')['properties']
        self.assertEqual((p['fee_status'], p['cost']), ('unknown', None))
        self.assertTrue(p['fee_conflict'])

    def test_narrow_standard_fee_rejects_day_use_history_zero_negation_and_conflict(self):
        cases = ['Day use Standard Fees 20.00 per night.', 'Previously Standard Fees 20.00 per night.',
                 'Not Standard Fees 20.00 per night.', 'Standard Fees 0 per night.',
                 'Standard Fees 20 per day.', 'Standard Fees 20 per night for parking.',
                 'Standard Fees 20 per night. These are day-use parking fees.',
                 'Standard Fees 20 per night. The fee was previously charged.',
                 'Standard Fees 20 per night. This describes the nearby campground.',
                 'Standard Fees 20 per night. Camping is free.',
                 'Standard Fees 20 per night. No fees are currently charged.']
        cases += ['Standard Fees 20 per night. This is not a camping charge.',
                  'Standard Fees 20 per night. These fees are waived.',
                  'Standard Fees 20 per night. This statement is false.',
                  'Standard Fees 20 per night. These fees do not apply to camping.']
        for text in cases:
            with self.subTest(text=text):
                self.assertFalse(usfs.standard_nightly_fee(text))
        self.assertFalse(usfs.standard_nightly_fee('Standard Fees 20 per night. It is no longer free.'))


if __name__ == '__main__':
    unittest.main()
