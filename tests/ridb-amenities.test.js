'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Q=require('../data-quality.js');
const source={name:'Recreation.gov RIDB full export',url:Q.RIDB_AMENITY_URL,sha256:'a'.repeat(64),inspected_at:'2026-10-30T12:00:00Z',original_retrieved_at:null,attribute_updated_at:null,archive_entry_time:'2026-10-21T18:46:28',archive_entry_timezone:null,basis:'frozen_public_export_cache',http_last_modified:null};
const group=(changes={})=>({reported:1,negative:0,unknown:0,conflict:0,qualifiers:{seasonal:1},...changes});
const payload=()=>({version:1,source:{...source},facilities:{'100':{sites:3,amenities:{toilet:group(),drinking_water:group({qualifiers:{peak_season:1}}),dump:group({qualifiers:{}}),picnic_table:group({reported:0,negative:1,qualifiers:{}})}}}});
const feature=(props={})=>({type:'Feature',geometry:{type:'Point',coordinates:[-75,43]},properties:{id:'usfs:100',name:'Pine Campground',schema_version:3,description:'A campground with camping.',fee_status:'unknown',amenities:[],legacy_ids:['ridb:100'],...props}});

test('evidence joins exact primary/legacy identities without amenity, service, fee or permission promotion',()=>{
  for(const props of [{id:'ridb:100',legacy_ids:[]},{id:'usfs:100',legacy_ids:['ridb:100']},{id:'osm:way:100',legacy_ids:['ridb:100'],osm_id:100,tourism:'camp_site'}]){
    const f=Q.normalizeFeature(feature(props));const before=structuredClone(f.properties);Q.attachRIDBAmenities(f,payload());
    assert.ok(f.properties.ridb_amenity_evidence);assert.deepEqual(f.properties.amenities,before.amenities);
    for(const key of ['fee_status','cost','access_status','camping_classification'])assert.deepEqual(f.properties[key],before[key]);
    assert.equal(Q.applyFilters([f],{amenities:['water']}).length,0);assert.equal(Q.applyFilters([f],{amenities:['dump']}).length,0);
  }
  for(const id of ['usfs:100','osm:node:100','ridb:0100','RIDB:100','ridb:100x']){
    const f=Q.normalizeFeature(feature({id,legacy_ids:[]}));Q.attachRIDBAmenities(f,payload());assert.equal(f.properties.ridb_amenity_evidence,undefined);
  }
  const raw=feature({id:'usfs:100',legacy_ids:[],facility_id:'100'});Q.attachRIDBAmenities(raw,payload());assert.equal(raw.properties.ridb_amenity_evidence,undefined,'Only exact RIDB identities join; unrelated numeric fields do not');
});

test('normalization and cross-source/state dedup retain counts once and preserve distinct facilities',()=>{
  const a=Q.normalizeFeature(feature()),b=Q.normalizeFeature(feature({id:'ridb:100',facility_id:'100'}));const table=payload();
  for(const f of [a,b])Q.attachRIDBAmenities(f,table);
  const rows=Q.cleanAndDedupeGeoJSON({features:[a,b,a,b]}).features;
  assert.equal(rows.length,1);assert.equal(rows[0].properties.ridb_amenity_evidence.facilities['100'].amenities.toilet.reported,1);
  assert.deepEqual(rows[0].properties.amenities,[]);
  const c=Q.normalizeFeature(feature({id:'ridb:200',facility_id:'200'}));
  const other=payload();other.facilities={'200':other.facilities['100']};Q.attachRIDBAmenities(c,other);
  const merged=Q.cleanAndDedupeGeoJSON({features:[a,c]}).features[0];
  assert.deepEqual(Object.keys(merged.properties.ridb_amenity_evidence.facilities).sort(),['100','200']);
});

test('strict validation rejects corrupt provenance, counts, identities and unsafe markup',()=>{
  assert.equal(Q.validRIDBAmenities(payload()),true);
  for(const mutate of [d=>d.source.url='javascript:alert(1)',d=>d.source.attribute_updated_at='2026-10-21',d=>d.source.original_retrieved_at='2026-10-30',d=>d.source.inspected_at='<img src=x>',d=>d.source.inspected_at='2026-02-30T00:00:00Z',d=>d.facilities['100'].sites=0,d=>d.facilities['100'].amenities.toilet.qualifiers.seasonal=2,d=>d.facilities['100'].amenities.dump.qualifiers.hand_pump=1,d=>d.facilities['100'].amenities['<img>']=group(),d=>d.facilities['0100']=d.facilities['100'],d=>d.facilities['100'].amenities.toilet.reported=-1]){
    const d=payload();mutate(d);assert.equal(Q.validRIDBAmenities(d),false);
  }
  const f=Q.normalizeFeature(feature({ridb_amenity_evidence:payload()}));assert.equal(f.properties.ridb_amenity_evidence,undefined,'Raw state snapshots cannot smuggle evidence');
  const canonical=payload();canonical.source={...canonical.source,basis:'canonical_download',original_retrieved_at:'2026-10-30T11:00:00Z',http_last_modified:'2026-10-29T18:46:42Z'};
  assert.equal(Q.validRIDBAmenities(canonical),true);
  const afterInspection=structuredClone(canonical);afterInspection.source.original_retrieved_at='2026-10-30T13:00:00Z';assert.equal(Q.validRIDBAmenities(afterInspection),false);
  const modifiedAfterRetrieval=structuredClone(canonical);modifiedAfterRetrieval.source.http_last_modified='2026-10-30T11:01:00Z';assert.equal(Q.validRIDBAmenities(modifiedAfterRetrieval),false);
});

test('generated public sidecar and audit match verified canonical source and generation-time exact scope',()=>{
  const data=JSON.parse(fs.readFileSync('data/campsites/ridb-amenities.json')),audit=JSON.parse(fs.readFileSync('data/campsites/ridb-amenities-audit.json'));
  assert.equal(Q.validRIDBAmenities(data),true);assert.equal(data.source.sha256,'13afd4dc1d1dec6885c2299bb4d939eb554e97ab32fc6bcd715b9ef4d9618e01');
  assert.equal(data.source.basis,'canonical_download');assert.ok(data.source.original_retrieved_at);assert.equal(data.source.http_last_modified,'2026-10-29T18:46:42Z');assert.equal(data.source.attribute_updated_at,null);
  // A later catalogue refresh may add/remove identities independently of this optional dated snapshot.
  // Bind its generation-time scope instead of blocking the existing weekly catalogue writer.
  const ids=Object.keys(data.facilities).sort();
  assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(ids)).digest('hex'),audit.selection_sha256);
  assert.equal(ids.length,audit.facility_ids);assert.equal(Object.values(data.facilities).reduce((n,f)=>n+f.sites,0),53693);
  assert.equal(audit.facility_ids,2163);assert.equal(audit.amenities.picnic_table.reported,35509);assert.equal(audit.amenities.picnic_table.negative,2);
  assert.equal(audit.amenities.toilet.reported,4498);assert.equal(audit.amenities.drinking_water.reported,3078);assert.equal(audit.amenities.shower.reported,1915);assert.equal(audit.amenities.dump.reported,1268);
});
