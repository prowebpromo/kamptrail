const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
// Deterministic browser identity (2.33.0, docs/DETERMINISTIC_IDENTITY.md): the real app on the real
// published data elects the same listing as search-index.json, whatever the loading order, timing or
// cache state, and every published id (canonical or legacy) opens the same listing without being rewritten.
const index=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/campsites/search-index.json'),'utf8'));
const byId=new Map(index.sites.map(s=>[s.id,s]));
const STATES=['NC','TN','CA','NV'];
// Cosby (NC,TN; OSM host, Recreation.gov alias), Upper Grays Meadow (CA,NV), Lower Jones Valley (CA).
const CASES=['osm:way:1107154601','usfs:20680','usfs:6427'];
const LOADED=index.sites.filter(s=>s.states.every(c=>STATES.includes(c))).map(s=>s.id);
const FILTERS=[{amenities:['toilet']},{amenities:['water']},{amenities:['toilet'],rigLength:20},{rigSize:'rv'},{rigSize:'tent'}];

async function boot(page,{delay={},order=null}={}){
  for(const [code,ms] of Object.entries(delay))await page.route(`**/data/campsites/${code}_merged.geojson`,async r=>{await new Promise(x=>setTimeout(x,ms));await r.continue();});
  await page.route('**/api/community-discovery.php*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,version:1,revision:'1',checked_at:new Date().toISOString(),next_after:null,sites:{'ridb:232479':{rating_count:1,rating_sum:5,latest_visit:'2026-06-01',observations:[]}}})}));
  // Start in the ocean so no state loads before the test chooses an order.
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:-10,lng:-140,zoom:9})));
  await page.goto('/');
  await page.waitForFunction(()=>window.KampTrailData?.getIdentityStatus?.().hosts==='published');
  await page.evaluate(async order=>{if(order)for(const c of order)await KampTrailData.loadStates([c]);else await KampTrailData.loadStates(['NC','TN','CA','NV']);},order);
}
// What the popup and the filters use for each listing, read from the running app.
function capture(page,ids,filters){
  return page.evaluate(({ids,filters})=>{
    const out={};
    for(const id of ids){
      const f=KampTrailData.getCampsiteById(id),p=f.properties,html=KampTrailData.popupHTML(f);
      out[id]={id:p.id,ids:[p.id,...[...(p.legacy_ids||[])].filter(x=>x!==p.id).sort()],filter:DataQuality.amenityFilterSets(p),rig:[...p.rig_friendly].sort(),fee:p.fee_status,type:p.type,
        claims:[...html.matchAll(/data-amenity="([a-z_]+)" data-status="([a-z_]+)"/g)].map(m=>m[1]+'='+m[2]).sort(),
        outcomes:filters.map(x=>DataQuality.applyFilters([f],{...KampTrailData.getDefaultFilters(),...x}).length)};
    }
    return out;
  },{ids,filters});
}
const indexView=id=>{const s=byId.get(id);return {id:s.id,ids:[s.id,...[...s.legacy_ids].sort()],g:s.m.a||[],s:s.m.s||[],rig:[...(s.m.r||[])].sort(),fee:s.m.f,type:s.m.t};};
const asIndex=v=>({id:v.id,ids:v.ids,g:v.filter.g,s:v.filter.s,rig:v.rig,fee:v.fee,type:v.type});

