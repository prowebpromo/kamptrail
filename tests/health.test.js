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
  assert.deepEqual(Object.keys(h.sources).sort(), ['blm', 'osm', 'rest_areas', 'ridb', 'ridb_sites', 'services', 'services_extracts', 'usfs', 'usfs_sites']);
  assert.ok(quality.summarizeHealth(h).rows.every(r => r.newest));
  assert.ok(h.sources.services_extracts.scopes.UT.last_success,'Expanded source health retains its actual pilot state');
  assert.ok(!h.sources.services_extracts.scopes.US,'A state extract cannot claim national refresh coverage');
  assert.ok(h.sources.rest_areas.scopes.TX.last_success,'The official rest-area pilot retains its actual download date');
  assert.ok(!h.sources.rest_areas.scopes.US,'A Texas rest-area pilot cannot claim national refresh coverage');
});

test('national service freshness uses extract dates and separate import accounting', () => {
  const {nationalServices, STATES} = require('../scripts/record_health.js');
  const h = {version: 1, run: {counts: {fresh: 104}}, sources: {services: {scopes: {US: {last_success: '2024-01-01T00:00:00Z'}}}}};
  const coverage = STATES.map(region => ({region, extract_timestamp: '2025-01-01T00:00:00Z', retrieved_at: '2025-01-02T00:00:00Z', count: 1}));
  assert.throws(() => nationalServices(h, 'fresh', {coverage: coverage.slice(1)}), /Complete/);
  assert.deepEqual(h.run.counts, {fresh: 104});
  nationalServices(h, 'fresh', {coverage});
  assert.deepEqual(h.run.counts, {fresh: 104});
  assert.deepEqual(h.services_run.counts, {fresh: 50});
  assert.equal(h.sources.services_extracts.scopes.UT.last_success, '2025-01-01T00:00:00Z');
  assert.equal(h.sources.services_extracts.scopes.UT.retrieved_at, '2025-01-02T00:00:00Z');
  assert.equal(h.sources.services.retired_by, 'services_extracts');
  assert.ok(!quality.summarizeHealth(h).rows.some(row => row.id === 'services'));
  assert.match(quality.summarizeHealth(h).rows.find(row => row.id === 'services_extracts').note, /50 of 50 states/);
  nationalServices(h, 'failed', {coverage});
  assert.equal(h.sources.services_extracts.scopes.UT.last_success, '2025-01-01T00:00:00Z');
  assert.deepEqual(h.run.counts, {fresh: 104});
});


test('manual state service refresh preserves national coverage and uses extract date', () => {
  const {nationalServices, record, STATES} = require('../scripts/record_health.js');
  const h = {version: 1, run: {counts: {fresh: 104}}, sources: {services: {scopes: {}}}};
  const coverage = STATES.map(region => ({region, extract_timestamp: '2025-01-01T00:00:00Z', retrieved_at: '2025-01-02T00:00:00Z', count: 1}));
  nationalServices(h, 'fresh', {coverage});
  record(h, 'services_extracts', 'UT', 'fresh', '2025-03-01T00:00:00Z', {region: 'UT', source: {extract_timestamp: '2025-02-01T00:00:00Z', retrieved_at: '2025-02-02T00:00:00Z'}});
  const ut = h.sources.services_extracts.scopes.UT;
  assert.equal(ut.last_success, '2025-02-01T00:00:00Z');
  assert.equal(ut.retrieved_at, '2025-02-02T00:00:00Z');
  assert.equal(h.sources.services_extracts.coverage_states.length, 50);
  assert.deepEqual(h.run.counts, {fresh: 104});
  record(h, 'services_extracts', 'UT', 'failed', '2025-03-02T00:00:00Z');
  assert.equal(h.sources.services_extracts.scopes.UT.extract_timestamp, '2025-02-01T00:00:00Z');
  assert.equal(h.sources.services_extracts.scopes.UT.retrieved_at, '2025-02-02T00:00:00Z');
});
