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
const report = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
const profiles = path.resolve(process.env.QA_PROFILES || 'fcc-profiles');
const old = JSON.parse(fs.readFileSync(path.join(profiles,'baseline.json'), 'utf8'));
const picker = '.kt-coverage-picker select';
const status = '#fcc-coverage-readout [role=status]';
const expectedText = {
  covered:'Map center: modeled coverage.', uncovered:'Map center: no modeled coverage.',
  missing:'Map center: no published data here.', unavailable:'Map center: coverage tile unavailable.'
};
const requiredRegions = (process.env.EXPECTED_REGIONS || 'RI').split(',').sort();
const sources = (report?.checks || []).filter(c=>requiredRegions.includes(c.region));
const anchor = () => sources.find(c=>c.region==='RI' && c.carrier==='att').witnesses.covered;
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
  await page.evaluate(({lon,lat,zoom}) => {
    window.map.stop();
    window.map.setView([lat,lon],zoom,{animate:false,reset:true});
    const actual=window.map.project(window.map.getCenter(),zoom).floor();
    const expected=window.map.project([lat,lon],zoom).floor();
    if(!actual.equals(expected)) throw Error('Coverage sample moved to another native pixel');
  }, p);
  await waitForMove(page,p,'source witness');
}
async function waitForMove(page, target, action) {
  try {
    await page.waitForFunction(({lon,lat,zoom})=>{
      const actual=map.project(map.getCenter(),zoom), desired=map.project([lat,lon],zoom);
      return map.getZoom()===zoom && !map._animatingZoom && !map._panAnim?._inProgress &&
        Math.abs(actual.x-desired.x)<=1.1 && Math.abs(actual.y-desired.y)<=1.1;
    },target,{timeout:12_000});
  } catch(error) {
    const current=await page.evaluate(()=>({center:map.getCenter(),zoom:map.getZoom(),moving:!!map._animatingZoom,
      panning:!!map._panAnim?._inProgress,selected:document.querySelector('.kt-coverage-picker select')?.value,
      readout:document.querySelector('#fcc-coverage-readout')?.textContent}));
    throw Error('Map navigation mismatch '+JSON.stringify({action,target,current}),{cause:error});
  }
}
async function assertStatus(page, value) {
  await page.waitForFunction(([selector,expected]) =>
    document.querySelector(selector)?.textContent === expected,[status,expectedText[value]],{timeout:45_000});
}
async function combinedAt(page, manifest, carrier, witness) {
  return page.evaluate(async ({manifest,carrier,w})=>{
    const entries=[];
    for(const r of manifest.carriers.find(c=>c.id===carrier).regions){
      const [west,south,east,north]=r.bounds;
      if(w.lon<west||w.lon>east||w.lat<south||w.lat>north) continue;
      const z=Math.min(w.zoom,r.maxZoom), size=256*2**z, lat=w.lat*Math.PI/180;
      const px=Math.floor((w.lon+180)/360*size),py=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*size);
      const path=[manifest.release,carrier,r.id,z,Math.floor(px/256),Math.floor(py/256)+'.png'].join('/');
      const response=await fetch(new URL('data/fcc-coverage/'+path,document.baseURI));
      if(!response.ok) throw Error('Missing expected published tile: '+path);
      const bmp=await createImageBitmap(await response.blob()),canvas=document.createElement('canvas');
      canvas.width=canvas.height=1;
      const cx=canvas.getContext('2d');
      cx.drawImage(bmp,px%256,py%256,1,1,0,0,1,1);bmp.close();
      const rgba=[...cx.getImageData(0,0,1,1).data];
      let state='invalid';
      if(rgba[3]===0) state='missing';
      if(rgba.join(',')==='24,96,176,255') state='covered';
      if(rgba.join(',')==='112,112,112,255') state='uncovered';
      if(state==='invalid') throw Error('Unknown pixel palette '+path+' '+rgba);
      entries.push({region:r.id,state,path});
    }
    return {entries,expected:entries.some(e=>e.state==='covered')?'covered':entries.some(e=>e.state==='uncovered')?'uncovered':'missing'};
  },{manifest,carrier,w:witness});
}
async function storedIds(page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id));
}
async function confirmAssets(manifest) {
  assert.equal(report.release,manifest.release);
  assert.equal(report.asOf,manifest.asOf);
  const pairs = requiredRegions.flatMap(r=>['att','t-mobile','verizon'].map(c=>r+'/'+c));
  assert.deepEqual(sources.map(c=>c.region+'/'+c.carrier).sort(),pairs.sort());
  assert.deepEqual([...new Set(manifest.carriers.flatMap(c=>c.regions.map(r=>r.id)))].sort(),requiredRegions);
  const checked=new Set();
  for (const c of sources) {
    const carrier=c.carrier;
    const source=manifest.carriers.find(x=>x.id===carrier).regions.find(r=>r.id===c.region).source;
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
    if (process.env.BASELINE_ONLY === '1') {
      return {mode,source_commit: previous.source_commit,savedIds:previous.storedIds,cacheVerifiedOffline:true};
    }
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
    for(const c of sources) {
      const carrier=c.carrier;
      await setCenter(page,c.witnesses.covered);
      await select(page,carrier);
      const areaWidget=page.getByRole('combobox',{name:'Published coverage area'});
      const availableRegions=await areaWidget.locator('option').evaluateAll(es=>es.map(e=>e.value).filter(Boolean).sort());
      assert.deepEqual(availableRegions,requiredRegions,'Published area choices');
      const region=manifest.carriers.find(p=>p.id===carrier).regions.find(r=>r.id===c.region);
      const intended=await page.evaluate(r=>{
        const [w,s,e,n]=r.bounds,b=L.latLngBounds([s,w],[n,e]);
        return {lat:(s+n)/2,lon:(e+w)/2,
          zoom:Math.max(r.minZoom,Math.min(r.maxZoom,map.getBoundsZoom(b,false,[30,30])))};
      },region);
      await areaWidget.selectOption(c.region);
      await waitForMove(page,intended,'published area '+c.region);
      console.error('Verified region navigation', mode,carrier,c.region,intended);
      await setCenter(page,c.witnesses.covered);
      const coveredResult = await page.locator('#fcc-coverage-readout').innerText();
      assert.match(coveredResult,/4G LTE/); assert.match(coveredResult,/outdoor stationary/i);
      assert.equal(await page.locator('#fcc-coverage-readout a').getAttribute('href'),'https://broadbandmap.fcc.gov/');
      const filing = new Date(manifest.asOf+'T00:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC'});
      assert.ok(coveredResult.includes(filing)||coveredResult.includes(manifest.asOf),'Correct FCC filing date for selected carrier');
      for(const [expected,w] of Object.entries(c.witnesses)) {
        await setCenter(page,w);
        const joint=await combinedAt(page,manifest,carrier,w);
        const native=joint.entries.find(e=>e.region===c.region)?.state || 'missing';
        assert.equal(native,expected,'Source witness no longer matches original region at '+JSON.stringify(w));
        try { await assertStatus(page,joint.expected); }
        catch(error) {
          const ui=await page.evaluate(({selector,zoom})=>({status:document.querySelector(selector)?.textContent,
            center:map.getCenter(),projectedCenter:map.project(map.getCenter(),zoom),zoom:map.getZoom(),
            images:[...document.querySelectorAll('.kt-coverage-tiles img')].map(i=>[i.src,i.naturalWidth])}),{selector:status,zoom:w.zoom});
          throw Error('Coverage disagreement '+JSON.stringify({mode,region:c.region,carrier,expected,w,joint,ui}),{cause:error});
        }
        if(expected!=='missing') {
          const uri=endpoint('data/fcc-coverage/'+w.tile);
          await page.waitForFunction(href=>[...document.querySelectorAll('.kt-coverage-tiles img')]
            .some(img=>img.currentSrc===href&&img.complete&&img.naturalWidth===256),uri,{timeout:35_000});
        }
        sampled.push([c.region,carrier,expected,w.lon,w.lat,joint.expected,joint.entries.map(e=>[e.region,e.state])]);
      }
    }
    // Quebec City lies beyond both qualified U.S. state boundaries.
    await setCenter(page,{lat:46.82,lon:-71.22,zoom:10});
    await assertStatus(page,'missing');
    const first=anchor();
    await setCenter(page,first); await select(page,'att'); await assertStatus(page,'covered');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.waitForFunction(()=>!navigator.onLine && document.querySelector('#fcc-coverage-readout').textContent.includes('Offline copy, not current.'));
    await page.reload({waitUntil:'domcontentloaded',timeout:90_000});
    await waitForPicker(page); await setCenter(page,first); await select(page,'att');
    await assertStatus(page,'covered');
    const offline=await page.locator('#fcc-coverage-readout').innerText();
    assert.match(offline,/Offline copy, not current\./);
    const filing = new Date(manifest.asOf+'T00:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC'});
    assert.ok(offline.includes(filing)||offline.includes(manifest.asOf),'Correct filing date remains visible offline');
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
          await setCenter(page,anchor());
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
  if (process.env.BASELINE_ONLY === '1') {
    const modes=[];
    for (const mode of ['desktop','mobile']) modes.push(await upgrade(mode,null));
    console.log(JSON.stringify({result:'PASS',scope:'offline baseline restoration',modes},null,2));
    return;
  }
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
  const result={result:'PASS',release,dataRelease:manifest.release,filingDate:manifest.asOf,sourceChecks:report.checks,assets,runs,controlledFailureCases};
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
