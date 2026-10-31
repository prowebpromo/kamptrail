const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CampsiteMerger, saveMergedData } = require('../merge_campsite_data');
const { mergeState } = require('../merge_all_states');
// Node 22's test IPC can misread non-ASCII progress stdout as V8 frames
// (nodejs/node#65934). These tests assert data and failures, not CLI progress.
// Capture only this child test file's progress; production logging is unchanged.
test.beforeEach(() => mock.method(console, 'log', () => {}));
test.afterEach(() => mock.restoreAll());
const point = (properties = {}, coordinates = [-73, 42]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates }, properties
});

test('OSM snapshot merges retain field ownership, dates and donor observations', () => {
  const merger = new CampsiteMerger();
  const a = {id:'osm:node:1',osm_id:1,osm_type:'node',name:'Pine Campground',tourism:'camp_site',source_retrieved_at:'2026-10-01T00:00:00Z'};
  const b = {id:'osm:node:2',osm_id:2,osm_type:'node',name:'Pine Campground',tourism:'camp_site',fee:'no',access:'permit',source_retrieved_at:'2026-10-02T00:00:00Z'};
  const original = structuredClone([a,b]);
  const merged = merger.mergeProperties(a,b);
  assert.equal(merged.id,a.id);
  for (const k of ['fee','access','cost','fee_status']) assert.equal(merged[k],undefined,k);
  assert.equal(merged.member_evidence.find(r=>r.source_record_id===b.id).fields.fee,'no');
  assert.equal(merged.member_evidence.find(r=>r.source_record_id===b.id).retrieved_at,b.source_retrieved_at);
  assert.deepEqual([a,b],original);
  const reverse = merger.mergeProperties(b,a);
  assert.equal(reverse.fee,'no');assert.equal(reverse.access,'permit');
  const repeated = merger.mergeProperties(merged,b);
  assert.equal(repeated.fee,undefined);assert.equal(repeated.access,undefined);
  assert.equal(repeated.member_evidence.length,1);
});

test('snapshot fee disagreements retain the kept element fee and record the donor', () => {
  const merger = new CampsiteMerger(), quality = require('../../data-quality');
  const a={id:'osm:node:1',osm_id:1,osm_type:'node',name:'Pine Campground',tourism:'camp_site',fee:'no'};
  const b={...a,id:'osm:node:2',osm_id:2,fee:'yes'};
  const merged=merger.mergeProperties(merger.mergeProperties(a,b),a);
  const normalized=quality.normalizeFeature(point(merged));
  assert.equal(normalized.properties.fee_status,'free');assert.equal(normalized.properties.cost,0);
  assert.ok(normalized.properties.data_conflicts.includes('member_fee_disagreement'));
  assert.equal(normalized.properties.member_evidence[0].fields.fee,'yes');
});

test('snapshot ownership guards leave merge membership, canonical IDs and coordinates unchanged', async () => {
  const merger=new CampsiteMerger();
  const a=point({id:'osm:node:1',osm_id:1,osm_type:'node',name:'Pine Campground',tourism:'camp_site'});
  const b=point({id:'osm:node:2',osm_id:2,osm_type:'node',name:'Pine Campground',tourism:'camp_site',fee:'yes'},[-73.0001,42]);
  const merged=await merger.mergeDatasets([{features:[a,b]}]);
  assert.equal(merged.features.length,1);assert.equal(merged.duplicatesRemoved,1);
  assert.equal(merged.features[0].properties.id,a.properties.id);
  assert.deepEqual(merged.features[0].geometry,a.geometry);
  assert.deepEqual(merged.features[0].properties.source_ids,[a.properties.id,b.properties.id]);
});

test('merging preserves explicit zero and never manufactures a free campsite', () => {
  const merger = new CampsiteMerger();
  assert.equal(merger.mergeProperties({ cost: 0 }, { cost: 20 }).cost, 0);
  assert.equal(merger.mergeProperties({}, {}).cost, null);
  assert.equal(merger.mergeProperties({ cost: '' }, { cost: 0 }).cost, 0);
  assert.equal(merger.mergeProperties({ cost: -5 }, { cost: Infinity }).cost, null);
});

test('merging retains original identity, provenance and unknown classifications', () => {
  const merger = new CampsiteMerger();
  const merged = merger.mergeProperties(
    { id: 'ridb:20', facility_id: '20', state: 'NY', source: 'recreation.gov', cost: null },
    { id: 'osm:way:30', osm_id: 30, osm_type: 'way', source: 'openstreetmap', type: 'multipolygon' }
  );
  assert.equal(merged.id, 'ridb:20');
  assert.equal(merged.facility_id, '20');
  assert.equal(merged.osm_id, undefined);
  assert.equal(merged.osm_type, undefined);
  assert.equal(merged.state, 'NY');
  assert.equal(merged.type, null);
  assert.deepEqual(merged.sources, ['recreation.gov', 'openstreetmap']);
  assert.deepEqual(merged.source_ids, ['ridb:20', 'osm:way:30']);
});

