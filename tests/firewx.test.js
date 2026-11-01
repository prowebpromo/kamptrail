'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const fx = require('./fixtures/fire-weather/load.js');
const root = path.resolve(__dirname, '..');
function load() {
  const c = { window: {}, URLSearchParams, Date, Object, Number, String, Set, Map, Array, JSON, Math, Error, matchMedia: () => ({ matches: false }) };
  c.window = c; c.globalThis = c; vm.createContext(c);
  for (const f of ['environment.js', 'firewx.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), c);
  return { fw: c.KampTrailFireWeather, env: c.KampTrailEnvironment };
}
const { fw, env } = load();
const NOW = fx.reference;                       // every fixture is evaluated at its own reference time
const ids = list => Array.from(list, a => a.id);
const feat = (over = {}, geometry = null) => ({ type: 'Feature', geometry, properties: { id: 'x', event: 'Red Flag Warning', messageType: 'Alert', expires: new Date(NOW + 3600000).toISOString(), ends: null, ...over } });

test('parsing: polygon and zone-only synthetic payloads validate and keep geometry null for zone-only alerts', () => {
  for (const name of ['polygon', 'zone_only', 'mixed', 'empty', 'expired', 'cancelled', 'updated', 'geometry_failure', 'partial_zones']) assert.doesNotThrow(() => fw.validate(fx.payload(name), NOW), name);
  const { alerts } = fw.select(fx.payload('mixed').data.features, NOW);
  const byId = Object.fromEntries(alerts.map(a => [a.id, a]));
  assert.equal(byId['urn:synthetic:polygon'].geometry.type, 'Polygon');
  assert.equal(byId['urn:synthetic:zone-only'].geometry, null);
  assert.deepEqual(byId['urn:synthetic:zone-only'].zones, ['fire/CAZ281', 'fire/NMZ104']);
});

test('parsing: malformed, partial, wrong-kind, future and oversize snapshots are rejected', () => {
  const good = fx.payload('polygon');
  const bad = [
    { ...good, partial: true }, { ...good, kind: 'fire' }, { ...good, ok: false }, { ...good, version: 2 }, { ...good, retrieved_at: 'nope' },
    { ...good, retrieved_at: new Date(NOW + 120000).toISOString() },
    { ...good, data: { type: 'FeatureCollection', features: new Array(501).fill(good.data.features[0]) } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ event: 'Special Weather Statement' })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ id: '' })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ messageType: 'Ack' })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ expires: null, ends: null })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ zones: ['../etc/passwd'] })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({ zones: new Array(61).fill('fire/COZ214') })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({}, { type: 'Point', coordinates: [1, 2] })] } },
    { ...good, data: { type: 'FeatureCollection', features: [feat({}, { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [2, 2]]] })] } },
    null,
  ];
  for (const b of bad) assert.throws(() => fw.validate(b, NOW), JSON.stringify(b)?.slice(0, 80));
});

test('expiry: expired alerts and alerts whose event ended early are never active', () => {
  const { alerts, hidden } = fw.select(fx.payload('expired').data.features, NOW);
  assert.deepEqual(ids(alerts), ['urn:synthetic:polygon']);
  assert.equal(hidden.expired, 2);
  const f = [feat({ id: 'a', expires: new Date(NOW + 1000).toISOString() })];
  assert.equal(fw.select(f, NOW).alerts.length, 1);
  assert.equal(fw.select(f, NOW + 1000).alerts.length, 0, 'expires exactly now is expired');
  assert.equal(fw.select(f, NOW + 5000).hidden.expired, 1);
  assert.equal(fw.select([feat({ id: 'b', expires: null, ends: new Date(NOW - 1).toISOString() })], NOW).alerts.length, 0);
});

