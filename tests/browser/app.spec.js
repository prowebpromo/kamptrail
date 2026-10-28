const {test,expect}=require('@playwright/test');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function ready(page,path='/'){
  await page.goto(path,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
}
test.beforeEach(async({context})=>{
  // Remote basemap requests are isolated in repeatable regressions; deployment smoke uses real tiles.
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
});
test('MVP has only working core tools and city search updates the map and list',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await expect(page.locator('#trip')).toContainText('Saved stops');
  expect(await page.locator('script[src^="https:"]').count()).toBe(0);
  expect(await page.locator('#compare-btn,#gpx-import,#layers-toggle,#kt-toggle-towers,#kt-toggle-poi').count()).toBe(0);
  expect(await page.evaluate(()=>[typeof window.KampTrailCompare,typeof window.KampTrailGPX,typeof window.KampTrailPhotos,typeof window.KampTrailOverlays])).toEqual(['undefined','undefined','undefined','undefined']);
  await page.locator('#destination').fill('Albany, NY');
  await page.locator('#search-form button').click();
  await page.getByRole('button',{name:'Albany, NY · City',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeCloseTo(42.65258,1);
  await expect.poll(()=>page.evaluate(()=>KampTrailData.getVisibleCampsites().length)).toBeGreaterThan(0);
  const count=await page.evaluate(()=>KampTrailData.getVisibleCampsites().length);
  await expect(page.locator('#result-summary')).toContainText(`${count} in this view`);
  expect(errors).toEqual([]);
});
test('national campground search works outside loaded states, shows GPS and directions, and saves across reloads',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:42.65,lng:-73.75,zoom:10})));
  await ready(page);
  expect(await page.evaluate(()=>KampTrailData.getLoadedStates().includes('CA'))).toBe(false);
  const target=await page.evaluate(async()=>{
    const data=await (await fetch('data/campsites/search-index.json')).json();
    return data.sites.find(s=>s.states.length===1&&s.states[0]==='CA'&&s.name.length>8);
  });
  await page.locator('#destination').fill(target.name);
  await page.locator('#search-form button').click();
  await page.getByRole('button',{name:`${target.name} · Campsite`,exact:true}).first().click();
  await expect(page.locator('.leaflet-popup')).toContainText(target.name);
  await expect(page.locator('.kt-coordinates')).toHaveText(`${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`);
  await expect(page.locator('.leaflet-popup a[href*="google.com/maps/dir"]')).toHaveAttribute('href',`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`);
  await page.locator('.leaflet-popup [data-kt-action="trip"]').click();
  await expect(page.locator('#kt-trip-list')).toContainText(target.name);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#trip-count')).toHaveText('(1)');
  await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-list')).toContainText(target.name);
  await expect(page.locator('#kt-trip-list a')).toHaveAttribute('href',`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`);
});
test('basic filters persist and reset without inventing prices or showing unrelated facilities',async({page})=>{
  await ready(page);
  expect(await page.evaluate(()=>KampTrailData.getAllCampsites().every(s=>s.properties.camping_classification==='campsite'))).toBe(true);
  await page.locator('#filters').click();await page.locator('[name="f-cost"][value="free"]').check();
  await expect(page.locator('#filter-badge')).toBeVisible();
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.fee_status==='free'))).toBe(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  await page.locator('#filters').click();await expect(page.locator('[name="f-cost"][value="free"]')).toBeChecked();
  await page.locator('#kt-f-reset').click();await expect(page.locator('#filter-badge')).toBeHidden();
  expect(await page.locator('#f-rig,#f-road,#f-rate').count()).toBe(0);
});
test.describe('network retry',()=>{
  test.use({serviceWorkers:'block'});
  test('a failed state remains retryable and succeeds without reloading the app',async({page})=>{
    let fail=true;
    await page.route('**/data/campsites/NY_merged.geojson',r=>fail?r.fulfill({status:503,body:'Unavailable'}):r.continue());
    await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
    await ready(page);await expect(page.locator('#data-errors')).toContainText('NY');
    fail=false;await page.getByRole('button',{name:'Retry missing data'}).click();
    await expect.poll(()=>page.evaluate(()=>KampTrailData.getLoadedStates().includes('NY'))).toBe(true);
    await expect(page.locator('#data-errors')).toBeHidden();
  });
});
test('saved locations and searched cities remain usable after the first online visit goes offline',async({page,context})=>{
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
  await page.addInitScript(()=>caches.open('another-app'));
  await ready(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));KampTrailTrip.addStop(KampTrailData.getAllCampsites()[0].properties.id);});
  const name=await page.evaluate(()=>KampTrailTrip.getStops()[0].feature.properties.name);
  await page.locator('#kt-trip-close').click();await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  await page.locator('#trip').click();await expect(page.locator('#kt-trip-list')).toContainText(name);
  await page.locator('#kt-trip-close').click();
  await page.locator('#destination').fill('Albany, NY');await page.locator('#search-form button').click();
  await expect(page.locator('#search-results')).toContainText('Albany, NY');
  expect(await page.evaluate(()=>caches.has('another-app'))).toBe(true);
});
test('mobile controls remain clickable and saved stops close without blocking the map',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await page.locator('#map').boundingBox()).height).toBeGreaterThan(500);
  await page.locator('#filters').click();await page.getByRole('button',{name:'Close filters'}).click();
  await page.locator('#results-toggle').click();await expect(page.locator('#results')).toBeVisible();
  await page.locator('#result-list .site-actions button').filter({hasText:'Save stop'}).first().click();
  await expect(page.locator('#kt-trip-drawer')).toBeVisible();await page.locator('#kt-trip-close').click();
  await expect(page.locator('#kt-trip-drawer')).toBeHidden();expect(await page.locator('#app').evaluate(el=>el.inert)).toBe(false);
});
test('location permission denial recovers, and coordinates remain a complete alternative',async({page,context})=>{
  await context.clearPermissions();await ready(page);await page.locator('#near').click();await expect(page.locator('#near')).toBeEnabled();await expect(page.locator('#near')).toHaveAttribute('aria-pressed','false');
  await page.locator('#destination').fill('42.65, -73.75');await page.locator('#search-form button').click();await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeCloseTo(42.65,2);
});
test('GitHub Pages subpath resolves core scripts and national search catalogue',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await ready(page,'/kamptrail/');
  await page.locator('#destination').fill('Albany, NY');await page.locator('#search-form button').click();await expect(page.locator('#search-results')).toContainText('Albany, NY');
  expect(await page.locator('meta[name="kamptrail-version"]').getAttribute('content')).toBe('2.2.0');expect(errors).toEqual([]);
});
