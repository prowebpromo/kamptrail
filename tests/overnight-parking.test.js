'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const overnight = require('../overnight-parking.js');
const seed = require('../data/overnight/stops.json');

test('operator seed records retain unique identity, dates, coordinates and evidence', () => {
  assert.equal(new Set(seed.map(row => row.id)).size, seed.length);
  for (const row of seed) {
    assert.ok(['casino', 'truck-stop'].includes(row.type));
    assert.ok(['official-policy', 'unverified'].includes(row.status));
    assert.match(row.state, /^[A-Z]{2}$/);
    assert.match(row.phone, /^\+1\d{10}$/);
    assert.match(row.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(row.lat) && Math.abs(row.lat) <= 90);
    assert.ok(Number.isFinite(row.lng) && Math.abs(row.lng) <= 180);
    for (const url of [row.source, row.locationSource, row.directions]) assert.equal(new URL(url).protocol, 'https:');
    const point = overnight.seedRow(row);
    assert.equal(point.snapshot.properties.id, row.id);
    assert.equal(point.snapshot.properties.overnight_source, row.source);
    assert.deepEqual(point.snapshot.geometry.coordinates, [row.lng, row.lat]);
  }
});

test('policy, category and casino state filters combine without promoting an unknown', () => {
  const rows = seed.map(overnight.seedRow);
  const filters = {kinds: new Set(['casino','truck-stop']), verified: true, casinoState: '', origin: null};
  assert.ok(rows.some(row => row.status === 'unverified'));
  assert.ok(rows.filter(row => overnight.matches(row, filters)).every(row => row.status === 'official-policy'));
  filters.casinoState = 'ME';
  assert.deepEqual(rows.filter(row => overnight.matches(row, filters)).map(row => row.id), ['casino:oxford-me']);
  filters.kinds.delete('casino');
  assert.ok(rows.every(row => !overnight.matches(row, filters)));
  assert.equal(overnight.disclaimer, 'A pin is a place to ask about, not permission to stay.');
});
