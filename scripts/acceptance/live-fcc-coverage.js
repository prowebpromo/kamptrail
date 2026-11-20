#!/usr/bin/env node
'use strict';
// Read-only acceptance of a deployed coverage release. Feed the independent
// source/raster QA JSON and pre-release test profiles captured on the real site.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = new URL(process.env.BASE || 'https://kamptrail.com/');
const commit = process.env.EXPECTED_SHA;
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const profiles = path.resolve(process.env.QA_PROFILES || 'fcc-profiles');
const old = JSON.parse(fs.readFileSync(path.join(profiles,'baseline.json'), 'utf8'));
const picker = '.kt-coverage-picker select';
const status = '#fcc-coverage-readout [role=status]';
const expectedText = {
  covered:'Map center: modeled coverage.', uncovered:'Map center: no modeled coverage.',
  missing:'Map center: no published data here.', unavailable:'Map center: coverage tile unavailable.'
};
const lookup = new Map(report.checks.filter(c=>c.region==='RI').map(c=>[c.carrier,c]));
const endpoint = url => new URL(url, base).href;
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const browserOptions = { ...(process.env.CHROMIUM_PATH && {executablePath:process.env.CHROMIUM_PATH}),
  args:['--no-sandbox','--disable-dev-shm-usage'] };

