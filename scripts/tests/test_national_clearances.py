import contextlib
import importlib.util
import io
import json
from pathlib import Path
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


def make_row(i, tags=None):
    return {'id': f'osm:way:{1000 + i:07d}', 'osm_type': 'way', 'osm_id': str(1000 + i), 'osm_version': 1, 'edited_at': '2026-01-01T00:00:00Z',
            'state': 'DC', 'geometry': way_geometry(), 'tags': tags or {'maxheight': "9'4\""}, 'context': {'highway': 'service'},
            'metres': {'maxheight': 2.8448}, 'inches': {'maxheight': 112.0}, 'parse': {'maxheight': 'numeric'}, 'restriction_on': 'way', 'structure': []}


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


class ClassificationTests(unittest.TestCase):
    def test_way_keeps_raw_text_inches_status_and_association_fields(self):
        outcome, row = classify({'maxheight': "13'6\"", 'maxheight:physical': 'none', 'highway': 'secondary', 'name': 'Main St', 'ref': 'US 9', 'bridge': 'yes', 'layer': '1'})
        self.assertEqual(outcome, 'row')
        self.assertEqual(row['tags'], {'maxheight': "13'6\"", 'maxheight:physical': 'none'})
        self.assertEqual(row['inches'], {'maxheight': 162.0, 'maxheight:physical': None})
        self.assertEqual(row['parse'], {'maxheight': 'numeric', 'maxheight:physical': 'unknown'})
        self.assertEqual((row['osm_version'], row['edited_at'], row['restriction_on'], row['structure']), (3, '2026-01-01T00:00:00Z', 'way', ['bridge']))
        self.assertEqual({k: row['context'][k] for k in ('name', 'ref', 'highway', 'bridge', 'layer')},
                         {'name': 'Main St', 'ref': 'US 9', 'highway': 'secondary', 'bridge': 'yes', 'layer': '1'})

    def test_node_restriction_is_flagged_as_node_with_no_road_claim(self):
        outcome, row = classify({'barrier': 'height_restrictor', 'maxheight': '3.5'}, kind='node')
        self.assertEqual((outcome, row['restriction_on'], row['structure']), ('row', 'node', ['height_restrictor']))
        self.assertNotIn('highway', row['context'])

    def test_tunnel_and_covered_flags(self):
        _, row = classify({'highway': 'residential', 'tunnel': 'building_passage', 'maxheight': '3'})
        self.assertEqual(row['structure'], ['tunnel', 'covered'])
        _, row = classify({'highway': 'residential', 'bridge': 'no', 'tunnel': 'no', 'maxheight': '3'})
        self.assertEqual(row['structure'], [])

    def test_plain_height_counts_only_on_structures_and_barriers(self):
        self.assertEqual(classify({'building': 'yes', 'height': '12'})[0], 'skip')
        self.assertEqual(classify({'highway': 'service', 'height': '4'})[0], 'skip')
        outcome, row = classify({'bridge': 'yes', 'highway': 'service', 'height': '4'})
        self.assertEqual((outcome, row['parse']), ('row', {'height': 'numeric'}))
        self.assertEqual(classify({'barrier': 'lift_gate', 'height': '3'})[0], 'row')

    def test_no_context_is_quarantined_and_lifecycle_is_skipped(self):
        outcome, entry = classify({'maxheight': '3', 'amenity': 'parking'})
        self.assertEqual((outcome, entry['reason']), ('quarantine', 'no_road_structure_or_barrier_context'))
        self.assertEqual(classify({'maxheight': '3', 'highway': 'service', 'disused': 'yes'}), ('skip', 'lifecycle_excluded'))

    def test_cross_boundary_geometry_is_quarantined_not_claimed(self):
        outside = {'type': 'LineString', 'coordinates': [[-77.03, 38.9], [-76.0, 38.9]]}
        outcome, entry = classify({'maxheight': '3', 'highway': 'service'}, geometry=outside)
        self.assertEqual((outcome, entry['reason']), ('quarantine', 'outside_requested_state'))

    def test_edit_newer_than_extract_fails_the_state(self):
        with self.assertRaises(ValueError):
            national.classify_element('way', 1, 1, '2026-10-29T00:00:00Z', {'maxheight': '3', 'highway': 'service'}, way_geometry(), national.DcBoundaries(), 'DC', EXTRACT)

    def test_geometry_is_not_built_for_irrelevant_elements(self):
        calls = []
        national.classify_element('way', 1, 1, '2026-01-01T00:00:00Z', {'building': 'yes', 'height': '9'}, lambda: calls.append(1), national.DcBoundaries(), 'DC', EXTRACT)
        self.assertEqual(calls, [])


