#!/usr/bin/env node
'use strict';
// Whole-catalogue identity check: load state snapshots through the real data-loader.js in
// several orders and compare every listing with the published search index.
// Usage: node scripts/check-browser-identity.js [--out file.json] [--scenarios default,reversed,seed:1,...,pairs]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'data/campsites');
const {listingRow} = require('./build-search-index.js');

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const scenarios = (opt('--scenarios') || 'default,reversed,seed:1,seed:2,seed:3,pairs').split(',');
const out = opt('--out');
const hostMapMode = opt('--host-map') || 'served'; // served | missing

const index = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8'));
const indexById = new Map(index.sites.map(s => [s.id, s]));
const fileCache = new Map();
const readText = rel => { if (!fileCache.has(rel)) fileCache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8')); return fileCache.get(rel); };

function harness() {
  const cluster = {addLayers() {}, addLayer() {}, removeLayer() {}};
  const ocean = {getSouth: () => -10, getNorth: () => -9, getWest: () => -140, getEast: () => -139, contains: () => false};
  const map = {on() { return this; }, getBounds: () => ocean, addLayer() {}, removeLayer() {}, hasLayer: () => false, getZoom: () => 10, setView() {}, closePopup() {}};
  const fetcher = async url => {
    const rel = String(url).replace(/^\.?\//, '');
    if (rel === 'data/campsites/identity-hosts.json' && hostMapMode === 'missing') return {ok: false, status: 404, json: async () => ({})};
    const file = path.join(root, rel);
    if (!rel.startsWith('data/') || !fs.existsSync(file)) return {ok: false, status: 404, json: async () => ({})};
    // Parse per request: the loader may keep and mutate what it receives.
    return {ok: true, status: 200, json: async () => JSON.parse(readText(rel))};
  };
  const context = {console: {warn() {}, log() {}, error() {}}, fetch: fetcher, setTimeout, clearTimeout, AbortController, URL, document: {addEventListener() {}},
    dispatchEvent() {}, L: {markerClusterGroup: () => cluster, divIcon: o => o, marker: () => ({bindPopup() { return this; }, on() { return this; }, setPopupContent() { return this; }})}};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readText('data-quality.js'), context);
  vm.runInContext(readText('data-loader.js'), context);
  return {api: context.KampTrailData, DQ: context.DataQuality, map};
}

const ALL = Object.keys(JSON.parse(JSON.stringify(require('node:vm').runInNewContext('(' + readText('data-loader.js').match(/const STATE_BOUNDS = (\{[\s\S]*?\n  \});/)[1] + ')'))));
function shuffled(list, seed) {
  let s = seed >>> 0 || 1; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
  const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

// Popup claims and filter outcomes are compared through the published row (fee, type, amenity
// filter sets, rig types, road, status, rating, RV signatures). Elevation is a separate sidecar.
const strip = row => { const m = {...row.m}; delete m.e; return JSON.stringify(m); };
const ids = row => JSON.stringify([row.id, ...[...row.legacy_ids].sort()]);
async function run(order, onlyIds = null) {
  const h = harness();
  await h.api.init(h.map);
  for (const code of order) await h.api.loadStates([code]);
  await h.api.whenIdentityReady?.();
  const shown = h.api.getAllCampsites();
  const diff = {canonical: [], source_ids: [], claims: [], missing: [], extra: []};
  const seen = new Set();
  for (const f of shown) {
    const row = listingRow(f, h.DQ, []), want = indexById.get(row.id);
    if (onlyIds && !onlyIds.has(row.id) && !(row.legacy_ids || []).some(id => onlyIds.has(id))) continue;
    if (!want) {
      const host = index.sites.find(s => s.legacy_ids.includes(row.id));
      (host ? diff.canonical : diff.extra).push({shown: row.id, index: host?.id || null, name: row.name});
      if (host) seen.add(host.id);
      continue;
    }
    seen.add(want.id);
    if (ids(row) !== ids(want)) diff.source_ids.push({id: row.id, shown: [...row.legacy_ids].sort(), index: [...want.legacy_ids].sort()});
    else if (strip(row) !== strip(want)) diff.claims.push({id: row.id, shown: JSON.parse(strip(row)), index: JSON.parse(strip(want))});
  }
  const loaded = new Set(order);
  for (const s of index.sites) if (s.states.every(c => loaded.has(c)) && (!onlyIds || onlyIds.has(s.id)) && !seen.has(s.id)) diff.missing.push(s.id);
  return {listings: shown.length, counts: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.length])), examples: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.slice(0, 5)]))};
}

(async () => {
  const result = {checked_at: new Date().toISOString(), index_sites: index.sites.length, host_map: hostMapMode, scenarios: {}};
  for (const name of scenarios) {
    if (name === 'pairs') {
      // Each multi-state listing's states one at a time, in both orders.
      const combos = new Map();
      for (const s of index.sites) if (s.states.length > 1) { const k = s.states.join(','); if (!combos.has(k)) combos.set(k, new Set()); combos.get(k).add(s.id); }
      const agg = {combos: combos.size, runs: 0, listings_checked: 0, counts: {canonical: 0, source_ids: 0, claims: 0, missing: 0, extra: 0}, examples: []};
      for (const [k, only] of combos) for (const order of [k.split(','), k.split(',').reverse()]) {
        const r = await run(order, only); agg.runs++; agg.listings_checked += only.size;
        for (const [c, n] of Object.entries(r.counts)) agg.counts[c] += n;
        if (Object.values(r.counts).some(Boolean) && agg.examples.length < 8) agg.examples.push({order, counts: r.counts, examples: r.examples});
      }
      result.scenarios.pairs = agg;
    } else {
      const order = name === 'default' ? ALL : name === 'reversed' ? [...ALL].reverse() : shuffled(ALL, +name.split(':')[1]);
      result.scenarios[name] = {order: order.join(','), ...(await run(order))};
    }
    console.error(name, JSON.stringify(result.scenarios[name].counts));
  }
  const text = JSON.stringify(result, null, 1) + '\n';
  if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
})().catch(e => { console.error(e); process.exitCode = 1; });