async function getJSON(url) {
  const response=await fetch(endpoint(url),{cache:'no-store'});
  assert.ok(response.ok, 'GET ' + url + ' returned ' + response.status);
  return response.json();
}
async function checkRelease() {
  const release=await getJSON('release.json?acceptance='+Date.now());
  assert.equal(release.source_commit,commit,'Live release changed or wrong source commit');
  return release;
}
async function waitForPicker(page) {
  await page.locator(picker).waitFor({state:'attached',timeout:45_000});
}
async function select(page, value) {
  const widget=page.locator(picker);
  if (!await widget.isVisible()) {
    await page.locator('.leaflet-control-layers-toggle').click();
  }
  await widget.selectOption(value);
}
async function setCenter(page, p) {
  await page.evaluate(({lon,lat,zoom}) => window.map.setView([lat,lon],zoom,{animate:false}), p);
}
async function assertStatus(page, value) {
  await page.waitForFunction(([selector,expected]) =>
    document.querySelector(selector)?.textContent === expected,[status,expectedText[value]],{timeout:45_000});
}
async function storedIds(page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id));
}
async function confirmAssets(manifest) {
  assert.equal(report.release,manifest.release);
  assert.equal(report.asOf,manifest.asOf);
  assert.deepEqual([...lookup.keys()].sort(),['att','t-mobile','verizon']);
  const checked=new Set();
  for (const [carrier,c] of lookup) {
    const source=manifest.carriers.find(x=>x.id===carrier).regions.find(r=>r.id==='RI').source;
    assert.equal(source.sha256,c.sourceSHA256);
    assert.equal(String(source.fileId),String(c.fileId));
    for(const w of Object.values(c.witnesses)) {
      if(checked.has(w.tile)) continue;
      const response=await fetch(endpoint('data/fcc-coverage/'+w.tile),{cache:'no-store'});
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-type')||'',/image\/png/i);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())),w.sha256,'Live PNG byte identity: '+w.tile);
      checked.add(w.tile);
    }
  }
  return [...checked];
}
async function upgrade(mode, manifest) {
  const mobile=mode==='mobile';
  const context=await chromium.launchPersistentContext(path.join(profiles,mode), {
    ...browserOptions, viewport:mobile?{width:390,height:844}:{width:1440,height:960},
    isMobile:mobile,hasTouch:mobile,locale:'en-US'
  });
  try {
    const previous=old[mode];
    const page=context.pages()[0]||await context.newPage(), sampled=[];
    await context.setOffline(true);
    await page.goto(endpoint(''),{waitUntil:'domcontentloaded',timeout:60_000});
    assert.deepEqual(await storedIds(page),previous.storedIds,'Pre-update offline profile missing its saved stop');
    const oldCache=await page.evaluate(()=>caches.keys());
    assert.ok(previous.caches.some(key=>/kamptrail:.*kt-v\d+$/.test(key)&&oldCache.includes(key)),'Old shell cache not restored');
    await context.setOffline(false);
    await page.evaluate(async()=>{ const sw=await navigator.serviceWorker.getRegistration(); if(sw) await sw.update(); });
    let upgraded=false;
    for(let attempt=0;attempt<3&&!upgraded;attempt++) {
      await page.goto(endpoint('?acceptance='+Date.now()+'#explore'),{waitUntil:'domcontentloaded',timeout:90_000});
      try {await waitForPicker(page); upgraded=true;} catch(error) {if(attempt===2)throw error;}
    }
    assert.deepEqual(await storedIds(page),previous.storedIds,'Existing saved stop changed during upgrade');
    assert.equal(await page.locator(picker).inputValue(),'','Overlay must start off');
    assert.equal(await page.locator('#fcc-coverage-readout').isVisible(),false);
    assert.deepEqual((await page.locator(picker+' option').evaluateAll(els=>els.map(o=>o.value))).sort(),['','att','t-mobile','verizon']);
    for(const [carrier,c] of lookup) {
      await setCenter(page,c.witnesses.covered);
      await select(page,carrier);
      const coveredResult = await page.locator('#fcc-coverage-readout').innerText();
      assert.match(coveredResult,/4G LTE/); assert.match(coveredResult,/outdoor stationary/i);
      assert.equal(await page.locator('#fcc-coverage-readout a').getAttribute('href'),'https://broadbandmap.fcc.gov/');
      const imagePeriod=manifest.asOf.split('-')[0];
      assert.ok(coveredResult.includes(imagePeriod));
      for(const [expected,w] of Object.entries(c.witnesses)) {
        await setCenter(page,w);
        await assertStatus(page,expected);
        if(expected!=='missing') {
          const uri=endpoint('data/fcc-coverage/'+w.tile);
          await page.waitForFunction(href=>[...document.querySelectorAll('.kt-coverage-tiles img')]
            .some(img=>img.currentSrc===href&&img.complete&&img.naturalWidth===256),uri,{timeout:35_000});
        }
        sampled.push([carrier,expected,w.lon,w.lat]);
      }
    }
    // Return outside the pilot far from Rhode Island.
    await setCenter(page,{lat:42.65,lon:-73.75,zoom:10});
    await assertStatus(page,'missing');
    const first=lookup.get('att').witnesses.covered;
    await setCenter(page,first); await select(page,'att'); await assertStatus(page,'covered');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.waitForFunction(()=>!navigator.onLine && document.querySelector('#fcc-coverage-readout').textContent.includes('Offline copy, not current.'));
    await page.reload({waitUntil:'domcontentloaded',timeout:90_000});
    await waitForPicker(page); await setCenter(page,first); await select(page,'att');
    await assertStatus(page,'covered');
    const offline=await page.locator('#fcc-coverage-readout').innerText();
    assert.match(offline,/Offline copy, not current\./);
    assert.ok(offline.includes(manifest.asOf.slice(0,4)));
    assert.deepEqual(await storedIds(page),previous.storedIds);
    await context.setOffline(false);
    return {mode,previousRelease:previous.source_commit,savedIds:previous.storedIds,
      nativeWitnesses:sampled,offline,reopenedFromPreviousCache:true,mobileEmulation:mobile};
  } finally {await context.close();}
}
async function failureCases(manifest) {
  // Isolated browser contexts only. No responses or settings on the server are modified.
  const browser=await chromium.launch(browserOptions);
  try {
    const result={};
    for (const kind of ['tileFailure','oldFiling','manifestFailure']) {
      const context=await browser.newContext({serviceWorkers:'block',locale:'en-US'});
      try {
        const page=await context.newPage();
        if(kind==='tileFailure') await page.route('**/data/fcc-coverage/**/*.png',r=>r.fulfill({status:503,body:'temporarily unavailable'}));
        if(kind==='oldFiling') await page.clock.setFixedTime(new Date(Date.parse(manifest.asOf+'T00:00:00Z')+400*86400000));
        if(kind==='manifestFailure') await page.route('**/data/fcc-coverage/manifest.json',r=>r.fulfill({status:404,body:''}));
        const observedManifest=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/data/fcc-coverage/manifest.json'));
        await page.goto(endpoint('#explore'),{waitUntil:'domcontentloaded',timeout:90_000});
        await observedManifest;
        if(kind==='manifestFailure'){
          await page.waitForFunction(()=>window.map && window.KampTrailCoverage);
          assert.equal(await page.locator(picker).count(),0);
        }else{
          await waitForPicker(page);
          await setCenter(page,lookup.get('att').witnesses.covered);
          await select(page,'att');
          await assertStatus(page,kind==='tileFailure'?'unavailable':'covered');
          if(kind==='oldFiling') assert.match(await page.locator('#fcc-coverage-readout').innerText(),/Older filing, not current\./);
        }
        result[kind]='passed in isolated browser using forced condition';
      }finally{await context.close();}
    }
    return result;
  }finally{await browser.close();}
}
(async()=>{
  assert.match(commit||'',/^[a-f0-9]{40}$/);
  assert.equal(old.base.replace(/\/$/,''),base.origin);
  assert.equal(report.result,'PASS');
  const release=await checkRelease(),manifest=await getJSON('data/fcc-coverage/manifest.json');
  const assets=await confirmAssets(manifest);
  const runs=[];
  for (const mode of ['desktop','mobile']) runs.push(await upgrade(mode,manifest));
  const controlledFailureCases=await failureCases(manifest);
  await checkRelease();
  assert.equal((await getJSON('data/fcc-coverage/manifest.json')).release,manifest.release);
  const result={result:'PASS',release,dataRelease:manifest.release,filingDate:manifest.asOf,assets,runs,controlledFailureCases};
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
