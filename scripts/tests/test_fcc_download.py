import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location('fcc_download', Path(__file__).parents[1] / 'fcc_download.py')
fcc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fcc)

class WorkerTests(unittest.TestCase):
    def test_refuses_web_root_and_repo(self):
        for path in ('/tmp/public_html/fcc', fcc.ROOT / 'private'):
            with self.assertRaises(fcc.SafeError):
                fcc.outside_public(path)

    @unittest.skipUnless(os.name == 'posix', 'Unix private storage')
    def test_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = fcc.secure_dir(tmp)
            path = directory / 'credentials.json'
            path.write_text(json.dumps({'username': 'test@example.invalid', 'token': 'synthetic-secret'}))
            path.chmod(0o644)
            with self.assertRaises(fcc.SafeError):
                fcc.load_credentials(directory)
            path.chmod(0o600)
            self.assertEqual(fcc.load_credentials(directory)[1], 'synthetic-secret')
            path.unlink()
            path.symlink_to(directory / 'missing')
            with self.assertRaises(fcc.SafeError):
                fcc.load_credentials(directory)

    def test_errors_never_contain_credentials_or_upstream_body(self):
        class Failing:
            def open(self, req, **kw):
                raise urllib.error.HTTPError(req.full_url, 401, 'synthetic-secret', {}, io.BytesIO(b'synthetic-secret'))
        with self.assertRaises(fcc.SafeError) as result:
            fcc.request('listAsOfDates', ('test@example.invalid', 'synthetic-secret'), Failing())
        self.assertNotIn('synthetic-secret', str(result.exception))
        with self.assertRaises(fcc.SafeError):
            fcc.request('//attacker.invalid', ('test@example.invalid', 'synthetic-secret'), Failing())
        with self.assertRaises(fcc.SafeError):
            fcc.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://attacker.invalid/')

    def test_failed_download_preserves_previous_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'coverage.zip'
            path.write_bytes(b'previous')
            with self.assertRaises(fcc.SafeError):
                fcc.download(io.BytesIO(b'<html>synthetic-secret</html>'), path)
            self.assertEqual(path.read_bytes(), b'previous')
            self.assertEqual(list(Path(tmp).iterdir()), [path])
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as z:
                z.writestr('fixture.txt', 'synthetic data')
            data.seek(0)
            result = fcc.download(data, path)
            self.assertEqual(len(result['sha256']), 64)
            self.assertTrue(zipfile.is_zipfile(path))

    def test_denials_keep_status_and_only_an_allowlisted_format(self):
        for status, media, label in [(401, 'application/json; charset=utf-8', 'JSON'),
                                     (403, 'TEXT/HTML', 'HTML'),
                                     (403, 'text/secret-marker', 'other/unspecified')]:
            with self.subTest(status=status, media=media):
                body = io.BytesIO(b'secret-marker')
                opener = mock.Mock()
                opener.open.side_effect = urllib.error.HTTPError(
                    'https://example.invalid/secret-marker', status, 'secret-marker',
                    {'Content-Type': media}, body)
                with self.assertRaises(fcc.SafeError) as err:
                    fcc.request('listAsOfDates', ('user@example.invalid', 'secret-marker'), opener)
                self.assertIn(f'HTTP {status}; declared response format: {label}.', str(err.exception))
                self.assertNotIn('secret-marker', str(err.exception))
                self.assertTrue(body.closed)

    def test_local_check_uses_one_request_and_no_credential_files(self):
        dates = {'data': [{'as_of_date': '2025-12-31', 'data_type': 'availability'}],
                 'status': 'successful', 'status_code': 200}
        response = io.BytesIO(json.dumps(dates).encode())
        response.getcode = lambda: 200
        with mock.patch.object(fcc.sys, 'argv', ['fcc', 'check-local']), \
                mock.patch.object(fcc, 'secure_dir', side_effect=AssertionError), \
                mock.patch.object(fcc, 'reserve_request', side_effect=AssertionError), \
                mock.patch.object(fcc, 'prompt_credentials', return_value=('a', 'secret-marker')), \
                mock.patch.object(fcc, 'request', return_value=response) as req, \
                mock.patch('sys.stdout', new_callable=io.StringIO) as output:
            fcc.main()
        req.assert_called_once_with('listAsOfDates', ('a', 'secret-marker'))
        self.assertIn('Authentication succeeded', output.getvalue())
        self.assertNotIn('secret-marker', output.getvalue())

    @unittest.skipUnless(os.name == 'posix', 'Unix private storage')
    def test_schema_errors_identify_only_the_field_not_the_value(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = fcc.secure_dir(tmp)
            path = directory / 'credentials.json'
            for value, message in [('{bad', 'not valid JSON'), ('{"username":"", "token":"synthetic-secret"}', 'email field'), ('{"username":"test@example.invalid", "token":""}', 'token field')]:
                path.write_text(value)
                path.chmod(0o600)
                with self.assertRaises(fcc.SafeError) as result:
                    fcc.load_credentials(directory)
                self.assertIn(message, str(result.exception))
                self.assertNotIn('synthetic-secret', str(result.exception))
                self.assertNotIn('test@example.invalid', str(result.exception))

    @unittest.skipUnless(os.name == 'posix', 'Unix private storage')
    def test_rate_limit_is_shared_across_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = fcc.secure_dir(tmp)
            fcc.reserve_request(directory)
            with self.assertRaises(fcc.SafeError):
                fcc.reserve_request(directory)

    def test_request_uses_public_map_host_for_all_routes(self):
        opener = mock.Mock()
        for route in ('listAsOfDates', 'downloads/listAvailabilityData/2026-06-30',
                      'downloads/listAvailabilityData/2026-06-30?category=Provider&technology_type=Mobile+Broadband',
                      'downloads/downloadFile/availability/123/2'):
            with self.subTest(route=route):
                fcc.request(route, ('a', 'fixture-token'), opener)
                req = opener.open.call_args.args[0]
                self.assertEqual(req.full_url, 'https://broadbandmap.fcc.gov/api/public/map/' + route)

    def test_catalog_confirms_provider_and_state_mobile_files_only(self):
        for category in ('Provider', 'State'):
            with self.subTest(category=category):
                row = {'category': category, 'file_type': 'gis', 'technology_type': 'Mobile Broadband', 'file_id': 123}
                others = [dict(row, category='Summary'), dict(row, technology_type='Fixed Broadband'),
                          dict(row, file_type='csv'), None]
                result = {'data': [row, *others], 'status_code': 200}
                response = io.BytesIO(json.dumps(result).encode())
                with mock.patch.object(fcc, 'request', return_value=response) as req:
                    self.assertEqual(fcc.list_mobile('2026-06-30', ('a', 'b'), category), [row])
                    req.assert_called_once_with('downloads/listAvailabilityData/2026-06-30?category='
                                                + category + '&technology_type=Mobile+Broadband', ('a', 'b'))

    def test_rejects_auth_failure_in_http_200(self):
        for value in ({'status': 'fail', 'status_code': 401, 'data': []}, {'unexpected': []}):
            with self.assertRaises(fcc.SafeError):
                fcc.read_json(io.BytesIO(json.dumps(value).encode()))

if __name__ == '__main__':
    unittest.main()