test('cancellation and updates: cancelled and superseded alerts are hidden and counted', () => {
  const c = fw.select(fx.payload('cancelled').data.features, NOW);
  assert.deepEqual(ids(c.alerts), []); assert.equal(c.hidden.cancelled, 1);
  const u = fw.select(fx.payload('updated').data.features, NOW);
  assert.deepEqual(ids(u.alerts), ['urn:synthetic:update']); assert.equal(u.hidden.superseded, 1);
  // A Cancel message is never itself an alert, even if its own expiry is in the future.
  const only = fw.select([feat({ id: 'k', messageType: 'Cancel', references: ['gone'] })], NOW);
  assert.equal(only.alerts.length, 0);
  // Same id sent twice keeps the later message.
  const dup = fw.select([feat({ id: 'd', sent: '2026-11-01T10:00:00Z', headline: 'old' }), feat({ id: 'd', sent: '2026-11-01T12:00:00Z', headline: 'new' })], NOW);
  assert.equal(dup.alerts.length, 1); assert.equal(dup.alerts[0].headline, 'new');
});

test('status: a watch with a future onset is "upcoming", warnings sort before watches, empty stays empty', () => {
  const m = fw.select(fx.payload('mixed').data.features, NOW);
  assert.deepEqual(ids(m.alerts), ['urn:synthetic:polygon', 'urn:synthetic:zone-only']);
  assert.equal(m.alerts[0].status, 'active'); assert.equal(m.alerts[1].status, 'upcoming');
  const e = fw.select(fx.payload('empty').data.features, NOW);
  assert.deepEqual([e.alerts.length, e.hidden.cancelled + e.hidden.expired + e.hidden.superseded], [0, 0]);
});

test('zone resolution: only zone-only alerts request zones, within a budget, and resolved zones draw as one multipolygon', () => {
  const { alerts } = fw.select(fx.payload('mixed').data.features, NOW);
  const cache = new Map();
  assert.deepEqual(Array.from(fw.neededZones(alerts, cache, NOW)), ['fire/CAZ281', 'fire/NMZ104']);   // the polygon alert asks for nothing
  assert.equal(fw.neededZones(alerts, cache, NOW, 1).length, 1);
  const zoneAlert = alerts[1];
  assert.equal(fw.resolveShape(zoneAlert, cache, NOW).state, 'pending');
  cache.set('fire/CAZ281', { geometry: fw.validateZone(fx.zone('fire/CAZ281'), 'fire/CAZ281'), at: NOW });
  let shape = fw.resolveShape(zoneAlert, cache, NOW);
  assert.equal(shape.state, 'partial'); assert.equal(shape.resolved, 1);
  cache.set('fire/NMZ104', { geometry: fw.validateZone(fx.zone('fire/NMZ104'), 'fire/NMZ104'), at: NOW });
  shape = fw.resolveShape(zoneAlert, cache, NOW);
  assert.equal(shape.state, 'zones'); assert.equal(shape.geometry.type, 'MultiPolygon'); assert.equal(shape.geometry.coordinates.length, 2);
  assert.equal(fw.neededZones(alerts, cache, NOW).length, 0, 'resolved zones are not requested again');
  assert.equal(fw.resolveShape(alerts[0], cache, NOW).state, 'polygon');
  assert.equal(fw.resolveShape({ ...zoneAlert, zones: [], zoneCount: 0 }, cache, NOW).state, 'none');
  // Zone responses must match the requested id and carry a polygon.
  assert.throws(() => fw.validateZone(fx.zone('fire/CAZ281'), 'fire/COZ214'));
  assert.throws(() => fw.validateZone({ ...fx.zone('fire/CAZ281'), kind: 'fire' }, 'fire/CAZ281'));
  assert.throws(() => fw.validateZone({ ...fx.zone('fire/CAZ281'), data: { type: 'FeatureCollection', features: [] } }, 'fire/CAZ281'));
});

