#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.BASE || 'https://kamptrail.com';
const dir = path.resolve(process.env.QA_PROFILES || 'fcc-profiles');

async function capture(mode) {
  const mobile = mode === 'mobile';
  const context = await chromium.launchPersistentContext(path.join(dir, mode), {
    ...(process.env.CHROMIUM_PATH && {executablePath: process.env.CHROMIUM_PATH}),
    viewport: mobile ? {width:390,height:844} : {width:1440,height:960},
    isMobile: mobile, hasTouch: mobile, args:['--no-sandbox','--disable-dev-shm-usage']
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(base + '/#explore', {waitUntil:'domcontentloaded', timeout:90_000});
    await page.waitForFunction(() => window.map && window.KampTrailTrip && window.KampTrailData, null, {timeout:100_000});
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, {timeout:90_000});
    const info = await page.evaluate(async () => {
      const response = await fetch('/release.json?qa=' + Date.now(), {cache:'no-store'});
      const release = await response.json();
      await KampTrailData.loadStates(['RI']);
      const source = KampTrailData.getAllCampsites().find(s => {
        const p=s.geometry?.coordinates;
        return s.properties?.id && p && p[0] > -71.85 && p[0] < -71.22 && p[1] > 41.33 && p[1] < 42;
      });
      if (!source) throw Error('No Rhode Island campsite available for baseline saved stop.');
      KampTrailTrip.addStop(source.properties.id);
      map.setView([41.65,-71.5],9,{animate:false});
      return {source_commit: release.source_commit,storedIds: JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id),
        caches: await caches.keys(),clientVersion: String(KampTrailData.version),worker: navigator.serviceWorker.controller.scriptURL,
        pickerPresent: !!document.querySelector('.kt-coverage-picker select')};
    });
    assert.match(info.source_commit,/^[0-9a-f]{40}$/);
    assert.equal(info.storedIds.length, 1);
    assert.ok(info.caches.some(n=>n.includes('kamptrail:')));
    await context.clearCookies();
    return info;
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(dir, {recursive:true});
  const desktop = await capture('desktop');
  const mobile = await capture('mobile');
  assert.equal(desktop.source_commit, mobile.source_commit, 'same pre-release build');
  const record = {base,at:new Date().toISOString(),desktop,mobile};
  fs.writeFileSync(path.join(dir,'baseline.json'), JSON.stringify(record,null,2));
  process.stdout.write(JSON.stringify(record,null,2)+'\n');
})().catch(e => { console.error(e); process.exitCode=1; });
