'use strict';
// Tourism-type-admission candidate (revision 2). Classification comes from the listing's own record or an
// exact-identity agency record. A different OSM element never classifies a listing, at the snapshot merge,
// the index build or the browser merge.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const DQ=require('../data-quality.js');
const {CampsiteMerger}=require('../scripts/merge_campsite_data.js');
const pt=(props,c=[-110,40])=>({type:'Feature',geometry:{type:'Point',coordinates:c},properties:props});
const ridb={id:'ridb:1',facility_id:'1',name:'Old Post Road',source:'recreation.gov',schema_version:3,type:'established',description:''};
const osmEl={id:'osm:way:9',osm_id:9,osm_type:'way',tourism:'camp_site',name:'Old Post Road',source:'openstreetmap',schema_version:3,tents:'yes'};
const sites={'1':{t:12,r:0,L:0}};

test('snapshot merge: tourism of a distinct absorbed element stays on that member as attributed evidence',()=>{
  const m=new CampsiteMerger(),out=m.mergeProperties({...ridb},{...osmEl});
  assert.equal(out.tourism,undefined);
  const e=out.member_evidence.find(r=>r.source_record_id==='osm:way:9');
  assert.equal(e.fields.tourism,'camp_site');assert.equal(e.source,'OpenStreetMap contributors');
  assert.equal(out.tents,'yes','rig keys are outside this change');
});
test('snapshot merge: the record\'s own tourism and the same record seen twice are kept',()=>{
  const m=new CampsiteMerger();
  assert.equal(m.mergeProperties({...osmEl},{...osmEl}).tourism,'camp_site');
  assert.equal(m.mergeProperties({...osmEl},{...ridb,id:'ridb:2',facility_id:'2'}).tourism,'camp_site');
});
test('snapshot merge: a different record never lends its type',()=>{
  const m=new CampsiteMerger();
  assert.equal(m.mergeProperties({...ridb,type:'other'},{...ridb,id:'ridb:2',facility_id:'2',type:'established'}).type,null);
  assert.equal(m.mergeProperties({...ridb,type:null},{...ridb,type:'established'}).type,'established');
});
test('snapshot merge: a description copied from another record is marked as that record\'s wording',()=>{
  const m=new CampsiteMerger(),out=m.mergeProperties({...ridb,description:'Short.'},{...ridb,id:'ridb:2',facility_id:'2',description:'Potato Hills Central Campground offers campsites.'});
  assert.equal(out.description_source_record_id,'ridb:2');
});
test('index and browser: an inherited tourism tag on a record without its own osm_id never classifies it',()=>{
  // An old or cached snapshot row that still carries the inherited tag.
  const row=pt({...ridb,type:'other',tourism:'camp_site'});
  const f=DQ.normalizeFeature(row,{siteDetails:{}});
  assert.equal(f.properties.camping_classification,'unverified_camping_record');
  assert.equal(f.properties.camping_evidence,'ridb_activity_listing');
  assert.equal(f.properties.type,'other');
  assert.equal(f.properties.tourism,undefined);
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:[row]}).features.length,0,'not published on a borrowed tag');
});
test('index and browser: runtime merging never restores borrowed classification',()=>{
  // The browser merges records it has already normalized with newly loaded ones (data-loader.js mergeLoaded).
  const host=DQ.normalizeFeature(pt({...ridb,type:'other'}),{siteDetails:{}});
  const element=DQ.normalizeFeature(pt({...osmEl}));
  assert.equal(element.properties.camping_classification,'campsite');
  const once=DQ.cleanAndDedupeGeoJSON({features:[host,element]},{includeUnverified:true}).features;
  const kept=once.find(f=>f.properties.id==='ridb:1');
  assert.equal(kept.properties.camping_classification,'unverified_camping_record');
  const again=DQ.cleanAndDedupeGeoJSON({features:[...once,DQ.normalizeFeature(pt({...ridb,type:'other'}),{siteDetails:{}})]},{includeUnverified:true}).features;
  assert.equal(again.find(f=>f.properties.id==='ridb:1').properties.camping_classification,'unverified_camping_record');
  // Re-normalizing a normalized record (state reload) keeps it unclassified too.
  assert.equal(DQ.normalizeFeature(kept).properties.camping_classification,'unverified_camping_record');
});
test('own Recreation.gov facility type counts only with the facility\'s own overnight campsite records',()=>{
  const with_=DQ.normalizeFeature(pt({...ridb}),{siteDetails:sites});
  assert.equal(with_.properties.camping_classification,'campsite');
  assert.equal(with_.properties.camping_evidence,'ridb_facility_type_overnight_sites');
  assert.equal(with_.properties.type_evidence.kind,'structured_classification');
  const without=DQ.normalizeFeature(pt({...ridb}),{siteDetails:{}});
  assert.equal(without.properties.camping_classification,'unverified_camping_record');
  const amenityOnly=DQ.normalizeFeature(pt({...ridb}),{amenityDetails:{facilities:{'1':{sites:3,amenities:{}}}}});
  assert.equal(amenityOnly.properties.camping_classification,'campsite');
});
test('a fire lookout with its own overnight record keeps its accommodation type, never Campground',()=>{
  const f=DQ.normalizeFeature(pt({...ridb,name:'PICKETT BUTTE LOOKOUT'}),{siteDetails:sites});
  assert.ok(f,'not removed for being a lookout');
  assert.equal(f.properties.type,'lodging');assert.equal(f.properties.kt_accommodation,'lookout');
  assert.equal(DQ.normalizeFeature(pt({...ridb,name:'PICKETT BUTTE LOOKOUT'}),{siteDetails:{}}),null,'no own camping or overnight evidence: unchanged exclusion');
});
test('an OSM accommodation tag is not the classifier\'s accommodation kind',()=>{
  const f=DQ.normalizeFeature(pt({...osmEl,accommodation:'camping',name:'North Tongue River Campground'}));
  assert.equal(f.properties.type,'established');
});
test('descriptive wording classifies a Recreation.gov listing with no camping facility type, with attribution',()=>{
  const f=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Tom Bennett Campground'}),{siteDetails:{}});
  assert.equal(f.properties.type,'established');
  assert.deepEqual([f.properties.type_evidence.kind,f.properties.type_evidence.field,f.properties.type_evidence.value],['descriptive_wording','FacilityName','Tom Bennett Campground']);
  const d=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Wolf Flats Recreation Area',description:'Wolf Flats is a dispersed, undeveloped camping area with 25 locations to camp.'}),{siteDetails:{}});
  assert.equal(d.properties.type,'dispersed');assert.equal(d.properties.type_evidence.field,'FacilityDescription');
});
test('borrowed description wording never classifies the retained record',()=>{
  const f=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Potato Hills Central',description:'Potato Hills Central Campground offers campsites.',description_source_record_id:'ridb:2'}),{siteDetails:{}});
  assert.equal(f.properties.camping_classification,'unverified_camping_record');
});
test('L233: a name and distance match never classifies or publishes another record',()=>{
  const host=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Coleman Lake Recreation Area'}),{siteDetails:{}});
  const agency=DQ.normalizeFeature(pt({id:'usfs:3',name:'Coleman Lake Recreation Area',type:'established',camping_activity:'Campground Camping',source:'US Forest Service',schema_version:3}));
  const out=DQ.cleanAndDedupeGeoJSON({features:[host,agency]},{includeUnverified:true}).features;
  assert.equal(out.length,1);
  assert.equal(out[0].properties.id,'ridb:1');
  assert.equal(out[0].properties.camping_classification,'unverified_camping_record');
  assert.ok(out[0].properties.legacy_ids.includes('usfs:3'),'the identity merge is kept separately');
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:[host,agency]}).features.length,0);
});
test('L233: the same facility id published by an agency is an exact identity and may classify, never retype',()=>{
  const host=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Honeydew Creek'}),{siteDetails:{}});
  const blm=DQ.normalizeFeature(pt({id:'blm-facility:1',facility_id:'1',name:'Honeydew Creek',type:'established',camping_activity:'BLM camping facility',source:'Bureau of Land Management',schema_version:3}));
  const out=DQ.cleanAndDedupeGeoJSON({features:[host,blm]}).features;
  assert.equal(out.length,1);
  assert.equal(out[0].properties.camping_classification,'campsite');
  assert.equal(out[0].properties.camping_evidence_record_id,'blm-facility:1');
  assert.equal(out[0].properties.type,'other');
});
test('ledger: every proposed change is listed, attributed and flagged for separate review',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/candidates/tourism-type-admission.json'),'utf8'));
  assert.equal(pkg.version,2);
  const idx=new Map(JSON.parse(fs.readFileSync(path.join(__dirname,'../data/campsites/search-index.json'),'utf8')).sites.map(s=>[s.id,s]));
  const ids=new Set();
  for(const r of pkg.records){
    assert.ok(!ids.has(r.canonical_id),'deduplicated: '+r.canonical_id);ids.add(r.canonical_id);
    if(r.proposed.status==='published')assert.equal(idx.get(r.canonical_id)?.m.t,r.proposed.type,r.canonical_id);
    else assert.ok(!idx.has(r.canonical_id),r.canonical_id);
    if(r.changes.length)assert.ok(r.changes.every(c=>c.separate_review===true),r.canonical_id);
    assert.ok(r.identity.saved_link_resolves_after,r.canonical_id);
  }
});
