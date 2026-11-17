import json
import io
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import capture_fire_weather as cap

POLY = {'type': 'Polygon', 'coordinates': [[[-120, 38], [-119, 38], [-119, 39], [-120, 38]]]}


def alert(event, geometry=None, zones=()):
    return {'type': 'Feature', 'geometry': geometry,
            'properties': {'id': 'urn:' + event, 'event': event, 'sent': '2026-10-31T10:00:00-07:00',
                           'expires': '2026-11-01T20:00:00-07:00', 'areaDesc': 'Test area',
                           'affectedZones': list(zones)}}


def collection(*features):
    return {'type': 'FeatureCollection', 'features': list(features)}


class FetchTests(unittest.TestCase):
    def test_recovers_after_three_503s_with_longer_alert_budget(self):
        opener = Mock(side_effect=[
            urllib.error.HTTPError(cap.ALERTS_URL, 503, 'Service Unavailable', {}, None)
            for _ in range(3)
        ] + [io.BytesIO(json.dumps(collection()).encode())])
        with patch.object(cap.time, 'sleep') as sleep, patch('sys.stderr', new_callable=io.StringIO) as log:
            result = cap.fetch_json(cap.ALERTS_URL, opener=opener, retries=5, backoff_seconds=5)
        self.assertEqual(result, collection())
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [5, 10, 20])
        self.assertEqual(opener.call_count, 4)
        self.assertIn('attempt 3/6 failed', log.getvalue())
        request = opener.call_args.args[0]
        self.assertEqual(request.get_header('User-agent'), cap.USER_AGENT)
        self.assertEqual(request.get_header('Accept'), 'application/geo+json')
        self.assertEqual(opener.call_args.kwargs['timeout'], 30)

    def test_persistent_503_exhausts_bounded_budget_and_still_fails(self):
        error = urllib.error.HTTPError(cap.ALERTS_URL, 503, 'Service Unavailable', {}, None)
        opener = Mock(side_effect=error)
        with patch.object(cap.time, 'sleep') as sleep, patch('sys.stderr', new_callable=io.StringIO) as log:
            with self.assertRaises(urllib.error.HTTPError):
                cap.fetch_json(cap.ALERTS_URL, opener=opener, retries=5, backoff_seconds=5)
        self.assertEqual(opener.call_count, 6)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [5, 10, 20, 40, 60])
        self.assertIn('failed after 6 attempts', log.getvalue())

    def test_permanent_http_errors_do_not_retry(self):
        for status in (400, 401, 403, 404):
            with self.subTest(status=status):
                opener = Mock(side_effect=urllib.error.HTTPError(cap.ALERTS_URL, status, 'Permanent error', {}, None))
                with patch.object(cap.time, 'sleep') as sleep:
                    with self.assertRaises(urllib.error.HTTPError):
                        cap.fetch_json(cap.ALERTS_URL, opener=opener)
                self.assertEqual(opener.call_count, 1)
                sleep.assert_not_called()

    def test_transient_http_errors_and_network_timeouts_retry(self):
        errors = [urllib.error.HTTPError(cap.ALERTS_URL, status, 'Transient error', {}, None)
                  for status in (408, 429, 500, 502, 504)]
        errors += [urllib.error.URLError('connection failed'), TimeoutError('timed out')]
        for error in errors:
            with self.subTest(error=str(error)):
                opener = Mock(side_effect=[error, io.BytesIO(b'{}')])
                with patch.object(cap.time, 'sleep') as sleep, patch('sys.stderr', new_callable=io.StringIO):
                    self.assertEqual(cap.fetch_json(cap.ALERTS_URL, opener=opener), {})
                self.assertEqual(opener.call_count, 2)
                sleep.assert_called_once_with(2)

    def test_zone_default_budget_remains_short(self):
        opener = Mock(side_effect=TimeoutError('timed out'))
        with patch.object(cap.time, 'sleep') as sleep, patch('sys.stderr', new_callable=io.StringIO):
            with self.assertRaises(TimeoutError):
                cap.fetch_json(cap.ZONE_PREFIX + 'fire/CAZ201', opener=opener)
        self.assertEqual(opener.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4])

    def test_invalid_json_can_recover(self):
        opener = Mock(side_effect=[io.BytesIO(b'not json'), io.BytesIO(b'{}')])
        with patch.object(cap.time, 'sleep'), patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(cap.fetch_json(cap.ALERTS_URL, opener=opener), {})

    def test_response_size_limit_is_preserved(self):
        opener = Mock(side_effect=lambda *args, **kwargs: io.BytesIO(b'x' * 11))
        with patch.object(cap, 'MAX_BYTES', 10), patch.object(cap.time, 'sleep'), patch('sys.stderr', new_callable=io.StringIO):
            with self.assertRaisesRegex(ValueError, 'response too large'):
                cap.fetch_json(cap.ALERTS_URL, opener=opener)


