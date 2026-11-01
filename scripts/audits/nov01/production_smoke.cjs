'use strict';
// Read-only production check for the Nov 1 maintenance changes. Takes the expected deployment SHA.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const url = 'https://kamptrail.com/';
const expectedIndex = '83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a';

async function verify(browser, mobile, expected) {
  const viewport = mobile ? {width:390,height:844} : {width:1440,height:900};
  const context = await browser.newContext({viewport, isMobile:mobile, hasTouch:mobile, serviceWorkers:'block'});
  // Use the runtime's trusted CA bundle for the live origin when the Chromium
  // distribution lacks its own trust-store entry for the workspace HTTPS proxy.
  if (process.env.KT_SYSTEM_TLS_FETCH === '1') {
    await context.route('https://kamptrail.com/**', async route => {
      if (route.request().method() !== 'GET') return route.abort();
      const response = await context.request.get(route.request().url(), {timeout:60000});
      try { await route.fulfill({response}); } finally { await response.dispose(); }
    });
  }
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', er=>errors.push(er.message));
  try {
    await page.goto(url, {waitUntil:'domcontentloaded', timeout:90000});
    await page.waitForFunction(()=>window.map && window.KampTrailData && document.querySelector('.leaflet-control-layers'),null,{timeout:60000});
    const info=await page.evaluate(async()=>{
      async function get(path) { const r=await fetch(path,{cache:'no-store'}); if(!r.ok) throw Error('HTTP '+r.status+' '+path); return r.json(); }
      const [marker,indiana,policies] = await Promise.all(['release.json','data/rest-areas/IN.json','data/rest-areas/state-policies.json'].map(get));
      const site=indiana.records.find(r=>r.id==='indot:0db7d09b-31eb-439c-b8bc-f6322669b016');
      const exception=policies.exceptions.find(r=>r.facility_id===site.id);
      const index=await fetch('data/campsites/search-index.json',{cache:'no-store'});
      const bytes=await index.arrayBuffer();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      return {sha:marker.source_commit, version:document.querySelector('meta[name="kamptrail-version"]').content,
        rig:KampTrailData.version, index:digest, listings:JSON.parse(new TextDecoder().decode(bytes)).sites.length,
        site:{id:site.id,name:site.name,xy:site.coordinates},policyURL:exception.sources[0].url,
        nationalStatus:(await fetch('data/clearances/index.json',{cache:'no-store'})).status};
    });
    assert.equal(info.sha,expected); assert.equal(info.index,expectedIndex); assert.equal(info.listings,33370);
    assert.equal(info.version,'2.34.0'); assert.equal(info.rig,info.version); assert.equal(info.nationalStatus,404);
    await page.evaluate(([x,y])=>map.setView([y,x],11,{animate:false}),info.site.xy);
    const layers=page.getByRole('button',{name:'Map layers',exact:true});
    if (mobile) await layers.click(); else await page.locator('.leaflet-control-layers').hover();
    const toggle=page.getByLabel('Official rest areas',{exact:true});
    await toggle.waitFor({state:'visible'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await toggle.check();
    assert(await toggle.isChecked());
    const pin=page.getByTitle(info.site.name,{exact:true});
    await pin.waitFor({state:'attached', timeout:45000});
    await pin.focus(); await pin.press('Enter');
    const popup=page.locator('.kt-rest-popup[data-rest-area-id="'+info.site.id+'"]');
    await popup.waitFor({state:'visible',timeout:15000});
    const printed=await popup.innerText();
    assert.match(printed,/overnight parking\s+Prohibited/i);
    assert.match(printed,/sleeping in a vehicle\s+Unknown/i);
    assert.match(printed,/camping\s+Unknown/i);
    assert(await popup.locator('a').evaluateAll((links,url)=>links.some(a=>a.href===url),info.policyURL));
    assert.deepEqual(errors,[]);
    return {...info,mobile,viewport,facilityPopup:true,jsErrors:errors};
  } catch(error) {
    console.error(JSON.stringify(await page.evaluate(()=>({url:location.href, center:window.map?.getCenter(),zoom:window.map?.getZoom(),state:window.KampTrailData?.getLoadStatus(),panel:document.querySelector('.kt-rest-control')?.innerText,pins:[...document.querySelectorAll('.kt-rest-icon')].slice(0,5).map(x=>x.title),modal:document.querySelector('dialog[open]')?.id})).catch(()=>null)));
    throw error;
  } finally { await context.close(); }
}
(async()=>{
  const expected=process.argv[2];assert.match(expected||'',/^[0-9a-f]{40}$/);
  const args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'];
  const opts={args,headless:true};
  if(process.env.KT_CHROMIUM)opts.executablePath=process.env.KT_CHROMIUM;
  if(process.env.HTTPS_PROXY)opts.proxy={server:process.env.HTTPS_PROXY};
  const browser=await chromium.launch(opts);
  try { for(const mobile of [false,true])console.log(JSON.stringify(await verify(browser,mobile,expected))); }
  finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