test('geometry-fetch failure: the alert stays in the list, is labelled unavailable, and is retried only after the retry window', () => {
  const { alerts } = fw.select(fx.payload('geometry_failure').data.features, NOW);
  assert.equal(alerts.length, 1);
  const cache = new Map([['fire/COZ214', { geometry: null, at: NOW }]]);
  const shape = fw.resolveShape(alerts[0], cache, NOW);
  assert.equal(shape.state, 'unavailable'); assert.equal(shape.geometry, null);
  assert.deepEqual(Array.from(fw.neededZones(alerts, cache, NOW + 60000)), [], 'recent failure is not hammered');
  assert.deepEqual(Array.from(fw.neededZones(alerts, cache, NOW + 11 * 60000)), ['fire/COZ214'], 'retried after 10 minutes');
  assert.equal(fw.resolveShape(alerts[0], cache, NOW + 11 * 60000).state, 'pending');
  // Partial: one of two zones resolved.
  const p = fw.select(fx.payload('partial_zones').data.features, NOW).alerts[0];
  const mixed = new Map([['fire/CAZ281', { geometry: fw.validateZone(fx.zone('fire/CAZ281'), 'fire/CAZ281'), at: NOW }], ['fire/COZ214', { geometry: null, at: NOW }]]);
  const partial = fw.resolveShape(p, mixed, NOW);
  assert.deepEqual([partial.state, partial.resolved, partial.total], ['partial', 1, 2]);
  // More zones than the payload carried can never be called complete.
  const truncated = fw.resolveShape({ ...p, zoneCount: 5 }, new Map([['fire/CAZ281', mixed.get('fire/CAZ281')], ['fire/COZ214', mixed.get('fire/CAZ281')]]), NOW);
  assert.equal(truncated.state, 'partial');
});

test('stale data: fresh within 15 minutes, labelled stale after, refused after 6 hours', () => {
  const at = ms => ({ ...fx.payload('polygon'), retrieved_at: new Date(NOW - ms).toISOString() });
  assert.equal(fw.freshness(at(0), NOW), 'fresh');
  assert.equal(fw.freshness(at(fw.FRESH_MS), NOW), 'fresh');
  assert.equal(fw.freshness(at(fw.FRESH_MS + 1000), NOW), 'stale');
  assert.doesNotThrow(() => fw.validate(at(fw.STALE_MAX_MS), NOW));
  assert.throws(() => fw.validate(at(fw.STALE_MAX_MS + 1000), NOW));
  // Stale data never revives an expired alert: expiry is judged against the clock, not the retrieval time.
  const old = fx.payload('polygon'); assert.equal(fw.select(old.data.features, NOW + 24 * 3600000).alerts.length, 0);
});

test('environment bridge: firewx and zone queries are fixed, and age is not enforced on them but is on point alerts', () => {
  assert.equal(env.query('firewx', null), 'api/environment.php?kind=firewx');
  assert.equal(env.query('zone', 'fire/COZ214'), 'api/environment.php?kind=zone&zone=fire%2FCOZ214');
  assert.ok(!env.query('zone', 'fire/COZ214').includes('https'));
  const old = fx.payload('polygon', Date.now() - 3 * 3600000);
  assert.doesNotThrow(() => env.validate(old, 'firewx'));
  assert.throws(() => env.validate({ ...old, kind: 'alerts' }, 'alerts'));
  const bad = fx.payload('polygon', Date.now()); bad.data.features[0].geometry = { type: 'Point', coordinates: [1, 2] };
  assert.throws(() => env.validate(bad, 'firewx'));
  assert.doesNotThrow(() => env.validate(fx.payload('zone_only', Date.now()), 'firewx'));
  assert.equal(typeof env.request, 'function');
});

