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
  assert.equal(merged.unverified_osm_field_records.find(r=>r.source_record_id===b.id).fields.fee,'no');
  assert.equal(merged.unverified_osm_field_records.find(r=>r.source_record_id===b.id).retrieved_at,b.source_retrieved_at);
  assert.deepEqual([a,b],original);
  const reverse = merger.mergeProperties(b,a);
  assert.equal(reverse.fee,'no');assert.equal(reverse.access,'permit');
  const repeated = merger.mergeProperties(merged,b);
  assert.equal(repeated.fee,undefined);assert.equal(repeated.access,undefined);
  assert.equal(repeated.unverified_osm_field_records.length,2);
});

test('snapshot OSM free versus paid conflicts survive another free donor and normalization', () => {
  const merger = new CampsiteMerger(), quality = require('../../data-quality');
  const a={id:'osm:node:1',osm_id:1,osm_type:'node',name:'Pine Campground',tourism:'camp_site',fee:'no'};
  const b={...a,id:'osm:node:2',osm_id:2,fee:'yes'};
  const merged=merger.mergeProperties(merger.mergeProperties(a,b),a);
  const normalized=quality.normalizeFeature(point(merged));
  assert.equal(normalized.properties.fee_status,'unknown');assert.equal(normalized.properties.cost,null);
  assert.equal(normalized.properties.fee_conflict,true);
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
  assert.equal(merged.osm_id, 30);
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
