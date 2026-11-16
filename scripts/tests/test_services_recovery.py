import errno
import io
import json
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import import_services as services
import stage_services as staging
from aggregate_services import aggregate
from plan_services_recovery import pending_states
from services_regions import REGISTRY_PATH, URLS


def failure_proof(stage, region='UT', batch='test'):
    receipt = {'version': 1, 'region': region, 'batch': batch,
               'registry_sha256': staging.digest(REGISTRY_PATH), 'failed_at': services.utc_now(),
               'error': 'exhausted startup connection refused', 'failure_kind': 'startup_transport',
               'importer_exit': 75, 'last_good_retained': True}
    path = stage / f'{region}-failure.json'
    path.write_text(json.dumps(receipt))
    return path, receipt


def checkpoint(stage, region='RI', batch='test'):
    directory = stage / region
    directory.mkdir()
    source = {'kind': 'geofabrik', 'url': URLS[region],
              'extract_timestamp': '2025-01-01T00:00:00Z', 'retrieved_at': '2025-03-01T00:00:00Z',
              'sha256': 'a' * 64, 'license': 'ODbL-1.0', 'categories': list(services.CATEGORIES)}
    row = {'id': 'osm:node:1', 'osm_type': 'node', 'osm_id': '1', 'osm_version': 1,
           'edited_at': '2025-01-01T00:00:00Z', 'coordinates': [-71.4, 41.8],
           'name': 'Station', 'categories': ['fuel'], 'tags': {'amenity': 'fuel'},
           'states': [region], 'source_region': region}
    (directory / 'source.json').write_text(json.dumps({'version': 2, 'region': region, 'source': source, 'items': [row]}))
    (directory / 'report.json').write_text(json.dumps({'source': source, 'statistics': {
        'accepted': 1, 'parser_version': '4.3.2', 'sha256': source['sha256'], 'url': source['url'],
        'resolved_url': source['url'].replace('latest', '250101'),
        'retrieved_at': source['retrieved_at'], 'bytes': 100, 'quarantined': 0}, 'quarantine': []}))
    (directory / 'receipt.json').write_text(json.dumps({'version': 1, 'region': region,
        'batch': batch, 'registry_sha256': staging.digest(REGISTRY_PATH), 'accepted': 1,
        'hashes': {name: staging.digest(directory / name) for name in ('source.json', 'report.json')}}))
    return directory


class ServicesRecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='services-recovery-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.stage = self.root / 'stage'
        self.stage.mkdir()
        # The fixtures predate accepted production extracts; use an empty baseline.
        baseline = patch('plan_services_recovery.ROOT', self.root / 'checkout')
        baseline.start()
        self.addCleanup(baseline.stop)

    def test_exhausted_startup_whitelist_has_distinct_type_and_original_cause(self):
        reasons = [TimeoutError('status timeout')]
        reasons += [OSError(code, 'transport failure') for code in (
            errno.ENETDOWN, errno.ENETUNREACH, errno.EHOSTUNREACH,
            errno.ECONNRESET, errno.ECONNABORTED, errno.ECONNREFUSED, errno.ETIMEDOUT)]
        for reason in reasons:
            for failure in (reason, urllib.error.URLError(reason)):
                with self.subTest(reason=str(failure)):
                    opener = Mock()
                    opener.open.side_effect = failure
                    with patch('urllib.request.build_opener', return_value=opener), \
                            patch('import_services.time.monotonic', return_value=100), \
                            patch('import_services.time.sleep') as sleep:
                        with self.assertRaises(services.StartupTransportFailure) as caught:
                            services._open_download(urllib.request.Request(URLS['RI']), 'RI', 1900)
                    self.assertIs(caught.exception.__cause__, failure)
                    self.assertEqual(opener.open.call_count, 3)
                    self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 3])

    def test_final_startup_timeout_cannot_reclassify_exhausted_download_budget(self):
        clock = [100]
        opener = Mock()
        def opened(request, timeout):
            if opener.open.call_count == 3:
                clock[0] = 1900
            raise TimeoutError('startup timeout')
        opener.open.side_effect = opened
        with patch('urllib.request.build_opener', return_value=opener), \
                patch('import_services.time.monotonic', side_effect=lambda: clock[0]), \
                patch('import_services.time.sleep'):
            with self.assertRaisesRegex(ValueError, 'budget exceeded'):
                services._open_download(urllib.request.Request(URLS['RI']), 'RI', 1900)
        self.assertEqual(opener.open.call_count, 3)

    def test_only_typed_importer_failure_maps_to_exit_75(self):
        with patch('import_services.main', side_effect=services.StartupTransportFailure('startup')), \
                patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(services.cli(), 75)
        for failure in (ValueError('schema'), TimeoutError('body'), ssl.SSLError('TLS'),
                        urllib.error.HTTPError(URLS['RI'], 503, 'status', {}, None)):
            with self.subTest(failure=str(failure)), patch('import_services.main', side_effect=failure):
                with self.assertRaises(type(failure)):
                    services.cli()
            if isinstance(failure, urllib.error.HTTPError):
                failure.close()
        with patch('stage_services.main', side_effect=staging.StartupImportFailure(75, ['import'])), \
                patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(staging.cli(), 75)
        for failure in (subprocess.CalledProcessError(1, ['import']),
                        subprocess.CalledProcessError(75, ['proof-validator']), ValueError('proof')):
            with patch('stage_services.main', side_effect=failure):
                with self.assertRaises(type(failure)):
                    staging.cli()

    def test_importer_exit_75_produces_bound_retryable_receipt_and_retains_baseline(self):
        checkout = self.root / 'checkout'
        accepted = checkout / 'data/sources/services/UT.json'
        accepted.parent.mkdir(parents=True)
        accepted.write_bytes(b'last-good')
        with patch('stage_services.ROOT', checkout), \
                patch('stage_services.run_import', side_effect=staging.StartupImportFailure(75, ['import'])):
            with self.assertRaises(subprocess.CalledProcessError):
                staging.stage_one('UT', self.stage, self.root / 'raw', 'test')
        self.assertEqual(accepted.read_bytes(), b'last-good')
        self.assertFalse((self.stage / 'UT').exists())
        self.assertEqual(pending_states(self.stage, 'test', ['UT']), ['UT'])
        receipt = json.loads((self.stage / 'UT-failure.json').read_bytes())
        self.assertEqual(receipt['failure_kind'], 'startup_transport')
        self.assertTrue(receipt['last_good_retained'])
        self.assertEqual(receipt['registry_sha256'], staging.digest(REGISTRY_PATH))

    def test_deterministic_stage_failure_is_never_recovered(self):
        for error in (ValueError('parse budget'), subprocess.CalledProcessError(1, ['import']),
                      subprocess.CalledProcessError(75, ['proof-validator'])):
            with self.subTest(error=str(error)), patch('stage_services.run_import', side_effect=error):
                with self.assertRaises(type(error)):
                    staging.stage_one('UT', self.stage, self.root / 'raw', 'test')
                with self.assertRaisesRegex(ValueError, 'not a bound'):
                    pending_states(self.stage, 'test', ['UT'])

    def test_only_supervised_importer_exit_75_has_deferred_type(self):
        with self.assertRaises(staging.StartupImportFailure) as caught:
            staging.run_import([sys.executable, '-c', 'raise SystemExit(75)'])
        self.assertEqual(caught.exception.returncode, 75)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            staging.run_import([sys.executable, '-c', 'raise SystemExit(1)'])
        self.assertNotIsInstance(caught.exception, staging.StartupImportFailure)

    def test_only_failed_state_is_selected_and_successful_proofs_are_unchanged(self):
        completed = checkpoint(self.stage)
        before = {path: path.read_bytes() for path in completed.iterdir()}
        failed, _ = failure_proof(self.stage)
        self.assertEqual(pending_states(self.stage, 'test', ['RI', 'UT']), ['UT'])
        # A successful recovery artifact replaces this state's failure artifact.
        failed.unlink()
        checkpoint(self.stage, 'UT')
        self.assertEqual(pending_states(self.stage, 'test', ['RI', 'UT']), [])
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)

    def test_missing_unknown_conflicting_or_corrupt_proof_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'missing'):
            pending_states(self.stage, 'test', ['UT'])
        unknown = self.stage / 'XX-failure.json'
        unknown.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'unrequested'):
            pending_states(self.stage, 'test', ['UT'])
        unknown.unlink()
        failed, _ = failure_proof(self.stage)
        completed = checkpoint(self.stage, 'UT')
        with self.assertRaisesRegex(ValueError, 'conflicting'):
            pending_states(self.stage, 'test', ['UT'])
        failed.unlink()
        (completed / 'source.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'hash-mismatched'):
            pending_states(self.stage, 'test', ['UT'])

    def test_failure_receipt_requires_exact_identity_schema_and_type(self):
        path, good = failure_proof(self.stage)
        mutations = {'version': 2, 'region': 'RI', 'batch': 'different-run-or-sha',
                     'registry_sha256': '0' * 64, 'failure_kind': 'import_or_validation',
                     'importer_exit': 1, 'failed_at': '2099-01-01T00:00:00Z',
                     'last_good_retained': 'true', 'error': ''}
        for key, value in mutations.items():
            with self.subTest(field=key):
                path.write_text(json.dumps({**good, key: value}))
                with self.assertRaises(ValueError):
                    pending_states(self.stage, 'test', ['UT'])
        for bad in ({**good, 'unexpected': True}, {key: value for key, value in good.items() if key != 'batch'}):
            path.write_text(json.dumps(bad))
            with self.assertRaises(ValueError):
                pending_states(self.stage, 'test', ['UT'])

    def test_three_exhausted_recovery_rounds_cannot_create_national_candidate(self):
        completed = checkpoint(self.stage)
        before = {path: path.read_bytes() for path in completed.iterdir()}
        for attempt in range(4):  # Initial attempt and exactly three recovery rounds.
            failure_proof(self.stage)
            self.assertEqual(pending_states(self.stage, 'test', ['RI', 'UT']), ['UT'])
        destination = self.root / 'candidate'
        destination.mkdir()
        (destination / 'index.json').write_bytes(b'last-good')
        with self.assertRaises(FileNotFoundError):
            aggregate(self.stage, destination, 'test')
        self.assertEqual((destination / 'index.json').read_bytes(), b'last-good')
        self.assertFalse((destination / 'aggregate-receipt.json').exists())
        for path, content in before.items():
            self.assertEqual(path.read_bytes(), content)


if __name__ == '__main__':
    unittest.main()
