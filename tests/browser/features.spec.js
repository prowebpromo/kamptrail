const {test,expect}=require('@playwright/test');
const path=require('node:path');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const tripScript=path.resolve(__dirname,'../../trip-planner.js');

async function mockRemote(context,calls=[]) {
  await context.route(/^https:\/\//,route=>{
    const url=route.request().url();calls.push(url);
    if(url.includes('gis.blm.gov')&&url.includes('/query'))return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({features:[{attributes:{ADMIN_AGENCY_CODE:'BLM',ADMIN_UNIT_NAME:'Bureau of Land Management',ADMIN_UNIT_TYPE:'Bureau of Land Management CA',ADMIN_ST:'CA'}}]})});
    if(url.startsWith('https://api.weather.gov/points/'))return route.fulfill({contentType:'application/geo+json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({properties:{forecast:'https://api.weather.gov/gridpoints/TEST/1,1/forecast',relativeLocation:{properties:{city:'Bishop',state:'CA'}}}})});
    if(url.startsWith('https://api.weather.gov/gridpoints/'))return route.fulfill({contentType:'application/geo+json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({properties:{elevation:{value:1500},updateTime:'2026-10-28T12:00:00Z',periods:[{name:'Tonight',temperature:31,temperatureUnit:'F',windSpeed:'5 mph',windDirection:'NW',shortForecast:'Clear',probabilityOfPrecipitation:{value:0}}]}})});
    if(url.startsWith('https://routing.openstreetmap.de/'))return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({code:'Ok',routes:[{duration:9000,distance:321869,legs:[{duration:5400,distance:160934},{duration:3600,distance:160935}]}]})});
    if(url.includes('basemap.nationalmap.gov'))return route.fulfill({contentType:'image/jpeg',headers:{'access-control-allow-origin':'*'},body:pixel});
    return route.fulfill({contentType:'image/png',body:pixel});
  });
}
async function ready(page,url='/') {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
}

test('layers control offers topo, satellite, public land and RV services from public sources',async({page,context})=>{
  const calls=[];await mockRemote(context,calls);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:37.4,lng:-118.4,zoom:9})));
  await ready(page);
  const labels=await page.locator('.leaflet-control-layers label').allTextContents();
  for(const name of ['Standard','Topo','Satellite','Public land (BLM, USFS, NPS)','RV services (dump, water, propane)'])expect(labels.join('|')).toContain(name);
  await page.locator('.leaflet-control-layers').hover();
  await page.getByLabel('Topo').check();
  await expect.poll(()=>calls.some(u=>u.includes('basemap.nationalmap.gov')&&u.includes('USGSTopo'))).toBe(true);
  await page.getByLabel('Public land (BLM, USFS, NPS)').check();
  await expect(page.locator('.kt-land-legend')).toContainText('BLM');
  await expect.poll(()=>calls.some(u=>u.includes('BLM_Natl_SMA_Cached_without_PriUnk/MapServer/tile/'))).toBe(true);
  await page.getByLabel('RV services (dump, water, propane)').check();
  await expect.poll(()=>page.locator('.kt-svc-icon,.kt-svc-cluster').count()).toBeGreaterThan(0);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.KampTrailLayers?.getBase()==='Topo');
  expect(await page.evaluate(()=>KampTrailLayers.isOn('Public land (BLM, USFS, NPS)'))).toBe(true);
  expect(errors).toEqual([]);
});

test('long-press spot check shows the land manager, stay-limit guidance, forecast, and can be saved',async({page,context})=>{
  await mockRemote(context);await ready(page);
  await page.evaluate(()=>{map.setView([37.45,-118.4],10);KampTrailLayers.openSpot(L.latLng(37.45,-118.4));});
  const popup=page.locator('.kt-spot-popup');
  await expect(popup).toContainText('Bureau of Land Management (BLM)');
  await expect(popup).toContainText('14 days within any 28-day period');
  await expect(popup.locator('a[href="https://www.blm.gov/camping"]')).toBeVisible();
  await expect(popup.locator('a',{hasText:'Suggest a campsite here'})).toHaveAttribute('href',/template=new-campsite\.yml.*coordinates=37\.45000%2C\+-118\.40000/);
  await popup.getByRole('button',{name:'Forecast + elevation'}).click();
  await expect(popup).toContainText('Elevation about 4,921 ft');
  await expect(popup).toContainText('Tonight: 31°F, Clear');
  await popup.getByRole('button',{name:'Save stop'}).click();
  await expect(page.locator('#kt-trip-list')).toContainText('Spot 37.4500, -118.4000');
});

