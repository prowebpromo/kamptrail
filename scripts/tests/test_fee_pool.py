import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fee_pool', Path(__file__).resolve().parents[1] / 'analyze_fee_pool.py')
pool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pool)


def site(identity, kind='established', fee='unknown', aliases=None):
    return {'id': identity, 'legacy_ids': aliases or [], 'name': identity,
            'states': ['CA'], 'm': {'f': fee, 't': kind}}


def feature(identity, operator):
    return {'properties': {'id': identity, 'operator': operator}}


class FeePoolTests(unittest.TestCase):
    def test_overlap_alias_join_and_known_fee_exclusion(self):
        index = {'sites': [site('usfs:1', 'dispersed'), site('osm:node:2'),
                           site('ridb:3', aliases=['osm:node:3']), site('osm:node:4', fee='free')]}
        snapshots = [('CA', [feature('osm:node:2', 'USFS'), feature('osm:node:3', 'BLM'),
                             feature('osm:node:4', 'USFS'), feature('osm:node:2', 'USFS')])]
        result = pool.analyze(index, snapshots)
        self.assertEqual(result['eligibility_counts']['unique_pool'], 3)
        self.assertEqual(result['eligibility_counts']['dispersed_and_agency_overlap'], 1)
        self.assertEqual(result['eligibility_counts']['pool_if_operator_leads_require_primary_osm_id'], 2)
        self.assertEqual(len(result['sample']), 3)
        osm = next(x for x in result['sample'] if x['id'] == 'osm:node:2')
        self.assertEqual(len(osm['operator_evidence']), 1)
        self.assertTrue(all(x['fee_status'] == 'unknown' for x in result['sample']))

    def test_federal_match_does_not_treat_generic_or_state_operators_as_federal(self):
        rejected = ['Florida Forest Service', 'Delaware Forest Service', 'Forest Service',
                    'USDA', 'Tahoe National Forest']
        sites = [site('osm:node:' + str(i)) for i in range(len(rejected))]
        result = pool.analyze({'sites': sites}, [('CA', [feature(s['id'], op) for s, op in zip(sites, rejected)])])
        self.assertEqual(result['eligibility_counts']['unique_pool'], 0)
        for value in ['USFS', 'BLM', 'United States Forest Service', 'USDA Forest Service',
                      'USFS Tahoe National Forest', 'Bureau of Land Management']:
            self.assertIsNotNone(pool.FEDERAL_OPERATOR.search(value))

    def test_sample_is_order_independent_and_scoped_by_strata(self):
        sites = [site('osm:node:' + str(i)) for i in range(80)]
        features = [feature(s['id'], 'USFS') for s in sites]
        a = pool.analyze({'sites': sites}, [('CA', features)])
        b = pool.analyze({'sites': sites[::-1]}, [('CA', features[::-1])])
        self.assertEqual(a, b)
        self.assertEqual(a['sample_count'], 20)
        self.assertEqual(len({x['id'] for x in a['sample']}), 20)

    def test_ambiguous_catalogue_alias_fails_instead_of_arbitrary_join(self):
        with self.assertRaisesRegex(ValueError, 'Ambiguous catalogue alias'):
            pool.analyze({'sites': [site('ridb:1', aliases=['osm:node:1']), site('osm:node:1')]}, [])

    def test_snapshot_pointing_to_two_catalogue_records_is_excluded(self):
        index = {'sites': [site('osm:node:1'), site('ridb:2')]}
        f = feature('osm:node:1', 'USFS')
        f['properties']['source_ids'] = ['ridb:2']
        result = pool.analyze(index, [('CA', [f])])
        self.assertEqual(result['eligibility_counts']['unique_pool'], 0)
        self.assertEqual(result['retention_diagnostics']['ambiguous_snapshot_identity_joins_excluded'], 1)

    def test_first_thirty_attempts_include_all_strata(self):
        sites = [site('usfs:' + str(i), 'dispersed') for i in range(20)]
        sites += [site('blm-area:' + str(i)) for i in range(20)]
        osm = [site('osm:node:' + str(i)) for i in range(30)]
        sites += osm
        result = pool.analyze({'sites': sites}, [('CA', [feature(s['id'], 'BLM') for s in osm])])
        first = result['sample'][:30]
        self.assertEqual(len(first), 30)
        self.assertTrue(all(row['review_phase'] == 1 for row in first))
        from collections import Counter
        self.assertEqual(dict(Counter(row['stratum'] for row in first)), pool.INTERIM_QUOTAS)


if __name__ == '__main__':
    unittest.main()