class ShardTests(unittest.TestCase):
    def test_every_file_respects_byte_row_and_vertex_limits(self):
        rows = [make_row(i) for i in range(50)]
        files = national.shard('DC', make_source(), rows, max_bytes=6000, max_records=12, max_vertices=30)
        self.assertGreater(len(files), 3)
        names = []
        for name, data, count in files:
            doc = json.loads(data)
            names.append(name)
            self.assertLessEqual(len(data), 6000)
            self.assertLessEqual(count, 12)
            self.assertLessEqual(sum(national.vertex_count(r) for r in doc['records']), 30)
            self.assertEqual((doc['parts'], doc['version'], doc['schema']), (len(files), 2, national.SCHEMA))
        self.assertEqual(names[:3], ['DC.json', 'DC-2.json', 'DC-3.json'])
        self.assertEqual([r['id'] for _, d, _ in files for r in json.loads(d)['records']], [r['id'] for r in rows])

    def test_default_limits_match_the_pilot_client(self):
        self.assertEqual((national.MAX_FILE_BYTES, national.MAX_FILE_RECORDS, national.MAX_FILE_VERTICES), (512 * 1024, 2000, 50000))

    def test_oversized_single_record_is_refused(self):
        with self.assertRaises(ValueError):
            national.shard('DC', make_source(), [make_row(1)], max_bytes=300)


