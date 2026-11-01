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
  assert.equal(out.tents,undefined);assert.equal(e.fields.tents,'yes','2.34.0 member ownership');
});
test('snapshot merge: the record\'s own tourism and the same record seen twice are kept',()=>{
  const m=new CampsiteMerger();
  assert.equal(m.mergeProperties({...osmEl},{...osmEl}).tourism,'camp_site');
  assert.equal(m.mergeProperties({...osmEl},{...ridb,id:'ridb:2',facility_id:'2'}).tourism,'camp_site');
});
test('snapshot merge: a different record never lends its type',()=>{
  const m=new CampsiteMerger();
  assert.equal(m.mergeProperties({...ridb,type:'other'},{...ridb,id:'ridb:2',facility_id:'2',type:'established'}).type,'other');
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
test('a lodging word inside a recreation site name does not classify the site as lodging',()=>{
  const f=DQ.normalizeFeature(pt({...ridb,name:'Pink House Recreation Site'}),{siteDetails:sites});
  assert.equal(f.properties.type,'established');
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
  assert.equal(d.properties.type,'other');assert.equal(d.properties.type_evidence,null);
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
test('L233: the same facility id published by an agency is an exact identity and may classify, never lend its type',()=>{
  const host=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Honeydew Creek'}),{siteDetails:{}});
  const blm=DQ.normalizeFeature(pt({id:'blm-facility:1',facility_id:'1',name:'Honeydew Creek',type:'established',camping_activity:'BLM camping facility',source:'Bureau of Land Management',schema_version:3}));
  const out=DQ.cleanAndDedupeGeoJSON({features:[host,blm]}).features;
  assert.equal(out.length,1);
  assert.equal(out[0].properties.camping_classification,'campsite');
  assert.equal(out[0].properties.camping_evidence_record_id,'blm-facility:1');
  assert.equal(out[0].properties.type,'other','own type other stays other');
  // An own Recreation.gov campground type shows once camping is confirmed by the exact identity.
  const own=DQ.normalizeFeature(pt({...ridb,type:'established',name:'Honeydew Creek'}),{siteDetails:{}});
  const out2=DQ.cleanAndDedupeGeoJSON({features:[own,blm]}).features;
  assert.equal(out2[0].properties.type,'established');assert.equal(out2[0].properties.type_evidence.confirmed_by,'blm-facility:1');
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
test('an element absorbed by an unclassified host is never published because the host lost classification',()=>{
  const host={...ridb,type:'other',name:'River Forks',source_ids:['ridb:1','osm:relation:5']};
  const element={id:'osm:relation:5',osm_id:5,osm_type:'relation',tourism:'camp_site',name:'River Forks',source:'openstreetmap',schema_version:3};
  const ga=[pt(host)],nc=[pt(element)];
  const withheldMembers=new Set([...DQ.withheldMembers(ga,{siteDetails:{}}),...DQ.withheldMembers(nc,{})]);
  assert.ok(withheldMembers.has('osm:relation:5'));
  const out=DQ.cleanAndDedupeGeoJSON({features:[...DQ.publicationCandidates(ga,{siteDetails:{},withheldMembers}),...DQ.publicationCandidates(nc,{withheldMembers})].map(f=>DQ.normalizeFeature(f,{siteDetails:{}}))},{withheldMembers}).features;
  assert.equal(out.length,0);
  // The same element without an unclassified host still publishes on its own tag.
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:[pt(element)]}).features.length,1);
});

test('a nearby agency activity remains separate when the merged record is normalized twice',()=>{
  const host=pt({...ridb,name:'Basin Site',type:'other'});
  const agency=pt({id:'usfs:99',name:'Basin Site',camping_activity:'Campground Camping',source:'US Forest Service',schema_version:3});
  const first=DQ.cleanAndDedupeGeoJSON({features:[host,agency]},{includeUnverified:true}).features;
  assert.equal(first[0].properties.camping_activity,undefined);
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:first}).features.length,0);
});
test('BLM camping-layer membership never masquerades as a Recreation.gov mapped facility type',()=>{
  const own=pt({id:'blm-facility:42',facility_id:'42',name:'Test Canyon',type:'established',source:'Bureau of Land Management',camping_activity:'BLM camping facility',schema_version:3});
  for(const f of [own,DQ.normalizeFeature(own)]){
    const p=DQ.normalizeFeature(f).properties;
    assert.equal(p.ridb_facility_type,null);
    assert.equal(p.type_evidence.source_record_id,'blm-facility:42');
    assert.equal(p.type_evidence.field,'BLM layer 8 camping_activity');
  }
});
test('reviewed publication and evidence survive an updated retrieval without inventing a new own-source finding',()=>{
  const f=pt({...ridb,id:'ridb:243218',facility_id:'243218',name:'Coleman Lake Recreation Area',source_retrieved_at:'2030-01-10T15:00:00Z',type:'other'});
  const p=DQ.cleanAndDedupeGeoJSON({features:[f]}).features[0].properties;
  assert.equal(p.camping_classification,'published_pending_review');
  assert.equal(p.type,'other');
  assert.equal(DQ.normalizeFeature(pt({...f.properties,access:'private'})),null);
});
test('review dispositions guard every held description and unreviewed website match',()=>{
  const holds=require('../docs/candidates/tourism-type-review.json');
  const idx=new Map(require('../data/campsites/search-index.json').sites.map(s=>[s.id,s]));
  const rows=Object.entries(holds).filter(([,r])=>r.decision==='hold_current_other');
  assert.equal(rows.length,51);for(const [id] of rows)assert.equal(idx.get(id)?.m.t,'other',id);
  const linked=require('../scripts/tourism-type-admission/website-links.json');
  assert.equal(linked.filter(w=>w.facility_id_matches).length,44);
  assert.equal(linked.filter(w=>w.exact).length,0);
});
