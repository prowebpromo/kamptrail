import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_usfs_site_amenities as usfs  # noqa: E402

W, T = usfs.classify_water, usfs.classify_toilet


def row(cn, rid, water=None, toilet=None, **extra):
    base = {'site_cn': cn, 'public_site_name': f'Site {cn}', 'site_name': f'SITE {cn}', 'site_type': 'CAMPGROUND', 'rec1stop_id': rid,
            'water_availability': water, 'restroom_availability': toilet, 'open_season': None, 'season_description': None,
            'infra_last_update': 1786027825000, 'edw_last_modify': 1786068267000}
    base.update(extra)
    return base


class WaterClasses(unittest.TestCase):
    def test_drinking_water_needs_explicit_drinking_or_potable_wording(self):
        for text in ('Yes, drinking water is available from faucets', 'Yes, drinking water is available from a hand pump',
                     'Potable Water', 'Drinking Water', 'Drinking water is provided by a well with a hand pump',
                     'Potable water available. No water-hookups.', 'Yes drinking water is generally available'):
            self.assertEqual(W(text)[0], 'drinking_water', text)

    def test_hand_pump_qualifier_only_when_text_says_so(self):
        self.assertEqual(W('Yes, drinking water is available from a hand pump'), ('drinking_water', ['hand_pump']))
        self.assertEqual(W('Drinking water, Handpump'), ('drinking_water', ['hand_pump']))
        self.assertEqual(W('Yes, drinking water is available from faucets'), ('drinking_water', []))

    def test_seasonal_qualifier_only_when_the_water_text_says_season(self):
        self.assertEqual(W('Drinking water available seasonally.'), ('drinking_water', ['seasonal']))
        self.assertEqual(W('Potable water available during peak season'), ('drinking_water', ['seasonal']))
        self.assertEqual(W('Drinking Water available June 1st-Sept. 30'), ('drinking_water', []))

    def test_no_drinking_water(self):
        for text in ('No drinking water is available', 'No, drinking water is not provided', 'Not for drinking', 'No potable water',
                     'Non-Potable Water', 'Water can be treated or filtered from nearby water sources', 'No Drinking Water',
                     'Potable water not available.'):
            self.assertEqual(W(text)[0], 'no_drinking_water', text)

    def test_no_water(self):
        for text in ('No', 'no', 'No water is available', 'No water available', 'No water is available.', 'NO WATER',
                     'No water available. Bring drinking water.'):
            self.assertEqual(W(text)[0], 'no_water', text)

    def test_ambiguous_blank_and_null_text_stays_unknown(self):
        for text in ('Yes', 'AVAILABLE', 'None', 'NONE', 'NOT AVAILABLE', 'Hand pump', 'Water available', 'Pressurized water system',
                     'Drinking', 'Portable water', '', '   ', None, 'null', 'NULL', 'Concessions Only',
                     'Water available from stream near site.  Treat all water before using.'):
            self.assertEqual(W(text), ('unknown', []), repr(text))

    def test_mixed_partial_and_temporary_statements_stay_unknown(self):
        for text in ('No; drinking water is available at nearby campgrounds', 'Drinking Water, hand pump at nearby campground',
                     'Potable Water at Sites 6 and 13, available through 9/15', 'Potable Water Currently Unavailable',
                     'Potable Water is currently off for the winter season', 'No, the handpump has been discontinued.',
                     'Potable with periods of non-potable. We advise visitors to bring their own drinking water.',
                     'Outdoor Handpump in the summer months. No water is available in the winter.', 'Water pump; no water hook ups',
                     'No, drinking water is not available. The water system is Non-functioning for the Summer and Fall 2026 camping season.'):
            self.assertEqual(W(text)[0], 'unknown', text)


