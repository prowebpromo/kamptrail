'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Q=require('../data-quality.js');
const source={name:'USDA Forest Service Recreation Site record',layer_url:Q.USFS_SITE_URL,license:'CC BY 4.0',basis:'saved_download',retrieved:'2026-10-31',rows_sha256:'b'.repeat(64)};
const record=(extra={})=>({cn:'5005.1',name:'Pine Campground',type:'CAMPGROUND',water:{text:'Potable Water',class:'drinking_water'},toilet:{text:'Vault toilet(s)',class:'vault_or_pit'},updated:'2026-08-05',edw_modified:'2026-08-06',...extra});
const payload=()=>({version:1,source:{...source},facilities:{'100':{records:[record()],conflicts:[]}}});
const feature=(props={})=>({type:'Feature',geometry:{type:'Point',coordinates:[-75,43]},properties:{id:'usfs:100',name:'Pine Campground',schema_version:3,description:'A campground with camping.',fee_status:'unknown',amenities:[],legacy_ids:['ridb:100'],...props}});

test('Forest Service evidence joins exact Recreation.gov identities only, never touches amenities or fees, and feeds filters at its scope',()=>{
  for(const props of [{id:'ridb:100',legacy_ids:[]},{id:'usfs:100',legacy_ids:['ridb:100']},{id:'osm:way:100',legacy_ids:['ridb:100'],osm_id:100,tourism:'camp_site'}]){
    const f=Q.normalizeFeature(feature(props));const before=structuredClone(f.properties);Q.attachUSFSSiteAmenities(f,payload());
    assert.ok(f.properties.usfs_site_evidence);assert.deepEqual(f.properties.amenities,before.amenities);
    for(const key of ['fee_status','cost','access_status','camping_classification'])assert.deepEqual(f.properties[key],before[key]);
    assert.equal(f.properties.ridb_amenity_evidence,undefined,'kept apart from the Recreation.gov amenity evidence');
    // 2.31.0: an explicit Forest Service class is campground-wide filter evidence the popup shows, with its date.
    assert.equal(Q.applyFilters([f],{amenities:['water']}).length,1);assert.equal(Q.applyFilters([f],{amenities:['toilet']}).length,1);assert.equal(Q.applyFilters([f],{amenities:['dump']}).length,0);
    const e=Q.amenityEvidence(f.properties);assert.equal(e.amenities.toilet.positive[0].scope,'site_record');assert.equal(e.amenities.toilet.positive[0].date,'2026-08-05');
  }
  for(const id of ['usfs:100','osm:node:100','ridb:0100','RIDB:100','ridb:100x','ridb:1000']){
    const f=Q.normalizeFeature(feature({id,legacy_ids:[]}));Q.attachUSFSSiteAmenities(f,payload());assert.equal(f.properties.usfs_site_evidence,undefined,id);
  }
  const raw=feature({id:'usfs:100',legacy_ids:[],facility_id:'100'});Q.attachUSFSSiteAmenities(raw,payload());assert.equal(raw.properties.usfs_site_evidence,undefined,'unrelated numeric fields do not join');
});

test('serialized or copied evidence is not trusted after normalization',()=>{
  const attached=Q.normalizeFeature(feature());Q.attachUSFSSiteAmenities(attached,payload());
  assert.equal(Q.normalizeFeature(attached).properties.usfs_site_evidence!==undefined,true,'the trusted object survives re-normalization');
  const serialized=JSON.parse(JSON.stringify(attached));
  assert.equal(Q.normalizeFeature(serialized).properties.usfs_site_evidence,undefined);
  assert.equal(Q.validUSFSSiteAmenities(serialized.properties.usfs_site_evidence),true);
});

test('merging duplicate rows never adds records twice and keeps the first attached evidence',()=>{
  const data=payload(),a=Q.normalizeFeature(feature({id:'ridb:100',legacy_ids:[]})),b=Q.normalizeFeature(feature({id:'ridb:100',legacy_ids:[]}));
  Q.attachUSFSSiteAmenities(a,data);Q.attachUSFSSiteAmenities(b,data);
  const merged=Q.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[a,b]}).features;
  assert.equal(merged.length,1);assert.equal(merged[0].properties.usfs_site_evidence.facilities['100'].records.length,1);
});

