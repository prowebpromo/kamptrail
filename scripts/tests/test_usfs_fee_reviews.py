"""Reviewed site-specific pages can enrich unknown fees without weakening identity."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_usfs_recreation as usfs


def row(**changes):
    value = {'recareaid': 900001, 'recareaname': 'Reviewed Campground',
             'longitude': -111.0, 'latitude': 40.0, '_geometry': {'x': -111.0, 'y': 40.0},
             'markeractivity': 'RV Camping', '_camping_activities': ['RV Camping'],
             '_discovery': 'primary_markeractivity', 'feedescription': None,
             'recareadescription': 'This campground has four campsites.', 'openstatus': 'closed'}
    value.update(changes)
    return value


def review(**changes):
    value = {'recareaid': 900001, 'name': 'Reviewed Campground', 'source': 'US Forest Service',
             'source_field': 'official_page.Fee Site and Info',
             'source_url': 'https://www.fs.usda.gov/r04/example/recreation/reviewed-campground',
             'text': 'No fees are required for this site', 'retrieved_at': '2026-10-30',
             'source_updated_at': None, 'source_updated_at_basis': None,
             'review_after': '2026-11-29', 'identity_coordinates': [-111.0, 40.0],
             'context': [{'source_field': 'official_page.Camping and access',
                          'text': 'RVs up to 25 feet. Closed in winter. A nearby picnic site costs $5.'}]}
    value.update(changes)
    return value


class FeeReviewTests(unittest.TestCase):
    def feature(self, item=None, observation=None, retrieved='2026-11-01'):
        item = item or row()
        observation = observation or review()
        with patch.object(usfs, 'load_fee_reviews', return_value={900001: observation}):
            return usfs.to_feature(item, retrieved)['properties']

    def test_unknown_adopts_specific_fee_but_not_access_or_amenity_assumptions(self):
        p = self.feature()
        self.assertEqual((p['fee_status'], p['cost']), ('free', 0))
        self.assertEqual(p['fee_source_field'], 'official_page.Fee Site and Info')
        self.assertEqual(p['fee_checked'], '2026-10-30')  # A later import is not a later page check.
        self.assertEqual(p['open_status'], 'closed')
        self.assertEqual(p['amenities'], [])
        e = next(e for e in p['fee_evidence_records'] if e['source_field'] == p['fee_source_field'])
        self.assertEqual(e['retrieved_at'], '2026-10-30')
        self.assertIsNone(e['source_updated_at'])
        self.assertEqual(e['sha256'], hashlib.sha256(e['text'].encode()).hexdigest())
        context = next(e for e in p['fee_evidence_records'] if e.get('evidence_kind') == 'maintained_official_page_context')
        self.assertEqual(context['classification_text'], '')
        self.assertIn('$5', context['text'])  # A nearby picnic price is context, not this camping fee.

    def test_unknown_can_gain_paid_or_conditional_evidence_and_permits_still_qualify_free(self):
        p = self.feature(observation=review(text='$12 per night'))
        self.assertEqual((p['fee_status'], p['cost']), ('paid', 12))
        p = self.feature(observation=review(text='Camping is free in winter only.'))
        self.assertEqual(p['fee_status'], 'conditional')
        p = self.feature(row(restrictions='A camping permit is required.'))
        self.assertEqual((p['fee_status'], p['cost']), ('conditional', None))

    def test_known_contradictions_remain_unknown_instead_of_newest_wins(self):
        for item, observation in [(row(feedescription='$8 per night'), review()),
                                  (row(feedescription='No fee'), review(text='$12 per night')),
                                  (row(feedescription='$8 per night'), review(text='$12 per night'))]:
            p = self.feature(item, observation)
            self.assertEqual((p['fee_status'], p['cost']), ('unknown', None))
            self.assertTrue(p['fee_conflict'])
            self.assertEqual(len([e for e in p['fee_evidence_records'] if e['classification_text']]), 2)

    def test_current_conditions_qualify_an_existing_free_fee(self):
        for text in ('Camping is free in winter only.', 'No camping fee. A camping permit is required.'):
            with self.subTest(text=text):
                p = self.feature(row(feedescription='No fee'), review(text=text))
                self.assertEqual((p['fee_status'], p['cost']), ('conditional', None))
                self.assertEqual(p['fee_text'], text)
                self.assertFalse(p['fee_conflict'])

    def test_expired_future_wrong_name_and_displaced_reviews_cannot_promote_unknown(self):
        cases = [(review(), '2026-10-29'), (review(), '2026-11-29'),
                 (review(), '2026-12-01'), (review(name='Another Campground'), '2026-11-01'),
                 (review(identity_coordinates=[-111.1, 40.0]), '2026-11-01'),
                 (review(identity_coordinates=None), '2026-11-01')]
        for observation, day in cases:
            with self.subTest(observation=observation, day=day):
                p = self.feature(observation=observation, retrieved=day)
                self.assertEqual((p['fee_status'], p['cost']), ('unknown', None))
                self.assertFalse(any(e.get('evidence_kind', '').startswith('maintained_') for e in p['fee_evidence_records']))
        self.assertEqual(self.feature(observation=review(review_after=None))['fee_status'], 'unknown')

    def test_schema_rejects_bad_dates_locations_sources_and_duplicate_ids(self):
        invalid = [review(source_url='http://www.fs.usda.gov/recreation'),
                   review(source_url='https://www.fs.usda.gov.evil.test/recreation'),
                   review(source_url='https://name@www.fs.usda.gov/recreation'),
                   review(review_after='2026-10-30'), review(source_updated_at='2026-02-30'),
                   review(identity_coordinates=None),
                   review(identity_coordinates=[True, 40]), review(identity_coordinates=[181, 40]),
                   review(context=[{'source_field': True, 'text': 'No fees'}])]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'reviews.json'
            for records in [[v] for v in invalid] + [[review(), copy.deepcopy(review())]]:
                path.write_text(json.dumps({'schema_version': 1, 'records': records}))
                usfs.load_fee_reviews.cache_clear()
                with patch.object(usfs, 'FEE_REVIEWS', path), self.assertRaises((ValueError, RuntimeError)):
                    usfs.load_fee_reviews()
        usfs.load_fee_reviews.cache_clear()


if __name__ == '__main__':
    unittest.main()
