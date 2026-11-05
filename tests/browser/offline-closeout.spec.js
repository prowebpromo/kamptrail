const {test, expect} = require('@playwright/test');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
test.use({serviceWorkers:'block', viewport:{width:390,height:844}});

const camp = (id, name, offset, props) => ({
  type:'Feature', geometry:{type:'Point',coordinates:[-75 + offset,43]},
  properties:{id:`osm:way:${id}`,osm_id:id,osm_type:'way',source:'openstreetmap',
    name,schema_version:3,tourism:'camp_site',type:'established',amenities:[],
    tents:'yes',caravans:'no',...props}
});
const features = [
  camp(991001,'Closeout Free Tent',-.002,{fee:'no',fee_status:'free',cost:0}),
  camp(991002,'Closeout Paid Trailer',0,{fee:'yes',fee_status:'paid',cost:15,tents:'no',caravans:'yes'}),
  camp(991003,'Closeout Free Dispersed',.002,{fee:'no',fee_status:'free',cost:0,type:'dispersed',tourism:'camp_pitch'})
];
async function ready(page,context) {
  const requests = {topo:[],submissions:[],lookups:[],holdTopo:false};
  await context.route(/^https:\/\//, async route => {
    const url = route.request().url();
    if (url.includes('/USGSTopo/MapServer/tile/')) {
      requests.topo.push(url);
      if (requests.holdTopo) await new Promise(resolve=>setTimeout(resolve,250));
    }
    if (/gis\.blm\.gov|api\.weather\.gov/.test(url)) requests.lookups.push(url);
    await route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:pixel}).catch(()=>{});
  });
  const json = (route,body) => route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  await page.route('**/api/submit.php',route=>{
    requests.submissions.push(route.request().postDataJSON());
    return json(route,{ok:true,token:'a'.repeat(32)});
  });
  await page.route('**/data/campsites/index.json',route=>json(route,{states:[{state:'NY',count:3}],total_sites:3}));
  await page.route('**/data/campsites/agency/index.json',route=>json(route,{version:1,states:[]}));
  await page.route('**/data/campsites/*_merged.geojson',route=>json(route,{type:'FeatureCollection',features}));
  await page.route('**/data/campsites/ridb-sites.json',route=>json(route,{version:2,facilities:{}}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:12})));
  await page.goto('/');
  await page.evaluate(()=>KampTrailMapLoader.start());
  await page.waitForFunction(()=>window.KampTrailData?.getCampsiteById('osm:way:991001')&&!KampTrailData.getLoadStatus().loading);
  return requests;
}
async function mapArea(page,lng=-75) {
  await page.evaluate(lng=>{ map.setView([43,lng],16,{animate:false}); KampTrailSafety.request=async()=>true; },lng);
  await page.locator('.kt-off-toggle').click();
  page.on('dialog',dialog=>dialog.accept());
}
async function save(page) {
  await page.evaluate(()=>{
    window.closeoutSaveFinished=new Promise(resolve=>{
      const button=document.querySelector('.kt-off-save');
      const observer=new MutationObserver(()=>{if(!button.disabled){observer.disconnect();resolve();}});
      observer.observe(button,{attributes:true,attributeFilter:['disabled']});
    });
  });
  await page.locator('.kt-off-save').click();
  await page.evaluate(()=>window.closeoutSaveFinished);
  await expect(page.locator('.kt-off-save')).toBeEnabled();
  await expect(page.locator('.kt-off-progress')).toBeHidden();
  await expect(page.locator('.kt-off-status')).toContainText('saved');
}
async function inventory(page) {
  return page.evaluate(async()=>{
    const cache=await caches.open(KampTrailOffline.cacheName());
    return (await cache.keys()).map(r=>r.url).filter(url=>url.startsWith(KampTrailOffline.TOPO)).sort();
  });
}
async function truthfulCount(page,count) {
  await page.locator('.kt-off-check').click();
  await expect(page.locator('.kt-off-status')).toContainText(`${count} map tiles`);
  await expect(page.locator('.kt-off-readiness')).toContainText(`Topo map tiles: ${count} cached entries`);
}

test('saving an area after one tile is evicted fetches only that gap and keeps unique counts',async({page,context})=>{
  const requests=await ready(page,context); await mapArea(page); await save(page);
  const original=await inventory(page); expect(original.length).toBeGreaterThan(1);
  expect(requests.topo).toHaveLength(original.length);
  await page.evaluate(async url=>(await caches.open(KampTrailOffline.cacheName())).delete(url),original[0]);
  await truthfulCount(page,original.length-1);
  const before=requests.topo.length; await save(page);
  expect(requests.topo.slice(before)).toEqual([original[0]]);
  expect(await inventory(page)).toEqual(original); await truthfulCount(page,original.length);
  await expect(page.locator('.kt-off-status')).toContainText('1 saved area,');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_offline_areas_v1')).length)).toBe(1);
});

