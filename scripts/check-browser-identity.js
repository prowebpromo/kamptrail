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
// Host file on the first visit: served | missing (404) | timeout (never answers) | corrupt (invalid JSON shape).
const hostMapMode = opt('--host-map') || 'served';

const index = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8'));
const indexById = new Map(index.sites.map(s => [s.id, s]));
const fileCache = new Map();
const readText = rel => { if (!fileCache.has(rel)) fileCache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8')); return fileCache.get(rel); };

function harness(mode = hostMapMode) {
  const hostState = {mode};
  const cluster = {addLayers() {}, addLayer() {}, removeLayer() {}};
  const ocean = {getSouth: () => -10, getNorth: () => -9, getWest: () => -140, getEast: () => -139, contains: () => false};
  const map = {on() { return this; }, getBounds: () => ocean, addLayer() {}, removeLayer() {}, hasLayer: () => false, getZoom: () => 10, setView() {}, closePopup() {}};
  const fetcher = async (url, opts) => {
    const rel = String(url).replace(/^\.?\//, '');
    if (rel === 'data/campsites/identity-hosts.json' && hostState.mode !== 'served') {
      if (hostState.mode === 'missing') return {ok: false, status: 404, json: async () => ({})};
      if (hostState.mode === 'corrupt') return {ok: true, status: 200, json: async () => ({version: 1, hosts: 'not a map'})};
      return new Promise((resolve, reject) => opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))));
    }
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
  return {api: context.KampTrailData, DQ: context.DataQuality, map, hostState};
}

const ALL_STATES = Object.keys(JSON.parse(JSON.stringify(require('node:vm').runInNewContext('(' + readText('data-loader.js').match(/const STATE_BOUNDS = (\{[\s\S]*?\n  \});/)[1] + ')'))));
const ALL = process.env.KT_STATES ? process.env.KT_STATES.split(',') : ALL_STATES;
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

// Index owner of every published id (canonical or legacy).
const owner = new Map(); for (const s of index.sites) for (const id of [s.id, ...s.legacy_ids]) owner.set(id, s.id);
// First visit with the host file failing: count wrong merges (one listing holding records of two index
// listings) and flips (an id shown as a listing's id that later stops being one, or moves to another
// listing) after every state load. Then serve the file, reconcile, and compare with the index.
async function fallbackRun(order, mode) {
  const h = harness(mode);
  await h.api.init(h.map);
  const shownAt = new Map(), flips = [], wrong = new Map(), unknown = new Set();
  let maxListings = 0;
  const step = () => {
    const now = new Map();
    for (const f of h.api.getAllCampsites()) {
      const p = f.properties, recs = [p.id, ...(p.legacy_ids || [])], own = new Set();
      for (const r of recs) { const o = owner.get(r); if (o) own.add(o); else unknown.add(r); }
      if (own.size > 1) wrong.set(p.id, [...own]);
      now.set(p.id, f);
    }
    for (const [id] of shownAt) if (!now.has(id) && !flips.some(x => x.id === id)) flips.push({id, resolves_to: h.api.getCampsiteById(id)?.properties.id || null});
    for (const id of now.keys()) if (!shownAt.has(id)) shownAt.set(id, true);
    maxListings = Math.max(maxListings, now.size);
  };
  const status = h.api.getIdentityStatus?.().hosts || 'none (2.31.0)';
  for (const code of order) { await h.api.loadStates([code]); step(); }
  const fallback = {host_status_during_load: status, listings_shown: maxListings, ids_shown: shownAt.size, wrong_merges: wrong.size, flips: flips.length, unknown_record_ids: unknown.size,
    examples: {wrong: [...wrong].slice(0, 5), flips: flips.slice(0, 5)}};
  // Duplicate markers: index listings shown as more than one marker while in fallback.
  const byOwner = new Map(); for (const f of h.api.getAllCampsites()) { const o = owner.get(f.properties.id); if (o) byOwner.set(o, (byOwner.get(o) || 0) + 1); }
  fallback.index_listings_with_duplicate_markers = [...byOwner.values()].filter(n => n > 1).length;
  // The file arrives: retry, reconcile once, and every id shown during the fallback still resolves to its index listing.
  h.hostState.mode = 'served';
  if (!h.api.retryIdentity) return {order: order.join(','), host_file: mode, fallback, reconcile: null, after_reconcile: null};
  for (let i = 0; i < 3 && h.api.getIdentityStatus().hosts !== 'published'; i++) await h.api.retryIdentity();
  // Only ids of listings whose states are all loaded can be expected to resolve to the index listing now.
  const loadedSet = new Set(order), complete = id => indexById.get(owner.get(id))?.states.every(c => loadedSet.has(c));
  const reconcile = {host_status: h.api.getIdentityStatus().hosts, shown_ids_checked: 0, shown_ids_resolving_elsewhere: 0, examples: []};
  for (const id of shownAt.keys()) { if (!complete(id)) continue; reconcile.shown_ids_checked++; const got = h.api.getCampsiteById(id)?.properties.id; if (got !== owner.get(id)) { reconcile.shown_ids_resolving_elsewhere++; if (reconcile.examples.length < 5) reconcile.examples.push({id, got, index: owner.get(id)}); } }
  const after = compare(h, order, new Set(index.sites.filter(x => x.states.every(c => loadedSet.has(c))).map(x => x.id)));
  return {order: order.join(','), host_file: mode, fallback, reconcile, after_reconcile: after};
}
function compare(h, order, onlyIds = null) {
  const shown = h.api.getAllCampsites();
  const diff = {canonical: [], source_ids: [], claims: [], missing: [], extra: []};
  const seen = new Set();
  for (const f of shown) {
    const row = listingRow(f, h.DQ, []), want = indexById.get(row.id);
    if (onlyIds && !onlyIds.has(row.id) && !(row.legacy_ids || []).some(id => onlyIds.has(id))) continue;
    if (!want) { const host = owner.get(row.id); (host ? diff.canonical : diff.extra).push({shown: row.id, index: host || null, name: row.name}); if (host) seen.add(host); continue; }
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
    if (name.startsWith('fail:')) {
      // fail:<missing|timeout|corrupt>:<default|reversed|seed:N>
      const [, mode, ...rest] = name.split(':'), o = rest.join(':');
      const order = o === 'default' ? ALL : o === 'reversed' ? [...ALL].reverse() : shuffled(ALL, +o.split(':')[1]);
      result.scenarios[name] = await fallbackRun(order, mode);
      const r = result.scenarios[name];
      console.error(name, JSON.stringify({wrong: r.fallback.wrong_merges, flips: r.fallback.flips, dup: r.fallback.index_listings_with_duplicate_markers, reconcile: r.reconcile.shown_ids_resolving_elsewhere, after: r.after_reconcile.counts}));
      continue;
    }
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
