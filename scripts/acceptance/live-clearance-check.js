#!/usr/bin/env node
'use strict';
// Live clearance-layer acceptance (2.36.0, R10). Two views on the live site:
//  1. national: the densest manifest tile in a non-RI state, at zoom 13. The opt-in layer loads, every tile request
//     answers 200, the control reports candidates and "Unmapped hazards are unknown", and the ODbL credit shows in
//     the control and the map attribution bar.
//  2. Rhode Island, same tab: online read of the pilot, then the connection drops with no reload and the control
//     must say "Saved snapshot".
// With EXPECTED_SHA, release.json must report it at the start and the end. Exit 0 on PASS, 1 on a failed check,
// 2 on a script error.
// REQUIRE_REPORTS=1 also requires the visitor-reports endpoint to answer (live PHP).
// Usage: [EXPECTED_SHA=<sha>] [REQUIRE_REPORTS=1] [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-clearance-check.js
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'https://kamptrail.com';
const MOBILE = process.env.MOBILE === '1';
const EXPECTED_SHA = process.env.EXPECTED_SHA || null;

async function release(page) { return page.evaluate(async () => { const r = await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'}); return r.ok ? r.json() : {source_commit: null, http_status: r.status}; }); }

async function openLayer(page) {
  await page.getByRole('button', {name: 'Map layers', exact: true}).press('Enter');
  const box = page.getByLabel('Clearance candidates (OpenStreetMap)', {exact: true});
  if (!await box.isChecked()) { await box.focus(); await box.press('Space'); }
  await page.locator('#map').click({position: {x: 2, y: 40}});
}

(async () => {
  const start = new Date().toISOString();
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const record = {start, base: BASE, expected_sha: EXPECTED_SHA, browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()}, mobile_emulation: MOBILE};
  try {
    const ctxOpts = MOBILE ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {};
    // 1. National view.
    const context = await browser.newContext(ctxOpts), page = await context.newPage();
    record.viewport_runtime = page.viewportSize();
    const errors = [], tiles = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
    page.on('response', r => { if (r.url().includes('/data/clearances/tiles/')) tiles.push([r.url().split('/').pop().split('?')[0], r.status()]); });
    const manifest = await (await fetch(`${BASE}/data/clearances/index.json?n=${Date.now()}`)).json();
    const pick = manifest.tiles.filter(t => t.records > 0).sort((a, b) => b.records - a.records)[0];
    const [w, s, e, n] = pick.bbox, center = {lat: (s + n) / 2, lng: (w + e) / 2};
    record.national = {manifest_tiles: manifest.tiles.length, picked_tile: pick.path, picked_records: pick.records, center, zoom: 13};
    await page.addInitScript(p => { if (!sessionStorage.getItem('kt-acc')) { sessionStorage.setItem('kt-acc', '1'); localStorage.setItem('kt_last_position', JSON.stringify(p)); } }, {lat: center.lat, lng: center.lng, zoom: 13});
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await page.waitForFunction(() => window.KampTrailClearances && window.map, null, {timeout: 90000});
    record.release = await release(page);
    if (EXPECTED_SHA) assert.equal(record.release.source_commit, EXPECTED_SHA, 'deployed source_commit at start');
    record.version = await page.evaluate(() => window.KampTrailClearances.version);
    await openLayer(page);
    const control = page.locator('.kt-clearance-control');
    await control.getByText(/clearance candidates? in view/).waitFor({timeout: 60000});
    record.national.status = (await control.locator('[role=status]').first().innerText()).trim();
    record.national.odbl_in_control = (await control.locator('.kt-odbl').innerText()).includes('Open Database Licence');
    record.national.attribution_bar = (await page.locator('.leaflet-control-attribution').innerText()).includes('OpenStreetMap contributors, ODbL');
    record.national.tile_responses = tiles;
    record.national.page_errors = errors;
    assert.ok(tiles.length > 0, 'at least one tile requested');
    assert.ok(tiles.every(([, st]) => st === 200), 'every tile answered 200');
    record.national.visitor_reports_unavailable = /Visitor reports unavailable/.test(record.national.status);
    assert.ok(!/unavailable|could not|failed/i.test(record.national.status.replace(/Visitor reports unavailable\.?/, '')), 'no unavailable or failed clearance area in the national view');
    if (process.env.REQUIRE_REPORTS === '1') assert.equal(record.national.visitor_reports_unavailable, false, 'visitor reports endpoint answers');
    assert.match(record.national.status, /Unmapped hazards are unknown/);
    assert.ok(record.national.odbl_in_control && record.national.attribution_bar, 'ODbL credit in the control and the attribution bar');
    assert.deepEqual(errors, [], 'no page errors');
    await context.close();

    // 2. Rhode Island, online then offline in the same tab.
    const ri = await browser.newContext(ctxOpts), rp = await ri.newPage();
    await rp.addInitScript(() => { if (!sessionStorage.getItem('kt-acc')) { sessionStorage.setItem('kt-acc', '1'); localStorage.setItem('kt_last_position', JSON.stringify({lat: 41.82, lng: -71.41, zoom: 12})); } });
    await rp.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await rp.waitForFunction(() => window.KampTrailClearances && window.map, null, {timeout: 90000});
    await openLayer(rp);
    const rc = rp.locator('.kt-clearance-control');
    await rc.getByText(/Rhode Island/).first().waitFor({timeout: 60000});
    record.ri = {online_status: (await rc.locator('[role=status]').first().innerText()).trim()};
    assert.doesNotMatch(record.ri.online_status, /Saved snapshot/, 'online read is not labelled saved');
    await ri.setOffline(true);
    await rp.evaluate(() => window.dispatchEvent(new Event('offline')));
    await rc.getByText(/Saved snapshot/).first().waitFor({timeout: 30000});
    record.ri.offline_status = (await rc.locator('[role=status]').first().innerText()).trim();
    record.ri.uncached_fetch_blocked = await rp.evaluate(async () => { try { await fetch('/acceptance-probe-' + Date.now(), {cache: 'no-store'}); return false; } catch { return true; } });
    assert.equal(record.ri.uncached_fetch_blocked, true, 'really offline');
    await ri.setOffline(false);
    record.release_end = await release(rp);
    assert.equal(record.release_end.source_commit, record.release.source_commit, 'release changed during the run');
    if (EXPECTED_SHA) assert.equal(record.release_end.source_commit, EXPECTED_SHA, 'deployed source_commit at end');
    await ri.close();
    record.result = 'PASS';
  } catch (e) {
    record.result = 'FAIL'; record.error = e.message; process.exitCode = e instanceof assert.AssertionError ? 1 : 2;
  } finally {
    record.end = new Date().toISOString();
    console.log(JSON.stringify(record, null, 1));
    await browser.close();
  }
})();
