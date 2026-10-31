import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_official_rest_areas as rest


class Boundaries:
    def __init__(self, state='ID', outside=()):
        self.state, self.outside = state, set(outside)

    def classify_many(self, points):
        return {tuple(c): {'state': 'MT' if tuple(c) in self.outside else self.state} for c in points}


def layer(n=24, change=None):
    features = []
    for i in range(n):
        attrs = {'OBJECTID': i, 'GlobalID': '{%08X-0000-4000-8000-%012X}' % (i, i), 'FacilityName': f'Test Rest Area {i} - Eastbound',
                 'CommonRoadName': 'I-84', 'CountyName': 'Ada', 'ServiceLastUpdatedUTC': 1599842589000}
        geom = {'x': -116.1 + i * .01, 'y': 43.4}
        if i == 0 and change:
            change(attrs, geom)
        features.append({'attributes': attrs, 'geometry': geom})
    return json.dumps({'features': features}).encode()


class OfficialRestAreas(unittest.TestCase):
    cfg = rest.REGIONS['ID']

    def test_agency_identity_location_and_dates_are_kept_and_permission_stays_unknown(self):
        rows, rejected, count = rest.parse('ID', self.cfg, layer(), Boundaries())
        self.assertEqual((len(rows), rejected, count), (24, [], 24))
        self.assertTrue(all(r['permission'] == 'unknown' and r['state'] == 'ID' for r in rows))
        self.assertTrue(all(r['id'].startswith('itd:') for r in rows))
        self.assertEqual(len({r['id'] for r in rows}), 24)
        row = next(r for r in rows if r['name'].startswith('Test Rest Area 0 '))
        self.assertEqual(row['location'], 'I-84, Ada County')
        self.assertEqual(row['source_updated_at'], '2020-09-11T16:43:09Z')
        self.assertEqual(row['source_url'], self.cfg['info_url'])
        for key in ('overnight_parking', 'sleeping_in_vehicle', 'camping', 'fee', 'cost'):
            self.assertNotIn(key, row)

    def test_points_outside_the_census_state_are_rejected_not_assigned(self):
        raw = layer()
        outside = [-116.1, 43.4]
        rows, rejected, _ = rest.parse('ID', self.cfg, raw, Boundaries(outside=[tuple(outside)]))
        self.assertEqual(len(rows), 23)
        self.assertEqual(rejected[0]['reason'], 'outside_census_state_geometry')

    def test_bad_rows_are_rejected_and_bounds_protect_against_truncated_sources(self):
        rows, rejected, _ = rest.parse('ID', self.cfg, layer(change=lambda a, g: g.update(x=None)), Boundaries())
        self.assertEqual((len(rows), rejected[0]['reason']), (23, 'missing_geometry'))
        rows, rejected, _ = rest.parse('ID', self.cfg, layer(change=lambda a, g: g.update(x=-80.0)), Boundaries())
        self.assertEqual(rejected[0]['reason'], 'outside_state_bounds')
        with self.assertRaises(ValueError):
            rest.parse('ID', self.cfg, layer(n=5), Boundaries())
        with self.assertRaises(ValueError):
            rest.parse('ID', self.cfg, json.dumps({'features': [], 'exceededTransferLimit': True}).encode(), Boundaries())
        with self.assertRaises(ValueError):
            rest.parse('ID', self.cfg, layer(change=lambda a, g: a.update(GlobalID='{00000001-0000-4000-8000-000000000001}')), Boundaries())

    def test_only_the_exact_reviewed_endpoint_is_fetched(self):
        with self.assertRaises(ValueError):
            rest.fetch('https://example.com/rest', {rest.query_url(self.cfg)})

    def test_every_region_matches_a_reviewed_policy_scope(self):
        policies = json.loads((rest.ROOT / 'data/rest-areas/state-policies.json').read_text())['policies']
        scopes = {(p['scope']['state'], p['scope']['operator'], p['scope']['facility_kind']) for p in policies}
        for region, cfg in rest.REGIONS.items():
            self.assertIn((region, cfg['operator'], cfg['facility_kind']), scopes, region)

    def test_shrinking_sources_and_date_regressions_keep_the_prior_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'ID.json'
            prior = {'records': [{}] * 20, 'source': {'retrieved_at': '2026-10-31T00:00:00Z'}}
            path.write_text(json.dumps(prior))
            with self.assertRaises(ValueError):
                rest.guarded_write(path, {'records': [{}] * 10, 'source': {'retrieved_at': '2026-11-01T00:00:00Z'}})
            with self.assertRaises(ValueError):
                rest.guarded_write(path, {'records': [{}] * 20, 'source': {'retrieved_at': '2026-10-30T00:00:00Z'}})
            self.assertEqual(json.loads(path.read_text()), prior)


if __name__ == '__main__':
    unittest.main()
