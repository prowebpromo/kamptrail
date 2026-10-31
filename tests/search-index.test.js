'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildSearchIndex, buildFromDirectory} = require('../scripts/build-search-index.js');
const DataQuality = require('../data-quality.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function campsite(name, id, coordinates = [-73.8,43.1]) {
  return {type:'Feature', geometry:{type:'Point',coordinates}, properties:{name, osm_id:id, osm_type:'node', tourism:'camp_site'}};
}
function source(state, features) {return {state, geojson:{type:'FeatureCollection',features}};}

test('national index contains publishable sites from snapshots outside the current viewport', () => {
  const index = buildSearchIndex([
    source('NY', [campsite('Adirondack Campground',101)]),
    source('CA', [campsite('Pacific Campground',102,[-121,38])])
  ]);
  assert.equal(index.version,1);
  assert.equal(index.sites.length,2);
  assert.deepEqual(index.sites.find(s=>s.name==='Pacific Campground').states,['CA']);
});

test('compact index retains agency closure status without inferring missing availability',()=>{
  const statuses=['closed','temporarily closed',undefined,'none'];
  const features=statuses.map((open_status,i)=>{const f=campsite(`Status ${i} Campground`,200+i);f.properties.open_status=open_status;f.properties.fee='no';return f;});
  const index=buildSearchIndex([source('NY',features)]);
  for(const [i,status] of statuses.entries()){
    const row=index.sites.find(s=>s.name===`Status ${i} Campground`);
    assert.equal(row.m.f,'free');
    assert.equal(row.m.o,i<2?status:undefined);
  }
});

test('search screens camping within each state before cross-state fee reconciliation',()=>{
  const ridb={type:'Feature',geometry:{type:'Point',coordinates:[-117.2177778,44.36611111]},properties:{id:'ridb:255223',facility_id:'255223',name:'Steck Park',schema_version:3,fee_status:'paid',cost:null,description:'Reservoir access and boat ramps.'}};
  const osm=campsite('Steck Park',1059339869,[-117.2184182,44.3652693]);osm.properties.osm_type='way';
  for(const collections of [[source('ID',[ridb]),source('OR',[osm])],[source('OR',[osm]),source('ID',[ridb])]]){
    const index=buildSearchIndex(collections,DataQuality,{'255223':{f:'paid'}});
    assert.equal(index.sites.length,1);const row=index.sites[0];assert.equal(row.id,'osm:way:1059339869');assert.equal(row.m.f,'unknown');assert.deepEqual(row.states,['OR']);assert.ok(!row.legacy_ids.includes('ridb:255223'));
  }
});

test('state admission preserves original rows and global transitive dedupe topology',()=>{
  const a=campsite('Bird Creek Campground',100,[-114,39]);
  const b={type:'Feature',geometry:{type:'Point',coordinates:[-113.997,39]},properties:{id:'ridb:200',facility_id:'200',schema_version:3,name:'Bird Creek Campground',fee_status:'paid'}};
  const c={type:'Feature',geometry:{type:'Point',coordinates:[-113.994,39]},properties:{id:'usfs:300',schema_version:3,name:'Bird Creek Campground',camping_activity:'Campground Camping',fee_status:'paid'}};
  const admitted=DataQuality.publicationCandidates([b,c],{state:'NV'});assert.equal(admitted.length,2);assert.equal(admitted[0],b);assert.equal(admitted[1],c);
  const index=buildSearchIndex([source('CA',[a]),source('NV',[b,c])]);assert.equal(index.sites.length,2);
  assert.ok(index.sites.some(r=>r.id==='osm:node:100'&&r.legacy_ids.includes('ridb:200')));assert.ok(index.sites.some(r=>r.id==='usfs:300'));
});

test('cross-state duplicates retain source snapshots and a focusable stable ID', () => {
  const a = campsite('Border Campground',101);
  const b = campsite('Border Campground',102,[-73.8001,43.1]);
  const index = buildSearchIndex([source('NY',[a]),source('VT',[b])]);
  assert.equal(index.sites.length,1);
  assert.deepEqual(index.sites[0].states,['NY','VT']);
  const runtime = DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[b,a]});
  assert.ok(runtime.features.some(f=>f.properties.id===index.sites[0].id || f.properties.legacy_ids.includes(index.sites[0].id)));
});

