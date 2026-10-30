'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const quality = require('../data-quality.js');
const script = path.join(__dirname, '..', 'scripts', 'record_health.js');
const run = (file, ...args) => execFileSync('node', [script, ...args], {env: {...process.env, KT_HEALTH_FILE: file}, encoding: 'utf8'});
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kt-health-')), 'health.json');
const DAY = 86400000;

test('a fresh fetch sets last success; a failure keeps the previous success date', () => {
  const file = tmp();
  run(file, 'start'); run(file, 'record', 'osm', 'CA', 'fresh');
  const first = JSON.parse(fs.readFileSync(file)).sources.osm.scopes.CA;
  assert.equal(first.outcome, 'fresh'); assert.equal(first.last_success, first.last_attempt);
  run(file, 'start'); run(file, 'record', 'osm', 'CA', 'failed');
  const h = JSON.parse(fs.readFileSync(file));
  assert.equal(h.sources.osm.scopes.CA.outcome, 'failed');
  assert.equal(h.sources.osm.scopes.CA.last_success, first.last_success);
  assert.deepEqual(h.run.counts, {failed: 1});
});
test('invalid sources, scopes, and outcomes are refused without writing', () => {
  const file = tmp();
  for (const args of [['record', 'nope', 'CA', 'fresh'], ['record', 'osm', 'XX', 'fresh'], ['record', 'usfs', 'CA', 'fresh'], ['record', 'osm', 'CA', 'great']])
    assert.throws(() => run(file, ...args));
  assert.equal(fs.existsSync(file), false);
});
test('a run where every refresh failed is visibly degraded', () => {
  const file = tmp();
  run(file, 'start');
  for (const s of ['CA', 'OR']) run(file, 'record', 'osm', s, 'failed');
  run(file, 'record', 'usfs', 'US', 'failed');
  const sum = quality.summarizeHealth(JSON.parse(fs.readFileSync(file)));
  assert.equal(sum.runFailed, true); assert.equal(sum.degraded, true);
  const osm = sum.rows.find(r => r.id === 'osm');
  assert.equal(osm.status, 'failing'); assert.match(osm.note, /Saved data is shown/);
});
test('stale, partial, skipped and current sources are distinguished', () => {
  const now = Date.parse('2026-10-28T00:00:00Z'), iso = d => new Date(now - d * DAY).toISOString();
  const h = {version: 1, stale_after_days: 45, run: {started: iso(0), counts: {fresh: 2, failed: 1, skipped: 2}}, sources: {
    ridb: {label: 'Recreation.gov campgrounds', scopes: {CA: {last_success: iso(300), outcome: 'skipped'}, OR: {last_success: iso(300), outcome: 'skipped'}}},
    osm: {label: 'OpenStreetMap campsites', scopes: {CA: {last_success: iso(0), outcome: 'fresh'}, OR: {last_success: iso(7), outcome: 'failed'}}},
    usfs: {label: 'Forest Service recreation sites', scopes: {US: {last_success: iso(0), outcome: 'fresh'}}},
  }};
  const sum = quality.summarizeHealth(h, now);
  const by = Object.fromEntries(sum.rows.map(r => [r.id, r]));
  assert.equal(by.ridb.status, 'stale'); assert.match(by.ridb.note, /Older than 45 days in 2 of 2 states.*Not refreshed/);
  assert.equal(by.osm.status, 'partial'); assert.match(by.osm.note, /failed in 1 of 2 states/);
  assert.equal(by.usfs.status, 'current'); assert.equal(by.usfs.note, '');
  assert.equal(sum.runFailed, false); assert.equal(sum.degraded, true);
  assert.equal(quality.summarizeHealth({version: 2}), null);
});
test('the shipped health file is valid and covers every source', () => {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'health.json')));
  assert.equal(h.version, 1);
  assert.deepEqual(Object.keys(h.sources).sort(), ['blm', 'osm', 'rest_areas', 'ridb', 'ridb_sites', 'services', 'services_extracts', 'usfs']);
  assert.ok(quality.summarizeHealth(h).rows.every(r => r.newest));
  assert.ok(h.sources.services_extracts.scopes.UT.last_success,'Expanded source health retains its actual pilot state');
  assert.ok(!h.sources.services_extracts.scopes.US,'A state extract cannot claim national refresh coverage');
  assert.ok(h.sources.rest_areas.scopes.TX.last_success,'The official rest-area pilot retains its actual download date');
  assert.ok(!h.sources.rest_areas.scopes.US,'A Texas rest-area pilot cannot claim national refresh coverage');
});
