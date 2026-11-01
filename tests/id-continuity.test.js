'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {check} = require('../scripts/check-id-continuity');

const index = sites => ({version: 1, sites});

test('unchanged ids pass, including legacy ids', () => {
  const a = index([{id: 'osm:way:1', legacy_ids: ['ridb:9']}, {id: 'usfs:2'}]);
  const r = check(a, structuredClone(a), null);
  assert.equal(r.lost.length, 0); assert.equal(r.moved.length, 0); assert.equal(r.previous_ids, 3);
});

test('a dropped canonical or legacy id is lost', () => {
  const r = check(index([{id: 'osm:way:1', legacy_ids: ['ridb:9']}, {id: 'usfs:2'}]), index([{id: 'osm:way:1'}]), null);
  assert.deepEqual(r.lost.map(x => x.id).sort(), ['ridb:9', 'usfs:2']);
});

test('an id that now opens a different listing is moved', () => {
  const r = check(index([{id: 'usfs:5'}, {id: 'osm:node:7'}]), index([{id: 'osm:node:7', legacy_ids: ['usfs:5']}]), null);
  assert.deepEqual(r.moved, [{id: 'usfs:5', from: 'usfs:5', to: 'osm:node:7'}]);
  assert.equal(r.lost.length, 0);
});

test('a reviewed withdrawal with the same host keeps the id resolving', () => {
  const prev = index([{id: 'ridb:1', legacy_ids: ['osm:way:3']}, {id: 'usfs:2'}]);
  const withdrawn = {version: 1, listings: [{id: 'ridb:1', legacy_ids: ['osm:way:3']}]};
  assert.equal(check(prev, index([{id: 'usfs:2'}]), withdrawn).lost.length, 0);
  // A withdrawal entry for a different host does not excuse the loss.
  assert.equal(check(prev, index([{id: 'usfs:2'}]), {version: 1, listings: [{id: 'ridb:99', legacy_ids: ['osm:way:3']}]}).lost.length, 2);
});

test('new listings never fail the check', () => {
  const r = check(index([{id: 'a'}]), index([{id: 'a'}, {id: 'b'}]), null);
  assert.equal(r.lost.length + r.moved.length, 0);
});
