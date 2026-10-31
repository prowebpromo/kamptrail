import copy
import datetime as dt
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import rest_area_policy as policy

BUNDLE = json.loads(policy.POLICIES.read_text())
NOW = dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)


def resolve(state='MT', operator='mdt', kind='rest_area', **kwargs):
    return policy.resolve(BUNDLE, state=state, operator=operator,
                          facility_kind=kind, now=NOW, **kwargs)


def exception(**rules):
    return {'facility_id': 'test:1', 'state': 'MT', 'operator': 'mdt',
            'facility_kind': 'rest_area', 'sources': BUNDLE['policies'][1]['sources'],
            'rules': rules}


class StatePolicies(unittest.TestCase):
    def test_duration_and_camping_do_not_imply_other_permissions(self):
        tx = resolve('TX', 'txdot', 'safety_rest_area')
        self.assertEqual(tx['rules']['max_stay_hours'], 24)
        self.assertEqual(tx['rules']['overnight_parking'], 'unknown')
        self.assertEqual(tx['rules']['sleeping_in_vehicle'], 'unknown')
        mt = resolve()
        self.assertEqual(mt['rules']['overnight_parking'], 'allowed')
        self.assertEqual(mt['rules']['camping'], 'prohibited')
        self.assertEqual(mt['rules']['sleeping_in_vehicle'], 'unknown')
        self.assertEqual(mt['rules']['max_stay_hours'], 12)
        self.assertEqual(mt['current_opening'], 'unknown')

    def test_state_alone_cannot_apply_agency_rule_to_other_facilities(self):
        for state, operator, kind in [('TX', 'private', 'safety_rest_area'),
                                       ('TX', 'txdot', 'travel_information_center'),
                                       ('MT', 'mdt', 'campsite'), ('NY', 'mdt', 'rest_area')]:
            result = resolve(state, operator, kind)
            self.assertIsNone(result['policy_id'])
            self.assertEqual(result['rules']['overnight_parking'], 'unknown')
            self.assertIsNone(result['rules']['max_stay_hours'])

    def test_specific_restrictive_exception_and_unknown_can_block_default(self):
        result = resolve(facility_id='test:1', exceptions=[exception(overnight_parking='prohibited', max_stay_hours=4)])
        self.assertEqual(result['rules']['overnight_parking'], 'prohibited')
        self.assertEqual(result['rules']['max_stay_hours'], 4)
        self.assertEqual(result['review_required'], [])
        result = resolve(facility_id='test:1', exceptions=[exception(overnight_parking='unknown')])
        self.assertEqual(result['rules']['overnight_parking'], 'unknown')
        self.assertEqual(resolve(facility_id='other', exceptions=[exception(overnight_parking='prohibited')])['rules']['overnight_parking'], 'allowed')

    def test_permissive_conflicts_need_review_instead_of_relaxing_state_rule(self):
        result = resolve(facility_id='test:1', exceptions=[exception(camping='allowed', max_stay_hours=24)])
        self.assertEqual(result['rules']['camping'], 'unknown')
        self.assertIsNone(result['rules']['max_stay_hours'])
        self.assertEqual(result['review_required'], ['camping', 'max_stay_hours'])

    def test_statute_backed_scopes_keep_unstated_activities_unknown(self):
        expected = {('WA', 'wsdot', 'safety_rest_area'): ('unknown', 'unknown', 'unknown', None),
                    ('SD', 'sddot', 'rest_area'): ('unknown', 'unknown', 'prohibited', None),
                    ('NV', 'ndot', 'rest_area'): ('unknown', 'unknown', 'unknown', None)}
        for (state, operator, kind), want in expected.items():
            with self.subTest(state=state):
                r = resolve(state, operator, kind)['rules']
                self.assertEqual((r['overnight_parking'], r['sleeping_in_vehicle'], r['camping'], r['max_stay_hours']), want)

    def test_location_only_scopes_keep_every_permission_unknown(self):
        scopes = [('CA', 'caltrans', 'safety_roadside_rest_area'), ('IA', 'iowa_dot', 'rest_area'),
                  ('IN', 'indot', 'rest_area_or_welcome_center'), ('KS', 'kdot', 'rest_area'),
                  ('MI', 'mdot', 'rest_area_or_welcome_center')]
        for state, operator, kind in scopes:
            with self.subTest(state=state):
                p = resolve(state, operator, kind)
                self.assertEqual([p['rules'][a] for a in ('overnight_parking', 'sleeping_in_vehicle', 'camping')], ['unknown'] * 3)
                self.assertIsNone(p['rules']['max_stay_hours'])
                self.assertEqual(p['rules']['conditions'], [])
                self.assertTrue(p['sources'])

    def test_five_additions_keep_qualified_durations_and_sleeping_unknown(self):
        expected = {
            ('FL', 'florida_turnpike', 'turnpike_service_plaza'): ('prohibited', 'unknown'),
            ('ID', 'itd', 'safety_rest_area'): ('unknown', 'prohibited'),
            ('OH', 'odot', 'rest_area_or_roadside_park'): ('unknown', 'prohibited'),
            ('OR', 'odot', 'safety_rest_area'): ('unknown', 'prohibited'),
            ('VA', 'vdot', 'rest_area'): ('prohibited', 'prohibited'),
        }
        self.assertEqual(len(BUNDLE['policies']), 15)
        for (state, operator, kind), (parking, camping) in expected.items():
            with self.subTest(state=state):
                p = resolve(state, operator, kind)
                self.assertEqual(p['rules']['overnight_parking'], parking)
                self.assertEqual(p['rules']['camping'], camping)
                self.assertEqual(p['rules']['sleeping_in_vehicle'], 'unknown')
                self.assertIsNone(p['rules']['max_stay_hours'])
                self.assertEqual(p['current_opening'], 'unknown')
                self.assertTrue(p['sources'])
                self.assertIsNone(resolve(state, 'unmatched_agency', kind)['policy_id'])
                self.assertIsNone(resolve(state, operator, 'unmatched_class')['policy_id'])
                self.assertTrue(all(source['source_updated_at'] is None for source in p['sources']))
        self.assertIsNone(resolve('NE', 'ndot', 'safety_rest_area')['policy_id'])
        self.assertIsNone(resolve('GA', 'gdot', 'safety_rest_area')['policy_id'])

    def test_new_source_publishers_require_exact_audited_url(self):
        for index in range(2, len(BUNDLE['policies'])):
            for suffix in ['?download=1', '#fragment', '/unreviewed']:
                bundle = copy.deepcopy(BUNDLE)
                bundle['policies'][index]['sources'][0]['url'] += suffix
                with self.subTest(index=index, suffix=suffix), self.assertRaises(ValueError):
                    policy.validate(bundle, NOW)

    def test_invalid_and_ambiguous_evidence_rejected(self):
        for mutate in [lambda b: b['policies'].append(copy.deepcopy(b['policies'][0])),
                       lambda b: b['policies'][0].update(sources=[]),
                       lambda b: b['policies'][0]['sources'][0].update(url='https://example.com/'),
                       lambda b: b['policies'][0]['sources'][0].update(retrieved_at='2027-01-01T00:00:00Z')]:
            bundle = copy.deepcopy(BUNDLE)
            mutate(bundle)
            with self.assertRaises(ValueError):
                policy.validate(bundle, NOW)
        with self.assertRaises(ValueError):
            resolve(facility_id='test:1', exceptions=[exception(), exception()])

    def test_conflicting_site_rule_cannot_mutate_reusable_state_evidence(self):
        original = copy.deepcopy(BUNDLE)
        resolve(facility_id='test:1', exceptions=[exception(overnight_parking='prohibited')])
        self.assertEqual(BUNDLE, original)
        self.assertEqual(resolve()['rules']['overnight_parking'], 'allowed')


if __name__ == '__main__':
    unittest.main()
