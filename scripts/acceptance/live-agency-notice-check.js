#!/usr/bin/env node
'use strict';
// Live agency-load notice acceptance (2.38.0, PR #168). On the live site, with only the named agency request failed:
//  1. national overview with the agency index failing: the index notice and Retry show, and Retry restores the index;
//  2. Colorado detail view with Colorado's agency file failing: the notice names Colorado, Colorado's other listings
//     stay, the notice survives zooming out to the overview, and Retry restores the Forest Service and BLM listings.
// With EXPECTED_SHA, release.json must report it at the start and the end. Exit 0 PASS, 1 failed check, 2 error.
// Usage: [EXPECTED_SHA=<sha>] [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-agency-notice-check.js
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'https://kamptrail.com';
const MOBILE = process.env.MOBILE === '1';
const EXPECTED_SHA = process.env.EXPECTED_SHA || null;
const INDEX_NOTICE = 'Forest Service and BLM listings could not load. Other listings are shown.';
const CO_NOTICE = 'Forest Service and BLM listings could not load for Colorado. Other listings are shown.';
const release = page => page.evaluate(async () => { const r = await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'}); return r.ok ? r.json() : {source_commit: null, http_status: r.status}; });
const agencyCount = page => page.evaluate(() => KampTrailData.getAllCampsites().filter(f => [f.properties.id, ...(f.properties.legacy_ids || [])].some(id => /^(usfs|blm-area|blm-facility):/.test(id))).length);

async function newPage(browser, position) {
  const context = await browser.newContext({serviceWorkers: 'block', ...(MOBILE ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {})});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  await page.addInitScript(p => localStorage.setItem('kt_last_position', JSON.stringify(p)), position);
  return {context, page, errors};
}
async function showList(page) { if (MOBILE && !(await page.locator('#results').isVisible())) await page.locator('#results-toggle').click(); }

(async () => {
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const record = {start: new Date().toISOString(), base: BASE, expected_sha: EXPECTED_SHA, browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()}, mobile_emulation: MOBILE};
  try {
    // 1. Overview, agency index failing.
    let {context, page, errors} = await newPage(browser, {lat: 39.5, lng: -98.5, zoom: 4});
    record.viewport_runtime = page.viewportSize();
    await page.route('**/data/campsites/agency/index.json*', r => r.fulfill({status: 404, body: 'not found'}));
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await page.waitForFunction(() => window.KampTrailData?.getLoadStatus().overview && KampTrailData.getLoadStatus().agencyIndex === 'failed', null, {timeout: 90000});
    record.release = await release(page);
    if (EXPECTED_SHA) assert.equal(record.release.source_commit, EXPECTED_SHA, 'deployed source_commit at start');
    record.version = await page.evaluate(() => KampTrailData.version);
    await showList(page);
    const n1 = page.locator('#data-errors .kt-agency-notice');
    await n1.waitFor({timeout: 30000});
    record.overview = {notice: (await n1.innerText()).replace(/\s+/g, ' ').trim(), summary: (await page.locator('#result-summary').innerText()).trim()};
    assert.ok(record.overview.notice.includes(INDEX_NOTICE), 'index notice in overview');
    assert.match(record.overview.summary, /Zoomed out/);
    await page.unroute('**/data/campsites/agency/index.json*');
    await n1.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.locator('#data-errors .kt-agency-notice').waitFor({state: 'detached', timeout: 60000});
    record.overview.after_retry = (await page.evaluate(() => KampTrailData.getLoadStatus())).agencyIndex;
    assert.equal(record.overview.after_retry, 'ok');
    assert.deepEqual(errors, [], 'no page errors (overview)');
    await context.close();

    // 2. Colorado detail, Colorado agency file failing, then zoom out.
    ({context, page, errors} = await newPage(browser, {lat: 39.0, lng: -105.5, zoom: 9}));
    await page.route('**/data/campsites/agency/CO.geojson*', r => r.fulfill({status: 500, body: 'error'}));
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await page.waitForFunction(() => window.KampTrailData?.getLoadStatus().loadedStates.includes('CO') && !KampTrailData.getLoadStatus().loading, null, {timeout: 90000});
    await showList(page);
    const n2 = page.locator('#data-errors .kt-agency-notice');
    await n2.waitFor({timeout: 30000});
    const st = await page.evaluate(() => KampTrailData.getLoadStatus());
    record.colorado = {notice: (await n2.innerText()).replace(/\s+/g, ' ').trim(), agency_failed: st.agencyFailedStates, failed_states: st.failedStates,
      co_listings: await page.evaluate(() => KampTrailData.getAllCampsites().filter(f => f.properties.forecastStates?.includes('CO')).length), agency_listings_before: await agencyCount(page)};
    assert.ok(record.colorado.notice.includes(CO_NOTICE), 'Colorado notice');
    assert.deepEqual(st.failedStates, []);
    assert.ok(record.colorado.co_listings > 0, 'Colorado listings stay');
    await page.evaluate(() => map.setZoom(4));
    await page.waitForFunction(() => KampTrailData.getLoadStatus().overview, null, {timeout: 30000});
    record.colorado.overview_notice = (await page.locator('#data-errors .kt-agency-notice').innerText()).replace(/\s+/g, ' ').trim();
    assert.ok(record.colorado.overview_notice.includes(CO_NOTICE), 'notice survives zooming out');
    await page.unroute('**/data/campsites/agency/CO.geojson*');
    await page.locator('#data-errors .kt-agency-notice').getByRole('button', {name: 'Retry', exact: true}).click();
    await page.locator('#data-errors .kt-agency-notice').waitFor({state: 'detached', timeout: 60000});
    record.colorado.agency_listings_after = await agencyCount(page);
    record.colorado.after_retry = (await page.evaluate(() => KampTrailData.getLoadStatus())).agencyFailedStates;
    assert.deepEqual(record.colorado.after_retry, []);
    assert.ok(record.colorado.agency_listings_after > record.colorado.agency_listings_before, 'Forest Service and BLM listings restored');
    assert.deepEqual(errors, [], 'no page errors (Colorado)');
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