def write_state(directory, region='DC', count=20, sha='a' * 64, schema2=True):
    files = national.shard(region, make_source(sha), [make_row(i) for i in range(count)])
    for name, data, _ in files:
        (Path(directory) / name).write_bytes(data)
    return files


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data, self.stage, self.scratch = self.root / 'data', self.root / 'stage', self.root / 'scratch'
        self.data.mkdir()
        self.now = lambda: '2026-11-01T00:00:00Z'

    def worker_returning(self, count, sha='b' * 64):
        return lambda pbf, receipt, scratch, region: {'source': make_source(sha), 'records': [make_row(i) for i in range(count)],
                                                       'report': {'quarantined': 2, 'quarantine_reasons': {'x': 2}, 'skipped': {}, 'quarantine_samples': []}}

    def build(self, worker, downloader=None, **kw):
        downloader = downloader or (lambda region, dest: {'url': national.DC_URL, 'resolved_url': national.DC_URL, 'sha256': 'b' * 64, 'bytes': 1, 'retrieved_at': '2026-11-01T00:00:00Z'})
        return national.build_state('DC', directory=self.data, stage=self.stage, scratch=self.scratch, downloader=downloader, worker=worker, now=self.now, **kw)

    def test_guard_reasons(self):
        prior = {'schema': national.SCHEMA, 'records': 100}
        self.assertIsNone(national.guard(prior, 70, 1000))
        self.assertEqual(national.guard(prior, 69, 1000), 'shrunk_sharply')
        self.assertEqual(national.guard(prior, 0, 0), 'no_records')
        self.assertEqual(national.guard({'schema': 'pilot-1', 'records': 100}, 100, 1000), 'schema_locked')
        self.assertIsNone(national.guard({'schema': 'pilot-1', 'records': 100}, 100, 1000, allow_schema_change=True))
        self.assertEqual(national.guard(None, 5, national.MAX_STATE_BYTES + 1), 'state_too_large')
        self.assertIsNone(national.guard({'schema': national.SCHEMA, 'records': 9}, 1, 1000))  # tiny states may legitimately change a lot

    def test_sharp_shrink_keeps_prior_and_stages_nothing(self):
        write_state(self.data, count=40)
        status = self.build(self.worker_returning(10))
        self.assertEqual((status['status'], status['failure']['reason'], status['failure']['prior_records']), ('kept_prior', 'shrunk_sharply', 40))
        self.assertEqual(sorted(p.name for p in self.stage.glob('*.json')), [])
        self.assertEqual(national.prior_state_info(self.data, 'DC')['records'], 40)

    def test_failed_fetch_keeps_prior_and_is_recorded(self):
        write_state(self.data, count=40)
        def broken(region, dest):
            raise ValueError('PBF download failed after 3 attempts: HTTP Error 503')
        status = self.build(self.worker_returning(40), downloader=broken)
        self.assertEqual((status['status'], status['failure']['reason']), ('kept_prior', 'build_failed'))
        self.assertIn('503', status['failure']['detail'])
        self.assertTrue((self.stage / 'status' / 'DC.json').is_file())

    def test_failed_fetch_without_prior_is_failed(self):
        status = self.build(self.worker_returning(5), downloader=lambda r, d: (_ for _ in ()).throw(ValueError('down')))
        self.assertEqual(status['status'], 'failed')

    def test_unchanged_source_skips_parsing(self):
        write_state(self.data, count=20, sha='b' * 64)
        status = self.build(lambda *a: self.fail('must not parse'))
        self.assertEqual(status['status'], 'unchanged')

    def test_pilot_schema_is_locked_until_allowed(self):
        pilot = {'version': 1, 'region': 'DC', 'source': make_source('c' * 64), 'records': [make_row(i) for i in range(20)]}
        (self.data / 'DC.json').write_text(json.dumps(pilot))
        status = self.build(self.worker_returning(20))
        self.assertEqual((status['status'], status['failure']['reason']), ('kept_prior', 'schema_locked'))
        status = self.build(self.worker_returning(20), allow_schema_change=True)
        self.assertEqual(status['status'], 'ok')

    def test_good_refresh_stages_files_and_counts(self):
        write_state(self.data, count=40)
        status = self.build(self.worker_returning(45))
        self.assertEqual((status['status'], status['records'], status['quarantined']), ('ok', 45, 2))
        self.assertEqual(status['parse_counts']['numeric'], 45)
        self.assertTrue((self.stage / 'DC.json').is_file())

    def test_publish_replaces_files_removes_stale_parts_and_verifies_manifest(self):
        files = national.shard('DC', make_source(), [make_row(i) for i in range(40)], max_bytes=5000)
        self.assertGreater(len(files), 2)
        for name, data, _ in files:
            (self.data / name).write_bytes(data)
        national.write_index(self.data, national.build_index(self.data))
        status = self.build(self.worker_returning(40))
        national.publish(self.stage, self.data)  # one part now fits in the default 512 KiB
        self.assertEqual(sorted(p.name for p in self.data.glob('DC*.json')), ['DC.json'])
        self.assertEqual(national.verify_index(self.data), [])
        index = json.loads((self.data / 'index.json').read_text())
        self.assertEqual((index['states']['DC']['status'], index['states']['DC']['records']), ('present', 40))
        self.assertEqual(index['states']['DC']['quarantined'], 2)
        self.assertEqual(status['status'], 'ok')

    def test_publish_records_failure_and_keeps_prior_data(self):
        write_state(self.data, count=40)
        before = (self.data / 'DC.json').read_bytes()
        self.build(self.worker_returning(5))
        for region in national.ALL_REGIONS[:3]:
            if region != 'DC':
                (self.stage / 'status' / f'{region}.json').write_text(json.dumps({'state': region, 'status': 'unchanged'}))
        index, updated, failed = national.publish(self.stage, self.data)
        self.assertEqual((updated, [f['state'] for f in failed]), ([], ['DC']))
        self.assertEqual((self.data / 'DC.json').read_bytes(), before)
        entry = index['states']['DC']
        self.assertEqual((entry['status'], entry['failure']['reason']), ('kept_prior', 'shrunk_sharply'))
        self.assertIn('DC', index['totals']['states_with_failures'])

    def test_crashed_job_with_no_status_is_recorded_as_failed(self):
        write_state(self.data, count=10)
        (self.stage / 'status').mkdir(parents=True)
        for region in national.ALL_REGIONS[:30]:
            if region != 'DC':
                (self.stage / 'status' / f'{region}.json').write_text(json.dumps({'state': region, 'status': 'unchanged'}))
        index, _, failed = national.publish(self.stage, self.data, expected=['DC'] + list(national.ALL_REGIONS[:30]), now=self.now)
        self.assertEqual([f['state'] for f in failed], ['DC'])
        self.assertEqual(index['states']['DC']['failure']['reason'], 'no_status_from_job')
        self.assertEqual(index['states']['DC']['status'], 'kept_prior')

    def test_publish_refuses_a_mostly_failed_run(self):
        (self.stage / 'status').mkdir(parents=True)
        for region in ('AL', 'AK', 'AZ', 'AR'):
            (self.stage / 'status' / f'{region}.json').write_text(json.dumps({'state': region, 'status': 'failed', 'failure': {'reason': 'build_failed'}}))
        with self.assertRaises(SystemExit):
            national.publish(self.stage, self.data)
        self.assertFalse((self.data / 'index.json').exists())


