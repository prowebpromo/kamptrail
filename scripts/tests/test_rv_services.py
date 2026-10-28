import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fetch_osm_poi  # noqa: E402


class RVServicesTests(unittest.TestCase):
    def test_water_point_keeps_type_tags_and_unverified_potability(self):
        feature = fetch_osm_poi.osm_element_to_geojson(
            {'type': 'node', 'id': 42, 'lat': 39.5, 'lon': -119.8, 'tags': {'amenity': 'water_point', 'drinking_water': 'yes'}}, 'water')
        props = feature['properties']
        self.assertEqual(props['type'], 'water')
        self.assertEqual(props['name'], 'Water fill point')
        self.assertEqual(props['osm_type'], 'node')
        self.assertEqual(props['schema_version'], 3)
        self.assertEqual(props['drinking_water'], 'yes')
        self.assertIn('potability unverified', props['service_description'])

    def test_failed_water_fetch_raises_before_anything_is_saved(self):
        with patch.object(fetch_osm_poi, 'extract_water_stations', return_value=[]), \
             patch.object(fetch_osm_poi, 'fetch_dump_stations', return_value=[]), \
             patch.object(fetch_osm_poi, 'fetch_propane_stations', return_value=[]), \
             patch.object(fetch_osm_poi, 'fetch_water_points', side_effect=RuntimeError('down')), \
             patch.object(fetch_osm_poi, 'save_geojson') as save:
            with self.assertRaises(RuntimeError):
                fetch_osm_poi.main()
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
