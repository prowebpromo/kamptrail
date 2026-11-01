#!/usr/bin/env node
'use strict';
// Partial-load identity check in Chromium (2.35.0, docs/DETERMINISTIC_IDENTITY.md).
// Loads states one at a time into the real app with identity-hosts.json served, and after every
// state load (a checkpoint) counts:
//   wrong merges: one browser listing whose ids (id plus legacy_ids) map to more than one index owner,
//                 or include an id the index does not publish;
//   wrong resolutions: a published id whose getCampsiteById result is a listing other than its index
//                 owner (the result holds an id of another owner, or none of its own owner);
//   unresolved: a published id of a listing whose states have all loaded that resolves to nothing.
// Scenarios: single (each state alone), pairs (each pair of states that share a multi-state listing,
// both orders), full:<default|reversed|seed:N> (all states, census against the index at the end),
// fail:<order> (host file 404 during loading, then served and retried).
// Usage: BASE_URL=http://127.0.0.1:8797 CHROMIUM_PATH=... node scripts/check-partial-identity.js \
//          [--scenarios single,pairs] [--out file.json] [--states NV,CA]
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const args = process.argv.slice(2), opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8797';
const scenarios = (opt('--scenarios') || 'single,pairs').split(',');
const out = opt('--out');
const onlyStates = opt('--states') ? new Set(opt('--states').split(',')) : null;

const index = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/campsites/search-index.json'), 'utf8'));
const compact = index.sites.map(s => [s.id, [s.id, ...s.legacy_ids], s.states]);
const pairs = new Set();
for (const s of index.sites) { const st = [...s.states].sort(); for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) pairs.add(st[i] + ',' + st[j]); }
const shuffled = (list, seed) => { let s = seed >>> 0 || 1; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296); const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function boot(browser, {failHosts = false} = {}) {
  const context = await browser.newContext({serviceWorkers: 'block'}), page = await context.newPage();
  const ctl = {serveHosts: !failHosts};
  page.on('pageerror', e => console.error('PAGEERR', e.message.slice(0, 160)));
  await page.route('**/api/**', r => r.fulfill({status: 404, body: '{}'}));
  await page.route('**/data/campsites/identity-hosts.json', r => ctl.serveHosts ? r.continue() : r.fulfill({status: 404, body: ''}));
  // Start in the ocean so no state loads before the script chooses an order.
  await page.addInitScript(() => localStorage.setItem('kt_last_position', JSON.stringify({lat: -10, lng: -140, zoom: 9})));
  await page.goto(BASE + '/?n=' + Date.now());
  await page.waitForFunction(want => window.KampTrailData?.getIdentityStatus?.().hosts === want, failHosts ? 'fallback' : 'published', {timeout: 60000});
  await page.evaluate(idx => {
    const owner = new Map(), sites = new Map();
    for (const [id, ids, states] of idx) { sites.set(id, {ids, states}); for (const x of ids) owner.set(x, id); }
    window.__kt = {owner, sites};
  }, compact);
  return {context, page, ctl};
}

