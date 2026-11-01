#!/usr/bin/env node
'use strict';
// Live identity census: every listing in the published search index must resolve in the browser to the same
// canonical id and the same source-id set (id plus legacy_ids), with no wrong merges, after loading every state.
// Unexpected browser ids, unmatched browser listings and unequal listing counts are mismatches too.
// With EXPECTED_SHA set, release.json must report that source_commit at the start and the end of the run.
// Exit 0 only on zero mismatches. Exit 1 on any mismatch or release change, 2 on a script or browser error.
// Usage: INDEX_FILE=<index.json> [EXPECTED_SHA=<sha>] [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-identity-census.js <reversed|seed:N|default|delayed:ST>
const {chromium} = require('playwright');
const fs = require('fs');
const {compare} = require('./census-compare');
const EXPECTED_SHA = process.env.EXPECTED_SHA || null;

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
    const readRelease = () => page.evaluate(async () => (await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'})).json());
    const release = await readRelease();
    const order = scenario === 'reversed' ? [...meta.states].reverse()
      : scenario.startsWith('seed:') ? seedShuffle(meta.states, Number(scenario.split(':')[1]))
      : meta.states;
    if (delayed) await page.evaluate(all => KampTrailData.loadStates(all), order);
    else for (const st of order) await page.evaluate(st => KampTrailData.loadStates([st]), st);
    const loadStatus = await page.evaluate(() => KampTrailData.getLoadStatus());
    const browserListings = await page.evaluate(() => KampTrailData.getAllCampsites().map(f => [f.properties.id, [f.properties.id, ...(f.properties.legacy_ids || [])]]));
    const result = compare(expected, browserListings);
    const releaseEnd = await readRelease();
    const releaseProblems = [];
    if (EXPECTED_SHA && release.source_commit !== EXPECTED_SHA) releaseProblems.push(`start source_commit ${release.source_commit} is not ${EXPECTED_SHA}`);
    if (EXPECTED_SHA && releaseEnd.source_commit !== EXPECTED_SHA) releaseProblems.push(`end source_commit ${releaseEnd.source_commit} is not ${EXPECTED_SHA}`);
    if (release.source_commit !== releaseEnd.source_commit) releaseProblems.push('release changed during the run');
    const record = {
      start, end: new Date().toISOString(), scenario, base: BASE, expected_sha: EXPECTED_SHA, release, release_end: releaseEnd, release_problems: releaseProblems,
      version: meta.version,
      browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()},
      viewport_runtime: page.viewportSize(), mobile_emulation: MOBILE,
      state_order: order, failed_states: loadStatus.failedStates,
      expected_listings: result.expected_listings, browser_features: result.browser_features, count_differs: result.count_differs,
      mismatches: result.mismatches,
      missing: result.missing, split: result.split, canonical_differs: result.canonical,
      source_set_differs: result.sourceSet, wrong_merges: result.wrongMerge, unexpected_ids: result.unexpected,
      unmatched_browser_listings: result.unmatched, page_errors: pageErrors,
      result: result.mismatches === 0 && !loadStatus.failedStates.length && !releaseProblems.length ? 'PASS' : 'FAIL'
    };
    console.log(JSON.stringify(record, null, 1));
    process.exitCode = record.result === 'PASS' ? 0 : 1;
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error('SCRIPT ERROR', e.stack); process.exitCode = 2; });