test('fixtures: captured files match their recorded SHA-256 and URL, are real NWS data, and the synthetic file is labelled and reproducible', () => {
  const dir = path.join(__dirname, 'fixtures/fire-weather'), manifest = JSON.parse(fs.readFileSync(path.join(dir, 'captured/manifest.json'), 'utf8'));
  assert.ok(manifest.files.length >= 6); assert.match(manifest.user_agent, /kamptrail\.com/); assert.doesNotMatch(manifest.user_agent, /@/);
  assert.match(manifest.window.start, /^\d{4}-\d\d-\d\dT/); assert.equal((Date.parse(manifest.window.end) - Date.parse(manifest.window.start)) / 86400000, 7);
  for (const f of manifest.files) {
    const bytes = fs.readFileSync(path.join(dir, 'captured', f.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), f.sha256, f.file);
    assert.equal(bytes.length, f.bytes); assert.match(f.url, /^https:\/\/api\.weather\.gov\//); assert.match(f.retrieved_at, /Z$/); assert.equal(f.http_status, 200);
  }
  // The seven-day NWS record held no fire alerts. That empty answer is the real capture, and it is not shown as current.
  for (const event of ['Red Flag Warning', 'Fire Weather Watch']) {
    const f = manifest.files.find(x => x.event === event); assert.ok(f, event); assert.equal(f.feature_count, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'captured', f.file), 'utf8')).features.length, 0);
    assert.ok(f.url.includes('start=') && f.url.includes('end='));
  }
  assert.equal(fx.file.fixture.synthetic, true); assert.match(fx.file.fixture.label, /^SYNTHETIC/);
  assert.equal(require('./fixtures/fire-weather/build-synthetic.js').text, fs.readFileSync(path.join(dir, 'synthetic/cases.json'), 'utf8'));
  for (const name of fx.names) assert.equal(fx.payload(name).fixture.synthetic, true);
  for (const c of Object.values(fx.file.cases)) for (const f of c.data.features) assert.match(f.properties.id, /^urn:synthetic:/);
});

test('server never emits a fixture marker, and the client labels any payload that carries one', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'api/_lib/environment.php'), 'utf8'), /fixture/i);
  const src = fs.readFileSync(path.join(root, 'firewx.js'), 'utf8');
  assert.match(src, /d\.fixture \? node\('p', d\.fixture\.synthetic/);
});

test('locale: every fire-weather string has matching Spanish and French entries', () => {
  const src = fs.readFileSync(path.join(root, 'firewx.js'), 'utf8');
  const keys = new Set([fw.LABEL]); for (const m of src.matchAll(/t\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]);
  keys.delete('firewx'); keys.delete('zone');
  const c = { window: {}, Intl, Date, localStorage: { getItem: () => null, setItem() {} } }; c.window = c;
  const frSrc = fs.readFileSync(path.join(root, 'locale-fr.js'), 'utf8'); vm.runInNewContext(frSrc, c);
  const fr = c.KampTrailI18nFr.messages;
  const es = (() => { const x = { window: {}, Intl, Date, localStorage: { getItem: () => 'es', setItem() {} } }; x.window = x; vm.runInNewContext(fs.readFileSync(path.join(root, 'locale.js'), 'utf8'), x); return x.KampTrailI18n; })();
  const holes = x => (x.match(/\{[a-zA-Z0-9_]+\}/g) || []).sort().join();
  for (const k of keys) {
    const spanish = es.t(k); assert.notEqual(spanish, k, 'es missing: ' + k); assert.equal(holes(spanish), holes(k), 'es placeholders: ' + k);
    assert.ok(fr[k] && fr[k] !== k, 'fr missing: ' + k); assert.equal(holes(fr[k]), holes(k), 'fr placeholders: ' + k);
  }
});