test('quota failure and cancellation retain existing tiles and an explicit retry fills the new area',async({page,context})=>{
  const requests=await ready(page,context); await mapArea(page); await save(page);
  const original=await inventory(page);
  await page.evaluate(()=>{
    const put=Cache.prototype.put;
    Cache.prototype.put=function(request,response){
      if(window.closeoutQuota && String(request?.url||request).startsWith(KampTrailOffline.TOPO)) return Promise.reject(new DOMException('Fixture quota limit','QuotaExceededError'));
      return put.call(this,request,response);
    };
    window.closeoutQuota=true; map.setView([43,-74.9],16,{animate:false});
  });
  await save(page); await expect(page.locator('#toast')).toContainText('Device storage is full');
  expect(await inventory(page)).toEqual(original); await truthfulCount(page,original.length);
  await page.evaluate(()=>{window.closeoutQuota=false;}); requests.holdTopo=true;
  await page.locator('.kt-off-save').click(); await expect(page.locator('.kt-off-cancel')).toBeVisible();
  await page.locator('.kt-off-cancel').click();
  await expect(page.locator('#toast')).toContainText('Stopped.');
  await expect(page.locator('.kt-off-save')).toBeEnabled();
  expect((await inventory(page)).filter(url=>original.includes(url))).toEqual(original);
  requests.holdTopo=false; await save(page);
  const complete=await inventory(page); expect(complete.length).toBeGreaterThan(original.length);
  await truthfulCount(page,complete.length);
  expect(await page.evaluate(async()=>(await KampTrailOffline.readiness()).maps.every(area=>area.present===area.expected))).toBe(true);
});

test('feedback submitted while already offline promptly announces recovery and retains the unsent draft',async({page,context})=>{
  const requests=await ready(page,context);
  await page.locator('#kt-feedback-open').click();
  const dialog=page.getByRole('dialog',{name:'Help improve KampTrail'});
  await dialog.getByLabel('Short summary').fill('Keep my offline feedback');
  await dialog.getByLabel('What happened?').fill('This feedback draft must remain available after reconnecting.');
  await context.setOffline(true); await dialog.getByRole('button',{name:'Send feedback'}).click();
  const status=dialog.locator('.kt-report-msg');
  await expect(status).toContainText('Your text is still here',{timeout:2000});
  await expect(status).toHaveAttribute('aria-live','polite'); await expect(status).toBeVisible();
  await expect(status).toBeInViewport();
  await context.setOffline(false);
  // Allow reconnect handlers to run, then prove only an explicit click can submit.
  await page.waitForTimeout(300); expect(requests.submissions).toEqual([]);
  await expect(dialog.getByLabel('Short summary')).toHaveValue('Keep my offline feedback');
  await expect(dialog.getByLabel('What happened?')).toHaveValue('This feedback draft must remain available after reconnecting.');
  await expect(dialog.getByRole('button',{name:'Send feedback'})).toBeEnabled();
});

test('correction and custom spot lookups started offline announce promptly without submitting on reconnect',async({page,context})=>{
  const requests=await ready(page,context);
  await page.evaluate(()=>KampTrailData.focusCampsite('osm:way:991001'));
  await page.locator('.leaflet-popup').getByRole('button',{name:'Suggest a fix'}).click();
  const dialog=page.getByRole('dialog',{name:'Suggest a fix'});
  await dialog.getByLabel('Fee is wrong').check();
  await dialog.getByLabel('What did you see?').fill('Fee sign observed on November 5 says twelve dollars.');
  await dialog.getByLabel(/first-hand/).check(); await context.setOffline(true);
  await dialog.getByRole('button',{name:'Send report'}).click();
  await expect(dialog.locator('.kt-report-msg')).toContainText('You are offline',{timeout:2000});
  await expect(dialog.locator('.kt-report-msg')).toHaveAttribute('aria-live','polite');
  await expect(dialog.locator('.kt-report-msg')).toBeVisible();
  await expect(dialog.locator('.kt-report-msg')).toBeInViewport();
  await context.setOffline(false); await page.waitForTimeout(300); expect(requests.submissions).toEqual([]);
  await expect(dialog.getByLabel('What did you see?')).toHaveValue('Fee sign observed on November 5 says twelve dollars.');
  await expect(dialog.getByLabel('Fee is wrong')).toBeChecked(); await page.keyboard.press('Escape');
  await context.setOffline(true); await page.locator('#map').scrollIntoViewIfNeeded();
  await page.evaluate(()=>KampTrailLayers.openSpot(L.latLng(43.001,-75.001)));
  const spot=page.locator('.kt-spot-popup');
  await expect(spot.locator('.kt-spot-land')).toContainText('Try again when connected',{timeout:2000});
  await expect(spot.locator('.kt-spot-land')).toHaveAttribute('aria-live','polite');
  await expect(spot.locator('.kt-spot-land')).toBeVisible();
  await spot.getByRole('button',{name:'Forecast + elevation'}).click();
  await expect(spot.locator('.kt-spot-wx')).toContainText('unavailable',{timeout:2000});
  await expect(spot.locator('.kt-spot-wx')).toHaveAttribute('aria-live','polite');
  await expect(spot.locator('.kt-spot-wx')).toBeVisible();
  await context.setOffline(false); await page.waitForTimeout(300);
  expect(requests.lookups).toEqual([]); expect(requests.submissions).toEqual([]);
});