test.describe('deterministic identity on the published catalogue',()=>{
  test.use({serviceWorkers:'block'});
  test.setTimeout(240000);

  test('reversed and seeded loading orders and slow states give the index listing, claims and filter outcomes',async({browser})=>{
    const runs=[{order:STATES},{order:[...STATES].reverse()},{order:['TN','NV','NC','CA']},{order:['CA','TN','NV','NC']},{delay:{NC:1500,CA:900}},{delay:{TN:1500,NV:600}}];
    let base=null;
    for(const run of runs){
      const context=await browser.newContext(),page=await context.newPage();
      await boot(page,run);
      const all=await page.evaluate(ids=>ids.map(id=>{const f=KampTrailData.getCampsiteById(id);return f?[id,f.properties.id,[...(f.properties.legacy_ids||[])].filter(x=>x!==f.properties.id).sort().join(',')]:[id,null,''];}),LOADED);
      const wrong=all.filter(([id,shown,legacy])=>shown!==id||legacy!==[...byId.get(id).legacy_ids].sort().join(','));
      expect(wrong,`${JSON.stringify(run)}: every loaded listing has the index id and source-id set`).toEqual([]);
      const view=await capture(page,CASES,FILTERS);
      for(const id of CASES)expect(asIndex(view[id]),`${id} matches the index`).toEqual(indexView(id));
      if(!base)base=view;else expect(view,`${JSON.stringify(run)}: popup claims and filter outcomes equal the first run`).toEqual(base);
      await context.close();
    }
    // Cosby keeps its own OSM toilet evidence in the popup and the toilet filter.
    expect(base['osm:way:1107154601'].claims).toContain('toilet=present');
    expect(base['osm:way:1107154601'].outcomes[0]).toBe(1);
  });

  test('saved stops, share links and reviews keep their stored id and resolve canonical and legacy ids',async({page})=>{
    await page.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('kt_trip',JSON.stringify([{id:'ridb:232479',feature:null,note:'legacy',arrive:'',depart:''},{id:'usfs:20680',feature:null,note:'canonical',arrive:'',depart:''}]));}});
    await boot(page,{order:['TN','NC','NV','CA']});
    // Stored ids are unchanged after resolution; both stops show the listing they were saved for.
    await expect.poll(()=>page.evaluate(()=>KampTrailTrip.getStops().map(s=>[s.id,s.feature?.properties.id]))).toEqual([['ridb:232479','osm:way:1107154601'],['usfs:20680','usfs:20680']]);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id))).toEqual(['ridb:232479','usfs:20680']);
    // Saving the same place under its canonical id does not add a second stop.
    await page.evaluate(()=>KampTrailTrip.addStop('osm:way:1107154601'));
    expect(await page.evaluate(()=>KampTrailTrip.getStops().length)).toBe(2);
    // Share links and new reports carry the index id; both link forms open the same listing.
    expect(await page.evaluate(()=>KampTrailShare.linkFor({site:'ridb:232479'}))).toMatch(/#site=osm%3Away%3A1107154601$/);
    for(const id of ['ridb:232479','osm:way:1107154601']){
      await page.evaluate(id=>{location.hash='';location.hash='site='+encodeURIComponent(id);},id);
      await expect.poll(()=>page.evaluate(()=>document.querySelector('.leaflet-popup-content')?.textContent||'')).toContain('Cosby');
      expect(await page.evaluate(()=>location.hash)).toBe('#site='+encodeURIComponent(id));
      await page.evaluate(()=>window.map?.closePopup?.());
    }
    // A published review keyed to the legacy id still attaches to the listing.
    await page.evaluate(()=>KampTrailDiscovery.load(true));
    await expect.poll(()=>page.evaluate(()=>KampTrailDiscovery.summary(KampTrailData.getCampsiteById('osm:way:1107154601').properties)?.rating_count)).toBe(1);
    // A correction for the listing is submitted under its index id, even when opened through the alias.
    let posted=null;
    await page.route('**/api/submit.php',async r=>{posted=JSON.parse(r.request().postData());await r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token:'a'.repeat(32),status:'pending'})});});
    await page.evaluate(()=>KampTrailContrib.open({kind:'correction',site:KampTrailData.getCampsiteById('ridb:232479')}));
    await page.locator('#kt-report textarea[name="details"]').fill('Firsthand test correction for identity association.');
    await page.locator('#kt-report input[name="firsthand"]').check();
    await page.locator('#kt-report input[name="problems"]').first().check();
    await page.locator('#kt-report button[type="submit"]').click();
    await expect.poll(()=>posted?.campsite_id).toBe('osm:way:1107154601');
    // Reloading keeps the saved ids exactly as stored.
    await page.reload();await page.waitForFunction(()=>window.KampTrailTrip);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id))).toEqual(['ridb:232479','usfs:20680']);
  });
});

test.describe('cached states',()=>{
  test('a second load served by the service worker cache gives the same listings as the network load',async({page,context})=>{
    test.setTimeout(240000);
    await boot(page,{order:['NC','TN']});
    await page.evaluate(()=>navigator.serviceWorker.ready);
    const first=await capture(page,['osm:way:1107154601'],FILTERS);
    const ids=await page.evaluate(()=>KampTrailData.getAllCampsites().map(f=>f.properties.id).sort());
    // Second visit, offline: state files and the host map come from the cache, in the other order.
    await context.setOffline(true);
    await page.reload();await page.waitForFunction(()=>window.KampTrailData?.getIdentityStatus?.().hosts==='published');
    await page.evaluate(async()=>{for(const c of ['TN','NC'])await KampTrailData.loadStates([c]);});
    expect(await page.evaluate(()=>KampTrailData.getLoadStatus().loadedStates.sort())).toEqual(['NC','TN']);
    expect(await page.evaluate(()=>KampTrailData.getAllCampsites().map(f=>f.properties.id).sort())).toEqual(ids);
    expect(await capture(page,['osm:way:1107154601'],FILTERS)).toEqual(first);
    await context.setOffline(false);
  });
});
