'use strict';
// Tourism-type-admission candidate (revision 3, owner decisions 2026-11-01). Classification comes from the listing's own record or an
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
test('name rule scope: a held published Campground stays Campground while its own type is Other',()=>{
  const f=DQ.cleanAndDedupeGeoJSON({features:[pt({...ridb,id:'ridb:10076130',facility_id:'10076130',type:'other',name:'Tom Bennett Campground'})]},{siteDetails:{}}).features[0].properties;
  assert.equal(f.type,'established');assert.equal(f.type_evidence.kind,'held_published_label');
});
test('name rule scope: an unseen facility with an ambiguous camping name keeps its prior label until reviewed',()=>{
  for(const [name,prior] of [['Example Primitive Camp','other'],['Example Camping Area','other'],['Example Lake Campground','other'],['Example Camping Area','established']]){
    const f=DQ.normalizeFeature(pt({...ridb,id:'ridb:999001',facility_id:'999001',type:prior,name}),{siteDetails:{}});
    assert.equal(f.properties.camping_classification,'campsite',name+' still admitted on its own name');
    assert.equal(f.properties.type,prior,name);
    assert.notEqual(f.properties.type_evidence?.kind,'descriptive_wording');
  }
  const d=DQ.normalizeFeature(pt({...ridb,type:'other',name:'Wolf Flats Recreation Area',description:'Wolf Flats is a dispersed, undeveloped camping area with 25 locations to camp.'}),{siteDetails:{}});
  assert.equal(d.properties.type,'other');assert.equal(d.properties.type_evidence,null);
  // A ledgered id upgrades on its own name.
  const g=DQ.normalizeFeature(pt({...ridb,id:'ridb:10007101',facility_id:'10007101',type:'other',name:'Large Vehicle Campground'}),{siteDetails:{}});
  assert.equal(g.properties.type,'established');assert.equal(g.properties.type_evidence.field,'FacilityName');
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
  const f=pt({...ridb,id:'ridb:243218',facility_id:'243218',name:'Coleman Lake Recreation Area',source_retrieved_at:'2030-01-10T15:00:00Z',type:'other',description:'<p>There are 39 campsites with water and electrical hookups, bathhouses.</p>'});
  const p=DQ.cleanAndDedupeGeoJSON({features:[f]}).features[0].properties;
  assert.equal(p.camping_classification,'published_pending_review');
  assert.equal(p.type,'established','owner decision 2026-11-01 20:24: accepted from its own description');
  assert.equal(p.type_evidence.kind,'owner_reviewed_own_record');
  assert.equal(DQ.normalizeFeature(pt({...f.properties,access:'private'})),null);
});
test('owner decision 2026-11-01: a proposed withdrawal stays discoverable with its held label and a pending notice',()=>{
  const row=pt({...ridb,id:'ridb:247835',facility_id:'247835',name:'Daisy State Park',type:null,description:'This recreation area is part of Greeson Lake'});
  const out=DQ.cleanAndDedupeGeoJSON({features:[row]},{siteDetails:{}}).features;
  assert.equal(out.length,1);
  const p=out[0].properties;
  assert.equal(p.camping_classification,'published_pending_review');
  assert.equal(p.camping_evidence,'proposed_withdrawal_pending_review');
  assert.equal(p.type,'established');assert.equal(p.type_evidence.kind,'held_published_label');
  assert.equal(DQ.isWithdrawnId('ridb:247835'),false);
  // Re-normalizing (browser state merge) keeps the same outcome.
  assert.equal(DQ.normalizeFeature(out[0]).properties.camping_evidence,'proposed_withdrawal_pending_review');
  // A record outside the reviewed set gets no hold.
  assert.equal(DQ.cleanAndDedupeGeoJSON({features:[pt({...row.properties,id:'ridb:9',facility_id:'9'})]},{siteDetails:{}}).features.length,0);
});
const LEDGER=require('../docs/tourism/decision-ledger-2026-11-01.json');
const decided=id=>LEDGER.records.find(r=>r.id===id);
// A row carrying the ledger's own wording in its specified field.
const own=(id,extra={})=>{const r=decided(id);return pt({...ridb,id,facility_id:id.slice(5),name:r.own_field==='FacilityName'?r.own_quote:r.name,type:'other',description:r.own_field==='FacilityDescription'?'<p>'+r.own_quote+'</p>':'',source_retrieved_at:'2026-10-29T02:57:25Z',...extra});};
const out=row=>DQ.cleanAndDedupeGeoJSON({features:[row]},{siteDetails:{},includeUnverified:true}).features[0].properties;
test('owner decisions 2026-11-01: labels follow the dated ledger',()=>{
  assert.equal(out(own('ridb:255262')).type,'dispersed','own dispersed description');
  assert.equal(out(own('ridb:249902')).type_evidence.kind,'held_published_label','decision 4 exception stays held');
  const enduro=out(own('ridb:240871'));assert.equal(enduro.type,'other');assert.equal(enduro.camping_classification,'published_pending_review');
  assert.equal(out(own('ridb:262796')).type,'other','primitive alone is not Dispersed');
  for(const id of ['ridb:257133','ridb:248513','ridb:265204'])assert.equal(out(own(id)).type,'established',id);
  assert.equal(out(own('ridb:10134443')).type,'dispersed');
});
test('reviewed labels are bound to their own wording: a new date keeps the label, changed or missing wording returns it to pending',()=>{
  const later=out(own('ridb:255262',{source_retrieved_at:'2031-05-01T00:00:00Z'}));
  assert.equal(later.type,'dispersed');assert.equal(later.type_evidence.kind,'owner_reviewed_own_record');assert.equal(later.type_evidence.retrieved_at,'2031-05-01T00:00:00Z');
  const changed=out(own('ridb:255262',{description:'<p>Wolf Flats is a developed campground with 25 paved sites.</p>'}));
  assert.equal(changed.type,'other');assert.equal(changed.camping_classification,'published_pending_review');
  assert.equal(changed.camping_evidence,'owner_review_evidence_changed');assert.equal(changed.type_evidence.reviewed_label,'dispersed');
  // Missing wording, on a listing whose admission stands on its reviewed own record (Coleman Lake).
  const missing=out(own('ridb:243218',{description:'',source_retrieved_at:'2026-10-29T02:45:26Z'}));
  assert.equal(missing.camping_classification,'published_pending_review');
  assert.equal(missing.type,'other');assert.equal(missing.type_evidence.kind,'owner_review_evidence_changed');
  // Wording copied from another record is not the facility's own wording.
  assert.equal(out(own('ridb:243218',{description_source_record_id:'ridb:2',source_retrieved_at:'2026-10-29T02:45:26Z'})).type_evidence.kind,'owner_review_evidence_changed');
  // A name-bound label: a renamed facility goes back to pending.
  assert.equal(out(own('ridb:10007101',{name:'Large Vehicle Campground Loop B'})).type_evidence.kind,'owner_review_evidence_changed');
  assert.equal(out(own('ridb:10007101')).type,'established');
  // Re-normalization (browser state merge) reaches the same outcome.
  assert.equal(DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[-110,40]},properties:later}).properties.type,'dispersed');
});
test('the dated decision ledger matches the classifier for every decided listing',()=>{
  assert.equal(LEDGER.records.length,62);
  const src=fs.readFileSync(path.join(__dirname,'../data-quality.js'),'utf8');
  const block=name=>src.slice(src.indexOf('const '+name)).split(']);')[0];
  const reviewed=new Map([...block('OWNER_REVIEWED_LABELS').matchAll(/\["(ridb:\d+)", \{label:"(\w+)", field:"(\w+)", quote:("(?:[^"\\]|\\.)*")\}\]/g)].map(m=>[m[1],{label:m[2],field:m[3],quote:JSON.parse(m[4])}]));
  const held=new Map([...block('HELD_PUBLISHED_LABELS').matchAll(/\['(ridb:\d+)', '(\w+)'\]/g)].map(m=>[m[1],m[2]]));
  const accepted=['upgrade_named_campground','upgrade_named_dispersed_campground','upgrade_reviewed_individually','keep_current_label','relabel_dispersed'];
  for(const r of LEDGER.records){
    if(accepted.includes(r.decision))assert.deepEqual(reviewed.get(r.id),{label:r.label,field:r.own_field,quote:r.own_quote},r.id);
    else assert.ok(!reviewed.has(r.id),r.id);
    assert.equal(held.has(r.id),['keep_discoverable_pending_withdrawal_review','exception_held_pending'].includes(r.decision),r.id);
  }
  const holds=LEDGER.review_holds.records;assert.equal(holds.length,27);
  for(const h of holds){assert.equal(held.get(h.id),h.held_label,h.id);assert.ok(!decided(h.id),h.id);}
  assert.equal(reviewed.size,44);assert.equal(held.size,11+27);
  for(const id of ['ridb:248513','ridb:265204'])assert.equal(decided(id).confirmed,'2026-11-01T21:33:00-04:00',id);
});
test('one coordinate policy: the index build and the browser choose the same point',()=>{
  const {buildSearchIndex}=require('../scripts/build-search-index.js');
  const previous={sites:[{id:'ridb:7',legacy_ids:[],lat:40,lng:-110},{id:'ridb:251354',legacy_ids:[],lat:45.240556,lng:-111.871389}]};
  const rows=[pt({...ridb,id:'ridb:7',facility_id:'7',name:'Ordinary Campground'},[-110.01,40.01]),
    pt({...ridb,id:'ridb:251354',facility_id:'251354',name:'Axolotl Cabin'},[-111.8713889,45.2405556])];
  const details={'7':{t:3},'251354':{t:1}};
  const index=buildSearchIndex([{state:'MT',geojson:{type:'FeatureCollection',features:rows}}],DQ,details,[],new Set(previous.sites.map(s=>s.id)),new Map());
  const at=id=>{const s=index.sites.find(x=>x.id===id);return [s.lng,s.lat];};
  const browser=DQ.cleanAndDedupeGeoJSON({features:rows.map(r=>DQ.normalizeFeature(r,{siteDetails:details}))},{siteDetails:details,previousHosts:new Map(),ownerOnly:true});
  const bat=id=>browser.features.find(f=>f.properties.id===id).geometry.coordinates;
  assert.deepEqual(at('ridb:7'),[-110.01,40.01],'index takes the new source point');
  assert.deepEqual(bat('ridb:7'),[-110.01,40.01],'browser takes the same point');
  assert.deepEqual(at('ridb:251354'),[-111.871389,45.240556],'pinned in the index');
  assert.deepEqual(bat('ridb:251354'),[-111.871389,45.240556],'pinned in the browser');
});
test('lodging: the reviewed own-record closure notice is kept, and the multi-cabin record is distinguished',()=>{
  const shaw=pt({...ridb,id:'ridb:233178',facility_id:'233178',name:'SHAW HOUSE',source_retrieved_at:'2026-10-29T02:47:24Z',description:'<p><em>Shaw House is temporarily closed. In April of 2026 ...</em> (09/10/2026)</p>'});
  const s=DQ.cleanAndDedupeGeoJSON({features:[shaw]},{siteDetails:{'233178':{t:1}}}).features[0].properties;
  assert.equal(s.type,'lodging');assert.equal(s.own_closure_notice.status,'temporarily closed');assert.equal(s.own_closure_notice.notice_date,'2026-09-10');
  assert.equal(DQ.normalizeFeature(pt({...shaw.properties,source_retrieved_at:'2030-01-01T00:00:00Z'}),{siteDetails:{'233178':{t:1}}}).properties.own_closure_notice,undefined,'a later retrieval is reviewed afresh');
  const wm=DQ.normalizeFeature(pt({...ridb,id:'ridb:252494',facility_id:'252494',name:'White Mountains National Recreation Area - Alaska Cabins'}),{siteDetails:{'252494':{t:15}}}).properties;
  assert.equal(wm.type,'lodging');assert.equal(wm.kt_accommodation,'cabins');assert.equal(wm.ridb_overnight_sites,15);
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

test('lodging host geometry keeps its published point even on identity fallback',()=>{
  const source=[
    ['251354','Axolotl Cabin',[-111.8713889,45.2405556],[-111.871389,45.240556]],
    ['252494','White Mountains National Recreation Area - Alaska Cabins',[-147.2433611,65.4274972],[-147.243361,65.427497]]
  ];
  for(const [id,name,point,expected] of source){
    const row=pt({...ridb,id:'ridb:'+id,facility_id:id,name},point);
    for(const identity of [{},{radiusMeters:-1}]){
      const f=DQ.cleanAndDedupeGeoJSON({features:[row]},{...identity,siteDetails:{[id]:{t:1}}}).features[0];
      assert.deepEqual(f.geometry.coordinates,expected,id);
    }
  }
});
