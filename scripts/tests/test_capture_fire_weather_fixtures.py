import hashlib
import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import capture_fire_weather_fixtures as cap

NOW = datetime(2026, 11, 1, 15, 0, 0, tzinfo=timezone.utc)
EMPTY = json.dumps({'type': 'FeatureCollection', 'features': []}).encode()


def page(count, next_url=None):
    body = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'id': str(i)}} for i in range(count)]}
    if next_url:
        body['pagination'] = {'next': next_url}
    return json.dumps(body).encode()


class FakeNws:
    def __init__(self, responses=None):
        self.urls = []
        self.responses = responses or {}

    def __call__(self, url):
        self.urls.append(url)
        for needle, result in self.responses.items():
            if needle in url:
                if isinstance(result, Exception):
                    raise result
                return result
        if '/zones/' in url:
            return 200, json.dumps({'geometry': {'type': 'Polygon', 'coordinates': []}}).encode(), {'Cache-Control': 'public, max-age=60'}
        return 200, EMPTY, {}


class CaptureFixtureTests(unittest.TestCase):
    def run_capture(self, fake, *extra):
        out = tempfile.mkdtemp()
        code = cap.main(['--out', out, *extra], fetch=fake, sleep=lambda s: None, now=NOW)
        return out, code, json.loads(Path(out, 'manifest.json').read_text())

    def test_window_is_exactly_seven_days_and_events_are_queried_separately(self):
        fake = FakeNws()
        out, code, manifest = self.run_capture(fake)
        self.assertEqual(code, 0)
        self.assertEqual(manifest['window'], {'start': '2026-10-25T15:00:00Z', 'end': '2026-11-01T15:00:00Z', 'days': 7})
        queries = [urllib.parse.parse_qs(urllib.parse.urlparse(u).query) for u in fake.urls if '/alerts' in u]
        self.assertEqual([q['event'][0] for q in queries], ['Red Flag Warning', 'Fire Weather Watch', 'Small Craft Advisory'])
        for q in queries:
            self.assertEqual((q['start'][0], q['end'][0]), ('2026-10-25T15:00:00Z', '2026-11-01T15:00:00Z'))

    def test_manifest_hashes_match_saved_bytes_and_empty_results_are_recorded_as_empty(self):
        out, _, manifest = self.run_capture(FakeNws())
        for entry in manifest['files']:
            data = Path(out, entry['file']).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
            self.assertEqual(len(data), entry['bytes'])
            self.assertTrue(entry['url'].startswith('https://api.weather.gov/'))
        rfw = [f for f in manifest['files'] if f.get('event') == 'Red Flag Warning'][0]
        self.assertEqual(rfw['feature_count'], 0)
        self.assertEqual(sum(f['kind'] == 'nws-zone' for f in manifest['files']), 3)

    def test_pagination_is_followed_and_bytes_are_saved_unmodified(self):
        nxt = 'https://api.weather.gov/alerts?cursor=2&event=Red+Flag+Warning'
        fake = FakeNws({'event=Red+Flag+Warning&start': (200, page(2, nxt), {}), 'cursor=2': (200, page(1), {})})
        out, _, manifest = self.run_capture(fake)
        pages = [f for f in manifest['files'] if f.get('event') == 'Red Flag Warning']
        self.assertEqual([p['feature_count'] for p in pages], [2, 1])
        self.assertEqual(Path(out, pages[0]['file']).read_bytes(), page(2, nxt))

    def test_rate_limit_stops_capture_and_is_reported_not_retried(self):
        error = urllib.error.HTTPError('u', 429, 'Too Many Requests', {'Retry-After': '30'}, None)
        calls = []

        def opener(request, timeout):
            calls.append(request.full_url)
            raise error
        with self.assertRaises(cap.Stop):
            cap.get('https://api.weather.gov/alerts', opener=opener)
        self.assertEqual(len(calls), 1)
        fake = FakeNws({'Red+Flag': cap.Stop('429')})
        out, code, manifest = self.run_capture(fake)
        self.assertEqual(code, 1)
        self.assertIn('429', manifest['stopped'])

    def test_requests_identify_the_app_without_personal_contact(self):
        self.assertIn('kamptrail.com', cap.USER_AGENT)
        self.assertNotIn('@', cap.USER_AGENT)
        seen = {}

        class Response:
            status = 200
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return EMPTY

        def opener(request, timeout):
            seen.update(request.headers)
            return Response()
        cap.get('https://api.weather.gov/alerts', opener=opener)
        self.assertEqual(seen['User-agent'], cap.USER_AGENT)


def rfw_page():
    feature = {'type': 'Feature', 'geometry': None, 'properties': {'id': 'urn:t:1', 'event': 'Red Flag Warning'}}
    return json.dumps({'type': 'FeatureCollection', 'features': [feature]}).encode()


