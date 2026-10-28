const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function localOnly(context) {
  // Unit/integration runs isolate optional remote map/photography providers.
  await context.route(/^https:\/\//,route=>route.fulfill({contentType:'image/png',body:pixel}));
}
async function ready(page) {
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0 && !KampTrailData.getLoadStatus().loading);
}
test.beforeEach(async({context})=>localOnly(context));

test('desktop loads bundled scripts, real campsite snapshots, city search, and matching filters',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await ready(page);
  expect(await page.evaluate(()=>KampTrailData.getLoadStatus().totalSites)).toBeGreaterThan(0);
  expect(await page.locator('script[src^="https:"]').count()).toBe(0);
  await page.locator('#destination').fill('Albany, NY');
  await page.locator('#search-form').getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('#search-results').getByRole('button',{name:'Albany, NY · City',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeGreaterThan(42.6);
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeLessThan(42.8);
  await page.locator('#filters').click();
  await page.locator('input[name="f-cost"][value="free"]').check();
  await expect(page.locator('#filter-badge')).toBeVisible();
  expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.fee_status==='free'))).toBe(true);
  await page.locator('#kt-f-reset').click();
  await expect(page.locator('#filter-badge')).toBeHidden();
  expect(errors).toEqual([]);
});

test('campsite popup adds a trip stop that survives reload away from that state and exports coordinates',async({page})=>{
  await ready(page);
  const site=await page.evaluate(()=>{
    const s=KampTrailData.getAllCampsites().find(f=>f.properties.state==='CA');
    KampTrailData.focusCampsite(s.properties.id);return s;
  });
  await page.locator('.leaflet-popup [data-kt-action="trip"]').click();
  await expect(page.locator('#kt-trip-list')).toContainText(site.properties.name);
  await page.evaluate(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:42.65,lng:-73.75,zoom:10})));
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#trip-count')).toHaveText('(1)');
  await page.locator('#trip').click();
  await expect(page.locator('#kt-trip-list')).toContainText(site.properties.name);
  const download=page.waitForEvent('download');
  await page.locator('#kt-trip-export').click();
  const file=await download, xml=await fs.readFile(await file.path(),'utf8');
  expect(xml).toContain(String(site.geometry.coordinates[0]));
  expect(xml).toContain(String(site.geometry.coordinates[1]));
  expect(xml).toContain('<wpt');
});

test('community overlay requests state snapshots and map styles open on first click',async({page})=>{
  await ready(page);
  await page.evaluate(()=>map.setView([43,-74.5],7));
  const response=page.waitForResponse(r=>r.url().endsWith('/data/opencampingmap/NY.geojson')&&r.status()===200);
  await page.locator('#kt-toggle-ocm').check();
  await response;
  await expect.poll(()=>page.evaluate(()=>{
    let count=0;map.eachLayer(layer=>{if(layer.getAllChildMarkers)count+=layer.getAllChildMarkers().filter(m=>m.options.title==='Moose River Plains Camping Area').length;});return count;
  })).toBeGreaterThan(0);
  await page.locator('#layers-toggle').click();
  await expect(page.locator('#kt2-overlays')).toBeVisible();
  await page.locator('input[name="basemap"][value="satellite"]').check();
  expect(await page.evaluate(()=>Object.values(map._layers).some(l=>l._url?.includes('World_Imagery')))).toBe(true);
});

test.describe('network recovery without service-worker interception',()=>{
  test.use({serviceWorkers:'block'});
  test('a failed state download is reported and succeeds through Retry',async({page})=>{
  let fail=true;
  await page.route('**/data/campsites/NY_merged.geojson',route=>fail?route.fulfill({status:503,body:'unavailable'}):route.continue());
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
  await ready(page);
  await expect(page.locator('#data-errors')).toContainText('NY');
  expect(await page.evaluate(()=>KampTrailData.getLoadedStates().includes('NY'))).toBe(false);
  fail=false;
  await page.getByRole('button',{name:'Retry missing data'}).click();
  await expect.poll(()=>page.evaluate(()=>KampTrailData.getLoadedStates().includes('NY'))).toBe(true);
  await expect(page.locator('#data-errors')).toBeHidden();
});

});

test('first-visit data and app work after going offline, without deleting another app cache',async({page,context})=>{
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
  await page.addInitScript(()=>caches.open('unrelated-app-cache'));
  await ready(page);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    await caches.open('unrelated-app-cache');
  });
  await expect.poll(()=>page.evaluate(async()=>{
    const keys=await caches.keys();
    const c=await caches.open(keys.find(k=>k.endsWith('data-v1')) || 'missing');
    return !!await c.match(new URL('data/campsites/NY_merged.geojson',location.href));
  })).toBe(true);
  const before=await page.evaluate(()=>KampTrailData.getLoadStatus().totalSites);
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  expect(await page.evaluate(()=>KampTrailData.getLoadStatus().totalSites)).toBe(before);
  expect(await page.evaluate(()=>typeof L.map)).toBe('function');
  expect(await page.evaluate(()=>caches.has('unrelated-app-cache'))).toBe(true);
  await page.locator('#destination').fill('Albany, NY');
  await page.locator('#search-form').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('#search-results')).toContainText('Albany, NY');
});

test('mobile map remains usable with tools, city search, and campsite drawer',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await ready(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const mapBox=await page.locator('#map').boundingBox();expect(mapBox.height).toBeGreaterThan(400);
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#results-toggle').click();
  await expect(page.locator('#results')).toBeVisible();
  await page.locator('#results-toggle').click();
  await page.locator('#filters').click();
  await expect(page.locator('#kt-filter-panel')).toBeVisible();
  await page.locator('#filters').click();
  await page.evaluate(()=>KampTrailTrip.addStop(KampTrailData.getAllCampsites()[0].properties.id));
  await page.locator('#kt-trip-close').click();
  await expect(page.locator('#kt-trip-drawer')).toHaveAttribute('aria-hidden','true');
  await page.screenshot({path:'test-results/mobile.png'});
});

test('location denial recovers and coordinate search moves the map',async({page,context})=>{
  await context.clearPermissions();
  await ready(page);
  await page.locator('#near').click();
  await expect(page.locator('#near')).toBeEnabled();
  await expect(page.locator('#near')).toHaveAttribute('aria-pressed','false');
  await page.locator('#destination').fill('42.65, -73.75');
  await page.locator('#search-form').getByRole('button',{name:'Search',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeCloseTo(42.65,2);
});


test('GitHub Pages project subpath loads all tools and city search without absolute asset paths',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/kamptrail/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  await page.locator('#destination').fill('Albany, NY');
  await page.locator('#search-form').getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.locator('#search-results')).toContainText('Albany, NY');
  await page.evaluate(()=>KampTrailCompare.addToCompare(KampTrailData.getAllCampsites()[0].properties.id));
  await page.locator('#compare-btn').click();
  const color=await page.locator('#compare-drawer').evaluate(el=>getComputedStyle(el).color);
  expect(color).toBe('rgb(227, 240, 229)');
  expect(errors).toEqual([]);
});