test('replacement history: an alert replaced by an Update stays retired after the Update expires or leaves the feed', () => {
  const original = feat({ id: 'orig', expires: new Date(NOW + 9 * 3600000).toISOString() });
  const update = feat({ id: 'upd', messageType: 'Update', references: ['orig'], expires: new Date(NOW + 3600000).toISOString() });
  const first = { ...fx.payload('polygon'), data: { type: 'FeatureCollection', features: [original, update] } };
  assert.deepEqual(ids(fw.select(first.data.features, NOW).alerts), ['upd'], 'replaced while both are in the feed');
  const memory = fw.retiredIds(first);
  assert.ok(memory.has('orig'));
  // 1. The Update has expired, so it is gone from the next snapshot. The original is still unexpired.
  const later = [original];
  assert.deepEqual(ids(fw.select(later, NOW + 2 * 3600000).alerts), ['orig'], 'without memory the original would come back (the defect)');
  assert.deepEqual(ids(fw.select(later, NOW + 2 * 3600000, memory).alerts), [], 'with memory it stays retired');
  assert.equal(fw.select(later, NOW + 2 * 3600000, memory).hidden.superseded, 1);
  // 2. The server's own retired list does the same for a client that never saw the Update.
  const fromServer = { ...first, data: { type: 'FeatureCollection', features: [original], retired: ['orig'] } };
  assert.doesNotThrow(() => fw.validate(fromServer, NOW));
  assert.deepEqual(ids(fw.select(fromServer.data.features, NOW, fw.retiredIds(fromServer)).alerts), []);
  // 3. A chain A -> B -> C leaves only C, and a cancelled alert stays cancelled when its Cancel message leaves.
  const chain = [feat({ id: 'A' }), feat({ id: 'B', messageType: 'Update', references: ['A'] }), feat({ id: 'C', messageType: 'Update', references: ['A', 'B'] })];
  assert.deepEqual(ids(fw.select(chain, NOW).alerts), ['C']);
  const cancelGone = fw.retiredIds({ data: { features: [feat({ id: 'k', messageType: 'Cancel', references: ['A'] })] } });
  assert.deepEqual(ids(fw.select([feat({ id: 'A' })], NOW, cancelGone).alerts), []);
  // 4. Malformed retired lists are refused.
  for (const bad of [{}, 'orig', [1], new Array(501).fill('x')]) assert.throws(() => fw.validate({ ...first, data: { type: 'FeatureCollection', features: [], retired: bad } }, NOW));
});

test('six-hour cutoff is applied to what is already on screen, judged by the clock', () => {
  const d = fx.payload('polygon');
  assert.equal(fw.usableSnapshot(d, NOW + fw.STALE_MAX_MS), d, 'exactly six hours is still usable (and labelled stale)');
  assert.equal(fw.usableSnapshot(d, NOW + fw.STALE_MAX_MS + 1), null, 'one millisecond later it is not');
  assert.equal(fw.usableSnapshot(null, NOW), null);
  assert.equal(fw.freshness(d, NOW + fw.STALE_MAX_MS), 'stale');
  const src = fs.readFileSync(path.join(root, 'firewx.js'), 'utf8');
  const render = src.slice(src.indexOf('function render(now'), src.indexOf('const { alerts, hidden }'));
  assert.match(render, /!usableSnapshot\(st\.data, now\)/);
  assert.match(render, /st\.data = null/);
  assert.match(src, /st\.tick = setInterval\(\(\) => render\(\), 60000\)/, 'the tick renders without fetching');
});

test('client honors Retry-After exactly: no refetch before it, no cap, no fixed 2.1 second retry', async () => {
  const calls = [];
  function envWith(response) {
    const c = { window: {}, URLSearchParams, Date, Object, Number, String, Set, Map, Promise, JSON, Error, AbortController, setTimeout, clearTimeout, navigator: { onLine: true } };
    c.window = c; c.globalThis = c;
    c.fetch = async url => { calls.push(Date.now()); return response(); };
    vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(root, 'environment.js'), 'utf8'), c);
    return c.KampTrailEnvironment;
  }
  const res = (status, retryAfter) => ({ status, ok: status < 400, headers: { get: h => h === 'Retry-After' ? retryAfter : null }, text: async () => '{}' });
  const signal = new AbortController().signal;
  // A Retry-After far beyond any cap: one request, then nothing until it passes.
  let e = envWith(() => res(503, '7200'));
  await assert.rejects(e.request('firewx', null, signal), /Rate limited/);
  assert.equal(calls.length, 1);
  assert.ok(e.retryAfterMs() > 7199000 && e.retryAfterMs() <= 7200000, String(e.retryAfterMs()));
  await assert.rejects(e.request('zone', 'fire/COZ214', signal), /Rate limited/);
  assert.equal(calls.length, 1, 'no second request while Retry-After is pending');
  // A short Retry-After is waited out exactly once, not shortened to the old 2.1 second retry and not stretched past it.
  calls.length = 0;
  e = envWith(() => res(503, '1'));
  const t0 = Date.now();
  await assert.rejects(e.request('firewx', null, signal), /unavailable/);
  assert.equal(calls.length, 2);
  const gap = calls[1] - calls[0];
  assert.ok(gap >= 990 && gap < 1600, 'gap ' + gap);
  // HTTP-date form, and a 429 without a retry retry.
  calls.length = 0;
  e = envWith(() => res(503, new Date(Date.now() + 3600000).toUTCString()));
  await assert.rejects(e.request('firewx', null, signal), /Rate limited/);
  assert.ok(e.retryAfterMs() > 3590000 && e.retryAfterMs() <= 3600000);
  calls.length = 0;
  e = envWith(() => res(429, '90'));
  await assert.rejects(e.request('firewx', null, signal));
  assert.equal(calls.length, 1); assert.ok(e.retryAfterMs() > 89000);
  // Without a header the previous behaviour stays: one retry after 2.1 seconds.
  calls.length = 0;
  e = envWith(() => res(503, null));
  await assert.rejects(e.request('firewx', null, signal));
  assert.equal(calls.length, 2); assert.ok(calls[1] - calls[0] >= 2090);
});