// One checkpoint, evaluated in the page against the running app.
function checkpoint(page, loaded) {
  return page.evaluate(loaded => {
    const {owner, sites} = window.__kt, all = KampTrailData.getAllCampsites(), set = new Set(loaded);
    const ownersOf = f => { const o = new Set(); for (const x of [f.properties.id, ...(f.properties.legacy_ids || [])]) o.add(owner.get(x) ?? ('?' + x)); return o; };
    const wrongMerges = [];
    for (const f of all) { const o = ownersOf(f); if (o.size > 1 || [...o].some(x => x.startsWith('?'))) wrongMerges.push({id: f.properties.id, ids: [f.properties.id, ...(f.properties.legacy_ids || [])], owners: [...o]}); }
    // Same result as KampTrailData.getCampsiteById (first listing, in catalogue order, holding the first of
    // [id, ...identityIds(id)] that any listing holds), with an index instead of a scan per id.
    const first = new Map(); all.forEach(f => { for (const x of [f.properties.id, ...(f.properties.legacy_ids || [])]) if (!first.has(x)) first.set(x, f); });
    const resolve = x => { for (const w of [String(x), ...KampTrailData.identityIds(x)]) { const f = first.get(w); if (f) return f; } return undefined; };
    const wrongResolutions = [], unresolved = []; let checked = 0;
    for (const [id, s] of sites) {
      if (!s.states.some(c => set.has(c))) continue;
      for (const x of s.ids) {
        checked++;
        const f = resolve(x);
        if (!f) { if (s.states.every(c => set.has(c))) unresolved.push(x); continue; }
        const o = ownersOf(f);
        if (o.size !== 1 || !o.has(id)) wrongResolutions.push({id: x, owner: id, got: f.properties.id, got_ids: [f.properties.id, ...(f.properties.legacy_ids || [])]});
      }
    }
    return {listings: all.length, ids_checked: checked, wrong_merges: wrongMerges.length, wrong_resolutions: wrongResolutions.length, unresolved: unresolved.length,
      examples: {wrong_merges: wrongMerges.slice(0, 10), wrong_resolutions: wrongResolutions.slice(0, 10), unresolved: unresolved.slice(0, 10)}};
  }, loaded);
}
// Whole-catalogue census: every index listing whose states are loaded has one browser listing with its id and source-id set.
function census(page, loaded) {
  return page.evaluate(loaded => {
    const {sites} = window.__kt, set = new Set(loaded), all = KampTrailData.getAllCampsites(), byId = new Map();
    all.forEach((f, i) => { for (const x of new Set([f.properties.id, ...(f.properties.legacy_ids || [])])) byId.set(x, (byId.get(x) || []).concat(i)); });
    const diff = {missing: [], split: [], canonical: [], source_ids: []}; let compared = 0;
    for (const [id, s] of sites) {
      if (!s.states.every(c => set.has(c))) continue;
      compared++;
      const hit = new Set(); for (const x of s.ids) for (const i of byId.get(x) || []) hit.add(i);
      if (!hit.size) { diff.missing.push(id); continue; }
      if (hit.size > 1) { diff.split.push(id); continue; }
      const f = all[[...hit][0]], got = [...new Set([f.properties.id, ...(f.properties.legacy_ids || [])])].sort();
      if (f.properties.id !== id) diff.canonical.push({id, shown: f.properties.id});
      if (JSON.stringify(got) !== JSON.stringify([...s.ids].sort())) diff.source_ids.push({id, shown: got});
    }
    return {compared, listings: all.length, differences: Object.values(diff).reduce((n, v) => n + v.length, 0), counts: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.length])), examples: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.slice(0, 5)]))};
  }, loaded);
}

async function runOrder(browser, order, {final = false} = {}) {
  const {context, page} = await boot(browser);
  const checkpoints = [];
  try {
    for (let i = 0; i < order.length; i++) {
      await page.evaluate(c => KampTrailData.loadStates([c]), order[i]);
      const loaded = order.slice(0, i + 1);
      const got = await page.evaluate(() => KampTrailData.getLoadStatus().loadedStates);
      if (!loaded.every(c => got.includes(c))) throw new Error(`state did not load: ${order[i]} (${got})`);
      checkpoints.push({after: order[i], ...(await checkpoint(page, loaded))});
    }
    return {order: order.join('>'), checkpoints, census: final ? await census(page, order) : undefined};
  } finally { await context.close(); }
}
async function runFail(browser, order) {
  const {context, page, ctl} = await boot(browser, {failHosts: true});
  try {
    const checkpoints = [];
    for (let i = 0; i < order.length; i++) {
      await page.evaluate(c => KampTrailData.loadStates([c]), order[i]);
      checkpoints.push({after: order[i], ...(await checkpoint(page, order.slice(0, i + 1)))});
    }
    ctl.serveHosts = true;
    await page.evaluate(() => KampTrailData.retryIdentity());
    const status = await page.evaluate(() => KampTrailData.getIdentityStatus().hosts);
    return {order: order.join('>'), host_file: '404 then served', wrong_merges_during_fallback: Math.max(...checkpoints.map(c => c.wrong_merges)), wrong_resolutions_during_fallback: Math.max(...checkpoints.map(c => c.wrong_resolutions)),
      status_after_retry: status, after_retry: await checkpoint(page, order), census: await census(page, order), checkpoints: checkpoints.map(({examples, ...c}) => c)};
  } finally { await context.close(); }
}

