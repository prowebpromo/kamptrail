import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data_integrity import save_geojson, valid_coordinates
from fetch_recreation_gov_data import RIDBFetcher
from fetch_osm_data import osm_to_geojson
from fetch_osm_poi import osm_element_to_geojson


class PipelineTests(unittest.TestCase):
    def facility(self, **extra):
        return {'FacilityID': '42', 'FacilityLatitude': 40, 'FacilityLongitude': -100,
                'FacilityName': 'Sample', 'FacilityTypeDescription': 'Campground', **extra}

    def convert(self, facility):
        return RIDBFetcher('not-a-key').convert_to_geojson([facility], 'NY')['features'][0]['properties']

    def test_ridb_unknowns_are_not_guessed_from_prose(self):
        props = self.convert(self.facility(FacilityDescription='No water or toilets. Lake nearby. No RVs.'))
        self.assertIsNone(props['cost'])
        self.assertIsNone(props['road_difficulty'])
        self.assertEqual(props['amenities'], [])
        self.assertEqual(props['rig_friendly'], [])
        self.assertEqual(props['id'], 'ridb:42')
        self.assertEqual(props['schema_version'], 3)

    def test_ambiguous_fee_text_is_unknown(self):
        for text in ['Free parking. Camping $20', 'Permit required', '$10-$30 per night', '$5 per vehicle']:
            self.assertIsNone(self.convert(self.facility(FacilityUseFeeDescription=text))['cost'])

    def test_simple_explicit_nightly_fee_and_free(self):
        self.assertEqual(self.convert(self.facility(FacilityUseFeeDescription='$20.50 per night'))['cost'], 20.5)
        self.assertEqual(self.convert(self.facility(FacilityUseFeeDescription='Camping is free.'))['cost'], 0)

    def test_osm_element_type_survives_for_stable_ids(self):
        features = osm_to_geojson({'elements': [
            {'type': 'way', 'id': 5, 'center': {'lon': -100, 'lat': 40}, 'tags': {'type': 'multipolygon'}},
            {'type': 'node', 'id': 5, 'lon': -100, 'lat': 40, 'tags': {}}
        ]})['features']
        self.assertEqual(features[0]['properties']['osm_type'], 'way')
        self.assertNotEqual(features[0]['properties']['id'], features[1]['properties']['id'])

    def test_invalid_coordinates_are_not_published(self):
        self.assertFalse(valid_coordinates([float('nan'), 40]))
        self.assertFalse(valid_coordinates([0, 100]))
        self.assertTrue(valid_coordinates([0, 0]))
        self.assertEqual(osm_to_geojson({'elements': [{'type': 'node', 'id': 1, 'lat': 999, 'lon': -80}]})['features'], [])

    def test_empty_fetch_does_not_erase_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'data.geojson'
            file.write_text('saved data')
            with self.assertRaises(ValueError):
                save_geojson(file, {'type': 'FeatureCollection', 'features': []})
            self.assertEqual(file.read_text(), 'saved data')

    def test_later_ridb_page_failure_raises_instead_of_publishing_partial_state(self):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {'RECDATA': [self.facility]}
        response = Response()
        response.facility = self.facility()
        with patch('fetch_recreation_gov_data.requests.get', side_effect=[response, RuntimeError('network')]), patch('fetch_recreation_gov_data.time.sleep'):
            with self.assertRaises(RuntimeError):
                RIDBFetcher('not-a-key').fetch_facilities_by_state('NY', limit=1)

    def test_lpg_tag_does_not_claim_cylinder_refilling(self):
        feature = osm_element_to_geojson({'type': 'node', 'id': 2, 'lat': 40, 'lon': -100,
                                         'tags': {'fuel:lpg': 'yes', 'access': 'private'}}, 'propane')
        self.assertIn('unverified', feature['properties']['service_description'])
        self.assertEqual(feature['properties']['access'], 'Private')


if __name__ == '__main__':
    unittest.main()
