import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_ridb_sites  # noqa: E402


def write(folder, name, rows):
    (folder / name).write_text('\n'.join(rows) + '\n')


class RIDBSitesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        write(d, 'Campsites_API_v1.csv', ['CampsiteID,FacilityID,CampsiteName,CampsiteType,TypeOfUse,Loop,CampsiteAccessible,CampsiteLongitude,CampsiteLatitude,CreatedDate,LastUpdatedDate',
              '1,100,A,STANDARD,Overnight,A,false,0,0,,', '2,100,B,STANDARD,Overnight,A,false,0,0,,', '3,100,C,TENT,Overnight,A,false,0,0,,',
              '4,100,D,DAY,Day,A,false,0,0,,', '5,999,X,STANDARD,Overnight,A,false,0,0,,'])
        write(d, 'PermittedEquipment_API_v1.csv', ['CampsiteID,MaxLength,EquipmentName', '1,35.0,RV', '1,0,Tent', '2,0,Trailer', '3,0,Tent', '4,60,RV', '5,40,RV'])
        write(d, 'CampsiteAttributes_API_v1.csv', ['AttributeID,AttributeName,AttributeValue,EntityID,EntityType',
              '1,Max Vehicle Length,28,2,Campsite', '2,Max Vehicle Length,20,3,Campsite', '3,Electricity Hookup,30/50,1,Campsite',
              '4,Water Hookup,Yes,1,Campsite', '5,Sewer Hookup,No,1,Campsite', '6,Full Hookup,50,2,Campsite'])
        write(d, 'Facilities_API_v1.csv', ['FacilityID,FacilityUseFeeDescription,StayLimit,Reservable', '100,<p>No fees.</p>,14 days,false', '999,,,true'])
        self.dir = d

    def tearDown(self):
        self.tmp.cleanup()

    def test_catalogue_accepts_only_exact_positive_ridb_identities(self):
        index = self.dir / 'index.json'
        invalid = ['ridb:', 'ridb:0', 'ridb:-1', 'ridb:+1', 'ridb:001',
                   'ridb:1.0', 'ridb:1:2', 'ridb:1/2', 'ridb:1\n',
                   'ridb:１２３', 'RIDB:123', ' ridb:123', 'ridb:123 ',
                   'osm:node:100', 'blm-facility:999', None, 123, True,
                   {'id': 'ridb:999'}, ['ridb:999']]
        index.write_text(json.dumps({'sites': [
            {'id': 'ridb:100', 'legacy_ids': ['ridb:100', 'ridb:200', *invalid]},
            {'id': 'usfs:300', 'legacy_ids': ['ridb:200', 'ridb:300']},
            *({'id': identity} for identity in invalid),
            {'id': 'osm:node:500', 'legacy_ids': 'ridb:500'},
            {'id': 'usfs:600', 'legacy_ids': {'id': 'ridb:600'}},
            {'id': 'usfs:700', 'legacy_ids': None},
        ]}))
        self.assertEqual(build_ridb_sites.catalogue_facilities(index), {'100', '200', '300'})

    def test_merged_osm_or_agency_primary_retains_same_ridb_facility_summary(self):
        index = self.dir / 'index.json'
        expected = build_ridb_sites.build(self.dir, {'100'})
        for primary in ['osm:way:100', 'usfs:100', 'blm-facility:100']:
            with self.subTest(primary=primary):
                index.write_text(json.dumps({'sites': [
                    {'id': primary, 'legacy_ids': ['ridb:100', 'ridb:100']},
                    {'id': 'osm:node:999', 'legacy_ids': ['blm-facility:999']},
                ]}))
                wanted = build_ridb_sites.catalogue_facilities(index)
                actual = build_ridb_sites.build(self.dir, wanted)
                self.assertEqual(wanted, {'100'})
                self.assertEqual(actual, expected)
                self.assertEqual(set(actual), {'100'})

    def test_alias_import_does_not_infer_missing_fee_from_reservability(self):
        index = self.dir / 'index.json'
        index.write_text(json.dumps({'sites': [
            {'id': 'usfs:500', 'legacy_ids': ['ridb:999']},
        ]}))
        actual = build_ridb_sites.build(self.dir, build_ridb_sites.catalogue_facilities(index))
        self.assertEqual(set(actual), {'999'})
        self.assertEqual(actual['999'], {'t': 1, 'r': 1, 'L': 40, 'g': [[40, 0, 1]], 'rs': 1})

    def test_lengths_count_only_rv_type_sites_and_hookups_are_explicit(self):
        out = build_ridb_sites.build(self.dir, {'100'})
        self.assertEqual(set(out), {'100'})
        f = out['100']
        self.assertEqual((f['t'], f['r'], f['L']), (3, 2, 35))
        # One signature per kind of RV site. The tent site's 20 ft car pad is not an RV length.
        self.assertEqual(f['g'], [[28, 7, 1], [35, 3, 1]])
        self.assertEqual((f['e'], f['w'], f['s']), (2, 2, 1))
        self.assertEqual((f['f'], f['fe'], f['sl']), ('free', 'fee_text', '14 days'))

    def test_fee_text_is_conservative(self):
        f = build_ridb_sites.fee_from_text
        self.assertEqual(f('<p>No fees.</p>', 'false'), {'f': 'free', 'fe': 'fee_text'})
        self.assertEqual(f('Camping Fee: Free, Stay Limit: 14 days.', 'false')['f'], 'free')
        self.assertEqual(f('$10 per night for overnight camping. No fee for day use.', 'false'), {'f': 'paid', 'fe': 'fee_text', 'c': 10})
        self.assertEqual(f('Single Site: First Vehicle Free, Second Vehicle Fee is $5', 'false')['f'], 'paid')
        # Reservability is recorded, never treated as a camping fee.
        self.assertEqual(f('', 'true'), {'rs': 1})
        self.assertEqual(f('For current fees, please go to Recreation.gov', 'true'), {'rs': 1})
        self.assertEqual(f('Camping is not free.', 'false'), {'f': 'paid', 'fe': 'fee_text'})
        self.assertEqual(f('Free drinking water is available.', 'false'), {})
        self.assertEqual(f('Day-use picnicking is free.', 'false'), {})

    def test_shrunken_export_keeps_saved_file(self):
        index = self.dir / 'index.json'
        index.write_text(json.dumps({'sites': [{'id': 'ridb:100'}]}))
        out = self.dir / 'out.json'
        out.write_text(json.dumps({'facilities': {str(i): {} for i in range(10)}}))
        self.assertEqual(build_ridb_sites.main([str(self.dir), '--index', str(index), '--out', str(out)]), 1)
        self.assertEqual(len(json.loads(out.read_text())['facilities']), 10)


if __name__ == '__main__':
    unittest.main()
