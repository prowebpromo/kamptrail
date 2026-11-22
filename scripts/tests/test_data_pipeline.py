import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data_integrity import save_geojson, valid_coordinates
from fetch_recreation_gov_data import RIDBFetcher, previous_published_facilities
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

    def test_ridb_keeps_source_type_and_date_on_their_own_facility(self):
        area = self.facility(FacilityTypeDescription='  Recreation AREA  ', LastUpdatedDate='2019-07-12')
        camp = self.facility(FacilityID='43', FacilityTypeDescription='CAMPGROUND')
        rows = RIDBFetcher('not-a-key').convert_to_geojson([area, camp], 'NY')['features']
        first, second = [row['properties'] for row in rows]
        self.assertEqual(first['id'], 'ridb:42')
        self.assertEqual(first['FacilityTypeDescription'], '  Recreation AREA  ')
        self.assertEqual(first['LastUpdatedDate'], '2019-07-12')
        self.assertEqual(first['type'], 'other')
        self.assertEqual(second['id'], 'ridb:43')
        self.assertEqual(second['FacilityTypeDescription'], 'CAMPGROUND')
        self.assertNotIn('LastUpdatedDate', second)
        self.assertEqual(second['type'], 'established')

    def test_ridb_preserves_omitted_null_and_blank_source_fields(self):
        empty = self.facility()
        del empty['FacilityTypeDescription']
        props = self.convert(empty)
        self.assertNotIn('FacilityTypeDescription', props)
        self.assertNotIn('LastUpdatedDate', props)
        for value in (None, ''):
            props = self.convert(self.facility(FacilityTypeDescription=value, LastUpdatedDate=value))
            self.assertEqual(props['FacilityTypeDescription'], value)
            self.assertEqual(props['LastUpdatedDate'], value)
            self.assertEqual(props['type'], 'other')

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

    def test_state_paging_requires_stable_unique_ids_and_matching_counts(self):
        def page(ids, total):
            response = Mock()
            response.json.return_value = {'METADATA': {'RESULTS': {'TOTAL_COUNT': total}},
                                          'RECDATA': [self.facility(FacilityID=i) for i in ids]}
            return response
        fetcher = RIDBFetcher('not-a-key')
        for pages in ([page([1, 2], 3), page([2], 3)], [page([1, 2], 4), page([3], 4)],
                      [page([1, 2], 3), page([3], 4)]):
            with patch('fetch_recreation_gov_data.requests.get', side_effect=pages), patch('fetch_recreation_gov_data.time.sleep'):
                with self.assertRaises(RuntimeError):
                    fetcher.fetch_facilities_by_state('NY', 2)
        with patch('fetch_recreation_gov_data.requests.get', side_effect=[page([1, 2], 3), page([3], 3)]) as get, patch('fetch_recreation_gov_data.time.sleep'):
            self.assertEqual([r['FacilityID'] for r in fetcher.fetch_facilities_by_state('NY', 2)], [1, 2, 3])
            self.assertEqual([call.kwargs['params']['sort'] for call in get.call_args_list], ['ID', 'ID'])

    def test_omitted_published_facility_requires_exact_current_camping_and_own_location(self):
        fetcher = RIDBFetcher('not-a-key')
        record = self.facility(FacilityName='Fresh Own Name', ACTIVITY=[{'ActivityID': 9}])
        prior = {'42': {(-100, 40)}}
        for response in (self.facility(FacilityID='43'), {**record, 'Enabled': False}, {**record, 'ACTIVITY': []},
                         {**record, 'FacilityLongitude': -121}):
            collection = {'features': []}
            with patch.object(fetcher, 'fetch_exact_facility', return_value=(response, '2026-11-22T10:00:00Z')):
                with self.assertRaises(ValueError):
                    fetcher.reconcile_published(collection, prior, 'NY')
            self.assertEqual(collection['features'], [])
        collection = {'features': []}
        with patch.object(fetcher, 'fetch_exact_facility', return_value=(record, '2026-11-22T10:00:00Z')):
            self.assertEqual(fetcher.reconcile_published(collection, prior, 'NY'), 1)
        props = collection['features'][0]['properties']
        self.assertEqual((props['name'], props['id'], props['source_retrieved_at']),
                         ('Fresh Own Name', 'ridb:42', '2026-11-22T10:00:00Z'))
        with patch.object(fetcher, 'fetch_exact_facility', side_effect=AssertionError('should not fetch a present ID')):
            self.assertEqual(fetcher.reconcile_published(collection, prior, 'NY'), 0)
        with patch.object(fetcher, 'fetch_exact_facility', return_value=(None, None)):
            self.assertEqual(fetcher.reconcile_published({'features': []}, prior, 'NY'), 0)

    def test_only_previous_active_own_facilities_in_the_state_are_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'search-index.json').write_text(json.dumps({'sites': [{'id':'osm:way:2', 'legacy_ids':['ridb:42']}]}))
            rows = RIDBFetcher('not-a-key').convert_to_geojson([self.facility(), self.facility(FacilityID=17)], 'NY')
            (root/'NY(1).geojson').write_text(json.dumps(rows))
            self.assertEqual(previous_published_facilities(root,'NY'), {'42': {(-100,40)}})
            self.assertEqual(previous_published_facilities(root,'PA'), {})

    def test_lpg_tag_does_not_claim_cylinder_refilling(self):
        feature = osm_element_to_geojson({'type': 'node', 'id': 2, 'lat': 40, 'lon': -100,
                                         'tags': {'fuel:lpg': 'yes', 'access': 'private'}}, 'propane')
        self.assertIn('unverified', feature['properties']['service_description'])
        self.assertEqual(feature['properties']['access'], 'Private')


if __name__ == '__main__':
    unittest.main()
