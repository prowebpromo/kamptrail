const {test,expect}=require('@playwright/test');
const {createHash}=require('node:crypto');
test.use({serviceWorkers:'block'});
const record={id:'osm:node:99',legacy_ids:['old-saved-id'],name:'Original Historical Camp',lat:43,lng:-75.1,states:['NY'],source_dates:[{source_record_id:'osm:node:99',retrieved_at:'2026-10-01',updated_at:null}],source_urls:[{source_record_id:'osm:node:99',url:'https://www.openstreetmap.org/node/99'}],reason:'historical_identity_pending_reconciliation',archived_at:'2026-11-15T12:00:00Z'};
const raw=JSON.stringify({version:1,listings:[record]})+'\n',hash=createHash('sha256').update(raw).digest('hex');
const feature={type:'Feature',geometry:{type:'Point',coordinates:[-75.1,43]},properties:{id:'osm:node:99',name:record.name,type:'established',fee_status:'free',cost:0,rig_friendly:['rv'],tourism:'camp_site',osm_id:99,osm_type:'node'}};
const saved={id:'old-saved-id',feature,note:'Keep my original private note',arrive:'2026-10-02',depart:'2026-10-04'};
const stateRaw=JSON.stringify({type:'FeatureCollection',features:[feature,{type:'Feature',geometry:{type:'Point',coordinates:[-75.12,43]},properties:{id:'ridb:123',facility_id:123,name:'Current Campground',legacy_ids:['old-saved-id','osm:node:99']}}]}),stateHash=createHash('sha256').update(stateRaw).digest('hex');
const searchRaw=JSON.stringify({version:1,history_sha256:hash,sites:[{id:'ridb:123',legacy_ids:['old-saved-id'],name:'Current Campground',lat:43,lng:-75.12,states:['NY']},{id:record.id,legacy_ids:record.legacy_ids,name:record.name,lat:43,lng:-75.1,states:['NY']}]}),searchHash=createHash('sha256').update(searchRaw).digest('hex');
async function fixture(page,{unavailable=false}={}){
 const mode={unavailable};
 await page.route(/^https:\/\//,r=>r.abort());
 await page.route('**/data/campsites/**',r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('withdrawn.json'))return mode.unavailable?r.abort():r.fulfill({contentType:'application/json',body:raw});
  let data={};
  if(path==='/data/campsites/index.json')data={states:[{state:'NY',count:1}],total_sites:1,history_sha256:hash,source_sha256:{'data/campsites/NY_merged.geojson':stateHash}};
  else if(path.endsWith('identity-hosts.json'))data={version:1,index_sites:2,index_sha256:searchHash,history_sha256:hash,hosts:{'ridb:123':['old-saved-id','osm:node:99']}};
  else if(path.endsWith('search-index.json'))return r.fulfill({contentType:'application/json',body:searchRaw});
  else if(path.endsWith('/agency/index.json'))data={version:1,states:[]};
  else if(path.endsWith('NY_merged.geojson'))return r.fulfill({contentType:'application/json',body:stateRaw});
  else if(path.endsWith('_merged.geojson'))data={type:'FeatureCollection',features:[]};
  else if(path.endsWith('ridb-sites.json'))data={version:1,facilities:{}};
  return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.addInitScript(stop=>{if(!localStorage.getItem('kt_trip'))localStorage.setItem('kt_trip',JSON.stringify([stop]));localStorage.setItem('kt_last_position',JSON.stringify({lat:-10,lng:-140,zoom:9}));},saved);
 return mode;
}
for(const width of [390,1280])test(`historical shared aliases and saved stops preserve identity, dates and snapshots at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page);await page.goto('/?source=pwa#site=old-saved-id');
 const popup=page.locator('.kt-historical-listing');await expect(popup).toContainText(record.name);await expect(popup).toContainText('Current status is unverified');await expect(popup).toContainText('2026-10-01');await expect(popup).toContainText('updated: Date unavailable');await expect(popup).toContainText('bookkeeping date');
 await page.screenshot({path:test.info().outputPath(`historical-${width}.png`)});
 expect(await page.evaluate(()=>location.hash)).toBe('#site=old-saved-id');expect(await popup.locator('[data-amenity],.kt-rig-evidence,.kt-fee-records').count()).toBe(0);
 await page.evaluate(()=>KampTrailData.loadStates(['NY']));
 expect(await page.evaluate(()=>KampTrailData.getAllCampsites().map(f=>f.properties.id))).toEqual(['ridb:123']);
 expect(await page.evaluate(()=>KampTrailData.getCampsiteById('old-saved-id'))).toBeUndefined();
 expect(await page.evaluate(async()=>{const d=await KampTrailData.loadSearchIndex();return d.sites.map(s=>({id:s.id,aliases:s.legacy_ids}));})).toEqual([{id:'ridb:123',aliases:[]}]);
 await popup.getByRole('button',{name:'Close historical listing',exact:true}).click();await expect(popup).toHaveCount(0);await page.locator('#trip').click();await expect(page.locator('.kt-saved-history')).toContainText('Historical listing');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')))).toEqual([saved]);
 await page.screenshot({path:test.info().outputPath(`saved-historical-${width}.png`)});
 expect(await page.evaluate(()=>JSON.parse(KampTrailTrip.buildBackup()).stops)).toEqual([saved]);
  await page.locator('#kt-trip-list').getByRole('button',{name:'View on map',exact:true}).click();await expect(popup).toHaveCount(1);await expect(popup).toContainText('Opened saved ID: old-saved-id');expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')))).toEqual([saved]);
 await page.evaluate(()=>KampTrailTrip.addStop('osm:node:99',{type:'Feature',geometry:{type:'Point',coordinates:[-75.2,43.1]},properties:{id:'osm:node:99',type:'service',name:'Separate dump service',service_evidence:'Original service evidence'}}));
 expect(await page.evaluate(()=>KampTrailTrip.getStops().find(stop=>stop.id==='osm:node:99').feature.properties.type)).toBe('service');expect(await page.evaluate(()=>KampTrailTrip.getStops().find(stop=>stop.id==='osm:node:99').feature.geometry.coordinates)).toEqual([-75.2,43.1]);
});
test('unavailable history blocks current admission and saved revival, and retry opens the original historical record',async({page})=>{
 const mode=await fixture(page,{unavailable:true});await page.goto('/?source=pwa#site=old-saved-id');await expect(page.locator('#data-errors')).toContainText('Listing history is unavailable');
 await page.evaluate(()=>KampTrailData.loadStates(['NY']));expect(await page.evaluate(()=>KampTrailData.getAllCampsites().length)).toBe(0);
 await page.locator('#trip').click();await page.getByRole('button',{name:'View on map',exact:true}).click();await expect(page.locator('#kt-trip-notice')).toContainText('Listing history is unavailable');await page.locator('#kt-trip-close').click();
 mode.unavailable=false;await page.locator('#data-errors').getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('.kt-historical-listing')).toContainText(record.name);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')))).toEqual([saved]);
});
test.describe('offline historical links',()=>{
 test.use({serviceWorkers:'allow'});
 test('validated cached history opens after an offline app reload',async({page,context})=>{
  // Keep the initial fixture requests outside worker control, then exercise the real offline shell.
  await page.addInitScript(()=>{const register=navigator.serviceWorker.register.bind(navigator.serviceWorker);const gate=new Promise(resolve=>{window.allowHistoryWorker=resolve;});navigator.serviceWorker.register=(...args)=>gate.then(()=>register(...args));});
  await fixture(page);await page.goto('/?source=pwa#site=old-saved-id');await expect(page.locator('.kt-historical-listing')).toContainText(record.name);
  await page.evaluate(()=>window.allowHistoryWorker());
  await expect.poll(()=>page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return r?.active?.state||r?.installing?.state||'none';})).toBe('activated');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await expect(page.locator('.kt-historical-listing')).toContainText(record.name);await expect(page.locator('.kt-historical-listing')).toContainText('2026-10-01');
 });
});

test('a saved redirect opens active details when the host file is unavailable, with historical IDs reserved',async({page})=>{
  const prior='retired-source-way', host='ridb:123';
  const stop={...saved,id:prior,feature:{...feature,properties:{id:prior,name:'Earlier saved name'}}};
  await fixture(page);
  await page.route('**/data/campsites/identity-hosts.json',route=>route.abort());
  await page.route('**/data/campsites/search-index.json',route=>route.fulfill({json:{
    ...JSON.parse(searchRaw),redirects:{[prior]:host,'old-saved-id':host}
  }}));
  await page.addInitScript(stop=>localStorage.setItem('kt_trip',JSON.stringify([stop])),stop);
  await page.goto('/?source=pwa#site='+prior);
  const active=page.locator('.leaflet-popup-content [data-kt-action=trip][data-siteid="ridb:123"]');
  await expect(active).toBeVisible();
  expect(await page.evaluate(()=>location.hash)).toBe('#site='+prior);
  expect(await page.evaluate(async ({prior})=>{
    const api=KampTrailData, site=api.getCampsiteById(prior);
    return {hosts:api.getIdentityStatus().hosts,current:site?.properties.id,
      sourceIds:[...(site?.properties.legacy_ids||[]),...(site?.properties.source_ids||[])].includes(prior),
      archived:(await api.resolveListing('old-saved-id')).kind};
  },{prior})).toEqual({hosts:'fallback',current:host,sourceIds:false,archived:'historical'});
  await page.locator('#trip').click();
  const drawer=page.locator('#kt-trip-list');
  await expect(drawer).toContainText('Current Campground');
  await drawer.getByRole('button',{name:'View on map',exact:true}).click();
  await expect(active).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')))).toEqual([stop]);
});