test('keyboard users can bypass markers, open filters and saved stops, and return focus',async({page,context})=>{
  await ready(page,context); await page.locator('#results-toggle').focus(); await page.keyboard.press('Tab');
  const skip=page.getByRole('link',{name:'Skip map markers'}); await expect(skip).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('.leaflet-control-layers-toggle')).toBeFocused();
  // The sequential path before the map also reaches tools without traversing markers.
  await page.locator('#results-toggle').focus(); await page.keyboard.press('Tab'); await expect(skip).toBeFocused();
  await page.keyboard.press('Tab');
  if(await page.locator('#install-kamptrail').isVisible()) {await expect(page.locator('#install-kamptrail')).toBeFocused();await page.keyboard.press('Tab');}
  await expect(page.locator('#filters')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.locator('#kt-f-close')).toBeFocused(); await page.keyboard.press('Escape');
  await expect(page.locator('#filters')).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.locator('#rig-profile')).toBeFocused(); await page.keyboard.press('Tab');
  await expect(page.locator('#trip')).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.locator('#kt-trip-drawer')).toBeVisible(); await page.keyboard.press('Escape');
  await expect(page.locator('#trip')).toBeFocused();
});

async function target44(locator,label) {
  await expect(locator,label).toBeVisible(); await locator.scrollIntoViewIfNeeded();
  const rect=await locator.boundingBox();
  expect(rect.width,`${label} width`).toBeGreaterThanOrEqual(44);
  expect(rect.height,`${label} height`).toBeGreaterThanOrEqual(44);
}
test('primary touch targets measure at least 44 pixels at narrow and short phone sizes',async({page,context})=>{
  await ready(page,context);
  for(const viewport of [{width:360,height:640},{width:430,height:640},{width:360,height:480},{width:430,height:480}]) {
    await page.setViewportSize(viewport);
    for(const selector of ['#destination','#search-form button','#state-select','#results-toggle','#filters','#rig-profile','#trip','.kt-off-toggle','.leaflet-control-layers-toggle','.leaflet-control-zoom-in','.leaflet-control-zoom-out']) {
      await target44(page.locator(selector),`${viewport.width}x${viewport.height} ${selector}`);
    }
    await page.locator('#filters').click();
    for(const selector of ['#kt-f-reset','#kt-f-close','#kt-filter-show','#f-type','#f-rig','.cost-options label:has([value="free"])']) {
      await target44(page.locator(selector),`${viewport.width}x${viewport.height} ${selector}`);
    }
    await expect(page.locator('#kt-filter-show')).toBeInViewport(); await page.keyboard.press('Escape');
    await page.locator('#trip').click();
    for(const selector of ['#kt-trip-close','#kt-trip-export','#kt-trip-import']) await target44(page.locator(selector),`${viewport.width}x${viewport.height} ${selector}`);
    await expect(page.locator('#kt-trip-close')).toBeInViewport(); await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test('fee, type and rig changes show the actual rendered result count including zero and reset',async({page,context})=>{
  await page.setViewportSize({width:1440,height:1000}); await ready(page,context);
  const names=page.locator('#result-list .site-card h3');
  async function results(expected) {
    await expect(page.locator('#kt-filter-show')).toHaveText(`Show ${expected.length} results`);
    await page.locator('#kt-filter-show').click();
    await expect(names).toHaveCount(expected.length);
    expect((await names.allTextContents()).sort()).toEqual([...expected].sort());
    for(const name of expected) await expect(names.filter({hasText:name})).toBeVisible();
    await expect(page.locator('#result-summary')).toContainText(`${expected.length} in this view`);
    if(!expected.length) await expect(page.locator('#result-list .list-empty')).toContainText('No matching campsite listings');
    await page.locator('#filters').click();
  }
  await page.locator('#filters').click(); await results(features.map(f=>f.properties.name));
  await page.locator('[name="f-cost"][value="free"]').check(); await results(['Closeout Free Tent','Closeout Free Dispersed']);
  await page.locator('#f-type').selectOption('established'); await results(['Closeout Free Tent']);
  await page.locator('#f-rig').selectOption('trailer'); await results([]);
  await page.locator('#kt-f-reset').click(); await results(features.map(f=>f.properties.name));
  await expect(page.locator('[name="f-cost"][value="all"]')).toBeChecked();
  await expect(page.locator('#f-type')).toHaveValue('all'); await expect(page.locator('#f-rig')).toHaveValue('all');
});