class ManifestTests(unittest.TestCase):
    def test_hashes_counts_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            files = national.shard('DC', make_source(), [make_row(i) for i in range(30)], max_bytes=7000)
            for name, data, _ in files:
                (directory / name).write_bytes(data)
            index = national.build_index(directory)
            national.write_index(directory, index)
            entry = index['states']['DC']
            self.assertEqual(national.verify_index(directory), [])
            self.assertEqual((entry['records'], entry['parts']), (30, len(files)))
            self.assertEqual(entry['sha256'], national.sha256_of([directory / f['path'] for f in entry['files']]))
            self.assertEqual(entry['retrieved_at'], '2026-10-30T16:30:30Z')
            self.assertEqual(index['states']['AL']['status'], 'not_built')
            self.assertEqual(index['totals']['states_with_data'], 1)
            self.assertEqual(len(index['states']), 51)
            (directory / 'DC-2.json').write_bytes((directory / 'DC-2.json').read_bytes() + b' ')
            self.assertTrue(any('differs' in p for p in national.verify_index(directory)))
            (directory / 'DC-2.json').unlink()
            self.assertTrue(any('missing' in p for p in national.verify_index(directory)))

    def test_manifest_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            write_state(tmp, count=5)
            self.assertEqual(national.build_index(tmp), national.build_index(tmp))

    def test_committed_manifest_matches_committed_files(self):
        directory = national.DEFAULT_DIR
        self.assertEqual(national.verify_index(directory), [])
        index = json.loads((directory / 'index.json').read_text())
        self.assertEqual(set(index['states']), set(national.ALL_REGIONS))
        self.assertIn('OpenStreetMap contributors', index['attribution'])
        self.assertEqual(index['states']['RI']['records'], 254)


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
                                         (5, (-77.04, 38.91), {'barrier': 'height_restrictor', 'maxheight': 'below_default'})]:
                    writer.add_node(osmium.osm.mutable.Node(id=oid, version=2, timestamp=stamp, location=point, tags=tags))
                for oid, nodes, tags in [(10, [1, 2], {'highway': 'service', 'bridge': 'yes', 'maxheight': "13'6\"", 'maxheight:physical': '4.1', 'name': 'Test St'}),
                                         (11, [2, 4], {'highway': 'service', 'maxheight': '3'}),
                                         (12, [1, 3], {'building': 'yes', 'height': '9'}),
                                         (13, [2, 3], {'highway': 'service', 'maxheight': '3.5-4.2'})]:
                    writer.add_way(osmium.osm.mutable.Way(id=oid, version=3, timestamp=stamp, nodes=nodes, tags=tags))
            import hashlib
            receipt = {'url': national.DC_URL, 'resolved_url': national.DC_URL, 'sha256': hashlib.sha256(pbf.read_bytes()).hexdigest(),
                       'bytes': pbf.stat().st_size, 'retrieved_at': '2026-10-30T12:00:00Z'}
            data, stage = root / 'data', root / 'stage'
            data.mkdir()
            status = national.build_state('DC', directory=data, stage=stage, scratch=root / 'scratch', pbf=pbf, receipt=receipt)
            self.assertEqual(status['status'], 'ok', status.get('failure'))
            doc = json.loads((stage / 'DC.json').read_text())
            by_id = {r['id']: r for r in doc['records']}
            self.assertEqual(sorted(by_id), ['osm:node:5', 'osm:way:10', 'osm:way:13'])
            self.assertEqual(by_id['osm:way:10']['inches']['maxheight'], 162.0)
            self.assertEqual(by_id['osm:way:10']['parse']['maxheight:physical'], 'numeric')
            self.assertEqual((by_id['osm:node:5']['parse'], by_id['osm:node:5']['restriction_on']), ({'maxheight': 'below_default'}, 'node'))
            self.assertEqual(by_id['osm:way:13']['parse'], {'maxheight': 'unparseable'})
            self.assertEqual(status['quarantine_reasons'], {'outside_requested_state': 1})
            self.assertEqual(doc['source']['containment'], 'bbox')
            self.assertEqual(doc['source']['extract_timestamp'], EXTRACT)


class CliTests(unittest.TestCase):
    def test_dry_run_makes_no_network_calls_and_writes_nothing(self):
        before = sorted(p.name for p in national.DEFAULT_DIR.iterdir())
        out = io.StringIO()
        with patch('urllib.request.urlopen', side_effect=AssertionError('network')), patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('network')), contextlib.redirect_stdout(out):
            national.main(['build', '--dry-run'])
        plans = json.loads(out.getvalue())
        self.assertEqual([p['state'] for p in plans], list(national.ALL_REGIONS))
        self.assertEqual(plans[0]['user_agent'], national.USER_AGENT)
        self.assertEqual(sorted(p.name for p in national.DEFAULT_DIR.iterdir()), before)
        self.assertEqual(next(p for p in plans if p['state'] == 'RI')['prior']['schema'], 'pilot-1')


if __name__ == '__main__':
    unittest.main()
