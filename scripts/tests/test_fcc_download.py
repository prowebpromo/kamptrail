import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location('fcc_download', Path(__file__).parents[1] / 'fcc_download.py')
fcc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fcc)
email_spec = importlib.util.spec_from_file_location('fcc_server_set_email', Path(__file__).parents[1] / 'fcc_server_set_email.py')
email_helper = importlib.util.module_from_spec(email_spec)
email_spec.loader.exec_module(email_helper)

class WorkerTests(unittest.TestCase):
    def test_refuses_web_root_and_repo(self):
        for path in ('/tmp/public_html/fcc', fcc.ROOT / 'private'):
            with self.assertRaises(fcc.SafeError):
                fcc.outside_public(path)

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

    def test_email_update_preserves_token_and_private_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = directory / 'credentials.json'
            path.write_text(json.dumps({'username': '', 'token': 'synthetic-secret', 'other': 'retained'}))
            path.chmod(0o600)
            email_helper.set_email(directory, 'owner@example.invalid')
            self.assertEqual(json.loads(path.read_text()), {'username': 'owner@example.invalid', 'token': 'synthetic-secret', 'other': 'retained'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(sorted(p.name for p in directory.iterdir()), ['credentials.json'])

    def test_email_update_refuses_insecure_credentials_and_invalid_email(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            path = directory / 'credentials.json'
            path.write_text('{"token":"synthetic-secret"}')
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                email_helper.set_email(directory, 'owner@example.invalid')
            path.chmod(0o600)
            with self.assertRaises(ValueError):
                email_helper.set_email(directory, 'owner@example.invalid\nInjected')
            self.assertEqual(json.loads(path.read_text()), {'token': 'synthetic-secret'})

    def test_rate_limit_is_shared_across_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = fcc.secure_dir(tmp)
            fcc.reserve_request(directory)
            with self.assertRaises(fcc.SafeError):
                fcc.reserve_request(directory)

    def test_rejects_auth_failure_in_http_200(self):
        for value in ({'status': 'fail', 'status_code': 401, 'data': []}, {'unexpected': []}):
            with self.assertRaises(fcc.SafeError):
                fcc.read_json(io.BytesIO(json.dumps(value).encode()))

if __name__ == '__main__':
    unittest.main()
