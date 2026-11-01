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


if __name__ == '__main__':
    unittest.main()
