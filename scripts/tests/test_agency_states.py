import datetime as dt
import contextlib
import gzip
import hashlib
import io
import json
import math
import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_agency_states as states
import fetch_state_boundaries as fetcher


def rectangle(w, s, e, n):
    return {'type': 'Polygon', 'coordinates': [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}


def feature(identity, lng, lat, state=None):
    return {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [lng, lat]}, 'properties': {'id': identity, 'source': 'fixture', 'state': state}}


def reference(directory):
    directory.mkdir()
    manifest = {'version': 1, 'complete': True, 'source_url': states.SOURCE_URL, 'vintage': '2026-01-01', 'retrieved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'expected_states': sorted(states.STATES), 'states': {}}
    for code in sorted(states.STATES):
        geometry = rectangle(10, -60, 11, -59)  # Distant fixtures never influence US examples.
        if code == 'ID':
            geometry = rectangle(-114, 42, -111, 49)
        elif code == 'UT':
            geometry = rectangle(-114, 37, -109, 42)
        elif code == 'AK':
            geometry = {'type': 'MultiPolygon', 'coordinates': [rectangle(-151, 60, -149, 62)['coordinates'], [[[179, 51], [-179, 51], [-179, 53], [179, 53], [179, 51]]]]}
        data = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'STUSAB': code}, 'geometry': geometry}]}
        raw = json.dumps(data, separators=(',', ':')).encode()
        compressed = gzip.compress(raw, mtime=0)
        filename = code + '.geojson.gz'
        (directory / filename).write_bytes(compressed)
        prepared = states.PreparedState(geometry)
        manifest['states'][code] = {'file': filename, 'name': {'ID': 'Idaho', 'UT': 'Utah', 'AK': 'Alaska'}.get(code, code), 'sha256': hashlib.sha256(compressed).hexdigest(), 'raw_sha256': hashlib.sha256(raw).hexdigest(), 'compressed_bytes': len(compressed), 'raw_bytes': len(raw), 'coordinate_count': prepared.coordinate_count, 'bounds': prepared.bounds}
    (directory / 'manifest.json').write_text(json.dumps(manifest))
    return states.StateBoundaries(directory)


class AgencyStatesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.boundaries = reference(self.root / 'reference')

    def tearDown(self):
        self.temp.cleanup()

    def test_existing_valid_state_is_corrected_by_polygon_not_nearest_place(self):
        original = feature('ridb:233288', -111.53306, 42.09611, 'UT')
        assigned, rejected = states.assign_feature(original, self.boundaries)
        self.assertIsNone(rejected)
        self.assertEqual(assigned['properties']['state'], 'ID')
        self.assertEqual(assigned['properties']['source_state'], 'UT')
        self.assertEqual(assigned['properties']['state_assignment']['status'], 'corrected')
        self.assertIn('Census', assigned['properties']['field_provenance']['state'])
        self.assertEqual(original['properties']['state'], 'UT', 'must not mutate the source record')

    def test_missing_invalid_and_canonical_state_preserve_provenance(self):
        for raw, status in [(None, 'assigned'), ('ZZ', 'corrected'), (' id ', 'verified'), ('Idaho', 'verified')]:
            assigned, rejected = states.assign_feature(feature('x', -112, 44, raw), self.boundaries)
            self.assertIsNone(rejected)
            self.assertEqual(assigned['properties']['state'], 'ID')
            self.assertEqual(assigned['properties']['source_state'], raw)
            self.assertEqual(assigned['properties']['state_assignment']['status'], status)
        f = feature('x', -112, 44, 'ID')
        f['properties']['source_state'] = 'original upstream value'
        assigned, _ = states.assign_feature(f, self.boundaries)
        self.assertEqual(assigned['properties']['source_state'], 'original upstream value')

    def test_shared_border_and_ten_meter_band_are_ambiguous(self):
        for lat in [42, 42 + 5 / 110574, 42 - 5 / 110574]:
            result = self.boundaries.classify(-112, lat)
            self.assertIsNone(result['state'])
            self.assertEqual(result['reason'], 'boundary_ambiguous')
            self.assertEqual(result['candidates'], ['ID', 'UT'])
        self.assertEqual(self.boundaries.classify(-112, 42 + 30 / 110574)['state'], 'ID')

    def test_polygon_holes_and_hole_edges_are_not_interior(self):
        polygon = rectangle(-10, -10, 10, 10)
        polygon['coordinates'].append(rectangle(-1, -1, 1, 1)['coordinates'][0])
        prepared = states.PreparedState(polygon)
        self.assertEqual(prepared.relation(0, 0), -1)
        self.assertEqual(prepared.relation(1, 0), 0)
        self.assertEqual(prepared.relation(5, 0), 1)
        with self.assertRaises(ValueError):
            states.PreparedState({'type': 'Polygon', 'coordinates': [[[0, 0], [1, 1], [2, 0], [3, 0]]]})

    def test_multipart_alaska_and_dateline_are_supported_without_sign_repair(self):
        for lng, lat in [(-150, 61), (179.5, 52), (-179.5, 52), (180, 52), (-180, 52)]:
            self.assertEqual(self.boundaries.classify(lng, lat)['state'], 'AK')
        for lng, lat in [(109.2, 32.4), (0, 0), (-180.1, 52), (math.nan, 52), (False, 42)]:
            self.assertIsNone(self.boundaries.classify(lng, lat)['state'])
        self.assertEqual(self.boundaries.classify(109.2, 32.4)['reason'], 'outside_supported_states')

    def test_overlapping_states_fail_closed_and_batch_matches_single(self):
        self.boundaries.manifest['states']['UT']['bounds'] = [-114, 37, -109, 49]
        self.boundaries.cache['UT'] = states.PreparedState(rectangle(-114, 37, -109, 49))
        point = (-112, 44)
        self.assertEqual(self.boundaries.classify(*point)['reason'], 'boundary_ambiguous')
        points = [point, (-111.53306, 42.09611), (179.5, 52), (0, 0)]
        batch = self.boundaries.classify_many(points)
        for p in points:
            self.assertEqual(batch[p], self.boundaries.classify(*p))

    def test_reference_completeness_hash_and_timestamp_are_mandatory(self):
        directory = self.root / 'reference'
        file = directory / 'ID.geojson.gz'
        original = file.read_bytes()
        file.write_bytes(original + b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Corrupt'):
            states.StateBoundaries(directory)
        file.write_bytes(original)
        file.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'):
            states.StateBoundaries(directory)
        file.write_bytes(original)
        manifest = json.loads((directory / 'manifest.json').read_text())
        manifest['retrieved_at'] = '2099-01-01T00:00:00+00:00'
        (directory / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'timestamp'):
            states.StateBoundaries(directory)

    def test_build_reports_quarantine_and_preserves_output_on_source_failure(self):
        source = self.root / 'agency.json'
        source.write_text(json.dumps({'type': 'FeatureCollection', 'source': 'fixture', 'retrieved': '2026-10-29', 'features': [feature('good', -111.53306, 42.09611, 'UT'), feature('bad-sign', 109.2, 32.4, 'AZ'), feature('border', -112, 42, 'UT'), feature('nan', math.nan, 43, 'ID')]}))
        out = self.root / 'output'
        counts = states.build([source], out, boundaries=self.boundaries)
        self.assertEqual(counts, {'ID': 1})
        report_path = self.root / 'output-quarantine.json'
        report = json.loads(report_path.read_text())
        self.assertEqual(report['count'], 3)
        self.assertEqual(set(report['reasons']), {'outside_supported_states', 'boundary_ambiguous', 'invalid_coordinates'})
        self.assertEqual(json.loads((out / 'index.json').read_text())['state_assignment']['quarantined'], 3)
        self.assertEqual(json.loads((out / 'index.json').read_text())['version'], 1)
        self.assertFalse((out / 'quarantine.json').exists(), 'quarantine is pipeline-only')
        original_report = report_path.read_bytes()
        before = {p.name: p.read_bytes() for p in out.iterdir()}
        with self.assertRaises(FileNotFoundError):
            states.build([source, self.root / 'missing.json'], out, boundaries=self.boundaries)
        self.assertEqual(before, {p.name: p.read_bytes() for p in out.iterdir()})
        self.assertEqual(original_report, report_path.read_bytes())
        source.write_text('{broken')
        with self.assertRaises(json.JSONDecodeError):
            states.build([source], out, boundaries=self.boundaries)
        self.assertEqual(before, {p.name: p.read_bytes() for p in out.iterdir()})

    def test_fetch_failure_does_not_replace_existing_reference(self):
        destination = self.root / 'reference'
        before = (destination / 'manifest.json').read_bytes()
        def unavailable(url):
            raise OSError('fixture upstream unavailable')
        with self.assertRaises(OSError):
            fetcher.fetch(destination, reader=unavailable)
        self.assertEqual(before, (destination / 'manifest.json').read_bytes())
        with self.assertRaises(ValueError):
            fetcher.download('https://example.com/untrusted')

    def test_publish_failure_restores_snapshots_and_quarantine_report(self):
        source = self.root / 'agency.json'
        source.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature('good', -112, 44, 'UT')]}))
        out = self.root / 'output'
        states.build([source], out, boundaries=self.boundaries)
        before = {p.name: p.read_bytes() for p in out.iterdir()}
        report_path = self.root / 'output-quarantine.json'
        original_report = report_path.read_bytes()
        source.write_text(json.dumps({'type': 'FeatureCollection', 'features': [feature('replacement', -112, 44, 'ID')]}))
        original_rename = Path.rename
        def interrupted(path, target):
            if path.name == 'quarantine.json' and path.parent.name.startswith('agency-stage-'):
                raise OSError('fixture report publish failed')
            return original_rename(path, target)
        with mock.patch.object(Path, 'rename', new=interrupted):
            with self.assertRaises(OSError):
                states.build([source], out, boundaries=self.boundaries)
        self.assertEqual(before, {p.name: p.read_bytes() for p in out.iterdir()})
        self.assertEqual(original_report, report_path.read_bytes())

    def test_corrupt_uncompressed_reference_is_rejected_even_without_state_points(self):
        directory = self.root / 'reference'
        manifest = json.loads((directory / 'manifest.json').read_text())
        manifest['states']['WY']['raw_sha256'] = '0' * 64
        (directory / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'uncompressed'):
            states.StateBoundaries(directory)

    def test_fetch_rejects_incomplete_inventory_before_replacing_reference(self):
        destination = self.root / 'reference'
        before = (destination / 'manifest.json').read_bytes()
        responses = iter([{'layers': [{'id': 17, 'name': 'BAS 2026'}, {'id': 18, 'name': 'States', 'parentLayerId': 17}]}, {'geometryType': 'esriGeometryPolygon', 'description': 'January 1, 2026', 'supportedQueryFormats': 'JSON, geoJSON'}, {'count': 49}, {'features': []}])
        def reader(url):
            return b'{}', next(responses)
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            fetcher.fetch(destination, reader=reader)
        self.assertEqual(before, (destination / 'manifest.json').read_bytes())

    def test_successful_reference_refresh_preserves_source_notice(self):
        destination = self.root / 'reference'
        notice = b'Source: U.S. Census Bureau. Repackaging notice.\n'
        (destination / 'README.md').write_bytes(notice)
        raw_states = {state: gzip.decompress((destination / (state + '.geojson.gz')).read_bytes()) for state in states.STATES}
        def reader(url):
            if url.split('?')[0] == fetcher.SERVICE:
                data = {'layers': [{'id': 17, 'name': 'BAS 2026'}, {'id': 18, 'name': 'States', 'parentLayerId': 17}]}
            elif url.split('?')[0] == fetcher.LAYER:
                data = {'geometryType': 'esriGeometryPolygon', 'description': 'January 1, 2026', 'supportedQueryFormats': 'JSON, geoJSON'}
            else:
                parameters = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                if parameters.get('returnCountOnly') == ['true']:
                    data = {'count': 50}
                elif parameters.get('returnGeometry') == ['false']:
                    data = {'features': [{'attributes': {'STUSAB': state, 'NAME': state}} for state in sorted(states.STATES)]}
                else:
                    state = parameters['where'][0].split("'")[1]
                    raw = raw_states[state]
                    return raw, json.loads(raw)
            return json.dumps(data).encode(), data
        with contextlib.redirect_stdout(io.StringIO()):
            result = fetcher.fetch(destination, reader=reader)
        self.assertEqual(len(result['states']), 50)
        self.assertEqual((destination / 'README.md').read_bytes(), notice)
        self.assertEqual(states.StateBoundaries(destination).classify(-111.53306, 42.09611)['state'], 'ID')

    @unittest.skipUnless((states.REFERENCE / 'manifest.json').exists(), 'official reference not downloaded')
    def test_actual_census_idaho_utah_example(self):
        actual = states.StateBoundaries()
        self.assertEqual(actual.classify(-111.53306, 42.09611)['state'], 'ID')
        self.assertIsNone(actual.classify(109.2, 32.4)['state'])


if __name__ == '__main__':
    unittest.main()