class RetentionTests(unittest.TestCase):
    def capture(self, out, fake):
        return cap.main(['--out', out], fetch=fake, sleep=lambda s: None, now=NOW)

    def test_empty_capture_is_not_positive_and_a_real_fire_alert_is(self):
        empty = tempfile.mkdtemp()
        self.capture(empty, FakeNws())
        m = json.loads(Path(empty, 'manifest.json').read_text())
        self.assertEqual((m['positive'], m['fire_alert_features']), (False, 0))
        hit = tempfile.mkdtemp()
        self.capture(hit, FakeNws({'event=Red+Flag+Warning': (200, rfw_page(), {})}))
        m = json.loads(Path(hit, 'manifest.json').read_text())
        self.assertEqual((m['positive'], m['fire_alert_features']), (True, 1))

    def test_non_fire_events_never_make_a_capture_positive(self):
        out = tempfile.mkdtemp()
        self.capture(out, FakeNws({'Small+Craft': (200, page(3), {})}))
        self.assertFalse(json.loads(Path(out, 'manifest.json').read_text())['positive'])

    def test_a_later_empty_run_never_overwrites_a_positive_capture(self):
        out = tempfile.mkdtemp()
        self.assertEqual(self.capture(out, FakeNws({'event=Red+Flag+Warning': (200, rfw_page(), {})})), 0)
        before = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(out).rglob('*') if p.is_file()}
        fake = FakeNws()
        self.assertEqual(self.capture(out, fake), 2)
        self.assertEqual(fake.urls, [], 'no request is made when the target holds a positive capture')
        after = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(out).rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_positive_is_judged_from_saved_bytes_not_from_a_summary(self):
        out = tempfile.mkdtemp()
        self.capture(out, FakeNws({'event=Fire+Weather+Watch': (200, rfw_page().replace(b'Red Flag Warning', b'Fire Weather Watch'), {})}))
        saved = Path(out, 'alerts/fire-weather-watch-p1.json').read_bytes()
        self.assertEqual(hashlib.sha256(saved).hexdigest(), [f for f in json.loads(Path(out, 'manifest.json').read_text())['files'] if f.get('event') == 'Fire Weather Watch'][0]['sha256'])
        self.assertTrue(json.loads(Path(out, 'manifest.json').read_text())['positive'])

    def test_workflow_keeps_positive_captures_under_a_unique_name_without_overwrite(self):
        text = (SCRIPTS.parent / '.github/workflows/capture-fire-weather.yml').read_text()
        self.assertIn("if: steps.window.outputs.positive == 'true'", text)
        block = text[text.index('Keep capture that contains a real fire alert'):text.index('preserve-first-positive:')]
        self.assertIn('nws-fire-weather-POSITIVE-${{ github.run_id }}-${{ github.run_attempt }}', block)
        self.assertIn('overwrite: false', block)
        self.assertIn('retention-days: 90', block)
        ordinary = text[text.index('Keep seven-day capture'):text.index('Keep capture that contains')]
        self.assertIn('nws-fire-weather-window-${{ github.run_id }}', ordinary)

    def test_capture_job_stays_read_only_and_only_the_first_positive_is_committed(self):
        import yaml
        wf = yaml.safe_load((SCRIPTS.parent / '.github/workflows/capture-fire-weather.yml').read_text())
        self.assertEqual(wf['permissions'], {'contents': 'read'})
        capture = wf['jobs']['capture']
        self.assertNotIn('permissions', capture)
        self.assertNotIn('git commit', json.dumps(capture))
        keep = wf['jobs']['preserve-first-positive']
        self.assertEqual(keep['needs'], 'capture')
        self.assertEqual(keep['if'], "needs.capture.outputs.positive == 'true'")
        self.assertEqual(keep['permissions'], {'contents': 'write', 'pull-requests': 'write'})
        self.assertEqual(keep['env']['BRANCH'], 'fire-weather/first-positive-capture')
        self.assertEqual(keep['env']['ARTIFACT'], 'nws-fire-weather-POSITIVE-${{ github.run_id }}-${{ github.run_attempt }}')
        steps = json.dumps(keep['steps'])
        self.assertIn('git ls-remote --exit-code --heads origin', steps)  # skip once a first positive is kept
        self.assertIn('hashlib.sha256(data).hexdigest() != f[', steps)    # bytes verified against the manifest
        self.assertNotIn('--force', steps)
        self.assertNotIn('push origin main', steps)
        self.assertIn('git push origin \\"HEAD:refs/heads/$BRANCH\\"', steps)
        self.assertIn('gh pr create --base main', steps)

    def test_preserve_step_rejects_changed_bytes_and_non_positive_captures(self):
        import re, subprocess, sys as _sys, yaml
        wf = yaml.safe_load((SCRIPTS.parent / '.github/workflows/capture-fire-weather.yml').read_text())
        run = next(s['run'] for s in wf['jobs']['preserve-first-positive']['steps'] if 'Verify every file' in s.get('name', ''))
        check = re.search(r"<<'PY'\n(.*?)\n\s*PY\n", run, re.S).group(1)
        check = '\n'.join(line[10:] if line.startswith(' ' * 10) else line for line in check.split('\n'))
        def attempt(positive, tamper):
            out = tempfile.mkdtemp()
            data = b'{"features":[{"properties":{"event":"Red Flag Warning"}}]}'
            Path(out, 'alerts').mkdir()
            Path(out, 'alerts/red-flag-warning-p1.json').write_bytes(data)
            Path(out, 'manifest.json').write_text(json.dumps({'positive': positive, 'files': [
                {'file': 'alerts/red-flag-warning-p1.json', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]}))
            if tamper:
                Path(out, 'alerts/red-flag-warning-p1.json').write_bytes(data.replace(b'Red', b'Rex'))
            return subprocess.run([_sys.executable, '-c', check, out], capture_output=True, text=True).returncode
        self.assertEqual(attempt(True, False), 0)
        self.assertNotEqual(attempt(True, True), 0)
        self.assertNotEqual(attempt(False, False), 0)
        # The real capture script's output, with a real-shaped positive response, passes the same check.
        real = tempfile.mkdtemp()
        self.capture(real, FakeNws({'event=Red+Flag+Warning': (200, rfw_page(), {})}))
        self.assertTrue(json.loads(Path(real, 'manifest.json').read_text())['positive'])
        self.assertEqual(subprocess.run([_sys.executable, '-c', check, real], capture_output=True, text=True).returncode, 0)

if __name__ == '__main__':
    unittest.main()
