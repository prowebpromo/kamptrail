import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

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


class CaptureTests(unittest.TestCase):
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
            self.assertEqual(json.load(open(os.path.join(out, 'summary.json')))['alerts'], 0)

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
            summary = json.load(open(os.path.join(out, 'summary.json')))
            self.assertEqual((summary['alerts'], summary['with_polygon'], summary['zone_only'], summary['zone_geometries_saved']), (2, 1, 1, 1))
            self.assertEqual(os.listdir(os.path.join(out, 'zones')), ['zones_fire_CAZ201.json'])
            saved = json.load(open(os.path.join(out, 'alerts.json')))
            self.assertEqual(len(saved['features']), 2)
            self.assertIn('retrieved_at', saved)


if __name__ == '__main__':
    unittest.main()