test('retired history from the proxy hides an alert for a client that never saw its replacement', () => {
  // Proxy response 2 carries A alone, with the merged history naming A. A fresh tab renders it.
  const a = feat({ id: 'A', expires: new Date(NOW + 3000000).toISOString() });
  const response2 = { ...fx.payload('polygon'), data: { type: 'FeatureCollection', features: [a], retired: ['A'] } };
  assert.doesNotThrow(() => fw.validate(response2, NOW));
  const fresh = fw.select(response2.data.features, NOW, fw.retiredIds(response2));
  assert.deepEqual(ids(fresh.alerts), []);
  assert.equal(fresh.hidden.superseded, 1);
  // Without the history the alert would show (the defect).
  assert.deepEqual(ids(fw.select(response2.data.features, NOW).alerts), ['A']);
});

test('freshness: past the upstream deadline a retained response is labelled stale even inside the polling window', () => {
  const at = (deadlineSeconds, extra = {}) => ({ ...fx.payload('polygon'), retrieved_at: new Date(NOW).toISOString(), fresh_until: new Date(NOW + deadlineSeconds * 1000).toISOString(), ...extra });
  for (const [seconds, label] of [[60, 'max-age=60'], [0, 'max-age=0'], [-500, 'Expires in the past']]) {
    const d = at(seconds);
    if (seconds > 0) assert.equal(fw.freshness(d, NOW + seconds * 1000 - 1), 'fresh', label + ' before deadline');
    assert.equal(fw.freshness(d, NOW + Math.max(seconds, 0) * 1000 + 1000), 'stale', label + ' after deadline, well inside 15 minutes');
  }
  assert.equal(fw.freshness(at(600), NOW + 599000), 'fresh');
  assert.equal(fw.freshness(at(600, { stale: true }), NOW), 'stale', 'server label wins');
  // A payload with no deadline keeps the 15 minute rule.
  assert.equal(fw.freshness(fx.payload('polygon'), NOW + 14 * 60000), 'fresh');
  // Zones: a retained zone shape past its deadline is flagged on the alert.
  const alert = fw.select(fx.payload('zone_only').data.features, NOW).alerts[0];
  const geom = fw.validateZone(fx.zone('fire/CAZ281'), 'fire/CAZ281'), geom2 = fw.validateZone(fx.zone('fire/NMZ104'), 'fire/NMZ104');
  const cache = new Map([['fire/CAZ281', { geometry: geom, at: NOW, freshUntil: new Date(NOW + 60000).toISOString() }], ['fire/NMZ104', { geometry: geom2, at: NOW, freshUntil: null }]]);
  assert.notEqual(fw.resolveShape(alert, cache, NOW).stale, true);
  assert.equal(fw.resolveShape(alert, cache, NOW + 61000).stale, true);
  assert.equal(fw.resolveShape(alert, new Map([['fire/CAZ281', { geometry: geom, at: NOW, stale: true }], ['fire/NMZ104', { geometry: geom2, at: NOW }]]), NOW).stale, true);
});
