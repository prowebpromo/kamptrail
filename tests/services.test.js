const test = require('node:test');
const assert = require('node:assert');
const {build} = require('../scripts/build-services.js');
const f = (props, coords = [-110, 40]) => ({type: 'Feature', geometry: {type: 'Point', coordinates: coords}, properties: props});

test('services keep only OSM-tagged dump, propane and schema-3 water points', () => {
  const out = build({features: [
    f({type: 'water', source: 'recreation.gov', name: 'Inferred campground water'}),
    f({type: 'water', source: 'openstreetmap', name: 'Legacy water', osm_id: 1}),
    f({type: 'water', source: 'openstreetmap', name: 'Fill', osm_id: 2, osm_type: 'node', schema_version: 3, drinking_water: 'yes'}),
    f({type: 'dump', source: 'openstreetmap', name: 'Dump', osm_id: 3, access: 'unknown'}),
    f({type: 'dump', source: 'openstreetmap', name: 'Dump dup', osm_id: 3}),
    f({type: 'propane', source: 'openstreetmap', name: 'LPG', osm_id: 4, fee: 'Fee may apply'}),
    f({type: 'dump', source: 'openstreetmap', name: 'Bad', osm_id: 5}, [0, 200])
  ]});
  assert.deepStrictEqual(out.items.map(r => [r[2], r[3]]), [['w', 'Fill'], ['d', 'Dump'], ['p', 'LPG']]);
  assert.deepStrictEqual(out.items[0][4], {o: '2', t: 'node', dw: 'yes'});
  assert.deepStrictEqual(out.items[1][4], {o: '3'});
});

test('committed services file is valid and has no inferred water', () => {
  const data = require('../data/services/services.json');
  assert.ok(Array.isArray(data.items) && data.items.length > 1000);
  for (const r of data.items) {
    assert.ok(['d', 'p', 'w'].includes(r[2]));
    assert.ok(Math.abs(r[0]) <= 180 && Math.abs(r[1]) <= 90);
  }
});