class ToiletClasses(unittest.TestCase):
    def test_flush(self):
        for text in ('Flush toilet(s)', 'Flush', 'Flush Toilets', 'Indoor flush toilet.', '2 builidings with flushing toilets and wash basins.'):
            self.assertEqual(T(text)[0], 'flush', text)

    def test_vault_or_pit(self):
        for text in ('Vault toilet(s)', 'Vault', 'PIT TOILET', 'Outhouse', 'COMPOSTING TOILET', 'Pit', 'Composting toilet(s)', 'Vault Toilet (3)'):
            self.assertEqual(T(text)[0], 'vault_or_pit', text)

    def test_no_toilet(self):
        for text in ('No restroom available', 'no toilets', 'No', 'No '):
            self.assertEqual(T(text), ('no_toilet', []), text)

    def test_nearby_only(self):
        self.assertEqual(T('Restrooms available nearby'), ('nearby_only', []))
        self.assertEqual(T('Vault Toilet (1) - Campground\nVault Toilet (1) - at nearby Trailhead')[0], 'unknown')

    def test_accessible_qualifier_only_when_stated(self):
        self.assertEqual(T('Accessible Vault Toilet'), ('vault_or_pit', ['accessible']))
        self.assertEqual(T('2 accessible outhouses '), ('vault_or_pit', ['accessible']))
        self.assertEqual(T('pit toilet, not ADA accessible'), ('vault_or_pit', []))
        self.assertEqual(T('Vault toilet(s)'), ('vault_or_pit', []))

    def test_ambiguous_mixed_and_unrelated_text_stays_unknown(self):
        for text in ('Yes', 'yes', 'Toilet (2)', 'Restrooms Available.', 'Portable toilet(s)', 'Flush & Vault', 'Flush toilet(s) and vault toilet(s)',
                     'Non-flushable', 'Accessible Toilet', 'Reservations can be made at Recreation.gov.', '', None, 'null',
                     'Beaver, Bass, & Hardwood loops have flush toilets & showers. Rustic loop has vault toilets only.'):
            self.assertEqual(T(text), ('unknown', []), repr(text))


