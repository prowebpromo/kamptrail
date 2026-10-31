import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import build_national_clearances as national
import clearance_parse as parse

DC_POINT = [-77.03, 38.9]
EXTRACT = '2026-10-28T21:21:02Z'


def way_geometry(n=3):
    return {'type': 'LineString', 'coordinates': [[-77.03 + i * 0.001, 38.9] for i in range(n)]}


def classify(tags, kind='way', geometry=None, boundaries=None):
    return national.classify_element(kind, 7, 3, '2026-01-01T00:00:00Z', tags, geometry or (way_geometry() if kind == 'way' else {'type': 'Point', 'coordinates': DC_POINT}),
                                     boundaries or national.DcBoundaries(), 'DC', EXTRACT)


def make_source(sha='a' * 64):
    return {'kind': 'geofabrik', 'url': national.DC_URL, 'resolved_url': national.DC_URL, 'sha256': sha, 'bytes': 10,
            'retrieved_at': '2026-10-30T16:30:30Z', 'extract_timestamp': EXTRACT, 'containment': 'bbox', **national.LICENSE}


class ParsingTests(unittest.TestCase):
    def test_feet_and_inches_are_exact(self):
        for raw, inches in [("9'4\"", 112), ("12'", 144), ("13'6\"", 162), ("0'6\"", 6), ("14'11\"", 179)]:
            result = parse.parse_height_text(raw)
            self.assertEqual((result['status'], result['inches']), ('numeric', inches), raw)
        self.assertAlmostEqual(parse.parse_height_text("9'4\"")['metres'], 2.8448)

    def test_metric_and_floor_rounding(self):
        self.assertEqual(parse.parse_height_text('3.8')['inches'], 149.6)  # 149.6063 floors, never rounds up
        self.assertEqual(parse.parse_height_text('3.8 m')['metres'], 3.8)
        self.assertEqual(parse.parse_height_text('4')['inches'], 157.48)
        self.assertEqual(parse.parse_height_text('2.5')['inches'], 98.42)

    def test_bounds(self):
        for raw in ('0', '0.0', '100.01', "0'0\""):
            self.assertEqual(parse.parse_height_text(raw)['status'], 'unparseable', raw)
        self.assertEqual(parse.parse_height_text('100')['status'], 'numeric')

    def test_below_default(self):
        result = parse.parse_height_text('below_default')
        self.assertEqual(result, {'status': 'below_default', 'metres': None, 'inches': None})

    def test_none_default_and_blank_are_unknown(self):
        for raw in ('none', 'default', 'no_indications', 'unsigned', '', 'None'):
            result = parse.parse_height_text(raw)
            self.assertEqual((result['status'], result['inches']), ('unknown', None), raw)

    def test_ranges_lists_conditionals_and_other_units_are_unparseable(self):
        for raw in ('3.5-4.2', '3.5 - 4.2', '3.8;4.2', '4|5', '4 @ (wet)', '13 ft', '3,8', '3.8m', ' 3.8', "6'12\"", "6' 7\"", '-4', '12 feet', '1e1'):
            result = parse.parse_height_text(raw)
            self.assertEqual((result['status'], result['inches']), ('unparseable', None), raw)
        self.assertEqual(parse.parse_height_text(None)['status'], 'unparseable')

    def test_matches_pilot_parser(self):
        import build_clearances
        for raw in ('3.8', '3 m', "6'7\"", "12'", 'none', '13 ft', '0', '101', '3.8;4.2', "6'12\""):
            pilot = build_clearances.parse_height(raw)
            mine = parse.parse_height_text(raw)['metres']
            self.assertEqual(pilot is None, mine is None, raw)
            if pilot is not None:
                self.assertAlmostEqual(pilot, mine)

    def test_below_equal_and_above_rig_height(self):
        rig = 156.0  # 13 ft
        self.assertEqual(parse.compare_to_rig(155.99, rig), {'relation': 'below', 'comfortable': False})
        self.assertEqual(parse.compare_to_rig(156.0, rig), {'relation': 'equal', 'comfortable': False})
        self.assertEqual(parse.compare_to_rig(156.01, rig), {'relation': 'above', 'comfortable': True})

    def test_equality_is_never_comfortable_even_from_parsed_text(self):
        clearance = parse.parse_height_text("13'")['inches']
        self.assertEqual(parse.compare_to_rig(clearance, 156), {'relation': 'equal', 'comfortable': False})
        self.assertFalse(parse.compare_to_rig(156, 156, margin_inches=0)['comfortable'])

    def test_margin_makes_above_not_comfortable(self):
        self.assertEqual(parse.compare_to_rig(160, 156, margin_inches=6), {'relation': 'above', 'comfortable': False})
        self.assertEqual(parse.compare_to_rig(162, 156, margin_inches=6), {'relation': 'above', 'comfortable': False})
        self.assertTrue(parse.compare_to_rig(162.01, 156, margin_inches=6)['comfortable'])

    def test_unknown_clearance_never_compares(self):
        self.assertEqual(parse.compare_to_rig(None, 156), {'relation': 'unknown', 'comfortable': False})
        with self.assertRaises(ValueError):
            parse.compare_to_rig(100, 0)

VA_POINT = [-77.10, 38.85]


def candidate(i, tags=None, context=None, structure=None, kind='way', region='DC', geometry=None, oid=None):
    """A finalized candidate, built the same way the live and migrate paths build one."""
    oid = oid or 1000 + i
    row = {'id': f'osm:{kind}:{oid}', 'osm_type': kind, 'osm_id': str(oid), 'osm_version': 1, 'edited_at': '2026-01-01T00:00:00Z', 'state': region,
           'geometry': geometry or (way_geometry() if kind == 'way' else {'type': 'Point', 'coordinates': DC_POINT}),
           'tags': tags or {'maxheight': "9'4\""}, 'context': context if context is not None else {'highway': 'service'},
           'restriction_on': 'way' if kind == 'way' else 'node', 'structure': structure or []}
    outcome, value = national.finalize_row(row)
    assert outcome == 'row', value
    return value


def assess(tags, context=None, structure=None, restriction_on='way'):
    return parse.assess(tags, {'highway': 'secondary'} if context is None else context, structure or [], restriction_on)