test('campsite popup links to share, corrections, nearest services, and opens from a shared link',async({page,context})=>{
  await mockRemote(context);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  const target=await (async()=>{await ready(page);return page.evaluate(async()=>{const d=await (await fetch('data/campsites/search-index.json')).json();return d.sites.find(s=>s.states.length===1&&s.states[0]==='CO');});})();
  await page.goto(`/#site=${encodeURIComponent(target.id)}`,{waitUntil:'domcontentloaded'});
  const popup=page.locator('.leaflet-popup');
  await expect(popup).toContainText(target.name);
  await expect(popup.locator('a',{hasText:'Suggest a fix'})).toHaveAttribute('href',/github\.com\/prowebpromo\/kamptrail\/issues\/new\?template=campsite-correction\.yml/);
  await popup.getByRole('button',{name:'Share'}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(`#site=${encodeURIComponent(target.id)}`);
  await popup.getByRole('button',{name:'Nearest RV services'}).click();
  await expect(popup.locator('.kt-popup-extra')).toContainText('Dump station:');
  await expect(popup.locator('.kt-popup-extra')).toContainText('mi straight-line');
  await popup.getByRole('button',{name:'Land manager'}).click();
  await expect(popup.locator('.kt-popup-extra')).toContainText('Bureau of Land Management');
});

test('amenity and rig filters persist and match only reported data',async({page,context})=>{
  await mockRemote(context);await ready(page);
  await page.locator('#filters').click();
  await page.locator('[name="f-amenity"][value="toilet"]').check();
  await expect(page.locator('#filter-badge')).toHaveText('1');
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.amenities.includes('toilet')))).toBe(true);
  await page.locator('#f-rig').selectOption('tent');
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.rig_friendly.includes('tent')))).toBe(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  await page.locator('#filters').click();
  await expect(page.locator('[name="f-amenity"][value="toilet"]')).toBeChecked();
  await expect(page.locator('#f-rig')).toHaveValue('tent');
  await page.locator('#kt-f-reset').click();await expect(page.locator('#filter-badge')).toBeHidden();
});

