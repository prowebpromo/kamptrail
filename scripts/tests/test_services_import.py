import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import import_services as services
from build_agency_states import PreparedState

class Boundaries:
    def classify_many(self, points):
        return {tuple(p): {'state': 'UT' if -111.01 <= p[0] <= -111 else None, 'reason': 'contained' if -111.01 <= p[0] <= -111 else 'outside_supported_states', 'candidates': ['UT'] if -111.01 <= p[0] <= -111 else []} for p in points}

class ServicesImportTests(unittest.TestCase):
    def test_positive_rules_and_multicategory(self):
        self.assertEqual(services.categories({'amenity':'fuel','fuel:lpg':'yes','shop':'convenience','sanitary_dump_station':'customers'}), ['dump','lpg','groceries','fuel'])
        self.assertEqual(services.categories({'amenity':'drinking_water','drinking_water':'yes','shop':'gas'}), [])
        for value in ['notyes','yes;no','no','private','unknown']:
            self.assertEqual(services.categories({'sanitary_dump_station':value,'fuel:lpg':value}), [])
        self.assertEqual(services.categories({'waterway':'water_point'}), ['water'])
        self.assertEqual(services.categories({'amenity':'shower'}), ['showers'])
        self.assertEqual(services.categories({'shop':'laundry'}), ['laundry'])

    def test_lifecycle_excluded_access_retained(self):
        for extra in [{'disused':'yes'}, {'abandoned:amenity':'fuel'}, {'opening_hours':'closed'}]:
            self.assertEqual(services.categories({'amenity':'fuel',**extra}), [])
        self.assertEqual(services.categories({'amenity':'fuel','access':'private'}), ['fuel'])

    def test_legacy_exact_identity_dates_and_foreign_quarantine(self):
        def feature(typ,coordinates):
            return {'geometry':{'coordinates':coordinates},'properties':{'source':'openstreetmap','type':'dump','osm_type':typ,'osm_id':42,'source_retrieved_at':'2025-01-01T00:00:00Z','name':'é'*100}}
        raw=json.dumps({'features':[feature(t,[-111,40]) for t in ['node','way','relation']]+[feature('node',[-114,53])]}).encode()
        wrapper,q=services.legacy(raw,Boundaries())
        self.assertEqual([r['id'] for r in wrapper['items']],['osm:node:42','osm:way:42','osm:relation:42'])
        self.assertEqual(len(q),1)
        self.assertEqual(wrapper['items'][0]['retrieved_at'],'2025-01-01T00:00:00Z')
        self.assertLessEqual(len(wrapper['items'][0]['name'].encode()),120)
        self.assertIsNone(wrapper['source']['retrieved_at'])

    def test_last_good_source_preserved_on_shrink_and_regression(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'UT.json'
            old={'items':[{}]*10,'source':{'extract_timestamp':'2025-02-01T00:00:00Z'}}
            p.write_text(json.dumps(old)); original=p.read_bytes()
            for new in [{'items':[{}],'source':{'extract_timestamp':'2025-03-01T00:00:00Z'}},{'items':[{}]*10,'source':{'extract_timestamp':'2025-01-01T00:00:00Z'}}]:
                with self.assertRaises(ValueError):services.write_source(p,new)
                self.assertEqual(p.read_bytes(),original)

    def test_ak_dateline_and_hi_reference_geometry(self):
        alaska=PreparedState({'type':'Polygon','coordinates':[[[179,50],[-179,50],[-179,52],[179,52],[179,50]]]})
        self.assertEqual(alaska.relation(179.5,51),1)
        self.assertEqual(alaska.relation(-179.5,51),1)
        self.assertEqual(alaska.relation(0,51),-1)
        hawaii=PreparedState({'type':'Polygon','coordinates':[[[-156,19],[-155,19],[-155,20],[-156,20],[-156,19]]]})
        self.assertEqual(hawaii.relation(-155.5,19.5),1)


    def test_native_pbf_preserves_node_way_relation_identity(self):
        try:
            import osmium
        except ImportError:
            self.skipTest('Optional pinned native parser is not installed')
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'test.osm.pbf'
            header=osmium.io.Header()
            header.set('osmosis_replication_timestamp','2025-01-01T00:00:00Z')
            with osmium.SimpleWriter(str(p),header=header) as writer:
                for i,coords in enumerate([(-111,40),(-111.001,40),(-111.001,40.001)],1):
                    writer.add_node(osmium.osm.mutable.Node(id=i,version=1,timestamp='2025-01-01T00:00:00Z',location=coords,tags={'amenity':'fuel'} if i==1 else {}))
                writer.add_way(osmium.osm.mutable.Way(id=1,version=2,timestamp='2025-01-01T00:00:00Z',nodes=[1,2,3,1],tags={'shop':'laundry'}))
                writer.add_relation(osmium.osm.mutable.Relation(id=1,version=3,timestamp='2025-01-01T00:00:00Z',members=[('w',1,'outer')],tags={'type':'multipolygon','shop':'supermarket'}))
            metadata={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'retrieved_at':'2025-01-02T00:00:00Z'}
            result,quarantine,stats=services.import_pbf(p,'UT',metadata,Boundaries())
            self.assertEqual({r['id'] for r in result['items']},{'osm:node:1','osm:way:1','osm:relation:1'})
            self.assertEqual(result['source']['extract_timestamp'],'2025-01-01T00:00:00Z')
            self.assertFalse(quarantine)
            with self.assertRaisesRegex(ValueError,'header date'):
                services.import_pbf(p,'UT',{**metadata,'resolved_url':services.URLS['UT'].replace('latest','250102')},Boundaries())
            with self.assertRaisesRegex(ValueError,'requested region'):
                services.import_pbf(p,'UT',{**metadata,'url':services.URLS['RI']},Boundaries())
            metadata['sha256']='a'*64
            with self.assertRaisesRegex(ValueError,'checksum'):
                services.import_pbf(p,'UT',metadata,Boundaries())

    def test_redirect_to_arbitrary_host_denied(self):
        handler=services.FixedRedirect()
        with self.assertRaises(ValueError):handler.redirect_request(None,None,302,'',{},'https://evil.example/utah.osm.pbf')

if __name__=='__main__':unittest.main()
