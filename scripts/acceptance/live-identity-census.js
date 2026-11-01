#!/usr/bin/env node
'use strict';
// Live identity census: every listing in the published search index must resolve in the browser to the same
// canonical id and the same source-id set (id plus legacy_ids), with no wrong merges, after loading every state.
// Exit 0 only on zero mismatches. Exit 1 on any mismatch, 2 on a script or browser error.
// Usage: INDEX_FILE=<index.json> [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-identity-census.js <reversed|seed:N|default|delayed:ST>
const {chromium} = require('playwright');
const fs = require('fs');

const scenario = process.argv[2] || 'reversed';
const BASE = process.env.BASE || 'https://kamptrail.com';
const MOBILE = process.env.MOBILE === '1';
const index = JSON.parse(fs.readFileSync(process.env.INDEX_FILE, 'utf8'));
const expected = index.sites.map(s => [s.id, [...new Set([s.id, ...(s.legacy_ids || [])])].sort()]);

function seedShuffle(list, seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

(async () => {
  const start = new Date().toISOString();
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const context = await browser.newContext({serviceWorkers: 'block', ...(MOBILE ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {})});
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message.slice(0, 200)));
    await page.addInitScript(() => localStorage.setItem('kt_last_position', JSON.stringify({lat: -10, lng: -140, zoom: 9})));
    await page.route('**/api/**', r => r.fulfill({status: 404, body: '{}'}));
    const delayed = scenario.startsWith('delayed:') ? scenario.split(':')[1] : null;
    if (delayed) await page.route(`**/data/campsites/${delayed}_merged.geojson`, async r => { await new Promise(x => setTimeout(x, 4000)); await r.continue(); });
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await page.waitForFunction(() => window.KampTrailData && KampTrailData.getIdentityStatus?.().hosts === 'published', null, {timeout: 90000});
    const meta = await page.evaluate(() => ({version: KampTrailData.version, states: Object.keys(KampTrailData.getStateBounds())}));
    const release = await page.evaluate(async () => (await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'})).json());
    const order = scenario === 'reversed' ? [...meta.states].reverse()
      : scenario.startsWith('seed:') ? seedShuffle(meta.states, Number(scenario.split(':')[1]))
      : meta.states;
    if (delayed) await page.evaluate(all => KampTrailData.loadStates(all), order);
    else for (const st of order) await page.evaluate(st => KampTrailData.loadStates([st]), st);
    const loadStatus = await page.evaluate(() => KampTrailData.getLoadStatus());
    const result = await page.evaluate(idx => {
      const all = KampTrailData.getAllCampsites(), byId = new Map();
      all.forEach((f, i) => { for (const id of new Set([f.properties.id, ...(f.properties.legacy_ids || [])])) byId.set(id, (byId.get(id) || []).concat(i)); });
      const owner = new Map(); idx.forEach(([, ids], k) => ids.forEach(x => owner.set(x, k)));
      const out = {missing: [], split: [], canonical: [], sourceSet: [], wrongMerge: []};
      for (const [id, ids] of idx) {
        const hit = new Set(); ids.forEach(x => (byId.get(x) || []).forEach(i => hit.add(i)));
        if (!hit.size) { out.missing.push(id); continue; }
        if (hit.size > 1) { out.split.push(id); continue; }
        const f = all[[...hit][0]], got = [...new Set([f.properties.id, ...(f.properties.legacy_ids || [])])].sort();
        if (f.properties.id !== id) out.canonical.push(`${id}->${f.properties.id}`);
        if (JSON.stringify(got) !== JSON.stringify(ids)) out.sourceSet.push(`${id}: ${got.join('|')} vs ${ids.join('|')}`);
      }
      for (const f of all) { const owners = new Set([f.properties.id, ...(f.properties.legacy_ids || [])].map(x => owner.get(x))); if (owners.size > 1) out.wrongMerge.push(f.properties.id); }
      return {features: all.length, ...out};
    }, expected);
    const mismatches = result.missing.length + result.split.length + result.canonical.length + result.sourceSet.length + result.wrongMerge.length;
    const record = {
      start, end: new Date().toISOString(), scenario, base: BASE, release, version: meta.version,
      browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()},
      viewport_runtime: page.viewportSize(), mobile_emulation: MOBILE,
      state_order: order, failed_states: loadStatus.failedStates,
      expected_listings: expected.length, browser_features: result.features, mismatches,
      missing: result.missing, split: result.split, canonical_differs: result.canonical,
      source_set_differs: result.sourceSet, wrong_merges: result.wrongMerge, page_errors: pageErrors,
      result: mismatches === 0 && !loadStatus.failedStates.length ? 'PASS' : 'FAIL'
    };
    console.log(JSON.stringify(record, null, 1));
    process.exitCode = record.result === 'PASS' ? 0 : 1;
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error('SCRIPT ERROR', e.stack); process.exitCode = 2; });
