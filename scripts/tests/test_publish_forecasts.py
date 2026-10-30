"""Forecast publication is transactional even with missing/corrupt remote assets."""
import copy
from datetime import datetime, timezone
import gzip
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import publish_forecasts as p

NOW = 1793275200
COMMIT = 'a' * 40


def stamp(value):
    return datetime.fromtimestamp(value, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def fixture(now=NOW, sid='a' * 24):
    record = {'coordinate_key': '37.0000000,-120.0000000', 'region': 'conus',
              'status': 'known', 'grid_lat': 37, 'grid_lng': -120,
              'grid_distance_m': 100, 'temperatures_c': [0, None, -5]}
    identity = [['site-one', record['coordinate_key'], ['CA']]]
    m = {'version': 1, 'snapshot_id': sid, 'catalogue_sha256': p.digest(p.encode_json(identity)),
         'generated_at': stamp(now), 'expires_at': stamp(now + 7200),
         'source': {'name': 'NOAA/NWS NDFD', 'files': [
             {'region': region, 'url': f'{p.SOURCE_ROOT}AR.{region}/VP.001-003/ds.temp.bin',
              'last_modified': stamp(now - 3600), 'etag': 'noaa-etag', 'bytes': 123,
              'sha256': 'b' * 64} for region in sorted(p.REGIONS)]},
         'regions': {region: {'times': [stamp(now + h * 3600) for h in range(3)],
                             'grid_sha256': 'c' * 64, 'max_step_seconds': 3600,
                             'reference_times': [stamp(now - 7200), stamp(now - 3600)]}
                     for region in p.REGIONS}, 'states': {},
         'coverage': {'total': 1, 'grid_known': 1, 'unknown': 0}}
    files = {}
    for state in sorted(p.STATES):
        raw = p.encode_json({'version': 1, 'snapshot_id': sid, 'state': state,
                             'generated_at': m['generated_at'], 'expires_at': m['expires_at'],
                             'records': {'site-one': record} if state == 'CA' else {}})
        blob = gzip.compress(raw, mtime=0)
        name = f'forecast-v1-{sid}-{state}.json.gz'
        m['states'][state] = {'asset': name, 'sha256': p.digest(blob), 'json_sha256': p.digest(raw),
                              'bytes': len(blob), 'json_bytes': len(raw), 'count': int(state == 'CA')}
        files[name] = blob
    return m, p.encode_json(m), files


class FakeGitHub:
    def __init__(self):
        self.release = {'id': 7, 'tag_name': p.TAG, 'prerelease': True, 'draft': False, 'immutable': False}
        self.repository = {'id': p.REPOSITORY_ID, 'full_name': p.REPOSITORY, 'private': False}
        self.entries, self.bodies, self.log = {}, {}, []
        self.next_id, self.now, self.reads = 1, NOW, 0
        self.fail_upload = self.race = None
        self.clock = lambda: self.now

    def api(self, method, suffix, body=None, allowed=(200,)):
        self.log.append((method, suffix, body))
        if suffix == '':
            return 200, self.repository
        if method == 'GET' and suffix == '/releases/tags/' + p.TAG:
            return (200, copy.deepcopy(self.release)) if self.release else (404, None)
        if method == 'POST' and suffix == '/releases':
            self.release = {'id': 7, 'immutable': False, **body}
            return 201, copy.deepcopy(self.release)
        if suffix == '/releases/7':
            if method == 'PATCH':
                self.release.update(body)
            return 200, copy.deepcopy(self.release)
        raise AssertionError((method, suffix))

    def assets(self, release_id):
        self.reads += 1
        if self.reads == 2 and self.race:
            self.race(self)
        return copy.deepcopy(self.entries)

    def public(self, name, limit):
        if name not in self.bodies:
            raise p.PublishError('public_asset_unavailable')
        value = self.bodies[name]
        p.require(len(value) <= limit, 'too_large')
        return value

    def asset_bytes(self, asset, limit, *, draft=False):
        return self.public(asset['name'], limit)

    def upload(self, release_id, name, raw):
        self.log.append(('UPLOAD', name))
        if name == self.fail_upload:
            raise p.PublishError('simulated_upload_failure')
        p.require(name not in self.entries, 'already_exists')
        entry = {'id': self.next_id, 'name': name, 'size': len(raw), 'state': 'uploaded',
                 'created_at': stamp(self.now), 'digest': 'sha256:' + p.digest(raw)}
        self.next_id += 1
        self.entries[name], self.bodies[name] = entry, raw
        return entry

    def delete(self, asset_id):
        name = next(name for name, entry in self.entries.items() if entry['id'] == asset_id)
        self.log.append(('DELETE', name))
        del self.entries[name]
        del self.bodies[name]

    def seed(self, package, pointers=p.POINTERS):
        manifest, raw, files = package
        for name, value in {**files, f'forecast-v1-{manifest["snapshot_id"]}-manifest.json': raw,
                            **{name: raw for name in pointers}}.items():
            self.upload(7, name, value)
        self.log.clear()


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.m, self.raw, self.files = fixture()

    def test_full_package_load_binds_coordinate_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'output'
            output.mkdir()
            (output / 'manifest.json').write_bytes(self.raw)
            for name, blob in self.files.items():
                (output / name).write_bytes(blob)
            index = root / 'coordinate-index.json'
            index.write_bytes(p.encode_json({'version': 1, 'sha256': self.m['catalogue_sha256'], 'count': 1}))
            self.assertEqual(p.load_package(output, index, NOW)[0], self.m)
            index.write_bytes(p.encode_json({'version': 1, 'sha256': 'f' * 64, 'count': 1}))
            with self.assertRaisesRegex(p.PublishError, 'catalogue_mismatch'):
                p.load_package(output, index, NOW)

    def test_manifest_rejects_hostile_or_incompatible_schema(self):
        mutations = [lambda m: m.update(extra=True),
                     lambda m: m['states'].pop('AK'),
                     lambda m: m['source']['files'][0].pop('sha256'),
                     lambda m: m['source']['files'][0].update(sha256='F' * 64),
                     lambda m: m['source']['files'][0].update(url='https://evil.test/input'),
                     lambda m: m['source']['files'][0].update(last_modified=stamp(NOW-7201)),
                     lambda m: m.update(generated_at=stamp(NOW).replace('Z', '.1Z')),
                     lambda m: m['regions']['conus'].update(reference_times=[]),
                     lambda m: m['regions']['conus'].update(reference_times=[stamp(NOW), stamp(NOW)]),
                     lambda m: m['regions']['conus'].update(reference_times=[stamp(NOW+7201)]),
                     lambda m: m['regions']['conus'].update(times=[stamp(NOW), stamp(NOW+10801)]),
                     lambda m: m['states']['CA'].update(asset='../CA.json.gz'),
                     lambda m: m['coverage'].update(total=True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                m = copy.deepcopy(self.m)
                mutate(m)
                with self.assertRaises(p.PublishError):
                    p.validate_manifest(p.encode_json(m), NOW)
        with self.assertRaisesRegex(p.PublishError, 'stale'):
            p.validate_manifest(self.raw, NOW+7200)
        self.assertEqual(p.validate_manifest(self.raw, NOW+7200, allow_expired=True), self.m)

    def test_forecast_start_after_publication_does_not_renew_source_freshness(self):
        m = copy.deepcopy(self.m)
        m['regions']['conus']['reference_times'] = [stamp(NOW + 600)]
        m['regions']['conus']['times'] = [stamp(NOW + h * 3600) for h in (1, 2, 3)]
        raw = p.encode_json(m)
        self.assertEqual(p.validate_manifest(raw, NOW), m)
        with self.assertRaisesRegex(p.PublishError, 'stale'):
            p.validate_manifest(raw, NOW + 7200)
        m['source']['files'][0]['last_modified'] = stamp(NOW + 301)
        with self.assertRaises(p.PublishError):
            p.validate_manifest(p.encode_json(m), NOW)

    def test_duplicate_keys_and_invalid_dates_fail(self):
        with self.assertRaisesRegex(p.PublishError, 'duplicate_json_key'):
            p.decode_json(b'{"version":1,"version":2}')
        for date in ('2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+00:00'):
            with self.assertRaises(p.PublishError):
                p.timestamp(date)

    def test_state_retains_samples_and_rejects_mutations_after_rehash(self):
        name = self.m['states']['CA']['asset']
        data = p.validate_state(self.files[name], 'CA', self.m)
        self.assertEqual(data['records']['site-one']['temperatures_c'], [0, None, -5])
        mutations = [lambda r: r.update(grid_distance_m=5001),
                     lambda r: r.update(coordinate_key='037.0000000,-120.0000000'),
                     lambda r: r.update(coordinate_key='-0.0000000,-120.0000000'),
                     lambda r: r.update(temperatures_c=[0]),
                     lambda r: r.update(temperatures_c=[0, '3', -5]),
                     lambda r: r.update(extra=True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                modified = copy.deepcopy(data)
                mutate(modified['records']['site-one'])
                raw = p.encode_json(modified)
                blob = gzip.compress(raw, mtime=0)
                m = copy.deepcopy(self.m)
                m['states']['CA'].update(bytes=len(blob), sha256=p.digest(blob), json_bytes=len(raw), json_sha256=p.digest(raw))
                with self.assertRaises(p.PublishError):
                    p.validate_state(blob, 'CA', m)

    def test_bombs_trailing_stream_and_digest_mismatches_fail(self):
        for blob in (gzip.compress(b'x' * (p.MAX_RAW + 1)), gzip.compress(b'{}') + b'extra', b'bad gzip'):
            with self.assertRaises(p.PublishError):
                p.decompress(blob)
        name = self.m['states']['CA']['asset']
        with self.assertRaisesRegex(p.PublishError, 'asset_hash_mismatch'):
            p.validate_state(self.files[name] + b'x', 'CA', self.m)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeGitHub()
        self.old = fixture(NOW-1800, 'a'*24)
        self.new = fixture(NOW, 'b'*24)
        self.api.seed(self.old)

    def publish(self, package=None):
        return p.publish(self.api, *(package or self.new), NOW, COMMIT)

    def test_complete_generation_precedes_pointer_replacement_and_other_survives(self):
        result = self.publish()
        self.assertEqual(result['status'], 'published')
        self.assertEqual(self.api.bodies['current-a.json'], self.new[1])
        self.assertEqual(self.api.bodies['current-b.json'], self.old[1])
        change = self.api.log.index(('DELETE', 'current-a.json'))
        self.assertEqual(sum(item[0] == 'UPLOAD' for item in self.api.log[:change]), 51)
        self.assertFalse(any(item == ('DELETE', 'current-b.json') for item in self.api.log))

    def test_partial_generation_failure_never_touches_pointers(self):
        self.api.fail_upload = self.new[0]['states']['CA']['asset']
        with self.assertRaisesRegex(p.PublishError, 'simulated'):
            self.publish()
        self.assertTrue(all(self.api.bodies[name] == self.old[1] for name in p.POINTERS))
        self.assertFalse(any(item[0] == 'DELETE' for item in self.api.log))

    def test_pointer_upload_failure_leaves_other_valid_and_can_resume(self):
        self.api.fail_upload = 'current-a.json'
        with self.assertRaisesRegex(p.PublishError, 'simulated'):
            self.publish()
        self.assertNotIn('current-a.json', self.api.bodies)
        self.assertEqual(self.api.bodies['current-b.json'], self.old[1])
        self.api.fail_upload = None
        self.assertEqual(self.publish()['status'], 'published')

    def test_only_invalid_pointer_is_repaired(self):
        self.api.bodies['current-a.json'] = b'invalid'
        self.api.entries['current-a.json']['size'] = 7
        self.publish()
        self.assertEqual(self.api.bodies['current-b.json'], self.old[1])
        self.assertEqual(self.api.bodies['current-a.json'], self.new[1])

    def test_concurrent_pointer_change_prevents_destructive_step(self):
        def race(api):
            api.entries['current-a.json']['id'] += 10000
        self.api.race = race
        with self.assertRaisesRegex(p.PublishError, 'concurrent_publication'):
            self.publish()
        self.assertFalse(any(item[0] == 'DELETE' for item in self.api.log))

    def test_same_snapshot_is_idempotent_and_rollback_fails(self):
        self.assertEqual(self.publish(self.old)['status'], 'unchanged')
        self.assertFalse(any(item[0] in ('UPLOAD', 'DELETE') for item in self.api.log))
        with self.assertRaisesRegex(p.PublishError, 'forecast_rollback'):
            self.publish(fixture(NOW-2000, 'c'*24))

    def test_idempotent_rerun_verifies_and_repairs_missing_generation_asset(self):
        name = self.old[0]['states']['CA']['asset']
        self.api.delete(self.api.entries[name]['id'])
        self.api.log.clear()
        self.assertEqual(self.publish(self.old)['status'], 'unchanged')
        self.assertEqual(self.api.bodies[name], self.old[2][name])
        self.assertFalse(any(item[0] == 'DELETE' for item in self.api.log))

    def test_published_generation_cannot_be_overwritten(self):
        name = self.old[0]['states']['CA']['asset']
        self.api.bodies[name] = b'x' * len(self.api.bodies[name])
        with self.assertRaisesRegex(p.PublishError, 'immutable_asset_conflict'):
            self.publish(self.old)
        self.assertFalse(any(item[0] in ('UPLOAD', 'DELETE') for item in self.api.log))

    def test_conflicting_pointer_generation_is_rejected(self):
        altered = fixture(NOW-1800, 'c'*24)
        self.api.bodies['current-a.json'] = altered[1]
        self.api.entries['current-a.json']['size'] = len(altered[1])
        with self.assertRaisesRegex(p.PublishError, 'pointer_conflict'):
            self.publish()
        self.assertFalse(any(item[0] in ('UPLOAD', 'DELETE') for item in self.api.log))

    def test_immutable_private_or_wrong_repo_fail_before_writes(self):
        for key, value in [('immutable', True), ('immutable', None), ('prerelease', False)]:
            with self.subTest(key=key, value=value):
                self.api.release[key] = value
                with self.assertRaises(p.PublishError):
                    self.publish()
                self.assertFalse(any(item[0] in ('UPLOAD', 'DELETE', 'POST', 'PATCH') for item in self.api.log))
                self.api.release = {'id': 7, 'tag_name': p.TAG, 'prerelease': True, 'draft': False, 'immutable': False}
        self.api.repository['private'] = True
        with self.assertRaisesRegex(p.PublishError, 'repository_mismatch'):
            self.publish()

    def test_expiry_during_upload_never_changes_pointer(self):
        self.api.clock = lambda: NOW + 7201
        with self.assertRaisesRegex(p.PublishError, 'stale'):
            self.publish()
        self.assertTrue(all(self.api.bodies[name] == self.old[1] for name in p.POINTERS))

    def test_cleanup_protects_both_pointers_and_honors_expiry_grace(self):
        retired = fixture(NOW-9000, 'c'*24)
        self.api.seed(retired, pointers=())
        pointers = p.read_pointers(self.api, self.api.entries, NOW)
        assets = copy.deepcopy(self.api.entries)
        self.assertEqual(p.cleanup(self.api, assets, pointers, NOW-1), 0)
        self.assertEqual(p.cleanup(self.api, assets, pointers, NOW+1), 51)
        self.assertTrue(all(self.api.bodies[name] == self.old[1] for name in p.POINTERS))
        deletions = [item[1] for item in self.api.log if item[0] == 'DELETE']
        self.assertTrue(deletions[-1].endswith('-manifest.json'))

    def test_bootstrap_completes_draft_before_publication(self):
        self.api = FakeGitHub()
        self.api.release = None
        self.assertEqual(self.publish()['pointer'], 'both')
        create = next(item for item in self.api.log if item[0] == 'POST')
        self.assertTrue(create[2]['draft'])
        self.assertEqual(create[2]['make_latest'], 'false')
        patch = next(i for i, item in enumerate(self.api.log) if item[0] == 'PATCH')
        self.assertEqual(sum(item[0] == 'UPLOAD' for item in self.api.log[:patch]), 53)


class Response(io.BytesIO):
    def __init__(self, code, body=b'', headers=None):
        super().__init__(body)
        self.code, self.headers = code, headers or {}


class Opener:
    def __init__(self, responses):
        self.responses, self.requests = iter(responses), []

    def open(self, request, timeout):
        self.requests.append(request)
        return next(self.responses)


class TransportTests(unittest.TestCase):
    def test_public_redirect_never_receives_authorization(self):
        opener = Opener([Response(302, headers={'Location': 'https://release-assets.githubusercontent.com/a?signature=x'}), Response(200, b'good')])
        api = p.GitHub('test-token', opener=opener)
        self.assertEqual(api.public('current-a.json', 100), b'good')
        self.assertTrue(all('Authorization' not in request.headers for request in opener.requests))

    def test_draft_authorization_does_not_follow_redirect(self):
        opener = Opener([Response(302, headers={'Location': 'https://release-assets.githubusercontent.com/a?signature=x'}), Response(200, b'good')])
        api = p.GitHub('test-token', opener=opener)
        self.assertEqual(api.asset_bytes({'id': 1}, 100, draft=True), b'good')
        self.assertIn('Authorization', opener.requests[0].headers)
        self.assertNotIn('Authorization', opener.requests[1].headers)

    def test_hostile_redirect_fails_before_second_request(self):
        for url in ('http://release-assets.githubusercontent.com/x', 'https://evil.test/x', 'https://github.com.evil/x', 'https://a:b@release-assets.githubusercontent.com/x', 'https://127.0.0.1/x'):
            with self.subTest(url=url):
                opener = Opener([Response(302, headers={'Location': url})])
                with self.assertRaises(p.PublishError):
                    p.GitHub('test-token', opener=opener).public('current-a.json', 100)
                self.assertEqual(len(opener.requests), 1)

    def test_bounded_retry_and_response_size(self):
        opener = Opener([Response(429, headers={'Retry-After': '2'}), Response(200, b'good')])
        delays = []
        self.assertEqual(p.GitHub('test-token', opener=opener, sleep=delays.append).public('current-a.json', 100), b'good')
        self.assertEqual(delays, [2])
        opener = Opener([Response(429, headers={'Retry-After': '99999'})])
        with self.assertRaisesRegex(p.PublishError, 'rate_limited'):
            p.GitHub('test-token', opener=opener, sleep=delays.append).public('current-a.json', 100)
        opener = Opener([Response(200, b'x'*101)])
        with self.assertRaisesRegex(p.PublishError, 'remote_response_too_large'):
            p.GitHub('test-token', opener=opener).public('current-a.json', 100)


if __name__ == '__main__':
    unittest.main()
