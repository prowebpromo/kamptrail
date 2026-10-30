import csv
import io
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_ridb_amenities as amenities


class AmenityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.source = self.directory / 'public.zip'
        self.index = self.directory / 'index.json'
        self.index.write_text(json.dumps({'sites': [{'id': 'usfs:100', 'legacy_ids': ['ridb:100', 'ridb:100', 'ridb:0100', 'osm:node:200']}, {'id': 'ridb:200'}]}))
        self.rows = [
            ['1', 'Picnic Table', 'Y', '1', 'Campsite'],
            ['1', 'Picnic Table', 'Y', '1', 'Campsite'],  # duplicate row
            ['2', 'PICNIC TABLES', 'Picnic Tables', '1', 'Campsite'],
            ['3', 'Picnic Table', 'No', '2', 'Campsite'],
            ['4', 'PICNIC TABLES', 'Picnic Tables', '2', 'Campsite'],  # conflict on one record
            ['5', 'DRINKING WATER', '', '1', 'Campsite'],
            ['6', 'DRINKING WATER (PEAK SEASON)', 'Drinking Water (peak season)', '2', 'Campsite'],
            ['7', 'ACCESSIBLE DRINKING WATER', 'Accessible Drinking Water', '2', 'Campsite'],
            ['8', 'DRINKING WATER (HAND PUMP)', 'Drinking Water (hand pump)', '2', 'Campsite'],
            ['9', 'COIN SHOWERS', 'Coin Showers', '1', 'Campsite'],
            ['10', 'SHOWERS (SEASONAL)', 'Showers (Seasonal)', '1', 'Campsite'],
            ['11', 'DUMP STATION', 'Dump Station', '1', 'Campsite'],
            ['12', 'DRINKING WATER', 'yes', '3', 'Campsite'],  # not a whitelisted value
            ['13', 'Water Hookup', 'Yes', '3', 'Campsite'],
            ['14', 'WATER SPIGOT', 'Water Spigot', '3', 'Campsite'],
            ['15', 'NON-POTABLE WATER', 'Non-Potable Water', '3', 'Campsite'],
            ['16', 'DRINKING WATER', 'Drinking Water', '4', 'Campsite'],  # day use
            ['17', 'DUMP STATION', 'Dump Station', '100', 'Facility'],  # wrong entity type
            ['18', 'FLUSH TOILETS', 'Flush Toilets', '5', 'Campsite'],  # outside catalogue
            ['19', 'FLUSH TOILETS (SEASONAL)', 'Flush Toilets (Seasonal)', '3', 'Campsite'],
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def archive(self):
        with zipfile.ZipFile(self.source, 'w') as archive:
            for name, headers, rows in [
                ('Campsites_API_v1.csv', ['CampsiteID', 'FacilityID', 'TypeOfUse'], [['1', '100', 'Overnight'], ['2', '100', 'Overnight'], ['3', '200', 'Overnight'], ['4', '100', 'Day'], ['5', '999', 'Overnight']]),
                ('CampsiteAttributes_API_v1.csv', ['AttributeID', 'AttributeName', 'AttributeValue', 'EntityID', 'EntityType'], self.rows),
            ]:
                text = io.StringIO(); writer = csv.writer(text); writer.writerow(headers); writer.writerows(rows)
                archive.writestr(name, text.getvalue())

    def test_exact_scope_distinct_records_qualifiers_unknowns_and_conflicts(self):
        self.archive()
        output = amenities.build(self.source, amenities.catalogue_facilities(self.index))
        self.assertEqual(set(output), {'100', '200'})
        self.assertEqual(output['100']['sites'], 2)
        a = output['100']['amenities']
        self.assertEqual(a['picnic_table'], {'reported': 1, 'negative': 0, 'unknown': 0, 'conflict': 1, 'qualifiers': {}})
        self.assertEqual(a['drinking_water']['reported'], 1)
        self.assertEqual(a['drinking_water']['unknown'], 1)
        self.assertEqual(a['drinking_water']['qualifiers'], {'accessible': 1, 'hand_pump': 1, 'peak_season': 1})
        self.assertEqual(a['shower']['reported'], 1)
        self.assertEqual(a['shower']['qualifiers'], {'coin': 1, 'seasonal': 1})
        self.assertEqual(a['dump']['reported'], 1)
        self.assertEqual(output['200']['amenities']['drinking_water']['reported'], 0)
        self.assertEqual(output['200']['amenities']['drinking_water']['unknown'], 1)
        self.assertEqual(output['200']['amenities']['toilet']['qualifiers'], {'seasonal': 1})

    def test_explicit_negative_and_absence_are_different(self):
        self.rows = [['1', 'Picnic Table', 'No', '1', 'Campsite'], ['2', 'FLUSH TOILETS', 'No', '2', 'Campsite']]
        self.archive(); output = amenities.build(self.source, {'100', '200'})
        self.assertEqual(output['100']['amenities']['picnic_table']['negative'], 1)
        self.assertEqual(output['100']['amenities']['toilet']['unknown'], 1)
        self.assertEqual(output['200'], {'sites': 1, 'amenities': {}})

    def test_fixture_groups_are_distinct_and_conflicts_take_precedence(self):
        self.rows = [
            ['1', 'Fire Pit', 'No', '1', 'Campsite'],
            ['2', 'CAMPFIRE RINGS', 'Campfire Rings', '1', 'Campsite'],
            ['3', 'CAMPFIRE RINGS', 'Campfire Rings', '1', 'Campsite'],
            ['4', 'GRILLS', 'No', '1', 'Campsite'],
            ['5', 'ACCESSIBLE GRILLS', 'Accessible Grills', '2', 'Campsite'],
            ['6', 'Grills/Fire Ring', 'Y', '3', 'Campsite'],
            ['7', 'Food Locker', 'yes', '2', 'Campsite'],
            ['8', 'Tent Pad', 'No', '1', 'Campsite'],
            ['9', 'TRASH COLLECTION', 'Trash Collection', '2', 'Campsite'],
            ['10', 'Campfire Allowed', 'Yes', '3', 'Campsite'],
        ]
        self.archive(); result = amenities.build(self.source, {'100', '200'})
        a = result['100']['amenities']
        self.assertEqual(a['fire_fixture']['conflict'], 1)
        self.assertEqual(a['fire_fixture']['reported'], 0)
        self.assertEqual(a['grill']['negative'], 1)
        self.assertEqual(a['grill']['qualifiers'], {'accessible': 1})
        self.assertEqual(a['food_locker']['unknown'], 1)
        self.assertEqual(a['tent_pad']['negative'], 1)
        self.assertEqual(a['trash_collection']['reported'], 1)
        self.assertEqual(set(result['200']['amenities']), {'grill_or_fire_ring'})
        self.assertEqual(result['200']['amenities']['grill_or_fire_ring']['reported'], 1)

    def test_source_provenance_is_inspection_not_freshness(self):
        self.archive(); output = self.directory / 'output.json'; audit = self.directory / 'audit.json'
        amenities.main([str(self.source), '--index', str(self.index), '--out', str(output), '--audit', str(audit)])
        data = json.loads(output.read_text()); source = data['source']
        self.assertEqual(source['url'], amenities.SOURCE_URL)
        self.assertRegex(source['sha256'], '^[a-f0-9]{64}$')
        self.assertIsNone(source['original_retrieved_at']); self.assertIsNone(source['attribute_updated_at'])
        self.assertIsNone(source['archive_entry_timezone']); self.assertTrue(source['inspected_at'].endswith('+00:00'))
        self.assertEqual(json.loads(audit.read_text())['overnight_sites'], 3)
        self.assertEqual(json.loads(audit.read_text())['selection_sha256'], hashlib.sha256(b'["100","200"]').hexdigest())

    def test_canonical_receipt_requires_the_actual_export_hash_and_size(self):
        self.archive(); output = self.directory / 'output.json'; audit = self.directory / 'audit.json'; receipt = self.directory / 'receipt.json'
        with self.source.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        metadata = {'url': amenities.SOURCE_URL, 'sha256': digest, 'size_bytes': self.source.stat().st_size, 'http_status': 200,
                    'retrieved_at': '2026-10-30T16:33:00Z', 'http_last_modified': '2026-10-29T18:46:42Z'}
        receipt.write_text(json.dumps(metadata))
        args = [str(self.source), '--index', str(self.index), '--out', str(output), '--audit', str(audit), '--download-receipt', str(receipt)]
        amenities.main(args); source = json.loads(output.read_text())['source']; saved = output.read_bytes()
        self.assertEqual(source['basis'], 'canonical_download'); self.assertEqual(source['original_retrieved_at'], metadata['retrieved_at'])
        self.assertEqual(source['http_last_modified'], metadata['http_last_modified']); self.assertIsNone(source['attribute_updated_at'])
        for changes in [{'sha256': '0' * 64}, {'size_bytes': 1}, {'retrieved_at': '2026-02-30T00:00:00Z'}, {'http_status': 500},
                        {'retrieved_at': '2099-10-30T16:33:00Z'}, {'http_last_modified': '2026-10-30T16:34:00Z'}]:
            receipt.write_text(json.dumps(dict(metadata, **changes)))
            with self.assertRaises(ValueError):
                amenities.main(args)
            self.assertEqual(output.read_bytes(), saved)


if __name__ == '__main__':
    unittest.main()
