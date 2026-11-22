'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium,expect} = require('@playwright/test');
const out=path.resolve('visitor-result');
const old='osm:node:12791039600', current='osm:way:1582003341', resort='Odetah Camping Resort', recovered='ridb:10069432';
const expectedStates='AL AZ AR CA CO CT DE FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ').sort();
const carriers=['att','t-mobile','verizon'];
const note='Saved clubhouse entrance from earlier trip';
const mode=process.env.QA_MODE;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const popup=p=>p.locator('.leaflet-popup-content');
const saveAt=(p,id)=>popup(p).locator('[data-kt-action=trip][data-siteid="'+id+'"]');
const hash=s=>'#site='+s;
const local='http://127.0.0.1:8763', target=mode==='production'?'https://kamptrail.com':'http://127.0.0.1:8764';
const expected=require('../../visitor-source.json');
const {sites,redirects}=require('../../candidate/data/campsites/search-index.json');
const alias='osm:way:1054896883', host='osm:relation:21141431';
assert.equal(redirects[alias],host);
const before=require('../../previous/data/campsites/identity-hosts.json');assert.ok(before.hosts[host].includes(alias));
const destination=sites.find(site=>site.id===host);assert.ok(destination);assert.ok(!destination.legacy_ids.includes(alias));
const row=sites.find(s=>s.id===recovered || s.legacy_ids.includes(recovered));
assert.match(row.name,/Kiwanis Campground/i);
assert.deepEqual(sites.filter(s=>s.name.toLowerCase()===resort.toLowerCase()).map(s=>s.id),[current]);
const hist=require('../../candidate/data/campsites/withdrawn.json').listings.find(s=>s.id===old);
assert.equal(hist.reason,'source_absent_latest_feed');
const args={executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']};
const options=mobile=>mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:960}};
async function start(page,base,id,version,sha){
  await page.goto(base+'/?source=pwa'+(id?hash(id):'#explore'),{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(v=>window.KampTrailData?.version===v&&window.KampTrailTrip&&window.map,version,{timeout:85000});
  const stamp=await page.evaluate(async()=>{ const r=await fetch('/release.json',{cache:'no-store'}); if(!r.ok)throw Error('release '+r.status);return r.json(); });
  assert.equal(stamp.source_commit,sha);
}
async function prior(browser,mobile,label){
  const c=await browser.newContext(options(mobile)), p=await c.newPage();
  try {
    await start(p,local,old,'2.50.0','44643b2ce90a51e59e02d366a592a652feef9737');
    await expect(popup(p)).toContainText(resort,{timeout:85000});
    await saveAt(p,old).click({timeout:35000});
    const item=p.locator('#kt-trip-list .kt-saved-stop');
    await expect(item).toContainText(resort);
    await item.locator('.kt-stop-details summary').click();
    await item.getByLabel('Arrive',{exact:true}).fill('2026-12-01');
    await item.getByLabel('Leave',{exact:true}).fill('2026-12-03');
    await item.locator('textarea').fill(note);
    await item.locator('textarea').blur();
    const download=p.waitForEvent('download');
    await p.locator('#kt-trip-backup-json-export').click();
    const file=path.join(out,label+'-2.50-backup.json');
    await (await download).saveAs(file);
    const backup=JSON.parse(await fs.readFile(file));
    assert.equal(backup.stops.length,1);
    const [stop]=backup.stops;
    assert.equal(stop.id,old);assert.equal(stop.feature.properties.id,old);assert.equal(stop.feature.properties.name,resort);
    assert.deepEqual([stop.note,stop.arrive,stop.depart],[note,'2026-12-01','2026-12-03']);
    return {file,backup};
  } finally {await c.close();}
}
async function lookup(page,name,id) {
  const input=page.locator('#destination');
  await input.fill(name);await input.press('Enter');
  const result=page.locator('#search-results').getByRole('button',{name:name+' · Campsite',exact:true});
  await Promise.race([saveAt(page,id).waitFor({timeout:65000}),result.first().waitFor({timeout:65000})]);
  if(!await saveAt(page,id).isVisible()) await result.first().click();
  await expect(saveAt(page,id)).toBeVisible({timeout:65000});await expect(popup(page)).toContainText(name);
}
async function check(browser,mobile,label){
  const oldExport=await prior(browser,mobile,label);
  const c=await browser.newContext(options(mobile)), p=await c.newPage();
  const issues=[], ranges=[], screenshots=[];
  p.on('response',r=>{const url=new URL(r.url());if(url.origin===target&&r.status()>=400)issues.push({path:url.pathname,status:r.status(),retryAfter:r.headers()['retry-after']||null});});
  p.on('request',r=>{if(/\.pmtiles(?:$|\?)/.test(r.url()))ranges.push(r.url());});
  const shot=async name=>{const file=label+'-'+name+'.png';await p.screenshot({path:path.join(out,file)});screenshots.push(file);};
  try {
    await start(p,target,null,'2.51.0',expected.sha);
    await p.locator('#trip').click();
    await expect(p.locator('#kt-trip-list')).toContainText('No saved stops yet');
    await p.locator('#kt-trip-backup-json-file').setInputFiles(oldExport.file);
    const item=p.locator('#kt-trip-list .kt-saved-stop');
    await expect(item).toContainText(resort);
    await expect(item.locator('.kt-saved-history')).toContainText('Historical listing',{timeout:85000});
    await item.getByRole('button',{name:'View on map',exact:true}).click();
    const archive=p.locator('.kt-historical-listing');
    const archived=async()=>{
      await expect(archive).toContainText('Original listing ID: '+old,{timeout:65000});
      await expect(archive).toContainText('This listing was absent from the latest source feed.');
      await expect(archive).toContainText('Current status is unverified.');
      await expect(archive).toContainText(hist.archived_at);
      await expect(archive).toContainText(hist.source_dates[0].retrieved_at);
      await expect(archive.locator('a').first()).toHaveAttribute('href',hist.source_urls[0].url);
    };
    await archived();await shot('reopened-historical');
    await archive.getByRole('button',{name:'Close historical listing'}).click();await expect(archive).toHaveCount(0);
    await p.goto(target+'/?source=pwa'+hash(old),{waitUntil:'domcontentloaded'});
    await archived();assert.equal(new URL(p.url()).hash,hash(old));
    await archive.getByRole('button',{name:'Close historical listing'}).click();await expect(archive).toHaveCount(0);
    await lookup(p,resort,current);await shot('current-search');
    const index=await p.evaluate(async(id)=>{
      const index=await KampTrailData.loadSearchIndex();
      return {oldDiscoverable:index.sites.some(s=>s.id===id||s.legacy_ids?.includes(id)),matches:index.sites.filter(s=>s.name==='Odetah Camping Resort').map(s=>s.id)};
    },old);
    assert.deepEqual(index,{oldDiscoverable:false,matches:[current]});
    await p.goto(target+'/?source=pwa'+hash(recovered),{waitUntil:'domcontentloaded'});
    await expect(saveAt(p,row.id)).toBeVisible({timeout:85000});
    await expect(popup(p)).toContainText(row.name);
    assert.equal(new URL(p.url()).hash,hash(recovered));await shot('recovered-kiwanis');
    await p.goto(target+'/?source=pwa'+hash(alias),{waitUntil:'domcontentloaded'});
    await expect(saveAt(p,host)).toBeVisible({timeout:85000});await expect(popup(p)).toContainText(destination.name);
    assert.equal(new URL(p.url()).hash,hash(alias));await shot('preserved-legacy-link');
    const coast=p.locator('#destination');await coast.fill('-10, -140');await coast.press('Enter');
    await p.waitForFunction(()=>Math.abs(map.getCenter().lat+10)<0.01&&Math.abs(map.getCenter().lng+140)<0.01,null,{timeout:30000});
    const control=p.getByRole('combobox',{name:'FCC mobile coverage'}), area=p.getByRole('combobox',{name:'Published coverage area'});
    if(!await control.isVisible())await p.getByRole('button',{name:'Map layers',exact:true}).click();
    assert.deepEqual((await control.locator('option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean))).sort(),carriers);
    const menus={};for(const carrier of carriers){
      await control.selectOption(carrier);
      await expect(area.locator('option')).toHaveCount(49,{timeout:35000});
      const choices=(await area.locator('option').evaluateAll(opts=>opts.map(o=>o.value).filter(Boolean))).sort();
      assert.deepEqual(choices,expectedStates);menus[carrier]=choices.length;
    }
    await shot('carrier-menu');await control.selectOption('');
    assert.equal(ranges.length,0,'No FCC archive requests needed for off-footprint menu verification');
    const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')));
    assert.deepEqual(saved,oldExport.backup.stops,'Exact prior saved snapshot, ID, user note and dates survived all lookups');
    const receipt={mode,base:target,sha:expected.sha,version:'2.51.0',viewport:p.viewportSize(),savedVia:'2.50.0 popup, local JSON backup, 2.51.0 trip drawer',savedExactId:saved[0].id,archiveReason:hist.reason,archiveDate:hist.archived_at,sourceDate:hist.source_dates[0].retrieved_at,currentSearchMatch:{id:current,name:resort},recovered:{request:recovered,canonical:row.id,name:row.name},legacyShortcut:{priorAlias:alias,activeHost:host,name:destination.name},menus,requestedCoverageArchives:ranges.length,screenshots,issues};
    console.log(JSON.stringify(receipt,null,2));await fs.writeFile(path.join(out,label+'.json'),JSON.stringify(receipt,null,2));
  } catch(e){console.error(label,'URL',p.url(),'HTTP',JSON.stringify(issues.slice(-14)), 'BODY', (await p.locator('body').innerText().catch(()=>'' )).slice(-1200));await shot('failure').catch(()=>{});throw e;}finally{await c.close();}
}
(async()=>{await fs.mkdir(out,{recursive:true});const browser=await chromium.launch(args);
try{await check(browser,false,'desktop');if(mode==='production')await sleep(65000);await check(browser,true,'mobile');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});