class FenceAndHeightRuleTests(unittest.TestCase):
    def test_plain_height_on_non_road_objects_is_excluded_with_raw_value_and_reason(self):
        for barrier in ('fence', 'wall', 'gate', 'bollard', 'retaining_wall', 'hedge', 'lift_gate'):
            outcome, entry = classify({'barrier': barrier, 'height': '1.8'})
            self.assertEqual(outcome, 'excluded', barrier)
            self.assertEqual((entry['reason'], entry['tag'], entry['raw']), ('plain_height_not_vehicle_path', 'barrier=' + barrier, '1.8'))
            self.assertTrue(entry['id'].startswith('osm:way:'))

    def test_plain_height_is_kept_only_where_it_limits_a_vehicle_path(self):
        self.assertEqual(classify({'barrier': 'height_restrictor', 'height': '3.2'}, kind='node')[0], 'row')
        self.assertEqual(classify({'highway': 'service', 'tunnel': 'yes', 'height': '4'})[0], 'row')
        self.assertEqual(classify({'highway': 'service', 'tunnel': 'building_passage', 'height': '4'})[0], 'row')
        outcome, row = classify({'highway': 'service', 'bridge': 'yes', 'height': '4'})
        self.assertEqual(outcome, 'row')
        self.assertIn('height_kept_structure_on_highway', row['reasons'])
        self.assertEqual(classify({'bridge': 'yes', 'man_made': 'bridge', 'height': '4'})[0], 'excluded')
        self.assertEqual(classify({'railway': 'rail', 'tunnel': 'yes', 'height': '6'})[0], 'excluded')

    def test_buildings_are_counted_not_listed(self):
        self.assertEqual(classify({'building': 'yes', 'height': '12'}), ('skip', 'height_only_no_road_context:building'))
        self.assertEqual(classify({'natural': 'tree', 'height': '12'}), ('skip', 'height_only_no_road_context:natural'))

    def test_height_beside_maxheight_on_a_fence_is_ignored_but_kept_raw(self):
        outcome, row = classify({'barrier': 'fence', 'height': '1.8', 'maxheight': '3.5'})
        self.assertEqual(outcome, 'row')
        self.assertEqual(row['tags'], {'height': '1.8', 'maxheight': '3.5'})
        self.assertEqual(list(row['parse']), ['maxheight'])
        self.assertIn('height_ignored_plain_height_not_vehicle_path', row['reasons'])
        self.assertEqual(row['min_inches'], 137.79)

    def test_excluded_ids_round_trip_and_count(self):
        entries = [{'id': f'osm:{t}:{n}', 'osm_type': t, 'reason': 'plain_height_not_vehicle_path', 'tag': tag, 'raw': raw}
                   for t, n, tag, raw in [('way', 90, 'barrier=fence', '1.8'), ('way', 12, 'barrier=fence', '2'), ('node', 5, 'barrier=fence', '1.8'),
                                          ('node', 7, 'barrier=wall', '3')]]
        doc = national.encode_excluded('DC', entries)
        self.assertEqual(doc['total'], 4)
        self.assertEqual(national.decode_excluded(doc), sorted(entries, key=lambda e: e['id']))
        self.assertEqual(national.excluded_counts(doc), ({'plain_height_not_vehicle_path': 4}, {'plain_height_not_vehicle_path': {'barrier=fence': 3, 'barrier=wall': 1}}))
        self.assertEqual(national.encode_excluded('DC', list(reversed(entries))), doc)


class UnitlessAndSuspectTests(unittest.TestCase):
    def test_bare_number_is_metres_and_the_value_is_never_changed(self):
        result = assess({'maxheight': '3.8'})
        self.assertEqual((result['unit_assumed'], result['plausibility'], result['status'], result['comparable']), ('metres', 'ok', 'numeric_only', True))
        self.assertEqual(result['metres']['maxheight'], 3.8)
        row = candidate(1, {'maxheight': '13'}, {'highway': 'motorway'})
        self.assertEqual(row['tags'], {'maxheight': '13'})
        self.assertEqual(row['metres'], {'maxheight': 13.0})

    def test_explicit_units_are_not_flagged_as_assumed(self):
        self.assertNotIn('unit_assumed', assess({'maxheight': "13'6\""}))
        self.assertNotIn('unit_assumed', assess({'maxheight': '3.8 m'}))

    def test_bare_six_and_up_is_suspect_and_not_comparable(self):
        for raw, code in [('6', 'bare_number_likely_feet'), ('8', 'bare_number_likely_feet'), ('13', 'bare_number_likely_feet'), ('16', 'bare_number_likely_feet'),
                          ('20', 'bare_number_likely_feet'), ('55', 'bare_number_implausible_metres')]:
            result = assess({'maxheight': raw})
            self.assertEqual((result['status'], result['plausibility'], result['comparable'], result['unit_assumed']), ('suspect', 'suspect', False, 'metres'), raw)
            self.assertIn(code, result['reasons'], raw)
            self.assertNotIn('min_inches', result)
        self.assertEqual(assess({'maxheight': '5.4'})['status'], 'numeric_only')

    def test_highway_bounds_are_five_and_eighteen_feet_inclusive(self):
        self.assertEqual(assess({'maxheight': "5'0\""})['status'], 'numeric_only')
        self.assertEqual(assess({'maxheight': "4'11\""})['reasons'], ['under_5ft_on_highway'])
        self.assertEqual(assess({'maxheight': "18'0\""})['status'], 'numeric_only')
        self.assertEqual(assess({'maxheight': "18'1\""})['reasons'], ['over_18ft_on_highway'])
        self.assertEqual(assess({'maxheight': '1.524'})['status'], 'numeric_only')
        self.assertEqual(assess({'maxheight': '1.5'})['status'], 'suspect')
        self.assertEqual(assess({'maxheight': '5.4864'})['status'], 'numeric_only')

    def test_bounds_apply_to_vehicle_highways_not_footways_or_barriers(self):
        self.assertEqual(assess({'maxheight': '1.5'}, {'highway': 'footway'})['status'], 'numeric_only')
        self.assertEqual(assess({'maxheight': '1.5'}, {'barrier': 'height_restrictor'}, ['height_restrictor'], 'node')['status'], 'numeric_only')

    def test_implausible_values_stay_visible_in_the_data(self):
        row = candidate(2, {'maxheight': '55'}, {'highway': 'motorway'})
        self.assertEqual((row['status'], row['comparable'], row['unit_assumed'], row['plausibility']), ('suspect', False, 'metres', 'suspect'))

    def test_wiki_citation_is_recorded(self):
        self.assertIn('https://wiki.openstreetmap.org/Key:maxheight', Path(parse.__file__).read_text())