class CaptureTests(unittest.TestCase):
    def test_default_capture_gives_alerts_longer_budget_than_zones(self):
        zone = cap.ZONE_PREFIX + 'fire/CAZ201'
        with tempfile.TemporaryDirectory() as out, patch.object(cap, 'fetch_json') as fetch:
            fetch.side_effect = [collection(alert('Red Flag Warning', None, [zone])), {'type': 'Feature', 'geometry': POLY}]
            self.assertEqual(cap.main(['--out', out]), 0)
        self.assertEqual(fetch.call_args_list[0].kwargs, {'retries': 5, 'backoff_seconds': 5})
        self.assertEqual(fetch.call_args_list[1].args, (zone,))
        self.assertEqual(fetch.call_args_list[1].kwargs, {})

    def test_alert_outage_does_not_write_a_zero_alert_summary(self):
        with tempfile.TemporaryDirectory() as out, patch.object(cap, 'fetch_json') as fetch:
            error = urllib.error.HTTPError(cap.ALERTS_URL, 503, 'Service Unavailable', {}, None)
            self.addCleanup(error.close)
            fetch.side_effect = error
            with self.assertRaises(urllib.error.HTTPError):
                cap.main(['--out', out])
            self.assertEqual(os.listdir(out), [])

    def test_keeps_only_fire_weather_events(self):
        got = cap.fire_alerts(collection(alert('Red Flag Warning', POLY), alert('Wind Advisory', POLY), alert('Fire Weather Watch')))
        self.assertEqual([a['properties']['event'] for a in got], ['Red Flag Warning', 'Fire Weather Watch'])

    def test_rejects_wrong_shape(self):
        with self.assertRaises(ValueError):
            cap.fire_alerts({'type': 'Feature'})

    def test_zones_only_for_alerts_without_polygon_deduplicated_and_capped(self):
        z = 'https://api.weather.gov/zones/fire/CAZ201'
        alerts = [alert('Red Flag Warning', POLY, ['https://api.weather.gov/zones/fire/IGNORED']),
                  alert('Fire Weather Watch', None, [z, z, 'https://evil.example/zones/x'])]
        zones, skipped = cap.zones_needed(alerts)
        self.assertEqual(zones, [z])
        self.assertEqual(skipped, 0)
        many = [alert('Red Flag Warning', None, [f'https://api.weather.gov/zones/fire/Z{i}' for i in range(5)])]
        zones, skipped = cap.zones_needed(many, limit=3)
        self.assertEqual((len(zones), skipped), (3, 2))

    def test_no_alerts_writes_summary_only(self):
        with tempfile.TemporaryDirectory() as out:
            cap.main(['--out', out], fetch=lambda url: collection())
            self.assertEqual(sorted(os.listdir(out)), ['summary.json'])
            self.assertEqual(json.loads((Path(out) / 'summary.json').read_text(encoding='utf-8'))['alerts'], 0)

    def test_saves_alerts_and_zone_geometry_and_survives_zone_failure(self):
        good = 'https://api.weather.gov/zones/fire/CAZ201'
        bad = 'https://api.weather.gov/zones/fire/CAZ999'

        def fetch(url):
            if url.startswith(cap.ALERTS_URL):
                return collection(alert('Red Flag Warning', POLY), alert('Fire Weather Watch', None, [good, bad]))
            if url == bad:
                raise TimeoutError('slow')
            return {'type': 'Feature', 'geometry': POLY, 'properties': {'id': 'CAZ201'}}

        with tempfile.TemporaryDirectory() as out:
            cap.main(['--out', out], fetch=fetch)
            summary = json.loads((Path(out) / 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual((summary['alerts'], summary['with_polygon'], summary['zone_only'], summary['zone_geometries_saved']), (2, 1, 1, 1))
            self.assertEqual(os.listdir(os.path.join(out, 'zones')), ['zones_fire_CAZ201.json'])
            saved = json.loads((Path(out) / 'alerts.json').read_text(encoding='utf-8'))
            self.assertEqual(len(saved['features']), 2)
            self.assertIn('retrieved_at', saved)


if __name__ == '__main__':
    unittest.main()
