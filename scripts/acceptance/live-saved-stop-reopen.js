#!/usr/bin/env node
'use strict';
// Live saved-stop reopening, online and offline. A stop saved under a legacy id must keep that stored id
// across reloads and reopen the right place from the trip panel ("View on map"), including offline from the
// service-worker cache. Flow adapted from Codex's audit pilot (docs/audits/76da929f/offline-saved-stop.cjs on
// branch audit/codex-handoff-20261101). Exit 0 on PASS, 1 on any failed assertion, 2 on a script error.
// Usage: [BASE=https://kamptrail.com] [MOBILE=1] [CHROMIUM_PATH=...] node live-saved-stop-reopen.js
const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'https://kamptrail.com';
const MOBILE = process.env.MOBILE === '1';
const LEGACY = 'ridb:232479', HOST = 'osm:way:1107154601', NAME = 'Cosby Campground';

(async () => {
  const start = new Date().toISOString();
  const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}), args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const record = {start, base: BASE, browser: {executable: process.env.CHROMIUM_PATH || 'playwright bundled', version: browser.version()}, mobile_emulation: MOBILE};
  try {
    const context = await browser.newContext(MOBILE ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true} : {});
    const page = await context.newPage();
    record.viewport_runtime = page.viewportSize();
    await page.addInitScript(([legacy]) => {
      localStorage.setItem('kt_last_position', JSON.stringify({lat: 35.75, lng: -83.21, zoom: 8}));
      if (!sessionStorage.getItem('acceptance-seeded')) { sessionStorage.setItem('acceptance-seeded', '1'); localStorage.setItem('kt_trip', JSON.stringify([{id: legacy, feature: null, note: 'acceptance fixture', arrive: '', depart: ''}])); }
    }, [LEGACY]);
    const ready = () => page.waitForFunction(() => window.KampTrailTrip && window.KampTrailData && KampTrailData.getIdentityStatus?.().hosts === 'published', null, {timeout: 90000});
    const resolved = () => page.waitForFunction(h => KampTrailTrip.getStops()[0]?.feature?.properties.id === h, HOST, {timeout: 90000});
    const snap = () => page.evaluate(() => ({stored: JSON.parse(localStorage.getItem('kt_trip')).map(s => s.id), stops: KampTrailTrip.getStops().map(s => [s.id, s.feature?.properties.id, s.feature?.properties.name]), controlled: !!navigator.serviceWorker.controller, online: navigator.onLine, hosts: KampTrailData.getIdentityStatus().hosts}));
    await page.goto(`${BASE}/?n=${Date.now()}`, {waitUntil: 'domcontentloaded', timeout: 90000});
    await ready();
    record.release = await page.evaluate(async () => (await fetch('/release.json?n=' + Date.now(), {cache: 'no-store'})).json());
    record.version = await page.evaluate(() => KampTrailData.version);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({waitUntil: 'domcontentloaded'}); await ready();
    for (const st of ['NC', 'TN']) await page.evaluate(st => KampTrailData.loadStates([st]), st);
    await resolved();
    record.online = await snap();
    assert.deepEqual(record.online.stored, [LEGACY]);
    assert.deepEqual(record.online.stops, [[LEGACY, HOST, NAME]]);
    assert.equal(record.online.controlled, true, 'service worker controls the page before going offline');
    await context.setOffline(true);
    await page.reload({waitUntil: 'domcontentloaded'}); await ready();
    for (const st of ['TN', 'NC']) await page.evaluate(st => KampTrailData.loadStates([st]), st);
    await resolved();
    await page.locator('#trip').click();
    await page.getByRole('button', {name: 'View on map'}).first().click();
    await page.waitForFunction(n => document.querySelector('.leaflet-popup-content')?.textContent.includes(n), NAME, {timeout: 30000});
    record.offline = await snap();
    record.offline.uncached_fetch_blocked = await page.evaluate(async () => { try { await fetch('/acceptance-network-probe-' + Date.now(), {cache: 'no-store'}); return false; } catch { return true; } });
    assert.equal(record.offline.uncached_fetch_blocked, true, 'network is really offline');
    assert.deepEqual(record.offline.stored, record.online.stored, 'stored id unchanged offline');
    assert.deepEqual(record.offline.stops, record.online.stops, 'same resolution offline');
    record.popup = (await page.locator('.leaflet-popup-content').first().innerText()).slice(0, 300);
    record.result = 'PASS';
    await context.close();
  } catch (e) {
    record.result = 'FAIL'; record.error = e.message; process.exitCode = e instanceof assert.AssertionError ? 1 : 2;
  } finally {
    record.end = new Date().toISOString();
    console.log(JSON.stringify(record, null, 1));
    await browser.close();
  }
})();
