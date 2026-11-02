#!/usr/bin/env node
'use strict';
// Live rest-area partial-timeout acceptance (2.37.0, PR #166). On the live site, with every other request untouched,
// the first Nevada region request is held past its own 20 s deadline (fake clock). The check requires:
//  - the control reports "Unavailable now: Nevada." and not a whole-catalogue failure,
//  - an already validated region stays visible: the INDOT facility with the facility-specific parking prohibition,
//  - "Retry official rest areas" then loads Nevada and the unavailable notice clears.
// With EXPECTED_SHA, release.json must report it at the start and the end. Exit 0 PASS, 1 failed check, 2 error.
// Usage: [EXPECTED_SHA=<sha>] [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-rest-area-timeout-check.js
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'https://kamptrail.com';
const MOBILE = process.env.MOBILE === '1';
const EXPECTED_SHA = process.env.EXPECTED_SHA || null;
const release = page => page.evaluate(async () => { const r = await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'}); return r.ok ? r.json() : {source_commit: null, http_status: r.status}; });
const text = async loc => (await loc.innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const record = {start: new Date().toISOString(), base: BASE, expected_sha: EXPECTED_SHA, browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()}, mobile_emulation: MOBILE};
  try {
    const policies = await (await fetch(`${BASE}/data/rest-areas/state-policies.json?n=${Date.now()}`)).json();
    const exception = policies.exceptions.find(x => x.state === 'IN' && x.rules?.overnight_parking === 'prohibited');
    const indiana = await (await fetch(`${BASE}/data/rest-areas/IN.json?n=${Date.now()}`)).json();
    const site = indiana.records.find(r => r.id === exception.facility_id);
    assert.ok(site, 'INDOT exception facility present in the live IN file');
    record.site = {id: site.id, name: site.name, coordinates: site.coordinates};

    const context = await browser.newContext({serviceWorkers: 'block', ...(MOBILE ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {})});
    const page = await context.newPage();
    record.viewport_runtime = page.viewportSize();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
    await page.clock.install();
    let nvCalls = 0, releaseHold, held;
    const gate = new Promise(r => { releaseHold = r; }), started = new Promise(r => { held = r; });
    await page.route('**/data/rest-areas/NV.json*', async r => { nvCalls++; if (nvCalls === 1) { held(); await gate; return r.abort().catch(() => {}); } return r.continue(); });
    await page.addInitScript(p => localStorage.setItem('kt_last_position', JSON.stringify(p)), {lat: site.coordinates[1], lng: site.coordinates[0], zoom: 10});
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await page.waitForFunction(() => window.KampTrailRestAreas && window.map, null, {timeout: 90000});
    record.release = await release(page);
    if (EXPECTED_SHA) assert.equal(record.release.source_commit, EXPECTED_SHA, 'deployed source_commit at start');
    record.version = await page.evaluate(() => window.KampTrailRestAreas.version);
    record.request_timeout_ms = await page.evaluate(() => window.KampTrailRestAreas.requestTimeoutMs);

    await page.getByRole('button', {name: 'Map layers', exact: true}).press('Enter');
    const box = page.getByLabel('Official rest areas', {exact: true});
    await box.focus(); await box.press('Space');
    await started;
    await page.clock.fastForward(21000);
    const c = page.locator('.kt-rest-control');
    await c.getByText('Unavailable now: Nevada.').waitFor({timeout: 30000});
    record.after_deadline = await text(c);
    assert.doesNotMatch(record.after_deadline, /catalogue unavailable/i);
    // Let the other regions finish (real network), then check the INDOT facility is on the map.
    await page.waitForFunction(id => { let found = false; map.eachLayer(l => { if (l.ktRestAreaId === id) found = true; }); return found; }, site.id, {timeout: 60000});
    record.while_nevada_missing = await text(c);
    assert.match(record.while_nevada_missing, /Unavailable now: Nevada\./);
    await page.evaluate(id => map.eachLayer(l => { if (l.ktRestAreaId === id) l.openPopup(); }), site.id);
    const popup = page.locator('.kt-rest-popup');
    await popup.waitFor({timeout: 15000});
    record.popup = (await text(popup)).slice(0, 400);
    assert.match(record.popup, /overnight parking Prohibited/);
    await page.evaluate(() => map.closePopup());

    releaseHold();
    await c.getByRole('button', {name: 'Retry official rest areas', exact: true}).click();
    // Advance the fake clock while the real retry request completes, until the loaded result is shown.
    const loaded = () => page.evaluate(() => { const t = document.querySelector('.kt-rest-control')?.textContent || ''; return /official rest-area location/.test(t) && !/Loading|Unavailable now/.test(t); });
    for (let i = 0; i < 120 && !await loaded(); i++) { await page.clock.fastForward(500); await page.waitForTimeout(250); }
    assert.ok(await loaded(), 'retry finished loading with no unavailable region');
    record.after_retry = await text(c);
    record.nevada_requests = nvCalls;
    assert.match(record.after_retry, /Nevada/);
    assert.equal(nvCalls, 2, 'retry requested Nevada once more');
    assert.deepEqual(errors, [], 'no page errors');
    record.release_end = await release(page);
    assert.equal(record.release_end.source_commit, record.release.source_commit, 'release changed during the run');
    if (EXPECTED_SHA) assert.equal(record.release_end.source_commit, EXPECTED_SHA, 'deployed source_commit at end');
    await context.close();
    record.result = 'PASS';
  } catch (e) {
    record.result = 'FAIL'; record.error = e.message; process.exitCode = e instanceof assert.AssertionError ? 1 : 2;
  } finally {
    record.end = new Date().toISOString();
    console.log(JSON.stringify(record, null, 1));
    await browser.close();
  }
})();