test('source partition membership remains available without supplying a reported state',()=>{
  const unknown=campsite('Unreported State Campground',101,[-101.8556764,33.8690531]);
  const collections=[source('OK',[unknown]),source('TX',[unknown])];
  const row=buildSearchIndex(collections).sites[0];
  assert.deepEqual(row.states,['OK','TX']);
  assert.equal(row.id,'osm:node:101');
  assert.deepEqual([row.lng,row.lat],unknown.geometry.coordinates);
  for(const {state} of collections){
    const normalized=DataQuality.normalizeFeature(unknown,{state});
    assert.equal(normalized.properties.state,null);
    assert.notEqual(normalized.properties.state,state);
  }
});

test('search uses the same screening as the runtime normalizer', () => {
  const invalid = campsite('No coordinates',102,[null,null]);
  const placeholder = campsite('Sample Campsite 3',103);
  const input = [campsite('Genuine Campground',101),invalid,placeholder];
  const index = buildSearchIndex([source('NY',input)]);
  const runtime = DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},{state:'NY'});
  assert.deepEqual(index.sites.map(s=>s.id),runtime.features.map(f=>f.properties.id));
  assert.equal(index.sites.length,1);
});

test('restricted, inactive, and clear noncamping facilities stay out of national discovery', () => {
  const privateSite=campsite('Private Campground',101);
  privateSite.properties.access='private';
  const closedSite=campsite('Closed Campground',102);
  closedSite.properties.disused='yes';
  const cabin={type:'Feature',geometry:{type:'Point',coordinates:[-73,43]},properties:{name:'Mountain Rental Cabin',facility_id:103,source:'recreation.gov'}};
  const office={type:'Feature',geometry:{type:'Point',coordinates:[-74,43]},properties:{name:'Alpine Ranger Station',facility_id:104,source:'recreation.gov'}};
  const index=buildSearchIndex([source('NY',[privateSite,closedSite,cabin,office,campsite('Public Campground',105)])]);
  assert.deepEqual(index.sites.map(s=>s.name),['Public Campground']);
});

test('malformed or incomplete input fails instead of replacing the national index', () => {
  assert.throws(()=>buildSearchIndex([{state:'NY',geojson:{features:[]}}]),/FeatureCollection/);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kamptrail-search-'));
  try {assert.throws(()=>buildFromDirectory(directory),/Expected 50/);}
  finally {fs.rmSync(directory,{recursive:true,force:true});}
});

// ---- 2.22.0 stable listing IDs at the index layer ----
test('an already published listing keeps its ID and point when a newly separated record merges with it', () => {
  const mk = (id, name, lon, lat, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]}, properties: {id, name, tourism: 'camp_site', schema_version: 3, ...extra}});
  const features = [mk('osm:way:335361783', 'Upper Grays Meadow Campground', -118.2, 36.7741, {osm_id: 335361783, osm_type: 'way'}),
    mk('usfs:20680', 'Upper Grays Meadow Campground', -118.2001, 36.7745, {camping_activity: 'Campground Camping'})];
  const plain = DataQuality.cleanAndDedupeGeoJSON({type: 'FeatureCollection', features: features.map(f => JSON.parse(JSON.stringify(f)))}).features;
  assert.equal(plain[0].properties.id, 'osm:way:335361783', 'without published IDs the first record is canonical');
  const stable = DataQuality.cleanAndDedupeGeoJSON({type: 'FeatureCollection', features: features.map(f => JSON.parse(JSON.stringify(f)))}, {preferredIds: new Set(['usfs:20680'])}).features;
  assert.equal(stable.length, 1);
  assert.equal(stable[0].properties.id, 'usfs:20680');
  assert.deepEqual(stable[0].geometry.coordinates, [-118.2001, 36.7745]);
  assert.ok(stable[0].properties.legacy_ids.includes('osm:way:335361783'));
});

test('an alias rejoins its previous listing when several same-name listings are in range', () => {
  const mk = (id, lon, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, 37.325]}, properties: {id, name: 'Highway K', tourism: 'camp_site', schema_version: 3, ...extra}});
  const input = () => [mk('osm:node:2', -90.7652, {osm_id: 2, osm_type: 'node'}), mk('osm:node:1', -90.7690, {osm_id: 1, osm_type: 'node'}), mk('ridb:9', -90.7671, {facility_id: 9})];
  const plain = DataQuality.cleanAndDedupeGeoJSON({type: 'FeatureCollection', features: input()}).features;
  const host = id => plain.find(f => f.properties.id === id || (f.properties.legacy_ids || []).includes(id)).properties.id;
  assert.equal(host('ridb:9'), 'osm:node:1');
  const stable = DataQuality.cleanAndDedupeGeoJSON({type: 'FeatureCollection', features: input()}, {previousHosts: new Map([['ridb:9', 'osm:node:2']])}).features;
  assert.equal(stable.find(f => (f.properties.legacy_ids || []).includes('ridb:9')).properties.id, 'osm:node:2');
});