test('validator rejects malformed source, class, qualifier, text, date and conflict claims',()=>{
  assert.equal(Q.validUSFSSiteAmenities(payload()),true);
  const bad=[
    d=>{d.version=2;},d=>{d.source.name='Recreation.gov';},d=>{d.source.layer_url='https://example.test/';},d=>{d.source.license='CC0';},d=>{d.source.retrieved='2026-02-30';},
    d=>{d.source.rows_sha256='x';},d=>{d.facilities.abc=d.facilities['100'];},d=>{d.facilities['100'].records=[];},d=>{delete d.facilities['100'].conflicts;},
    d=>{d.facilities['100'].records[0].water.class='potable';},d=>{d.facilities['100'].records[0].water.text='';},d=>{d.facilities['100'].records[0].water.text='null';},
    d=>{d.facilities['100'].records[0].water.text=' padded ';},d=>{d.facilities['100'].records[0].water.qualifiers=['accessible'];},
    d=>{d.facilities['100'].records[0].toilet.qualifiers=['hand_pump'];},d=>{d.facilities['100'].records[0].water={text:'Yes',class:'unknown',qualifiers:['hand_pump']};},
    d=>{d.facilities['100'].records[0].toilet.class='nearby_only';d.facilities['100'].records[0].toilet.qualifiers=['accessible'];},
    d=>{d.facilities['100'].records[0].updated='yesterday';},d=>{d.facilities['100'].records[0].season={water:'Open'};},d=>{d.facilities['100'].records[0].season={};},
    d=>{delete d.facilities['100'].records[0].water;delete d.facilities['100'].records[0].toilet;},
    d=>{d.facilities['100'].conflicts=['water'];},d=>{d.facilities['100'].conflicts=['shower'];},
    d=>{d.facilities['100'].records.push(record({cn:'2',water:{text:'No water is available',class:'no_water'}}));},
  ];
  for(const mutate of bad){const d=payload();mutate(d);assert.equal(Q.validUSFSSiteAmenities(d),false,mutate.toString());}
  const conflicted=payload();conflicted.facilities['100'].records.push(record({cn:'2',water:{text:'No water is available',class:'no_water'}}));conflicted.facilities['100'].conflicts=['water'];
  assert.equal(Q.validUSFSSiteAmenities(conflicted),true,'a disagreement is valid only when it is flagged');
  const unknownOnly=payload();unknownOnly.facilities['100'].records.push(record({cn:'2',water:{text:'Yes',class:'unknown'}}));
  assert.equal(Q.validUSFSSiteAmenities(unknownOnly),true,'an unknown class does not disagree');
});

test('weekly workflow validates the built file with the client validator and restores the saved file on failure',()=>{
  const step=fs.readFileSync('.github/workflows/fetch-campsite-data.yml','utf8').split('- name: Refresh Forest Service site water and restroom statements')[1].split('- name:')[0];
  assert.match(step,/build_usfs_site_amenities\.py/);assert.match(step,/validUSFSSiteAmenities/);assert.match(step,/cp "\$saved" data\/campsites\/usfs-site-amenities\.json/);
  assert.ok(step.indexOf('validUSFSSiteAmenities')<step.indexOf('record usfs_sites US fresh'));
});

test('committed Forest Service file validates, is dated and keeps agency text apart from classes',()=>{
  const data=JSON.parse(fs.readFileSync('data/campsites/usfs-site-amenities.json','utf8'));
  assert.equal(Q.validUSFSSiteAmenities(data),true);
  assert.equal(data.source.retrieved,'2026-10-31');assert.match(data.source.rows_sha256,/^[a-f0-9]{64}$/);
  assert.ok(fs.statSync('data/campsites/usfs-site-amenities.json').size<2*1024*1024);
  const all=Object.values(data.facilities).flatMap(f=>f.records);
  assert.ok(all.some(r=>r.water?.class==='drinking_water'&&r.water.qualifiers?.includes('hand_pump')));
  assert.ok(all.some(r=>r.water?.class==='unknown'),'ambiguous text stays unknown');
  assert.ok(all.every(r=>[r.water,r.toilet].filter(Boolean).every(s=>s.text===s.text.trim()&&s.text.toLowerCase()!=='null')));
  // Season text is context only: no record carries a seasonal water qualifier unless its own water text says season.
  for(const r of all)if(r.water?.qualifiers?.includes('seasonal'))assert.match(r.water.text,/season/i);
  const conflicts=Object.values(data.facilities).filter(f=>f.conflicts.length);
  assert.ok(conflicts.length>=1);
});