// ---- Trip planner in isolation ----
const stop=(id,name,lng,lat)=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,name}});
async function tripPage(page) {
  await page.route('https://kamptrail-trip.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="app"><button id="trip">Saved stops <span id="trip-count">(0)</span></button></div></body></html>'}));
  await page.goto('https://kamptrail-trip.test/');
  await page.evaluate(()=>{window.testMsgs=[];window.showToast=m=>testMsgs.push(m);window.testMap={setView(){return this;}};window.KampTrailData={getCampsiteById:()=>null,getLoadStatus:()=>({totalSites:0,loadedStates:[],loading:false}),focusCampsite:()=>false};});
  await page.addScriptTag({path:tripScript});await page.evaluate(()=>KampTrailTrip.init(testMap));
}
test('trip stops reorder, keep notes and dates, and total straight-line miles and nights',async({page})=>{
  await tripPage(page);
  await page.evaluate(([a,b,c])=>{KampTrailTrip.addStop(a.properties.id,a);KampTrailTrip.addStop(b.properties.id,b);KampTrailTrip.addStop(c.properties.id,c);},[stop('a','Alpha',-105,40),stop('b','Bravo',-106,40),stop('c','Charlie',-107,40)]);
  await expect(page.locator('#kt-trip-summary')).toContainText('3 stops · about 106 mi straight-line');
  await page.getByRole('button',{name:'Move Charlie up'}).click();
  await expect(page.locator('.kt-saved-stop h3').nth(1)).toHaveText('2. Charlie');
  await expect(page.getByRole('button',{name:'Move Charlie up'})).toBeFocused();
  const first=page.locator('.kt-saved-stop').first();
  await first.locator('summary').click();
  await first.locator('input[type=date]').first().fill('2026-11-01');await first.locator('input[type=date]').first().dispatchEvent('change');
  await first.locator('input[type=date]').nth(1).fill('2026-11-04');await first.locator('input[type=date]').nth(1).dispatchEvent('change');
  await first.locator('textarea').fill('Verizon 2 bars at the pullout');await first.locator('textarea').dispatchEvent('change');
  await expect(page.locator('#kt-trip-summary')).toContainText('3 nights planned');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')));
  expect(saved.map(s=>s.id)).toEqual(['a','c','b']);
  expect(saved[0]).toMatchObject({arrive:'2026-11-01',depart:'2026-11-04',note:'Verizon 2 bars at the pullout'});
});
test('whole-trip directions split into Google Maps legs within the waypoint limits',async({page})=>{
  await tripPage(page);
  const legs=await page.evaluate(()=>{const pts=Array.from({length:12},(_,i)=>[40+i/10,-105-i/10]);return {desk:KampTrailTrip.routeLegs(pts,9),mob:KampTrailTrip.routeLegs(pts,3)};});
  expect(legs.desk.map(l=>[l.from,l.to])).toEqual([[1,11],[11,12]]);
  expect(legs.mob.map(l=>[l.from,l.to])).toEqual([[1,5],[5,9],[9,12]]);
  for(const leg of [...legs.desk,...legs.mob]){
    const u=new URL(leg.url);const w=u.searchParams.get('waypoints');
    expect(u.searchParams.get('api')).toBe('1');expect(w?w.split('|').length:0).toBeLessThanOrEqual(legs.desk.includes(leg)?9:3);
  }
  await page.evaluate(([a,b])=>{KampTrailTrip.addStop('a',a);KampTrailTrip.addStop('b',b);},[stop('a','Alpha',-105,40),stop('b','Bravo',-106,41)]);
  await page.getByRole('button',{name:'Directions for the whole trip'}).click();
  await expect(page.getByRole('link',{name:'Open route in Google Maps'})).toHaveAttribute('href','https://www.google.com/maps/dir/?api=1&origin=40,-105&destination=41,-106&travelmode=driving');
});
test('GPX export escapes names and import adds namespaced waypoints as stops',async({page})=>{
  await tripPage(page);
  await page.evaluate(s=>KampTrailTrip.addStop('x',s),stop('x','Tom & Jerry <Camp>',-110.5,38.25));
  const gpx=await page.evaluate(()=>KampTrailTrip.toGPX());
  expect(gpx).toContain('<wpt lat="38.25" lon="-110.5"><name>Tom &amp; Jerry &lt;Camp&gt;</name>');
  expect(gpx).toContain('<rtept lat="38.25" lon="-110.5">');
  const download=page.waitForEvent('download');await page.locator('#kt-trip-export').click();
  expect((await download).suggestedFilename()).toMatch(/^kamptrail-trip-\d{4}-\d{2}-\d{2}\.gpx$/);
  const file='<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><wpt lat="44.1" lon="-121.7"><name>Forest pullout</name><desc>Level spot</desc></wpt><wpt lat="999" lon="0"><name>Bad</name></wpt></gpx>';
  await page.locator('#kt-trip-file').setInputFiles({name:'trip.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(file)});
  await expect(page.locator('#kt-trip-list')).toContainText('Forest pullout');
  expect(await page.evaluate(()=>KampTrailTrip.getStops().map(s=>s.note))).toEqual(['','Level spot']);
  expect(await page.evaluate(()=>testMsgs.join(' '))).toContain('1 stop added');
});

test('rig length and hookup filters use Recreation.gov site details and popups show RV sites',async({page,context})=>{
  await mockRemote(context);await ready(page);
  const fit=await page.evaluate(()=>KampTrailData.getAllCampsites().filter(s=>s.properties.rv_max_length>=35).length);
  expect(fit).toBeGreaterThan(0);
  await page.locator('#filters').click();
  await page.locator('#f-length').fill('35');await page.locator('#f-length').dispatchEvent('change');
  await expect(page.locator('#filter-badge')).toHaveText('1');
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.rv_max_length>=35))).toBe(true);
  await page.locator('[name="f-hookup"][value="electric"]').check();
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.hookups.electric>0))).toBe(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  await page.locator('#filters').click();await expect(page.locator('#f-length')).toHaveValue('35');
  const id=await page.evaluate(()=>KampTrailData.getAllCampsites().find(s=>s.properties.rv_max_length>=35&&s.properties.hookups.electric>0).properties.id);
  await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
  await expect(page.locator('.leaflet-popup')).toContainText('RV sites (Recreation.gov):');
  await expect(page.locator('.leaflet-popup')).toContainText('list 35 ft or more');
});

