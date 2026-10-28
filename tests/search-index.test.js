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

test('cross-state duplicates retain source snapshots and a focusable stable ID', () => {
  const a = campsite('Border Campground',101);
  const b = campsite('Border Campground',102,[-73.8001,43.1]);
  const index = buildSearchIndex([source('NY',[a]),source('VT',[b])]);
  assert.equal(index.sites.length,1);
  assert.deepEqual(index.sites[0].states,['NY','VT']);
  const runtime = DataQuality.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[b,a]});
  assert.ok(runtime.features.some(f=>f.properties.id===index.sites[0].id || f.properties.legacy_ids.includes(index.sites[0].id)));
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