class StatusAndComparabilityTests(unittest.TestCase):
    def test_numeric_only_is_the_only_comparable_status(self):
        result = assess({'maxheight': "13'6\"", 'maxheight:physical': '4.0'})
        self.assertEqual((result['status'], result['comparable']), ('numeric_only', True))
        self.assertEqual((result['min_inches'], result['min_metres']), (157.48, 4.0))  # the lower of 162 and 157.48
        self.assertEqual(set(parse.STATUSES_CANDIDATE), {'numeric_only', 'mixed', 'directional_only', 'conditional', 'unknown', 'suspect'})

    def test_directional_only(self):
        for tags in ({'maxheight:forward': '3.5'}, {'maxheight:backward': '3.5'}, {'maxheight:forward': '3.5', 'maxheight:backward': '3.2'}, {'maxheight:lanes': '3.5|3.2'}):
            result = assess(tags)
            self.assertEqual((result['status'], result['comparable']), ('directional_only', False), tags)
            self.assertNotIn('min_inches', result)

    def test_mixed_when_plain_value_meets_direction_lanes_or_a_non_numeric_key(self):
        for tags in ({'maxheight': '3.5', 'maxheight:forward': '3.2'}, {'maxheight': '3.5', 'maxheight:lanes': '3.5|3'},
                     {'maxheight': '3.5', 'maxheight:physical': 'none'}, {'maxheight': '3.5', 'maxheight:physical': '3.5-4'}):
            result = assess(tags)
            self.assertEqual((result['status'], result['comparable']), ('mixed', False), tags)

    def test_conditional_is_never_comparable(self):
        for tags in ({'maxheight': '4', 'maxheight:conditional': '3.5 @ (Nov-Mar)'}, {'maxheight:conditional': '3.5 @ wet'},
                     {'maxheight': '4 @ (Mo-Fr 07:00-09:00)'}, {'maxheight': '4', 'maxheight:forward:conditional': '3 @ snow'}):
            result = assess(tags)
            self.assertEqual((result['status'], result['comparable']), ('conditional', False), tags)
            self.assertNotIn('min_inches', result)

    def test_unknown_words_below_default_and_unparseable_are_unknown(self):
        for tags in ({'maxheight': 'none'}, {'maxheight': 'default'}, {'maxheight': 'below_default'}, {'maxheight': '3.5-4.2'}, {'maxheight': '13 ft'},
                     {'maxheight': 'none', 'maxheight:physical': 'default'}):
            result = assess(tags)
            self.assertEqual((result['status'], result['comparable'], result['plausibility']), ('unknown', False, 'not_assessed'), tags)

    def test_suspect_wins_over_mixed_and_directional_but_conditional_wins_over_suspect(self):
        self.assertEqual(assess({'maxheight': '13', 'maxheight:forward': '3'})['status'], 'suspect')
        self.assertEqual(assess({'maxheight:forward': '13'})['status'], 'suspect')
        self.assertEqual(assess({'maxheight': '13', 'maxheight:conditional': '3 @ wet'})['status'], 'conditional')

    def test_empty_set_has_no_minimum(self):
        self.assertIsNone(parse.lowest_inches([]))
        self.assertIsNone(parse.lowest_inches(iter(())))
        self.assertEqual(parse.lowest_inches([(162.0, 4.11), (157.48, 4.0)]), (157.48, 4.0))
        for tags in ({'maxheight': 'none'}, {'maxheight:forward': '3'}, {'maxheight': '13'}):
            result = assess(tags)
            self.assertNotIn('min_inches', result)
            self.assertNotIn('min_metres', result)

    def test_clearance_equal_to_rig_height_is_never_clear(self):
        low = assess({'maxheight': "13'6\""})['min_inches']
        self.assertEqual(parse.compare_to_rig(low, 162), {'relation': 'equal', 'comfortable': False})
        self.assertEqual(parse.compare_to_rig(low, 161.99), {'relation': 'above', 'comfortable': True})
        self.assertEqual(parse.compare_to_rig(low, 162.01), {'relation': 'below', 'comfortable': False})

    def test_parse_keeps_unit_forms(self):
        self.assertEqual([parse.value_unit(v) for v in ('3.8', '3.8 m', "9'4\"", "12'", 'none', '13 ft')],
                         ['metres_assumed', 'metres', 'feet_inches', 'feet_inches', None, None])


class AppliesToTests(unittest.TestCase):
    def test_tag_on_the_highway_way_applies_to_the_way(self):
        result = assess({'maxheight': '3.5'}, {'highway': 'primary'})
        self.assertEqual((result['applies_to'], result['applies_to_evidence']), ('way_itself', ['tag_on_highway_way', 'highway=primary']))

    def test_a_bridge_alone_is_never_evidence_of_road_below(self):
        result = assess({'maxheight': '3.5'}, {'highway': 'primary', 'bridge': 'yes'}, ['bridge'])
        self.assertEqual(result['applies_to'], 'way_itself')
        self.assertNotIn('road_below', result['applies_to'])
        self.assertEqual(assess({'maxheight': '3.5'}, {'man_made': 'bridge'}, ['bridge'])['applies_to'], 'unknown')
        self.assertEqual(assess({'maxheight': '3.5'}, {'railway': 'rail', 'bridge': 'yes'}, ['bridge'])['applies_to'], 'unknown')

    def test_road_below_needs_tunnel_covered_or_negative_layer_on_a_highway_way(self):
        tunnel = assess({'maxheight': '3.5'}, {'highway': 'primary', 'tunnel': 'yes'}, ['tunnel'])
        self.assertEqual((tunnel['applies_to'], 'way_is_tunnel' in tunnel['applies_to_evidence']), ('road_below', True))
        layer = assess({'maxheight': '3.5'}, {'highway': 'service', 'layer': '-1'})
        self.assertEqual((layer['applies_to'], 'way_on_negative_layer' in layer['applies_to_evidence']), ('road_below', True))
        self.assertEqual(assess({'maxheight': '3.5'}, {'highway': 'service', 'layer': '1', 'bridge': 'yes'}, ['bridge'])['applies_to'], 'way_itself')

    def test_nodes_and_everything_else_are_unknown_with_evidence(self):
        node = assess({'maxheight': '3.5'}, {'barrier': 'height_restrictor'}, ['height_restrictor'], 'node')
        self.assertEqual((node['applies_to'], node['applies_to_evidence']), ('unknown', ['barrier_node_parent_way_not_recorded']))
        other = assess({'maxheight': '3.5'}, {'barrier': 'gate'}, [], 'way')
        self.assertEqual((other['applies_to'], other['applies_to_evidence']), ('unknown', ['no_highway_way_evidence']))
        self.assertEqual(assess({'maxheight': '3.5'}, {'highway': 'primary'}, [], 'node')['applies_to'], 'unknown')


