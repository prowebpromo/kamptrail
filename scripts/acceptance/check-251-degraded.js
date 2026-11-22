'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
  const alias='osm:way:1054896883',host='osm:relation:21141431';
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage();
    await p.route('**/data/campsites/identity-hosts.json',r=>r.abort());
    const base='http://127.0.0.1:8764';await p.goto(base+'/?source=pwa#site='+alias,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>!!window.KampTrailMapDataReady,null,{timeout:45000});
    await p.evaluate(()=>window.KampTrailMapDataReady);
    if(require('../../visitor-source.json').sha==='9404c8997e62b498b48b69df8fa1e86b15e1e530') await p.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('could not be found'),null,{timeout:20000});
    else await p.locator('.leaflet-popup-content [data-kt-action=trip][data-siteid="'+host+'"]').waitFor({timeout:35000});
    const facts=await p.evaluate(async({alias,host})=>{
      const resolved=await KampTrailData.resolveListing(alias);
      return {identity:KampTrailData.getIdentityStatus().hosts, resolved:resolved.feature?.properties.id, name:resolved.feature?.properties.name, synchronous:KampTrailData.getCampsiteById(alias)?.properties.id||null, hash:location.hash, activePopup:!!document.querySelector('.leaflet-popup-content [data-kt-action=trip][data-siteid="'+host+'"]'),message:document.querySelector('#toast')?.textContent||''};
    },{alias,host});
    assert.equal(facts.resolved,host);assert.equal(facts.identity,'fallback');assert.equal(facts.hash,'#site='+alias);
    await fs.mkdir('visitor-result',{recursive:true});await fs.writeFile('visitor-result/missing-identity.json',JSON.stringify(facts,null,2));console.log('Missing identity-hosts outcome',JSON.stringify(facts));
    if(require('../../visitor-source.json').sha==='9404c8997e62b498b48b69df8fa1e86b15e1e530') {assert.equal(facts.activePopup,false);assert.equal(facts.synchronous,null);}
    else {assert.equal(facts.activePopup,true);assert.equal(facts.synchronous,host);}
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});