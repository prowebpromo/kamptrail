import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_elevation as elevation


class ElevationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.keys = ['40.0100000,-105.2700000', '35.0000000,-117.0000000']
        self.source = elevation.source_metadata({'name': '3DEPElevation', 'serviceDataType': 'esriImageServiceDataTypeElevation', 'bandCount': 1, 'serviceDescription': 'Published October 26, 2026'})

    def sample(self, i, value='123.45'):
        lat, lng = map(float, self.keys[i].split(','))
        return {'locationId': i, 'location': {'x': lng, 'y': lat, 'spatialReference': {'wkid': 4326}},
                'value': value, 'rasterId': 42, 'resolution': 1,
                'attributes': {'VerticalDatum': 'NAVD 88', 'AcquisitionDate': 1615593600000}}

    def catalogue(self):
        return [{'id': 'a', 'coordinate_key': self.keys[0], 'states': ['CO']},
                {'id': 'b', 'coordinate_key': self.keys[1], 'states': ['CA']}]

    def cache(self):
        records = elevation.parse_samples({'samples': [self.sample(0), self.sample(1)]}, self.keys, self.source)
        sid = records[self.keys[0]]['service_metadata_id']
        return {'version': 1, 'coordinates': records, 'sources': {sid: self.source}}

    def test_reordering_units_coordinates_and_dates(self):
        result = elevation.parse_samples({'samples': [self.sample(1, '-40.2'), self.sample(0, '0')]}, self.keys, self.source)
        self.assertEqual(result[self.keys[0]]['elevation_m'], 0)
        self.assertEqual(result[self.keys[1]]['elevation_m'], -40.2)
        self.assertEqual(result[self.keys[0]]['source']['units'], 'metres')
        self.assertEqual(result[self.keys[0]]['vertical_datum'], 'NAVD 88')
        self.assertEqual(result[self.keys[0]]['acquisition_metadata'], {'AcquisitionDate': 1615593600000})
        self.assertEqual(result[self.keys[0]]['sample_coordinates'], {'lat': 40.01, 'lng': -105.27})

    def test_missing_duplicate_and_nodata_are_unknown_not_zero(self):
        for rows, reason in [([], 'missing_sample'), ([self.sample(0), self.sample(0)], 'duplicate_location_id'),
                             ([self.sample(0, 'NoData')], 'no_coverage'), ([self.sample(0, '-999999')], 'invalid_or_nodata_value'), ([self.sample(0, '-500.1')], 'invalid_or_nodata_value')]:
            result = elevation.parse_samples({'samples': rows}, self.keys, self.source)[self.keys[0]]
            self.assertEqual((result['status'], result['elevation_m'], result['reason']), ('unknown', None, reason))

    def test_invalid_ids_coordinates_errors_rejected(self):
        rows = [self.sample(0) for _ in range(4)]
        rows[0]['locationId'] = True
        rows[1]['locationId'] = 3
        rows[2]['location']['x'] = 0
        rows[3]['location']['spatialReference']['wkid'] = 3857
        for row in rows:
            with self.assertRaises(elevation.ElevationError):
                elevation.parse_samples({'samples': [row]}, self.keys, self.source)
        for data in [{'error': {'code': 500}}, {}, {'samples': None}]:
            with self.assertRaises(elevation.ElevationError):
                elevation.parse_samples(data, self.keys, self.source)

    def test_coordinate_normalization_and_catalogue_duplicates(self):
        self.assertEqual(elevation.coordinate_key(-0.0, -0.0), '0.0000000,0.0000000')
        for lat in [True, None, float('nan'), 91]:
            with self.assertRaises(elevation.ElevationError):
                elevation.coordinate_key(lat, 1)
        path = self.root / 'catalogue.json'
        row = {'id': 'a', 'lat': 40.01, 'lng': -105.27, 'states': ['CO']}
        elevation.atomic_write(path, {'sites': [row, row]})
        self.assertEqual(len(elevation.read_catalogue(path)), 1)
        elevation.atomic_write(path, {'records': [row, dict(row, lat=40.02)]})
        with self.assertRaises(elevation.ElevationError):
            elevation.read_catalogue(path)

    def test_coordinate_rounding_matches_javascript_binary_ties(self):
        cases = [
            (1.00390625, '1.0039063'), (-1.00390625, '-1.0039063'),
            (1.01171875, '1.0117188'), (-1.01171875, '-1.0117188'),
            (1.23456785, '1.2345678'), (-1.23456785, '-1.2345678'),
            (40.01000001, '40.0100000'), (40.01000009, '40.0100001'),
            (-0.00000001, '0.0000000'), (0.0, '0.0000000'),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(elevation.coordinate_key(value, value), expected + ',' + expected)

    def test_parameters(self):
        params = elevation.sample_params(self.keys)
        self.assertEqual(json.loads(params['geometry'])['points'][0], [-105.27, 40.01])
        self.assertEqual(params['interpolation'], 'RSP_BilinearInterpolation')
        self.assertEqual(params['returnFirstValueOnly'], 'true')
        with self.assertRaises(elevation.ElevationError):
            elevation.sample_params(self.keys * 26)

    def test_atomic_write_preserves_previous_on_failure(self):
        path = self.root / 'cache.json'
        elevation.atomic_write(path, {'old': True})
        before = path.read_bytes()
        with patch.object(elevation.os, 'replace', side_effect=OSError('disk failure')):
            with self.assertRaises(OSError):
                elevation.atomic_write(path, {'new': True})
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.root.iterdir()), [path])

    def test_restart_deduplicates_coordinates_and_skips_cached(self):
        calls = []
        def request(endpoint, params):
            if endpoint == elevation.SERVICE:
                return {'name': '3DEPElevation', 'serviceDataType': 'esriImageServiceDataTypeElevation', 'bandCount': 1}
            point = json.loads(params['geometry'])['points'][0]
            calls.append(point)
            if len(calls) == 2:
                raise elevation.ElevationError('temporary failure')
            return {'samples': [{'locationId': 0, 'location': {'x': point[0], 'y': point[1], 'spatialReference': {'wkid': 4326}}, 'value': '99'}]}
        cache_path = self.root / 'cache.json'
        catalogue = self.catalogue() + [dict(self.catalogue()[0], id='alias')]
        with self.assertRaises(elevation.ElevationError):
            elevation.enrich(catalogue, cache_path, request=request, batch_size=1, sleep=lambda n: None)
        self.assertEqual(len(elevation.load_cache(cache_path)['coordinates']), 1)
        cache, complete = elevation.enrich(catalogue, cache_path, request=request, batch_size=1, sleep=lambda n: None)
        self.assertTrue(complete)
        self.assertEqual(len(calls), 3)
        elevation.enrich(catalogue, cache_path, request=lambda *_: self.fail('Cached run must not request network'))

    def test_publication_commit_and_retention(self):
        out = self.root / 'public'
        cache = self.cache()
        first = elevation.publish(self.catalogue(), cache, out)
        first_bytes = (out / 'index.json').read_bytes()
        bad = dict(cache, coordinates={})
        with self.assertRaises(elevation.ElevationError):
            elevation.publish(self.catalogue(), bad, out)
        self.assertEqual((out / 'index.json').read_bytes(), first_bytes)
        real_write = elevation.atomic_write
        def fail_sidecar(path, value):
            if Path(path).name == 'CO.json':
                raise OSError('sidecar disk error')
            real_write(path, value)
        cache['coordinates'][self.keys[0]]['elevation_m'] += 1
        with patch.object(elevation, 'atomic_write', side_effect=fail_sidecar):
            with self.assertRaises(OSError):
                elevation.publish(self.catalogue(), cache, out)
        self.assertEqual((out / 'index.json').read_bytes(), first_bytes)
        second = elevation.publish(self.catalogue(), cache, out)
        cache['coordinates'][self.keys[0]]['elevation_m'] += 1
        third = elevation.publish(self.catalogue(), cache, out)
        self.assertEqual({p.name for p in (out / 'snapshots').iterdir()}, {second['snapshot_id'], third['snapshot_id']})
        elevation.publish(self.catalogue(), cache, out)
        self.assertEqual({p.name for p in (out / 'snapshots').iterdir()}, {second['snapshot_id'], third['snapshot_id']})
        for entry in third['states'].values():
            self.assertEqual(elevation.hashlib.sha256((out / entry['url']).read_bytes()).hexdigest(), entry['sha256'])

    def response(self, data):
        response = io.BytesIO(json.dumps(data).encode())
        response.geturl = lambda: elevation.SAMPLES
        return response

    def test_http200_error_body_and_bounded_retries(self):
        with self.assertRaises(elevation.ElevationError):
            elevation.request_json(elevation.SAMPLES, {}, opener=lambda *_a, **_k: self.response({'error': {'code': 500}}))
        tries = []
        def transient(*args, **kwargs):
            tries.append(1)
            raise urllib.error.HTTPError(elevation.SAMPLES, 503, 'unavailable', {}, None)
        waits = []
        with self.assertRaises(elevation.ElevationError):
            elevation.request_json(elevation.SAMPLES, {}, opener=transient, sleep=waits.append)
        self.assertEqual((len(tries), waits), (3, [2, 4]))
        with self.assertRaises(elevation.ElevationError):
            elevation.request_json('https://example.com/getSamples', {})

    def test_oversized_response_and_redirect_rejected(self):
        response = io.BytesIO(b' ' * (elevation.MAX_BYTES + 1))
        response.geturl = lambda: elevation.SAMPLES
        with self.assertRaises(elevation.ElevationError):
            elevation.request_json(elevation.SAMPLES, {}, opener=lambda *_a, **_k: response)
        response = self.response({'samples': []})
        response.geturl = lambda: 'https://example.com/elsewhere'
        with self.assertRaises(elevation.ElevationError):
            elevation.request_json(elevation.SAMPLES, {}, opener=lambda *_a, **_k: response)

    def test_missing_source_metadata_invalidates_cache(self):
        cache = self.cache()
        self.assertTrue(elevation.cache_entry_valid(self.keys[0], cache))
        cache['sources'] = {}
        self.assertFalse(elevation.cache_entry_valid(self.keys[0], cache))
        with self.assertRaises(elevation.ElevationError):
            elevation.publish(self.catalogue(), cache, self.root / 'public')

    def test_metadata_and_timestamp_validation(self):
        for value in [{}, {'name': 'other'}, {'error': {}}]:
            with self.assertRaises(elevation.ElevationError):
                elevation.source_metadata(value)
        record = self.cache()['coordinates'][self.keys[0]]
        for timestamp in ['invalid', '2026-10-29T12:00:00', '2026-10-29T12:00:00+01:00',
                          '2026-02-30T12:00:00Z', '2026-10-29T12:00:00.1234567Z', None]:
            record['retrieved_at'] = timestamp
            self.assertFalse(elevation.valid_cached(self.keys[0], record))
        for timestamp in ['2026-10-29T12:00:00Z', '2026-10-29T12:00:00.123456Z', '2026-10-29T12:00:00+00:00']:
            record['retrieved_at'] = timestamp
            self.assertTrue(elevation.valid_cached(self.keys[0], record))

    def test_unknown_retry_is_explicit_and_keeps_known_cached(self):
        cache = self.cache()
        record = cache['coordinates'][self.keys[0]]
        record.update(status='unknown', elevation_m=None, reason='no_coverage')
        path = self.root / 'cache.json'
        elevation.atomic_write(path, cache)
        elevation.enrich(self.catalogue(), path, request=lambda *_: self.fail('Unknown should be cached by default'))
        calls = []
        def request(endpoint, params):
            if endpoint == elevation.SERVICE:
                return {'name': '3DEPElevation', 'serviceDataType': 'esriImageServiceDataTypeElevation', 'bandCount': 1}
            calls.append(json.loads(params['geometry'])['points'])
            return {'samples': [self.sample(0)]}
        refreshed, complete = elevation.enrich(self.catalogue(), path, request=request, retry_unknown=True)
        self.assertEqual(calls, [[[-105.27, 40.01]]])
        self.assertEqual(refreshed['coordinates'][self.keys[0]]['status'], 'known')
        self.assertTrue(complete)

    def test_invalid_cache_units_not_reused(self):
        record = self.cache()['coordinates'][self.keys[0]]
        self.assertTrue(elevation.valid_cached(self.keys[0], record))
        for field, invalid in [('units', 'feet'), ('url', 'https://example.com'), ('horizontal_crs', 'EPSG:3857')]:
            record = self.cache()['coordinates'][self.keys[0]]
            record['source'][field] = invalid
            self.assertFalse(elevation.valid_cached(self.keys[0], record))

    def test_unknown_cache_still_requires_matching_sample_coordinates(self):
        cache = self.cache()
        record = cache['coordinates'][self.keys[0]]
        record.update(status='unknown', elevation_m=None, reason='no_coverage')
        self.assertTrue(elevation.cache_entry_valid(self.keys[0], cache))
        record['sample_coordinates']['lat'] += 1
        self.assertFalse(elevation.cache_entry_valid(self.keys[0], cache))
        record.update(reason='missing_sample', sample_coordinates=None)
        self.assertTrue(elevation.cache_entry_valid(self.keys[0], cache))

    def test_hashed_source_requires_provider_metadata_and_timezone(self):
        for change in [
                {'service_metadata': {}}, {'url': 'https://example.com'},
                {'metadata_retrieved_at': '2026-10-29'},
                {'metadata_retrieved_at': '2026-10-29T12:00:00'}]:
            cache = self.cache()
            source = dict(self.source, **change)
            sid = elevation.hashlib.sha256(elevation.encoded(source)).hexdigest()
            cache['sources'] = {sid: source}
            cache['coordinates'][self.keys[0]]['service_metadata_id'] = sid
            self.assertFalse(elevation.cache_entry_valid(self.keys[0], cache))

    def test_malformed_cache_and_unsupported_states_fail_cleanly(self):
        path = self.root / 'cache.json'
        for value in [[], {'version': 1, 'coordinates': {}, 'sources': []}]:
            elevation.atomic_write(path, value)
            before = path.read_bytes()
            with self.assertRaises(elevation.ElevationError):
                elevation.load_cache(path)
            self.assertEqual(path.read_bytes(), before)
        for states in [['DC'], ['PR'], [{}]]:
            elevation.atomic_write(path, {'sites': [{'id': 'a', 'lat': 40, 'lng': -105, 'states': states}]})
            with self.assertRaises(elevation.ElevationError):
                elevation.read_catalogue(path)
        row = self.sample(0)
        row['location']['spatialReference'] = None
        with self.assertRaises(elevation.ElevationError):
            elevation.parse_samples({'samples': [row]}, self.keys, self.source)

    def test_spatial_batches_cover_pending_once_and_preserve_cache(self):
        catalogue = self.catalogue()
        groups = []
        for group, (lat, lng) in enumerate([(37, -120), (40, -105), (43, -75)]):
            keys = [elevation.coordinate_key(lat + i * .0001, lng + ((i * 7) % 51) * .0001) for i in range(51)]
            groups.append(set(keys))
            catalogue.extend({'id': f'{group}:{i}', 'coordinate_key': key, 'states': ['CA', 'CO', 'NY'][group:group + 1]} for i, key in enumerate(keys))
        catalogue.append(dict(catalogue[-1], id='duplicate-coordinate'))
        path = self.root / 'cache.json'
        original = self.cache()
        original_bytes = elevation.encoded(original['coordinates'])
        elevation.atomic_write(path, original)
        requested, sizes, sleeps = [], [], []
        def request(endpoint, params):
            if endpoint == elevation.SERVICE:
                return {'name': '3DEPElevation', 'serviceDataType': 'esriImageServiceDataTypeElevation', 'bandCount': 1}
            points = json.loads(params['geometry'])['points']
            sizes.append(len(points))
            requested.extend(elevation.coordinate_key(lat, lng) for lng, lat in points)
            return {'samples': [{'locationId': i, 'location': {'x': lng, 'y': lat, 'spatialReference': {'wkid': 4326}}, 'value': lat}
                                for i, (lng, lat) in reversed(list(enumerate(points)))]}
        cache, complete = elevation.enrich(list(reversed(catalogue)), path, request=request, sleep=sleeps.append)
        expected = set.union(*groups)
        self.assertTrue(complete)
        self.assertEqual(len(requested), len(expected))
        self.assertEqual(set(requested), expected)
        self.assertEqual(sizes, [50, 50, 50, 3])
        self.assertEqual(sleeps, [.5, .5, .5, .5])
        self.assertEqual(requested, sorted(expected, key=elevation.spatial_order))
        for offset in range(0, 153, 51):
            self.assertIn(set(requested[offset:offset + 51]), groups)
        self.assertEqual(elevation.encoded({k: cache['coordinates'][k] for k in self.keys}), original_bytes)
        for key in expected:
            self.assertEqual(cache['coordinates'][key]['elevation_m'], float(key.split(',')[0]))
        elevation.enrich(catalogue, path, request=lambda *_: self.fail('Cached rerun must not request network'))

    def adaptive_catalogue(self):
        return self.catalogue() + [{'id': f'adaptive:{i}', 'coordinate_key': elevation.coordinate_key(38 + i * .001, -105), 'states': ['CO']} for i in range(50)]

    def adaptive_request(self, opener, sleeps):
        def request(endpoint, params):
            if endpoint == elevation.SERVICE:
                return {'name': '3DEPElevation', 'serviceDataType': 'esriImageServiceDataTypeElevation', 'bandCount': 1}
            return elevation.request_json(endpoint, params, opener=opener, sleep=sleeps.append)
        return request

    def request_points(self, req):
        return json.loads(elevation.urllib.parse.parse_qs(elevation.urllib.parse.urlparse(req.full_url).query)['geometry'][0])['points']

    def point_response(self, points):
        return self.response({'samples': [{'locationId': i, 'location': {'x': lng, 'y': lat, 'spatialReference': {'wkid': 4326}}, 'value': lat}
                                          for i, (lng, lat) in reversed(list(enumerate(points)))]})

    def test_http502_splits_once_and_checkpoints_each_successful_child(self):
        path = self.root / 'cache.json'
        original = self.cache()
        elevation.atomic_write(path, original)
        sizes, successful, sleeps, checkpoint_sizes = [], [], [], []
        def opener(req, **_):
            points = self.request_points(req)
            sizes.append(len(points))
            if len(points) == 50:
                raise urllib.error.HTTPError(elevation.SAMPLES, 502, 'gateway', {}, None)
            checkpoint_sizes.append(len(elevation.load_cache(path)['coordinates']))
            successful.extend(elevation.coordinate_key(lat, lng) for lng, lat in points)
            return self.point_response(points)
        cache, complete = elevation.enrich(self.adaptive_catalogue(), path, request=self.adaptive_request(opener, sleeps), sleep=sleeps.append)
        self.assertTrue(complete)
        self.assertEqual(sizes, [50, 50, 50, 25, 25])
        self.assertEqual(checkpoint_sizes, [2, 27])
        self.assertEqual(sleeps, [.5, 2, 4, .5, .5])
        self.assertEqual(len(successful), len(set(successful)))
        self.assertEqual(len(successful), 50)
        for key in successful:
            self.assertEqual(cache['coordinates'][key]['elevation_m'], float(key.split(',')[0]))
        self.assertEqual({k: cache['coordinates'][k] for k in self.keys}, original['coordinates'])
        elevation.enrich(self.adaptive_catalogue(), path, request=lambda *_: self.fail('All results must remain cached'))

    def test_persistent_502_aborts_first_branch_after_twelve_attempts(self):
        path = self.root / 'cache.json'
        elevation.atomic_write(path, self.cache())
        before = path.read_bytes()
        sizes, sleeps = [], []
        def opener(req, **_):
            sizes.append(len(self.request_points(req)))
            raise urllib.error.HTTPError(elevation.SAMPLES, 502, 'gateway', {}, None)
        with self.assertRaises(elevation.RetryableElevationError):
            elevation.enrich(self.adaptive_catalogue(), path, request=self.adaptive_request(opener, sleeps), sleep=sleeps.append)
        self.assertEqual(sizes, [50] * 3 + [25] * 3 + [12] * 3 + [6] * 3)
        self.assertEqual(path.read_bytes(), before)

    def test_later_subbatch_failure_preserves_completed_sibling(self):
        path = self.root / 'cache.json'
        elevation.atomic_write(path, self.cache())
        sizes, sleeps = [], []
        completed = []
        def opener(req, **_):
            points = self.request_points(req)
            sizes.append(len(points))
            if len(points) == 25 and not completed:
                completed.extend(elevation.coordinate_key(lat, lng) for lng, lat in points)
                return self.point_response(points)
            raise urllib.error.HTTPError(elevation.SAMPLES, 504, 'timeout', {}, None)
        with self.assertRaises(elevation.RetryableElevationError):
            elevation.enrich(self.adaptive_catalogue(), path, request=self.adaptive_request(opener, sleeps), sleep=sleeps.append)
        self.assertEqual(sizes, [50] * 3 + [25] + [25] * 3 + [12] * 3 + [6] * 3)
        cache = elevation.load_cache(path)
        self.assertEqual(len(cache['coordinates']), 27)
        self.assertTrue(all(elevation.cache_entry_valid(k, cache) for k in completed))

    def test_contract_errors_and_nontransient_http_never_split(self):
        for failure in ['http400', 'provider_error', 'bad_json', 'bad_id', 'bad_coordinate']:
            with self.subTest(failure=failure):
                path = self.root / (failure + '.json')
                elevation.atomic_write(path, self.cache())
                before = path.read_bytes()
                calls, sleeps = [], []
                def opener(req, **_):
                    calls.append(1)
                    if failure == 'http400':
                        raise urllib.error.HTTPError(elevation.SAMPLES, 400, 'bad request', {}, None)
                    if failure == 'provider_error':
                        return self.response({'error': {'code': 500}})
                    if failure == 'bad_json':
                        r = io.BytesIO(b'{malformed')
                        r.geturl = lambda: elevation.SAMPLES
                        return r
                    points = self.request_points(req)
                    lng, lat = points[0]
                    return self.response({'samples': [{'locationId': 99 if failure == 'bad_id' else 0,
                        'location': {'x': lng + 1, 'y': lat, 'spatialReference': {'wkid': 4326}}, 'value': 100}]})
                with self.assertRaises(elevation.ElevationError):
                    elevation.enrich(self.adaptive_catalogue(), path, request=self.adaptive_request(opener, sleeps), sleep=sleeps.append)
                self.assertEqual(len(calls), 1)
                self.assertEqual(path.read_bytes(), before)

    def test_outage_ratelimit_and_connect_failures_retry_without_splitting(self):
        for failure in [429, 500, 503, 'dns', 'connection', 'connect_timeout']:
            with self.subTest(failure=failure):
                path = self.root / (str(failure) + '.json')
                elevation.atomic_write(path, self.cache())
                before = path.read_bytes()
                calls, sleeps = [], []
                def opener(req, **_):
                    calls.append(1)
                    if isinstance(failure, int):
                        raise urllib.error.HTTPError(elevation.SAMPLES, failure, 'unavailable', {'Retry-After': '7'}, None)
                    if failure == 'dns':
                        raise urllib.error.URLError('dns unavailable')
                    if failure == 'connection':
                        raise ConnectionRefusedError('refused')
                    raise TimeoutError('connect timeout')
                with self.assertRaises(elevation.RetryableElevationError) as caught:
                    elevation.enrich(self.adaptive_catalogue(), path, request=self.adaptive_request(opener, sleeps), sleep=sleeps.append)
                self.assertFalse(caught.exception.subdividable)
                self.assertEqual(len(calls), 3)
                self.assertEqual(sleeps, [.5, 7, 7] if failure in (429, 503) else [.5, 2, 4])
                self.assertEqual(path.read_bytes(), before)

    def test_retry_after_date_and_excessive_delay_fail_closed(self):
        self.assertEqual(elevation.retry_after_seconds({'Retry-After': 'Thu, 29 Oct 2026 12:00:12 GMT'},
            now=lambda: elevation.datetime(2026, 10, 29, 12, 0, tzinfo=elevation.timezone.utc).timestamp()), 12)
        for value in ['61', '86400', 'invalid-date']:
            calls, sleeps = [], []
            def opener(*_a, **_k):
                calls.append(1)
                raise urllib.error.HTTPError(elevation.SAMPLES, 429, 'rate limited', {'Retry-After': value}, None)
            with self.assertRaises(elevation.ElevationError) as caught:
                elevation.request_json(elevation.SAMPLES, {}, opener=opener, sleep=sleeps.append)
            self.assertNotIsInstance(caught.exception, elevation.RetryableElevationError)
            self.assertEqual((len(calls), sleeps), (1, []))

    def test_only_read_timeouts_are_subdividable_transport_failures(self):
        class TimeoutResponse(io.BytesIO):
            def geturl(self):
                return elevation.SAMPLES
            def read(self, *_):
                raise TimeoutError('read timed out')
        sleeps = []
        with self.assertRaises(elevation.RetryableElevationError) as caught:
            elevation.request_json(elevation.SAMPLES, {}, opener=lambda *_a, **_k: TimeoutResponse(), sleep=sleeps.append)
        self.assertTrue(caught.exception.subdividable)
        self.assertEqual(sleeps, [2, 4])


if __name__ == '__main__':
    unittest.main()