test('adjacent unrelated or unnamed campsites remain distinct', async () => {
  const merger = new CampsiteMerger();
  const merged = await merger.mergeDatasets([{ features: [
    point({ name: 'North campground' }),
    point({ name: 'Lakeside retreat' }, [-73.00001, 42]),
    point({}), point({}, [-73.00001, 42])
  ] }]);
  assert.equal(merged.features.length, 4);
});

test('invalid coordinates do not crash a merge or create map markers; IDs stay stable', async () => {
  const merger = new CampsiteMerger();
  const original = point({ name: 'Test', facility_id: 99, id: 'NY-001' });
  const result = await merger.mergeDatasets([{ features: [
    original, point({ name: 'Bad' }, [181, 42]), point({}, ['-73', 42]), { properties: {} }
  ] }]);
  assert.equal(result.features.length, 1);
  assert.equal(result.invalidRemoved, 3);
  assert.equal(result.features[0].properties.id, 'ridb:99');
  assert.deepEqual(result.features[0].properties.source_ids, ['NY-001']);
  assert.equal(original.properties.id, 'NY-001');
});

test('an empty or invalid refresh cannot overwrite a saved working dataset', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kamptrail-merge-'));
  try {
    const output = path.join(directory, 'NY_merged.geojson');
    const saved = JSON.stringify({ type: 'FeatureCollection', features: [point({ name: 'Existing' })] });
    await fs.writeFile(output, saved);
    await assert.rejects(saveMergedData(output, { features: [] }), /keeping the existing/);
    assert.equal(await fs.readFile(output, 'utf8'), saved);
    await fs.writeFile(path.join(directory, 'NY.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
    const result = await mergeState('NY', new CampsiteMerger(), { campsitesDir: directory, osmDir: directory });
    assert.equal(result, null);
    assert.equal(await fs.readFile(output, 'utf8'), saved);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('merging a current record cannot launder legacy inferred RIDB defaults into trusted attributes', () => {
  const merger = new CampsiteMerger();
  const merged = merger.mergeProperties(
    { facility_id: '20', source: 'recreation.gov', cost: 0, amenities: ['water'], road_difficulty: 'paved', rig_friendly: ['RV'] },
    { schema_version: 3, source: 'openstreetmap', cost: null, amenities: [], road_difficulty: null }
  );
  assert.equal(merged.cost, null);
  assert.deepEqual(merged.amenities, []);
  assert.deepEqual(merged.rig_friendly, []);
  assert.equal(merged.road_difficulty, null);
  assert.equal(merged.field_provenance.cost, 'unknown');
  assert.equal(merged.legacy_inferred.cost, 0);
});

test('single-state refresh selects the historical raw filename and guards missing sources', async () => {
  const { loadStateSources } = require('../merge_campsite_data');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kamptrail-source-'));
  const osmDir = path.join(directory, 'osm');
  await fs.mkdir(osmDir);
  const write = (file, features) => fs.writeFile(file, JSON.stringify({ type: 'FeatureCollection', features }));
  try {
    const old = point({ name: 'RIDB site', facility_id: 20, source: 'recreation.gov' });
    await write(path.join(directory, 'NY(1).geojson'), [old]);
    await write(path.join(directory, 'NY_merged.geojson'), [old]);
    const selected = await loadStateSources('NY', new CampsiteMerger(), { campsitesDir: directory, osmDir });
    assert.equal(selected.datasets.length, 1);
    assert.equal(selected.datasets[0].features[0].properties.facility_id, 20);
    await fs.unlink(path.join(directory, 'NY(1).geojson'));
    await write(path.join(osmDir, 'NY.geojson'), [point({ name: 'OSM site', osm_id: 30 })]);
    await assert.rejects(
      loadStateSources('NY', new CampsiteMerger(), { campsitesDir: directory, osmDir }),
      /previous Recreation.gov source.*keeping existing/
    );
    // A valid empty file is also insufficient to erase a previously represented source.
    await write(path.join(directory, 'NY.geojson'), []);
    await assert.rejects(
      loadStateSources('NY', new CampsiteMerger(), { campsitesDir: directory, osmDir }),
      /previous Recreation.gov source/
    );
    // An absent source never represented before does not block other genuine data.
    await write(path.join(directory, 'NY_merged.geojson'), []);
    const onlyOSM = await loadStateSources('NY', new CampsiteMerger(), { campsitesDir: directory, osmDir });
    assert.equal(onlyOSM.datasets.length, 1);
    assert.equal(onlyOSM.datasets[0].features[0].properties.source, 'openstreetmap');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// ---- 2.22.0 merge identity: positional names stay separate, published IDs stay canonical ----
const osmSite = (id, name, lon, lat, extra = {}) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]},
  properties: {id: `osm:way:${id}`, osm_id: id, osm_type: 'way', name, tourism: 'camp_site', source: 'openstreetmap', schema_version: 3, ...extra}});

test('different OSM campgrounds named only by Upper/Lower or a direction are not merged', () => {
  const pairs = [['Upper Grays Meadow Campground', 'Lower Grays Meadow Campground'], ['North Deer Lake Campground', 'South Deer Lake Campground'],
    ['Johnny Creek Campground (Lower)', 'Johnny Creek Campground (Upper)'], ['Upper Narrows Campground', 'Lower Narrows Campground'], ['Shady Rest Campground', 'Old Shady Rest Campground']];
  for (const [a, b] of pairs) assert.equal(CampsiteMerger.distinctOsmCampgrounds({osm_id: 1, osm_type: 'way'}, {osm_id: 2, osm_type: 'way'}, a, b), true, `${a} | ${b}`);
});

test('numbered sites, lettered loops, spelling variants and non-OSM pairs keep the existing rule', () => {
  const pairs = [['Backcountry Site 4', 'Backcountry Site 5'], ['Group Site A', 'Group Site B'], ['Moon Lake #1', 'Moon Lake #2'],
    ['Site: GS, Loop: Bear Creek', 'Site: 27, Loop: Bear Creek'], ['Campground D', 'Campground E'], ['Wallace State Park Campground 2', 'Wallace State Park Campground 3'],
    ['North Camping Zone', 'South Camping Zone'], ['Sauk River Park  Campground', 'Sauk River Park Campground'], ['Pine Springs Campground', 'Pine Spring Campground']];
  for (const [a, b] of pairs) assert.equal(CampsiteMerger.distinctOsmCampgrounds({osm_id: 1, osm_type: 'way'}, {osm_id: 2, osm_type: 'way'}, a, b), false, `${a} | ${b}`);
  assert.equal(CampsiteMerger.distinctOsmCampgrounds({facility_id: 9, osm_id: 1, osm_type: 'way'}, {osm_id: 2, osm_type: 'way'}, 'Upper X Campground', 'Lower X Campground'), false);
  assert.equal(CampsiteMerger.distinctOsmCampgrounds({osm_id: 1, osm_type: 'way'}, {osm_id: 1, osm_type: 'way'}, 'Upper X Campground', 'Lower X Campground'), false);
});

test('snapshot merge keeps Upper and Lower apart but still groups numbered sites and same-name duplicates', async () => {
  const merger = new CampsiteMerger(); merger.preferredIds = null; merger.publishedAnyIds = null;
  const result = await merger.mergeDatasets([{type: 'FeatureCollection', features: [
    osmSite(1, 'Lower Grays Meadow Campground', -118.2, 36.77), osmSite(2, 'Upper Grays Meadow Campground', -118.2, 36.7741),
    osmSite(3, 'Backcountry Site 4', -110, 40), osmSite(4, 'Backcountry Site 5', -110, 40.001),
    osmSite(5, 'Pine Campground', -111, 41), osmSite(6, 'Pine Campground', -111, 41.001)]}]);
  assert.deepEqual(result.features.map(f => f.properties.id).sort(), ['osm:way:1', 'osm:way:2', 'osm:way:3', 'osm:way:5']);
});

test('a published listing stays the kept record with its own point when a previously absorbed element now matches it', async () => {
  const merger = new CampsiteMerger();
  merger.preferredIds = new Set(['osm:way:20']); merger.publishedAnyIds = new Set(['osm:way:20']);
  const result = await merger.mergeDatasets([{type: 'FeatureCollection', features: [
    osmSite(10, 'Upper Bayview Campground', -122.81011, 39.0130847, {fee: 'yes'}), osmSite(20, 'Upper Bayview Campground', -122.8100971, 39.0121403)]}]);
  assert.equal(result.features.length, 1);
  const kept = result.features[0];
  assert.equal(kept.properties.id, 'osm:way:20');
  assert.deepEqual(kept.geometry.coordinates, [-122.8100971, 39.0121403]);
  assert.equal(kept.properties.fee, undefined, 'the absorbed element fee stays with its owner');
});

test('the kept record is not replaced when it is already published as a listing or an alias', async () => {
  const merger = new CampsiteMerger();
  merger.preferredIds = new Set(['osm:way:31']); merger.publishedAnyIds = new Set(['osm:way:31', 'osm:way:30']);
  const result = await merger.mergeDatasets([{type: 'FeatureCollection', features: [
    osmSite(30, 'Highway K', -90.7666667, 37.3241667), osmSite(31, 'Highway K', -90.7612754, 37.3250398)]}]);
  assert.equal(result.features[0].properties.id, 'osm:way:30');
});