class TileTests(unittest.TestCase):
    def scatter(self, count, step=0.02, lon=-100.0, lat=40.0):
        return [candidate(i, geometry={'type': 'Point', 'coordinates': [lon + (i % 50) * step, lat + (i // 50) * step]}, kind='node',
                          tags={'maxheight': '3.5'}, context={'barrier': 'height_restrictor'}, structure=['height_restrictor'], oid=5000 + i) for i in range(count)]

    def test_every_tile_is_within_limits_and_records_fall_inside_their_bbox_and_cell(self):
        rows = self.scatter(600)
        tiles = national.make_tiles(rows, max_bytes=60_000, target_bytes=30_000, max_records=200)
        self.assertGreater(len(tiles), 4)
        self.assertEqual(sum(t['records'] for t in tiles), 600)
        for tile in tiles:
            self.assertLessEqual(tile['bytes'], 60_000)
            self.assertLessEqual(tile['records'], 200)
            doc = json.loads(tile['data'])
            self.assertEqual(doc['bbox'], tile['bbox'])
            for record in doc['candidates']:
                box = national.record_bbox(record)
                self.assertTrue(tile['bbox'][0] <= box[0] and tile['bbox'][1] <= box[1] and box[2] <= tile['bbox'][2] and box[3] <= tile['bbox'][3])
                centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
                self.assertEqual(national.tile_xy(*centre, tile['z']), (tile['x'], tile['y']))

    def test_default_limits_match_the_pilot_client_and_the_brief(self):
        self.assertEqual((national.MAX_FILE_BYTES, national.MAX_FILE_RECORDS, national.MAX_FILE_VERTICES), (512 * 1024, 2000, 50000))
        self.assertLess(national.TILE_TARGET_BYTES, national.MAX_FILE_BYTES)

    def test_oversized_single_record_is_refused(self):
        row = candidate(1, geometry={'type': 'LineString', 'coordinates': [[-77 + i * 1e-6, 38.9] for i in range(60000)]})
        with self.assertRaises(ValueError):
            national.make_tiles([row])

    def test_crowded_point_splits_into_parts_at_max_zoom(self):
        rows = [candidate(i, geometry={'type': 'Point', 'coordinates': [-100.0, 40.0]}, kind='node', tags={'maxheight': '3.5'}, context={'barrier': 'height_restrictor'},
                          structure=['height_restrictor'], oid=7000 + i) for i in range(120)]
        tiles = national.make_tiles(rows, max_bytes=20_000, target_bytes=10_000)
        self.assertTrue(all(t['z'] == national.TILE_MAX_ZOOM for t in tiles))
        self.assertGreater(len(tiles), 1)
        self.assertEqual([t['part'] for t in tiles], list(range(1, len(tiles) + 1)))
        self.assertEqual(len({t['path'] for t in tiles}), len(tiles))

    def test_a_way_crossing_a_cell_edge_is_found_from_either_side(self):
        edge = -78.75  # a z7 cell edge
        crossing = candidate(1, geometry={'type': 'LineString', 'coordinates': [[edge - 0.2, 40.0], [edge + 0.1, 40.0]]})
        tiles = national.make_tiles([crossing])
        self.assertEqual(len(tiles), 1)
        index = {'tiles': [{k: t[k] for k in ('path', 'bbox', 'bytes', 'records')} for t in tiles]}
        for lon in (edge - 0.15, edge + 0.05):
            view = national.viewport_bbox(lon, 40.0, 14, 400, 300)
            self.assertEqual(len(national.tiles_for_view(index, view)), 1)
        self.assertEqual(national.tiles_for_view(index, national.viewport_bbox(edge + 1, 40.0, 14, 400, 300)), [])

    def test_viewport_widths_shrink_with_zoom(self):
        wide, narrow = national.viewport_bbox(-100, 40, 8), national.viewport_bbox(-100, 40, 12)
        self.assertGreater(wide[2] - wide[0], 10 * (narrow[2] - narrow[0]))


class DedupeTests(unittest.TestCase):
    def docs(self):
        across = {'type': 'LineString', 'coordinates': [[-77.12, 38.85], [-77.10, 38.90]]}  # DC bbox and VA both list it
        dc = national.make_state_doc('DC', make_source(), [candidate(1, geometry=across, oid=900), candidate(2, oid=901)], [])
        va = national.make_state_doc('VA', {**make_source('b' * 64), 'containment': 'census_polygon'}, [candidate(1, geometry=across, oid=900, region='VA'), candidate(3, oid=902, region='VA')], [])
        return dc, va

    def test_one_identity_is_stored_once_under_the_census_state(self):
        dc, va = self.docs()
        merged = national.merge_candidates([], {'DC': dc, 'VA': va})
        self.assertEqual([r['id'] for r in merged], ['osm:way:900', 'osm:way:901', 'osm:way:902'])
        shared = next(r for r in merged if r['id'] == 'osm:way:900')
        self.assertEqual((shared['state'], shared['also_in_extracts']), ('VA', ['DC']))
        self.assertNotIn('also_in_extracts', merged[1])

    def test_refreshing_one_extract_keeps_the_other_membership(self):
        dc, va = self.docs()
        merged = national.merge_candidates([], {'DC': dc, 'VA': va})
        after_va = national.merge_candidates(merged, {'VA': national.make_state_doc('VA', make_source('c' * 64), [], [])})
        shared = next(r for r in after_va if r['id'] == 'osm:way:900')
        self.assertEqual(shared['state'], 'DC')
        self.assertNotIn('also_in_extracts', shared)
        self.assertNotIn('osm:way:902', [r['id'] for r in after_va])

    def test_boundary_crossing_candidate_loads_from_both_sides_and_loads_once(self):
        dc, va = self.docs()
        with tempfile.TemporaryDirectory() as tmp:
            store = {'sources': {}, 'failures': {}, 'excluded': {}, 'candidates': national.merge_candidates([], {'DC': dc, 'VA': va})}
            for region, doc in (('DC', dc), ('VA', va)):
                store['sources'][region] = national.source_entry(doc['source'], doc)
                store['excluded'][region] = doc['excluded']
            index, _, _ = national.write_store(tmp, store)
            self.assertEqual(national.verify_index(tmp), [])
            self.assertEqual(index['totals']['candidates'], 3)
            for lon, lat in ((-77.115, 38.86), (-77.105, 38.89)):
                hits = national.tiles_for_view(index, national.viewport_bbox(lon, lat, 15, 300, 300))
                loaded = [r['id'] for t in hits for r in json.loads((Path(tmp) / t['path']).read_text())['candidates']]
                self.assertEqual(loaded.count('osm:way:900'), 1)


class ProtectedAndManifestTests(unittest.TestCase):
    def test_ri_is_protected_not_failed_and_never_downloaded(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            status = national.build_state('RI', directory=tmp, stage=Path(tmp) / 's', scratch=Path(tmp) / 'x', downloader=lambda *a: calls.append(a))
            self.assertEqual((status['status'], calls), ('protected', []))
            self.assertNotIn('failure', status)
        self.assertNotIn('RI', national.BUILD_REGIONS)
        self.assertEqual(len(national.BUILD_REGIONS), 50)
        self.assertEqual(national.regions_from(['ALL']), list(national.BUILD_REGIONS))
        plan = national.plan('RI', national.DEFAULT_DIR, 'x')
        self.assertEqual((plan['skip'], plan['url']), ('protected', None))

    def test_manifest_records_ri_under_states_protected_with_a_reason_and_gate(self):
        index = national.build_index([], {'candidates': [], 'excluded': {}, 'sources': {}, 'failures': {'RI': {'reason': 'old'}, 'DC': {'reason': 'build_failed'}}})
        ri = index['states_protected']['RI']
        self.assertEqual(ri['status'], 'protected')
        self.assertTrue(ri['reason'] and ri['release_gate'])
        self.assertEqual(index['totals']['states_with_failures'], ['DC'])
        self.assertNotIn('RI', index['failures'])
        self.assertNotIn('RI', index['totals']['states_not_built'])

    def test_manifest_carries_no_failure_timestamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp) / 'stage'
            (stage / 'status').mkdir(parents=True)
            (stage / 'status' / 'DC.json').write_text(json.dumps({'state': 'DC', 'status': 'failed', 'attempted_at': '2026-11-03T00:00:00Z', 'failure': {'reason': 'build_failed'}}))
            for region in ('MD', 'VA', 'WV', 'WY'):
                (stage / 'status' / f'{region}.json').write_text(json.dumps({'state': region, 'status': 'unchanged'}))
            index, _, failed, _ = national.publish(stage, Path(tmp) / 'data')
            text = json.dumps(index)
            self.assertNotIn('2026-11-03', text)
            self.assertEqual(index['failures'], {'DC': {'reason': 'build_failed'}})

    def test_no_data_file_or_manifest_calls_a_candidate_verified(self):
        for path in sorted(national.DEFAULT_DIR.rglob('*.json')):
            if path.name == 'RI.json':
                continue
            text = path.read_text()
            self.assertNotRegex(text, r'(?i)verified clearance', path.name)
            break
        index = json.loads((national.DEFAULT_DIR / 'index.json').read_text())
        self.assertIn('clearance candidates', index['terminology'])
        self.assertNotRegex(json.dumps(index), r'(?i)verified clearance')


class BuildAndGuardTests(unittest.TestCase):
    def fake_worker(self, rows, excluded=(), reasons=None):
        def worker(pbf, receipt, scratch, region):
            return {'source': {**make_source(receipt['sha256']), 'retrieved_at': receipt['retrieved_at']}, 'candidates': list(rows), 'excluded': list(excluded),
                    'report': {'quarantined': 0, 'quarantine_reasons': {}, 'skipped': {}, 'vertices': 0, 'excluded': len(list(excluded))}}
        return worker

    def receipt(self, sha, when='2026-11-03T05:00:00Z'):
        return {'sha256': sha, 'retrieved_at': when, 'url': national.DC_URL, 'resolved_url': national.DC_URL, 'bytes': 10}

    def build(self, tmp, rows, sha, when='2026-11-03T05:00:00Z', region='DC', excluded=()):
        return national.build_state(region, directory=Path(tmp) / 'data', stage=Path(tmp) / 'stage', scratch=Path(tmp) / 'scratch', pbf=Path(tmp) / 'x.pbf',
                                    receipt=self.receipt(sha, when), worker=self.fake_worker(rows, excluded), now=lambda: '2026-11-03T05:00:00Z')

    def publish(self, tmp, **kw):
        return national.publish(Path(tmp) / 'stage', Path(tmp) / 'data', **kw)

    def rows(self, n=20):
        return [candidate(i) for i in range(n)]

    def calm_states(self, stage, regions=('MD', 'VA', 'WV', 'WY')):
        (Path(stage) / 'status').mkdir(parents=True, exist_ok=True)
        for region in regions:
            (Path(stage) / 'status' / f'{region}.json').write_text(json.dumps({'state': region, 'status': 'unchanged'}))

    def test_guard_reasons(self):
        prior = {'candidates': 100}
        self.assertEqual(national.guard(None, 0, 10), 'no_records')
        self.assertEqual(national.guard(prior, 69, 10), 'shrunk_sharply')
        self.assertIsNone(national.guard(prior, 70, 10))
        self.assertEqual(national.guard(None, 5, national.MAX_STATE_BYTES + 1), 'state_too_large')
        self.assertIsNone(national.guard({'candidates': 5}, 1, 10))

    def test_good_build_stages_a_state_file_and_publish_writes_tiles_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            status = self.build(tmp, self.rows(), 'a' * 64)
            self.assertEqual((status['status'], status['candidates']), ('ok', 20))
            index, updated, failed, written = self.publish(tmp, expected=['DC'])
            self.assertEqual((len(updated), failed), (1, []))
            self.assertEqual(index['totals']['candidates'], 20)
            self.assertEqual(index['sources']['DC']['source_sha256'], 'a' * 64)
            self.assertEqual(index['sources']['DC']['extract_timestamp'], EXTRACT)
            self.assertEqual(national.verify_index(Path(tmp) / 'data'), [])

    def test_same_source_hash_skips_parsing_and_same_content_is_not_restaged(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.build(tmp, self.rows(), 'a' * 64)
            self.publish(tmp)
            again = self.build(tmp, self.rows(), 'a' * 64, when='2026-12-01T05:00:00Z')
            self.assertEqual(again['status'], 'unchanged')
            fresh = Path(tmp) / 'stage2'
            status = national.build_state('DC', directory=Path(tmp) / 'data', stage=fresh, scratch=Path(tmp) / 's', pbf=Path(tmp) / 'x.pbf',
                                          receipt=self.receipt('d' * 64, '2026-12-01T05:00:00Z'), worker=self.fake_worker(self.rows()))
            self.assertEqual(status['status'], 'unchanged_content')
            self.assertFalse((fresh / 'state' / 'DC.json').exists())

    def test_sharp_shrink_keeps_prior_and_stages_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.build(tmp, self.rows(20), 'a' * 64)
            self.publish(tmp)
            shutil_stage = Path(tmp) / 'stage'
            for p in list(shutil_stage.rglob('*.json')):
                p.unlink()
            status = self.build(tmp, self.rows(5), 'b' * 64)
            self.assertEqual((status['status'], status['failure']['reason']), ('kept_prior', 'shrunk_sharply'))
            self.assertFalse((shutil_stage / 'state' / 'DC.json').exists())

    def test_failed_fetch_keeps_prior_data_and_the_manifest_records_a_reason_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.build(tmp, self.rows(), 'a' * 64)
            self.publish(tmp)
            def broken(region, path):
                raise ValueError('network down')
            self.calm_states(Path(tmp) / 'stage3')
            status = national.build_state('DC', directory=Path(tmp) / 'data', stage=Path(tmp) / 'stage3', scratch=Path(tmp) / 's', downloader=broken)
            self.assertEqual((status['status'], status['failure']), ('kept_prior', {'reason': 'build_failed'}))
            index, _, failed, _ = national.publish(Path(tmp) / 'stage3', Path(tmp) / 'data', expected=['DC', 'MD', 'VA', 'WV', 'WY'])
            self.assertEqual(index['totals']['candidates'], 20)
            self.assertEqual(index['failures'], {'DC': {'reason': 'build_failed'}})
            self.assertEqual(national.verify_index(Path(tmp) / 'data'), [])

    def test_crashed_job_and_mostly_failed_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.calm_states(Path(tmp) / 'calm')
            index, _, failed, _ = national.publish(Path(tmp) / 'calm', Path(tmp) / 'data', expected=['DC', 'MD', 'VA', 'WV', 'WY'])
            self.assertEqual(index['failures'], {'DC': {'reason': 'no_status_from_job'}})
            with self.assertRaises(SystemExit):
                national.publish(Path(tmp) / 'none', Path(tmp) / 'data', expected=['DC', 'VA', 'MD', 'CA'])

    def test_exclusions_are_published_by_reason_tag_and_state(self):
        entries = [{'id': 'osm:way:8', 'osm_type': 'way', 'reason': 'plain_height_not_vehicle_path', 'tag': 'barrier=fence', 'raw': '2'},
                   {'id': 'osm:node:9', 'osm_type': 'node', 'reason': 'plain_height_not_vehicle_path', 'tag': 'barrier=gate', 'raw': '3.1'}]
        with tempfile.TemporaryDirectory() as tmp:
            self.build(tmp, self.rows(), 'a' * 64, excluded=entries)
            index, *_ = self.publish(tmp)
            ex = index['exclusions']
            self.assertEqual((ex['total'], ex['by_reason']), (2, {'plain_height_not_vehicle_path': 2}))
            self.assertEqual(ex['by_tag']['plain_height_not_vehicle_path'], {'barrier=fence': 1, 'barrier=gate': 1})
            self.assertEqual(ex['by_state'], {'DC': {'plain_height_not_vehicle_path': 2}})
            doc = json.loads((Path(tmp) / 'data' / ex['files']['DC']['path']).read_text())
            self.assertEqual(national.decode_excluded(doc), sorted(entries, key=lambda e: e['id']))
            self.assertEqual(doc['attribution'], national.LICENSE['attribution'])


class DeterminismTests(unittest.TestCase):
    def rows(self):
        return [candidate(i, tags={'maxheight': f'{3 + i % 3}.{i % 9}'}) for i in range(40)]

    def test_two_tile_builds_from_the_same_input_are_byte_identical_regardless_of_order(self):
        a = national.make_tiles(self.rows())
        b = national.make_tiles(list(reversed(self.rows())))
        self.assertEqual([(t['path'], t['data']) for t in a], [(t['path'], t['data']) for t in b])

    def test_two_publishes_produce_identical_trees(self):
        trees = []
        for _ in range(2):
            with tempfile.TemporaryDirectory() as tmp:
                doc = national.make_state_doc('DC', make_source(), self.rows(), [])
                stage = Path(tmp) / 'stage'
                (stage / 'state').mkdir(parents=True)
                (stage / 'status').mkdir()
                (stage / 'state' / 'DC.json').write_bytes(national.encode(doc))
                (stage / 'status' / 'DC.json').write_text(json.dumps({'state': 'DC', 'status': 'ok'}))
                national.publish(stage, Path(tmp) / 'data')
                trees.append({str(p.relative_to(Path(tmp) / 'data')): p.read_bytes() for p in sorted((Path(tmp) / 'data').rglob('*')) if p.is_file()})
        self.assertEqual(trees[0], trees[1])

    def test_unchanged_rerun_writes_no_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = national.make_state_doc('DC', make_source(), self.rows(), [])
            stage = Path(tmp) / 'stage'
            (stage / 'state').mkdir(parents=True)
            (stage / 'status').mkdir()
            (stage / 'state' / 'DC.json').write_bytes(national.encode(doc))
            (stage / 'status' / 'DC.json').write_text(json.dumps({'state': 'DC', 'status': 'ok'}))
            *_, first = national.publish(stage, Path(tmp) / 'data')
            self.assertTrue(first)
            before = {p: p.stat().st_mtime_ns for p in (Path(tmp) / 'data').rglob('*.json')}
            *_, second = national.publish(stage, Path(tmp) / 'data')
            self.assertEqual(second, [])
            self.assertEqual(before, {p: p.stat().st_mtime_ns for p in (Path(tmp) / 'data').rglob('*.json')})

    def test_content_hash_ignores_volatile_source_fields(self):
        one = national.make_state_doc('DC', make_source(), self.rows(), [])
        two = national.make_state_doc('DC', {**make_source('f' * 64), 'retrieved_at': '2027-01-01T00:00:00Z', 'resolved_url': 'x'}, self.rows(), [])
        self.assertEqual(one['content_sha256'], two['content_sha256'])
        changed = self.rows()
        changed[0]['tags'] = {'maxheight': '3.9'}
        self.assertNotEqual(one['content_sha256'], national.make_state_doc('DC', make_source(), changed, [])['content_sha256'])

    @unittest.skipUnless(shutil.which('git') and shutil.which('bash'), 'git and bash are required')
    def test_workflow_commit_step_makes_no_commit_when_data_is_unchanged(self):
        import re as _re
        text = (SCRIPTS.parent / '.github/workflows/refresh-national-clearances.yml').read_text()
        block = _re.search(r"- name: Commit refreshed clearance data\n\s+shell: bash\n\s+run: \|\n((?:\s{10,}.*\n|\n)+)", text).group(1)
        script = '\n'.join(line[10:] for line in block.split('\n'))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@x', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@x', 'GITHUB_REF_NAME': 'main'}
            def git(*a, cwd):
                return subprocess.run(['git', *a], cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout.strip()
            git('init', '--bare', '-b', 'main', str(tmp / 'origin.git'), cwd=tmp)
            work = tmp / 'work'
            git('clone', str(tmp / 'origin.git'), str(work), cwd=tmp)
            git('checkout', '-b', 'main', cwd=work)
            (work / 'README').write_text('x')
            git('add', '-A', cwd=work)
            git('commit', '-m', 'seed', cwd=work)
            git('push', '-u', 'origin', 'main', cwd=work)
            def run_step():
                subprocess.run(['bash', '-c', script], cwd=work, env=env, check=True, capture_output=True, text=True)
            def stage_and_publish(when):
                stage = tmp / f'stage-{when}'
                (stage / 'state').mkdir(parents=True)
                (stage / 'status').mkdir()
                doc = national.make_state_doc('DC', {**make_source(), 'retrieved_at': when}, [candidate(i) for i in range(10)], [])
                (stage / 'state' / 'DC.json').write_bytes(national.encode(doc))
                (stage / 'status' / 'DC.json').write_text(json.dumps({'state': 'DC', 'status': 'ok'}))
                national.publish(stage, work / 'data/clearances')
            stage_and_publish('2026-11-03T05:00:00Z')
            run_step()
            first = git('rev-list', '--count', 'HEAD', cwd=work)
            self.assertEqual(first, '2')
            stage_and_publish('2026-12-01T05:00:00Z')
            run_step()
            self.assertEqual(git('rev-list', '--count', 'HEAD', cwd=work), first)
            self.assertEqual(git('status', '--porcelain', cwd=work), '')


class MigrateTests(unittest.TestCase):
    def v2_state(self, directory, region, rows, sha):
        source = {**make_source(sha), 'containment': 'bbox' if region == 'DC' else 'census_polygon', 'boundary_reference_sha256': 'c' * 64}
        old = []
        for row in rows:
            row = {k: v for k, v in row.items() if k not in ('status', 'comparable', 'plausibility', 'reasons', 'applies_to', 'applies_to_evidence', 'min_inches', 'min_metres', 'unit_assumed')}
            metres, inches, parse_status = parse.height_fields(row['tags'])
            row.update(metres=metres, inches=inches, parse=parse_status, state=region)
            old.append(row)
        (Path(directory) / f'{region}.json').write_text(json.dumps({'version': 2, 'schema': 'kamptrail-clearances-2', 'region': region, 'part': 1, 'parts': 1, 'source': source, 'records': old}))

    def test_offline_migration_keeps_sources_drops_fences_dedupes_and_protects_ri(self):
        across = {'type': 'LineString', 'coordinates': [[-77.12, 38.85], [-77.10, 38.90]]}
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            fence = candidate(5, {'maxheight': '9'}, {'highway': 'service'})
            fence.update(tags={'height': '1.8'}, context={'barrier': 'fence'})
            self.v2_state(d, 'DC', [candidate(1, geometry=across, oid=900), candidate(2, oid=901), fence], 'a' * 64)
            self.v2_state(d, 'VA', [candidate(1, geometry=across, oid=900, region='VA')], 'b' * 64)
            (d / 'RI.json').write_text('{"version":1,"records":[]}')
            index, written = national.migrate(d)
            self.assertEqual(sorted(p.name for p in d.glob('*.json')), ['RI.json', 'index.json'])
            self.assertEqual((d / 'RI.json').read_text(), '{"version":1,"records":[]}')
            self.assertEqual(index['totals']['candidates'], 2)
            self.assertEqual(index['exclusions']['by_tag']['plain_height_not_vehicle_path'], {'barrier=fence': 1})
            self.assertEqual(index['sources']['DC']['retrieved_at'], '2026-10-30T16:30:30Z')
            self.assertEqual(index['sources']['VA']['source_sha256'], 'b' * 64)
            self.assertEqual(national.verify_index(d), [])
            before = {p.name: p.read_bytes() for p in d.rglob('*.json')}
            national.rebuild(d)
            self.assertEqual(before, {p.name: p.read_bytes() for p in d.rglob('*.json')})


class CommittedDataTests(unittest.TestCase):
    def test_committed_manifest_matches_committed_files(self):
        self.assertEqual(national.verify_index(national.DEFAULT_DIR), [])

    def test_every_data_file_carries_the_attribution_header_and_license_file_exists(self):
        directory = national.DEFAULT_DIR
        self.assertIn('Open Database Licence', (directory / 'LICENSE-DATA.md').read_text())
        for path in [directory / 'index.json', *sorted((directory / 'tiles').glob('*.json')), *sorted((directory / 'excluded').glob('*.json'))]:
            doc = json.loads(path.read_text())
            self.assertEqual((doc['license'], doc['attribution'], doc['copyright_url']), ('ODbL-1.0', national.LICENSE['attribution'], national.LICENSE['copyright_url']), path.name)

    def test_candidates_have_status_comparable_and_no_fence_only_records(self):
        index = json.loads((national.DEFAULT_DIR / 'index.json').read_text())
        seen = 0
        for tile in index['tiles'][:40]:
            for record in json.loads((national.DEFAULT_DIR / tile['path']).read_text())['candidates']:
                seen += 1
                self.assertIn(record['status'], parse.STATUSES_CANDIDATE)
                self.assertEqual(record['comparable'], record['status'] == 'numeric_only')
                self.assertEqual(record['comparable'], 'min_inches' in record)
                if set(record['tags']) == {'height'}:
                    self.assertNotIn(record['context'].get('barrier'), ('fence', 'wall', 'gate', 'bollard'))
        self.assertGreater(seen, 100)
        self.assertEqual(index['exclusions']['total'], sum(index['exclusions']['by_reason'].values()))
        self.assertEqual(index['states_protected']['RI']['status'], 'protected')
        self.assertEqual(index['totals']['states_with_failures'], [])

    def test_committed_totals_match_the_tile_index_and_limits(self):
        index = json.loads((national.DEFAULT_DIR / 'index.json').read_text())
        self.assertEqual(sum(t['records'] for t in index['tiles']), index['totals']['candidates'])
        self.assertLessEqual(max(t['bytes'] for t in index['tiles']), 512 * 1024)

    def test_release_packaging_still_ships_only_the_ri_pilot(self):
        text = (SCRIPTS / 'build-release.js').read_text()
        self.assertIn("'data','clearances','RI.json'", text)
        self.assertNotIn('tiles', text)
        ri = json.loads((national.DEFAULT_DIR / 'RI.json').read_text())
        self.assertEqual(ri['version'], 1)

    def test_data_sources_credits_osm_with_the_odbl_sentence_and_link(self):
        text = (SCRIPTS.parent / 'DATA_SOURCES.md').read_text()
        row = next(line for line in text.split('\n') if line.startswith('| Low-clearance heights'))
        self.assertIn(national.LICENSE['attribution'], row)
        self.assertIn('https://www.openstreetmap.org/copyright', row)
        self.assertNotIn('Rhode Island pilot plus national refresh', text)


class WorkflowTests(unittest.TestCase):
    def test_workflow_uses_the_fixed_builder_and_skips_ri(self):
        text = (SCRIPTS.parent / '.github/workflows/refresh-national-clearances.yml').read_text()
        self.assertIn('BUILD_REGIONS', text)
        self.assertNotIn('allow_schema_change', text)
        self.assertIn('build_national_clearances.py', text)
        self.assertIn('workflow_dispatch', text)

class DownloadTests(unittest.TestCase):
    class Response:
        def __init__(self, body, url):
            self.body, self.url, self.headers = body, url, {'Content-Length': str(len(body))}
            self.offset = 0

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def geturl(self):
            return self.url

        def read(self, n):
            chunk, self.offset = self.body[self.offset:self.offset + n], self.offset + n
            return chunk

    def run_download(self, outcomes, region='DC'):
        sleeps, seen = [], []
        queue = list(outcomes)
        def opener(request, timeout):
            seen.append(request)
            outcome = queue.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        with tempfile.TemporaryDirectory() as tmp:
            receipt = national.download(region, Path(tmp) / 'x.osm.pbf', opener=opener, sleep=sleeps.append, now=lambda: '2026-11-01T00:00:00Z')
        return receipt, sleeps, seen

    def http(self, code):
        return urllib.error.HTTPError(national.DC_URL, code, 'err', {}, None)

    def test_user_agent_is_a_project_url_not_a_personal_address(self):
        self.assertIn('https://github.com/prowebpromo/kamptrail', national.USER_AGENT)
        self.assertNotIn('@', national.USER_AGENT)
        _, _, seen = self.run_download([self.Response(b'abc', national.DC_URL)])
        self.assertEqual(seen[0].get_header('User-agent'), national.USER_AGENT)

    def test_retries_with_backoff_then_succeeds(self):
        receipt, sleeps, seen = self.run_download([self.http(503), urllib.error.URLError('reset'), self.Response(b'abcd', national.DC_URL)])
        self.assertEqual((receipt['bytes'], receipt['attempts'], len(seen)), (4, 3, 3))
        self.assertEqual(len(sleeps), 2)
        self.assertGreaterEqual(sleeps[0], 15)
        self.assertGreaterEqual(sleeps[1], 60)

    def test_gives_up_after_three_attempts(self):
        with self.assertRaises(ValueError) as caught:
            self.run_download([self.http(503)] * 3)
        self.assertIn('3 attempts', str(caught.exception))

    def test_client_errors_are_not_retried(self):
        with self.assertRaises(urllib.error.HTTPError):
            self.run_download([self.http(404), self.Response(b'abc', national.DC_URL)])

    def test_redirect_outside_the_fixed_extract_is_refused(self):
        with self.assertRaises(ValueError):
            self.run_download([self.Response(b'abc', 'https://evil.example/dc.osm.pbf')])
        receipt, _, _ = self.run_download([self.Response(b'abc', national.DC_URL.replace('latest', '261028'))])
        self.assertTrue(receipt['resolved_url'].endswith('district-of-columbia-261028.osm.pbf'))

    def test_truncated_body_is_retried_and_registry_covers_51_regions(self):
        response = self.Response(b'abcdef', national.DC_URL)
        response.headers['Content-Length'] = '10'
        receipt, _, _ = self.run_download([response, self.Response(b'abcdef', national.DC_URL)])
        self.assertEqual(receipt['attempts'], 2)
        self.assertEqual(len(national.ALL_REGIONS), 51)
        self.assertTrue(all(national.region_url(r).startswith('https://download.geofabrik.de/north-america/us/') for r in national.ALL_REGIONS))




class NativeTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec('osmium'), 'Optional pinned native parser is unavailable')
    def test_synthetic_dc_extract_end_to_end_through_the_bounded_worker(self):
        import osmium
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pbf = root / 'dc.osm.pbf'
            header = osmium.io.Header()
            header.set('osmosis_replication_timestamp', EXTRACT)
            stamp = '2026-01-01T00:00:00Z'
            with osmium.SimpleWriter(str(pbf), header=header) as writer:
                for oid, point, tags in [(1, (-77.03, 38.90), {}), (2, (-77.031, 38.90), {}), (3, (-77.032, 38.90), {}), (4, (-76.0, 38.90), {}),
                                         (5, (-77.04, 38.91), {'barrier': 'height_restrictor', 'maxheight': 'below_default'}),
                                         (6, (-77.05, 38.91), {'barrier': 'fence', 'height': '1.8'})]:
                    writer.add_node(osmium.osm.mutable.Node(id=oid, version=2, timestamp=stamp, location=point, tags=tags))
                for oid, nodes, tags in [(10, [1, 2], {'highway': 'service', 'bridge': 'yes', 'maxheight': "13'6\"", 'maxheight:physical': '4.1', 'name': 'Test St'}),
                                         (11, [2, 4], {'highway': 'service', 'maxheight': '3'}),
                                         (12, [1, 3], {'building': 'yes', 'height': '9'}),
                                         (13, [2, 3], {'highway': 'service', 'maxheight': '3.5-4.2'}),
                                         (14, [1, 3], {'barrier': 'wall', 'height': '2'})]:
                    writer.add_way(osmium.osm.mutable.Way(id=oid, version=3, timestamp=stamp, nodes=nodes, tags=tags))
            import hashlib
            receipt = {'url': national.DC_URL, 'resolved_url': national.DC_URL, 'sha256': hashlib.sha256(pbf.read_bytes()).hexdigest(),
                       'bytes': pbf.stat().st_size, 'retrieved_at': '2026-10-30T12:00:00Z'}
            data, stage = root / 'data', root / 'stage'
            data.mkdir()
            status = national.build_state('DC', directory=data, stage=stage, scratch=root / 'scratch', pbf=pbf, receipt=receipt)
            self.assertEqual(status['status'], 'ok', status.get('failure'))
            doc = json.loads((stage / 'state' / 'DC.json').read_text())
            by_id = {r['id']: r for r in doc['candidates']}
            self.assertEqual(sorted(by_id), ['osm:node:5', 'osm:way:10', 'osm:way:13'])
            self.assertEqual(by_id['osm:way:10']['inches']['maxheight'], 162.0)
            self.assertEqual((by_id['osm:way:10']['status'], by_id['osm:way:10']['comparable'], by_id['osm:way:10']['min_inches']), ('numeric_only', True, 157.48))
            self.assertEqual((by_id['osm:node:5']['parse'], by_id['osm:node:5']['restriction_on'], by_id['osm:node:5']['status']), ({'maxheight': 'below_default'}, 'node', 'unknown'))
            self.assertEqual(by_id['osm:way:13']['parse'], {'maxheight': 'unparseable'})
            self.assertEqual(sorted(e['id'] for e in national.decode_excluded(doc['excluded'])), ['osm:node:6', 'osm:way:14'])
            self.assertEqual(status['skipped'], {'height_only_no_road_context:building': 1})
            self.assertEqual(status['quarantine_reasons'], {'outside_requested_state': 1})
            self.assertEqual(doc['source']['containment'], 'bbox')
            self.assertEqual(doc['source']['extract_timestamp'], EXTRACT)


class CliTests(unittest.TestCase):
    def test_dry_run_makes_no_network_calls_and_writes_nothing(self):
        before = sorted(str(p) for p in national.DEFAULT_DIR.rglob('*'))
        out = io.StringIO()
        with patch('urllib.request.urlopen', side_effect=AssertionError('network')), patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('network')), contextlib.redirect_stdout(out):
            national.main(['build', '--dry-run'])
        plans = json.loads(out.getvalue())
        self.assertEqual([p['state'] for p in plans], list(national.BUILD_REGIONS))
        self.assertEqual(plans[0]['user_agent'], national.USER_AGENT)
        self.assertEqual(sorted(str(p) for p in national.DEFAULT_DIR.rglob('*')), before)

    def test_measure_reports_tiles_and_bytes_for_the_five_views(self):
        rows = national.measure(national.DEFAULT_DIR)
        self.assertEqual(len(rows), 15)
        self.assertTrue(all(r['tiles'] >= 1 and r['bytes'] > 0 for r in rows if r['zoom'] == 12))


if __name__ == '__main__':
    unittest.main()
