#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

const origin = new URL(process.env.BASE).origin;
const proof = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const previous = JSON.parse(fs.readFileSync(path.resolve(process.env.QA_PROFILES, 'baseline.json'), 'utf8'));
const base = p => new URL(p, origin + '/').href;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pause = process.env.QA_MODE === 'production' ? 2500 : 250;
const states = [...new Set(proof.archiveChecks.map(row=>row.state))].sort();
const carriers = ['att','t-mobile','verizon'];
const expected = {covered:'Map center: modeled coverage.', uncovered:'Map center: no modeled coverage.',
  missing:'Map center: no published data here.', unavailable:'Map center: coverage tile unavailable.'};
const picker = '.kt-coverage-picker select';
const status = '#fcc-coverage-readout [role=status]';
const launch = {executablePath:process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args:['--no-sandbox','--disable-dev-shm-usage']};
const coordsOutside = {lat:61.2181,lon:-149.9003,zoom:10};
const legacyRelease = 'b7f7cc41c26c82ec6b3245ccd9b933d1c97f3d69';

async function saved(page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id));
}
async function move(page,point) {
  await page.evaluate(({lat,lon,zoom})=>{
    const map=window.map;
    map.stop();
    map.setView([lat,lon],zoom,{animate:false,reset:true});
    if (!map.project(map.getCenter(),zoom).floor().equals(map.project([lat,lon],zoom).floor())) {
      throw Error('Browser sample did not reach the requested native pixel');
    }
  },point);
}
async function select(page,carrier) {
  const control = page.locator(picker);
  if (!await control.isVisible()) await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await control.selectOption(carrier);
}
async function renderedStatus(page,point) {
  return page.evaluate(({lat,lon,zoom})=>{
    const map=window.map, box=map.getContainer().getBoundingClientRect();
    const view=map.latLngToContainerPoint([lat,lon]);
    const x=box.left+view.x, y=box.top+view.y;
    const native=map.project([lat,lon],zoom).floor();
    const px=((native.x%256)+256)%256, py=((native.y%256)+256)%256;
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true}), values=[];
    for(const img of document.querySelectorAll('.kt-coverage-tiles img')){
      if(!img.complete || img.naturalWidth!==256 || !img.isConnected) continue;
      const b=img.getBoundingClientRect();
      if(x<b.left||x>=b.right||y<b.top||y>=b.bottom) continue;
      if(!img.currentSrc.startsWith('blob:')) continue;
      ctx.clearRect(0,0,1,1);
      ctx.drawImage(img,px,py,1,1,0,0,1,1);
      const rgba=[...ctx.getImageData(0,0,1,1).data];
      if(!rgba[3]) values.push('missing');
      else if(rgba.join(',')==='24,96,176,255') values.push('covered');
      else if(rgba.join(',')==='112,112,112,255') values.push('uncovered');
      else return 'unknown-palette-'+rgba;
    }
    return values.includes('covered')?'covered':values.includes('uncovered')?'uncovered':'missing';
  },point);
}
async function onlineUpgrade(page,context) {
  await context.setOffline(false);
  for (let attempt=0; attempt<3; attempt++) {
    await page.goto(base('?acceptance='+Date.now()+'#explore'),{waitUntil:'domcontentloaded',timeout:90000});
    try {
      await page.waitForFunction(async ()=>window.KampTrailData?.version==='2.50.0' && navigator.serviceWorker.controller &&
        (await caches.keys()).some(key=>key.startsWith('kamptrail:')&&key.endsWith('kt-v95')),null,{timeout:50000});
      await page.locator(picker).waitFor({state:'attached',timeout:30000});
      return;
    } catch (error) { if (attempt===2) throw error; }
  }
}
function observe(context) {
  const responses = [], errors = [], png = [], rateLimited = [];
  context.on('response',response=>{
    const url=new URL(response.url()), headers=response.headers();
    if(url.origin!==origin) return;
    if(response.status()===429) rateLimited.push(url.pathname);
    if(!url.pathname.startsWith('/data/fcc-coverage/')) return;
    if(url.pathname.endsWith('.png')) png.push(url.pathname);
    if(!url.pathname.endsWith('.pmtiles')) return;
    const value=headers['content-range']||'', match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(value);
    if(response.status()!==206 || !match || Number(headers['content-length'])!==+match[2]-+match[1]+1
      || (headers['content-encoding'] && headers['content-encoding']!=='identity')) {
      errors.push([url.pathname,response.status(),value]);
    }
    responses.push({url:url.pathname,bytes:Number(headers['content-length']||0),range:value});
  });
  return {responses,errors,png,rateLimited};
}
async function inspect(mode) {
  const mobile = mode==='mobile', old=previous[mode];
  assert.equal(old.clientVersion,'2.49.0'); assert.equal(old.source_commit,legacyRelease);
  const context = await chromium.launchPersistentContext(path.resolve(process.env.QA_PROFILES,mode),
    {...launch, viewport: mobile?{width:390,height:844}:{width:1440,height:960}, isMobile:mobile,hasTouch:mobile,locale:'en-US'});
  const observations=observe(context);
  try {
    const page=context.pages()[0]||await context.newPage();
    const result=[], regionsChecked = new Set();
    await context.setOffline(true);
    await page.goto(base('/'),{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.KampTrailData?.version==='2.49.0',null,{timeout:45000});
    assert.deepEqual(await saved(page),old.storedIds,'The original saved visit must be present before upgrade');
    await onlineUpgrade(page,context);
    assert.deepEqual(await saved(page),old.storedIds,'Saved stops must survive the returning visitor upgrade');
    const control=page.locator(picker);
    assert.equal(await control.inputValue(),'');
    assert.deepEqual((await control.locator('option').evaluateAll(opts=>opts.map(o=>o.value))).sort(),['',...carriers]);
    await move(page,coordsOutside);
    for(const carrier of carriers) {
      await select(page,carrier);
      const areas=page.getByRole('combobox',{name:'Published coverage area'});
      assert.deepEqual((await areas.locator('option').evaluateAll(opts=>opts.map(o=>o.value).filter(Boolean))).sort(),states);
      await expect(page.locator(status)).toHaveText(expected.missing,{timeout:30000});
      regionsChecked.add(carrier);
    }
    await delay(pause);
    assert.equal(observations.responses.length,0,'Activating in Alaska must not eagerly fetch any of the 144 archives');
    let active='', jumped=false;
    for(const s of proof.browserSamples) {
      await delay(pause);
      await move(page,s);
      if(active!==s.carrier) {await select(page,s.carrier); active=s.carrier;}
      if(!jumped && s.state==='NY'){
        const area=page.getByRole('combobox',{name:'Published coverage area'});
        const target=await page.evaluate(r=>{
          const [w,s,e,n]=r.bounds, bounds=L.latLngBounds([s,w],[n,e]);
          return {lat:(s+n)/2, lon:(e+w)/2, zoom:Math.max(r.minZoom,Math.min(r.maxZoom,map.getBoundsZoom(bounds,false,[30,30])))};
        },proof.navigationRegion);
        await area.selectOption('NY');
        await page.waitForFunction(({lat,lon,zoom})=>{
          const p=map.project(map.getCenter(),zoom), dest=map.project([lat,lon],zoom);
          return map.getZoom()===zoom && !map._animatingZoom && !map._panAnim?._inProgress && Math.abs(p.x-dest.x)<2 && Math.abs(p.y-dest.y)<2;
        },target,{timeout:20000});
        jumped=true;
        await move(page,s);
      }
      try {
        await expect(page.locator(status)).toHaveText(expected[s.expected],{timeout:35000});
        if(s.expected!=='missing') await expect.poll(()=>renderedStatus(page,s),{timeout:30000}).toBe(s.expected);
      } catch(error) {
        throw Error('Coverage disagreement '+JSON.stringify(s)+'; observed '+await page.locator(status).textContent(),{cause:error});
      }
      result.push(s);
    }
    assert.ok(jumped,'The normal area picker must move the map');
    assert.equal(regionsChecked.size,3);
    const anchor=proof.browserSamples.find(s=>s.state==='RI'&&s.carrier==='att'&&s.expected==='covered');
    assert.ok(anchor); await move(page,anchor); await select(page,'att');
    await expect(page.locator(status)).toHaveText(expected.covered,{timeout:35000});
    const note=page.locator('#fcc-coverage-readout');
    await expect(note).toContainText(/4G LTE/i);
    await expect(note).toContainText(/outdoor stationary/i);
    assert.equal(await note.locator('a[href="https://broadbandmap.fcc.gov/"]').count(),1);
    const filing=new Date(proof.asOf+'T00:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC'});
    await expect(note).toContainText(filing);
    await context.setOffline(true);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    await page.locator(picker).waitFor({state:'attached',timeout:30000});
    await move(page,anchor); await select(page,'att');
    await expect(page.locator(status)).toHaveText(expected.covered,{timeout:35000});
    await expect(note).toContainText(/Offline copy, not current/i); await expect(note).toContainText(filing);
    assert.deepEqual(await saved(page),old.storedIds);
    await move(page,proof.unvisitedOfflineWitness); await select(page,proof.unvisitedOfflineWitness.carrier);
    await expect(page.locator(status)).toHaveText(expected.unavailable,{timeout:35000});
    await select(page,'');
    await context.setOffline(false);
    await page.evaluate(async()=>KampTrailData.loadStates(['RI']));
    await page.locator('#trip').click();
    const drawer=page.locator('#kt-trip-drawer');
    await drawer.waitFor({state:'visible'});
    await drawer.getByRole('button',{name:'View on map'}).first().click();
    await expect(page.locator('.leaflet-popup-content')).toContainText(old.savedPlace.name,{timeout:30000});
    assert.deepEqual(await saved(page),[old.savedPlace.id]);
    assert.ok(observations.responses.length>0); assert.deepEqual(observations.errors,[]);
    assert.deepEqual(observations.png,[],'Schema 2 browser should use the packed data');
    return {mode,mobileEmulation:mobile,reopenedPlace:old.savedPlace,previousVersion:old.clientVersion,currentVersion:'2.50.0',
      dataRelease:proof.generation,selectionMatrix:states.length*regionsChecked.size,outOfScopeRequests:0,samples:result,
      rangeResponses:observations.responses.length,transferredRangeBytes:observations.responses.reduce((n,r)=>n+r.bytes,0),
      distinctArchivesLoaded:[...new Set(observations.responses.map(r=>r.url))].length,areaPickerNavigatedTo:'NY',
      observed429s:observations.rateLimited,offlineFiling:filing,uncachedOfflineState:proof.unvisitedOfflineWitness.state};
  } finally {await context.close();}
}
async function controlledFailures() {
  const browser=await chromium.launch(launch), result={};
  const point=proof.browserSamples.find(s=>s.state==='RI'&&s.carrier==='att'&&s.expected==='covered');
  try {
    for(const kind of ['archiveOutage','olderFiling','packedPointerOutage']) {
      const context=await browser.newContext({serviceWorkers:'block',locale:'en-US'});
      try {
        const page=await context.newPage();
        if(kind==='archiveOutage') await page.route('**/*.pmtiles*',route=>route.fulfill({status:503,body:'fixture outage'}));
        if(kind==='olderFiling') await page.clock.setFixedTime(new Date(Date.parse(proof.asOf+'T00:00:00Z')+400*86400000));
        if(kind==='packedPointerOutage') await page.route('**/manifest-v2.json*',route=>route.fulfill({status:404,body:'fixture unavailable'}));
        await page.goto(base('?qa-controlled='+kind+'#explore'),{waitUntil:'domcontentloaded',timeout:90000});
        await page.locator(picker).waitFor({state:'attached',timeout:45000});
        await move(page,point); await select(page,'att');
        if(kind==='packedPointerOutage') {
          const values=await page.getByRole('combobox',{name:'Published coverage area'}).locator('option').evaluateAll(els=>els.map(el=>el.value).filter(Boolean).sort());
          assert.deepEqual(values,['NY','RI']);
        } else {
          await expect(page.locator(status)).toHaveText(expected[kind==='archiveOutage'?'unavailable':'covered'],{timeout:35000});
          if(kind==='olderFiling') await expect(page.locator('#fcc-coverage-readout')).toContainText('Older filing, not current.');
        }
        result[kind]='passed in isolated browser under a forced condition';
      } finally {await context.close();}
      await delay(2*pause);
    }
  } finally {await browser.close();}
  return result;
}
async function main(){
  assert.equal(proof.result,'PASS');assert.equal(proof.archiveCount,144);
  assert.equal(previous.base.replace(/\/$/,''),origin);
  const runs=[];
  for(const mode of ['desktop','mobile']) {
    if(process.env.QA_MODE==='production') await delay(45000);
    runs.push(await inspect(mode));
  }
  const controlled=await controlledFailures();
  const marker=await (await fetch(base('release.json?qa='+Date.now()),{cache:'no-store'})).json();
  const manifest=await (await fetch(base('data/fcc-coverage/manifest-v2.json?qa='+Date.now()),{cache:'no-store'})).json();
  assert.equal(marker.source_commit,proof.commit);assert.equal(manifest.release,proof.generation);
  const evidence={result:'PASS',mode:process.env.QA_MODE,sourceCommit:marker.source_commit,generation:manifest.release,asOf:proof.asOf,
    aggregate: {archives:proof.archiveCount,rangeResponses:proof.rangeResponses,archiveBytes:proof.archiveBytes,comparison:proof.priorQualification},
    runs,controlled};
  fs.writeFileSync(process.argv[3],JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence));
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={move,renderedStatus,onlineUpgrade,select,saved,observe,launch,expected};