class JoinAndConflicts(unittest.TestCase):
    def test_exact_id_join_only(self):
        rows = [row('1', '100', 'Potable Water', 'Vault toilet'), row('2', '1000', 'Potable Water'), row('3', ' 100', 'Potable Water'),
                row('4', '0100', 'Potable Water'), row('5', None, 'Potable Water')]
        facilities, stats = usfs.build(usfs.used_rows(rows), {'100'})
        self.assertEqual(list(facilities), ['100'])
        self.assertEqual(stats['matched_facilities'], 1)
        record = facilities['100']['records'][0]
        self.assertEqual(record['water'], {'text': 'Potable Water', 'class': 'drinking_water'})
        self.assertEqual(record['toilet']['class'], 'vault_or_pit')

    def test_exact_text_is_kept_and_blank_or_null_is_dropped(self):
        rows = [row('1', '100', ' Yes ', 'null'), row('2', '200', None, '   '), row('3', '300', 'None', None)]
        facilities, stats = usfs.build(usfs.used_rows(rows), {'100', '200', '300'})
        self.assertEqual(facilities['100']['records'][0]['water'], {'text': 'Yes', 'class': 'unknown'})
        self.assertNotIn('toilet', facilities['100']['records'][0])
        self.assertEqual(facilities['300']['records'][0]['water'], {'text': 'None', 'class': 'unknown'})
        self.assertNotIn('200', facilities, 'a match with no statement shows nothing')
        self.assertEqual((stats['matched_facilities'], stats['facilities_with_statements']), (3, 2))

    def test_season_text_is_context_and_never_a_water_class(self):
        rows = [row('1', '100', 'Yes', 'Vault', open_season='May - Sep', season_description='Closed in winter')]
        record = usfs.build(usfs.used_rows(rows), {'100'})[0]['100']['records'][0]
        self.assertEqual(record['season'], {'open_season': 'May - Sep', 'description': 'Closed in winter'})
        self.assertEqual(record['water']['class'], 'unknown')
        self.assertNotIn('qualifiers', record['water'])

    def test_dates_come_from_the_record_fields(self):
        record = usfs.build(usfs.used_rows([row('1', '100', 'Yes', infra_last_update=0, edw_last_modify=None)]), {'100'})[0]['100']['records'][0]
        self.assertEqual((record['updated'], record['edw_modified']), ('1970-01-01', None))

    def test_disagreeing_classes_are_a_conflict_and_unknown_does_not_count(self):
        rows = [row('1', '100', 'Potable Water', 'Vault toilet'), row('2', '100', 'No water is available', 'Vault toilet'),
                row('3', '200', 'Potable Water', 'Yes'), row('4', '200', 'Yes', 'Flush toilet')]
        facilities, _ = usfs.build(usfs.used_rows(rows), {'100', '200'})
        self.assertEqual(facilities['100']['conflicts'], ['water'])
        self.assertEqual(facilities['200']['conflicts'], [])

    def test_digest_is_canonical_and_ignores_input_order_and_extra_fields(self):
        a, b = row('1', '100', 'Yes'), row('2', None, 'x')
        first = usfs.used_rows([a, b, row('3', '300')])
        second = usfs.used_rows([{**row('3', '300'), '_lon': 1.5}, b, a])
        self.assertEqual(usfs.rows_digest(first), usfs.rows_digest(first))
        self.assertEqual([r['site_cn'] for r in first], ['1', '3'])
        self.assertEqual(set(first[0]), set(usfs.FIELDS))
        self.assertEqual(first, [{k: v for k, v in r.items() if k in usfs.FIELDS} for r in second])
        self.assertEqual(len(usfs.rows_digest(first)), 64)
        canonical = json.dumps(first, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        self.assertEqual(usfs.rows_digest(first), hashlib.sha256(canonical.encode()).hexdigest())


class MainGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.index = self.dir / 'index.json'
        self.index.write_text(json.dumps({'sites': [{'id': f'ridb:{n}'} for n in range(1, 401)]}))
        self.out = self.dir / 'out.json'
        self.snapshot = self.dir / 'snap.json'
        self._ranges = (usfs.ROWS_RANGE, usfs.MATCH_RANGE)
        usfs.ROWS_RANGE, usfs.MATCH_RANGE = (5, 100000), (3, 1000)

    def tearDown(self):
        usfs.ROWS_RANGE, usfs.MATCH_RANGE = self._ranges
        self.tmp.cleanup()

    def run_build(self, rows, retrieved='2026-10-31'):
        self.snapshot.write_text(json.dumps({'site': {'rows': rows}}))
        return usfs.main(['--snapshot', str(self.snapshot), '--retrieved', retrieved, '--index', str(self.index), '--out', str(self.out)])

    def rows(self, matched, extra=10):
        return [row(str(n), str(n), 'Potable Water', 'Vault toilet') for n in range(1, matched + 1)] + [row(f'x{n}', f'9{n}000') for n in range(extra)]

    def test_builds_and_records_source_and_counts(self):
        self.assertEqual(self.run_build(self.rows(50)), 0)
        data = json.loads(self.out.read_text())
        self.assertEqual(data['version'], 1)
        self.assertEqual(data['source']['retrieved'], '2026-10-31')
        self.assertEqual(data['source']['license'], 'CC BY 4.0')
        self.assertEqual((data['source']['matched_facilities'], data['source']['rows_used']), (50, 60))
        self.assertEqual(len(data['source']['rows_sha256']), 64)
        self.assertEqual(len(data['facilities']), 50)

    def test_sharp_drop_keeps_the_saved_file(self):
        self.assertEqual(self.run_build(self.rows(100)), 0)
        saved = self.out.read_text()
        self.assertEqual(self.run_build(self.rows(40)), 1)
        self.assertEqual(self.out.read_text(), saved)
        self.assertEqual(self.run_build(self.rows(90)), 0, 'a small change is accepted')

    def test_out_of_range_counts_keep_the_saved_file(self):
        self.assertEqual(self.run_build(self.rows(50)), 0)
        saved = self.out.read_text()
        self.assertEqual(self.run_build(self.rows(1, extra=10)), 1)
        self.assertEqual(self.run_build([row('1', '1')]), 1)
        self.assertEqual(self.out.read_text(), saved)

    def test_snapshot_requires_a_retrieval_date(self):
        self.snapshot.write_text(json.dumps({'site': {'rows': self.rows(50)}}))
        with self.assertRaises(SystemExit):
            usfs.main(['--snapshot', str(self.snapshot), '--index', str(self.index), '--out', str(self.out)])
        self.assertFalse(self.out.exists())


class CommittedFile(unittest.TestCase):
    def test_committed_file_matches_the_snapshot_record_counts(self):
        data = json.loads((Path(__file__).resolve().parents[2] / 'data/campsites/usfs-site-amenities.json').read_text())
        self.assertEqual(data['source']['retrieved'], '2026-10-31')
        self.assertEqual(data['source']['matched_facilities'], 735)
        self.assertEqual(len(data['facilities']), data['source']['facilities_with_statements'])
        self.assertEqual(sum(len(f['records']) for f in data['facilities'].values()), data['source']['records'])


if __name__ == '__main__':
    unittest.main()