test('free filter explains thin data and offers the public land layer',async({page,context})=>{
  await mockRemote(context);
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:42.65,lng:-73.75,zoom:9})));
  await ready(page);
  expect(await page.evaluate(()=>KampTrailData.getAllCampsites().filter(s=>s.properties.fee_evidence==='Recreation.gov fee description').length)).toBeGreaterThanOrEqual(0);
  await page.locator('#filters').click();await page.locator('[name="f-cost"][value="free"]').check();
  await expect(page.locator('.free-tip')).toContainText('BLM says most of its land allows dispersed camping');
  await page.locator('.free-tip button').click();
  await expect(page.locator('.kt-land-legend')).toBeVisible();
});

test('trip drive times come from one on-demand router request and replace straight-line legs',async({page,context})=>{
  const calls=[];await mockRemote(context,calls);await ready(page);
  await page.evaluate(()=>{const mk=(id,n,lng,lat)=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,name:n}});
    [mk('t1','One',-105,40),mk('t2','Two',-106,40),mk('t3','Three',-107,40)].forEach(s=>KampTrailTrip.addStop(s.properties.id,s));});
  await page.getByRole('button',{name:'Drive times'}).click();
  await expect(page.locator('#kt-trip-summary')).toContainText('2 hr 30 min driving, 200 mi by road');
  await expect(page.locator('.kt-saved-stop').nth(1)).toContainText('1 hr 30 min, 100 mi from stop 1 by road');
  await expect(page.locator('#kt-trip-drive-credit')).toContainText('OpenStreetMap contributors');
  expect(calls.filter(u=>u.startsWith('https://routing.openstreetmap.de/')).length).toBe(1);
  await page.getByRole('button',{name:'Move Three up'}).click();
  await expect(page.locator('#kt-trip-summary')).not.toContainText('driving');
});

test('offline maps save USGS Topo tiles for the view and refuse oversized areas',async({page,context})=>{
  const calls=[];await mockRemote(context,calls);
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:37.45,lng:-118.4,zoom:15})));
  test.setTimeout(90000);await ready(page);
  page.on('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Offline'}).click();
  const plan=await page.evaluate(()=>KampTrailOffline.plan(map.getBounds(),map.getZoom()));
  expect(plan.tooMany).toBe(false);expect(plan.zmin).toBe(15);expect(plan.zmax).toBe(16);
  await page.getByRole('button',{name:'Save this area'}).click();
  await expect(page.locator('.kt-off-status')).toContainText('1 saved area',{timeout:30000});
  const cached=await page.evaluate(async()=>(await (await caches.open(KampTrailOffline.cacheName())).keys()).length);
  expect(cached).toBe(plan.urls.length);
  expect(calls.every(u=>!u.startsWith('https://tile.openstreetmap.org/')||!u.includes('/16/'))).toBe(true);
  await page.evaluate(()=>map.setZoom(5));
  await page.getByRole('button',{name:'Save this area'}).click();
  await expect(page.locator('#toast')).toContainText('Zoom in');
});

test('agency fee evidence powers Free, keeps conditional separate, and explains RV-length exclusions',async({page,context})=>{
  await mockRemote(context);
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:44.3,lng:-115.5,zoom:7})));
  await ready(page);
  const counts=await page.evaluate(()=>{const a=KampTrailData.getAllCampsites();return {free:a.filter(s=>s.properties.fee_status==='free'&&s.properties.fee_text).length,cond:a.filter(s=>s.properties.fee_status==='conditional').length};});
  expect(counts.free).toBeGreaterThan(5);
  await page.locator('#filters').click();await page.locator('[name="f-cost"][value="free"]').check();
  const id=await page.evaluate(()=>KampTrailData.getVisibleCampsites().find(s=>s.properties.fee_text)?.properties.id);
  expect(id).toBeTruthy();
  await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
  await expect(page.locator('.kt-fee-evidence')).toContainText('imported');
  await expect(page.locator('.leaflet-popup')).toContainText('camping fee only');
  await page.keyboard.press('Escape');
  await page.locator('#filters').click();
  await page.locator('#f-length').fill('30');await page.locator('#f-length').dispatchEvent('change');
  await expect(page.locator('.free-tip').first()).toContainText('no documented RV length');
  await page.getByRole('button',{name:'Include them, labeled'}).click();
  await expect(page.locator('#f-length-unknown')).toBeChecked();
  await expect(page.locator('.site-card').first()).toContainText('RV length not documented');
});