const tally = runs => { const t = {runs: runs.length, checkpoints: 0, checkpoints_with_wrong_merge: 0, checkpoints_with_wrong_resolution: 0, max_wrong_merges: 0, max_wrong_resolutions: 0, total_wrong_merges: 0, total_wrong_resolutions: 0, total_unresolved: 0};
  for (const r of runs) for (const c of r.checkpoints) { t.checkpoints++; if (c.wrong_merges) t.checkpoints_with_wrong_merge++; if (c.wrong_resolutions) t.checkpoints_with_wrong_resolution++; t.max_wrong_merges = Math.max(t.max_wrong_merges, c.wrong_merges); t.max_wrong_resolutions = Math.max(t.max_wrong_resolutions, c.wrong_resolutions); t.total_wrong_merges += c.wrong_merges; t.total_wrong_resolutions += c.wrong_resolutions; t.total_unresolved += c.unresolved; }
  return t; };
// Keep only checkpoints with a finding in full, others as counts.
const slim = r => ({...r, checkpoints: r.checkpoints.map(c => c.wrong_merges || c.wrong_resolutions || c.unresolved ? c : (({examples, ...x}) => x)(c))});

(async () => {
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const probe = await boot(browser);
  const ALL = await probe.page.evaluate(() => Object.keys(KampTrailData.getStateBounds()));
  const version = await probe.page.evaluate(() => KampTrailData.version);
  await probe.context.close();
  const result = {checked_at: new Date().toISOString(), base_url: BASE, app_version: version, index_sites: index.sites.length, states: ALL.length, state_pairs: pairs.size, scenarios: {}};
  const keep = c => !onlyStates || onlyStates.has(c);
  for (const name of scenarios) {
    const t0 = Date.now();
    if (name === 'single') {
      const runs = []; for (const c of ALL.filter(keep)) runs.push(await runOrder(browser, [c]));
      result.scenarios.single = {summary: tally(runs), with_findings: runs.filter(r => r.checkpoints.some(c => c.wrong_merges || c.wrong_resolutions || c.unresolved)).map(slim)};
    } else if (name === 'pairs') {
      const runs = [];
      for (const k of [...pairs].sort()) { const [a, b] = k.split(','); if (!keep(a) || !keep(b)) continue; runs.push(await runOrder(browser, [a, b])); runs.push(await runOrder(browser, [b, a])); }
      result.scenarios.pairs = {pairs: runs.length / 2, summary: tally(runs), with_findings: runs.filter(r => r.checkpoints.some(c => c.wrong_merges || c.wrong_resolutions || c.unresolved)).map(slim)};
    } else if (name.startsWith('full:')) {
      const o = name.slice(5), order = o === 'default' ? ALL : o === 'reversed' ? [...ALL].reverse() : shuffled(ALL, +o.split(':')[1]);
      const r = await runOrder(browser, order.filter(keep), {final: true});
      result.scenarios[name] = {summary: tally([r]), census: r.census, order: r.order, findings: slim(r).checkpoints.filter(c => c.examples)};
    } else if (name.startsWith('fail:')) {
      const o = name.slice(5), order = o === 'default' ? ALL : o === 'reversed' ? [...ALL].reverse() : shuffled(ALL, +o.split(':')[1]);
      result.scenarios[name] = await runFail(browser, order.filter(keep));
    } else throw new Error('unknown scenario ' + name);
    const s = result.scenarios[name];
    if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
    console.error(name, JSON.stringify(s.summary || {wrong_merges: s.wrong_merges_during_fallback, wrong_resolutions: s.wrong_resolutions_during_fallback, status: s.status_after_retry}), s.census ? JSON.stringify(s.census.counts) : '', `${Math.round((Date.now() - t0) / 1000)} s`);
  }
  await browser.close();
  const text = JSON.stringify(result, null, 1) + '\n';
  if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
})().catch(e => { console.error(e); process.exitCode = 1; });
