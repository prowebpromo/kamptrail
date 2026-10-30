const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {mockServices}=require('./helpers/services-fixture');
test.use({serviceWorkers:'block'});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function fixture(page,context,{zoom=11,mobile=false,corrupt=false}={}){
 if(mobile)await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route(/^https:\/\//,route=>route.fulfill({contentType:'image/png',body:pixel}));
 const services=await mockServices(page,{corrupt});
 const campsite={type:'Feature',geometry:{type:'Point',coordinates:[-111.88,40.75]},properties:{id:'camp:pilot',name:'Pilot campground',schema_version:3,type:'established',source:'US Forest Service',camping_activity:'Campground Camping',amenities:[],rig_friendly:[]}};
 const json=(r,d)=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
 await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'UT',count:1}],total_sites:1}));
 await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
 await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
 await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features:[campsite]}));
 await page.addInitScript(z=>{if(!localStorage.getItem('kt_last_position'))localStorage.setItem('kt_last_position',JSON.stringify({lat:40.75,lng:-111.88,zoom:z}));if(localStorage.getItem('test_services_offline')==='1')Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});},zoom);
 await page.goto('/');await page.waitForFunction(()=>window.KampTrailLayers&&window.KampTrailServices&&window.map);
 return{...services,errors};
}
const ids=page=>page.evaluate(()=>KampTrailLayers.serviceIds().sort());
test('map services are zoom gated and share categories/access/identity with nearby and route',async({page,context})=>{
 const {requests,errors}=await fixture(page,context,{zoom:9});expect(requests).toEqual([]);await expect(page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(1);
 await page.evaluate(()=>KampTrailLayers.showServices());await expect(page.locator('.kt-services-status')).toContainText('Zoom to level 10');expect(requests).toEqual([]);
 await page.evaluate(()=>map.setZoom(11));await expect.poll(()=>ids(page)).toEqual(['osm:node:1','osm:node:3']);
 await page.getByRole('button',{name:'Clear service categories',exact:true}).click();await expect.poll(()=>ids(page)).toEqual([]);
 await page.locator('.kt-services-control').getByLabel('Fuel',{exact:true}).check();await expect.poll(()=>ids(page)).toEqual(['osm:node:1']);
 const parity=await page.evaluate(async()=>{const near=await KampTrailData.loadServices(40.75,-111.88),route=await KampTrailServices.loadRoute([[-111.95,40.75],[-111.8,40.75]],5);return{near:near.items.map(x=>x.id),route:route.items.map(x=>x.id),filters:KampTrailData.getCurrentFilters()};});expect(parity.near).toEqual(['osm:node:1']);expect(parity.route).toEqual(parity.near);expect(parity.filters.cost).toBe('all');
 await page.evaluate(()=>map.eachLayer(layer=>{if(layer.ktServiceId==='osm:node:1')layer.openPopup();}));
 const popup=page.locator('.kt-svc-popup');await expect(popup).toContainText('customers (conditional)');await expect(popup).toContainText('2026-01-01');await expect(popup).toContainText('overnight permission are not verified');await expect(popup.locator('img')).toHaveCount(0);expect((await new AxeBuilder({page}).include('.kt-svc-popup').analyze()).violations).toEqual([]);
 await popup.getByRole('button',{name:'Save service stop'}).click();expect(await page.evaluate(()=>KampTrailTrip.getStops().find(s=>s.id==='osm:node:1')?.feature.properties.type)).toBe('service');
 await page.evaluate(()=>{KampTrailTrip.toggle();map.closePopup();});await page.locator('.leaflet-control-layers').hover();await page.getByLabel('Satellite',{exact:true}).check();await expect(page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(1);
 await page.getByLabel('Services (7 categories)',{exact:true}).uncheck();await expect(page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(0);await page.locator('.leaflet-control-layers').hover();await expect(page.getByLabel('Services (7 categories)',{exact:true})).toBeVisible();await page.getByLabel('Services (7 categories)',{exact:true}).check();await expect(page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]')).toHaveCount(1);
 await page.reload();await page.waitForFunction(()=>window.KampTrailServices);expect(await page.evaluate(()=>KampTrailServices.getCategories())).toEqual(['fuel']);expect(errors).toEqual([]);
});
test('saved dated services survive offline reload and missing areas remain unknown',async({page,context})=>{
 const {errors}=await fixture(page,context);await page.evaluate(()=>KampTrailLayers.showServices());await expect.poll(()=>ids(page)).toEqual(['osm:node:1','osm:node:3']);
 await page.evaluate(async()=>{await KampTrailServices._cacheSettled();localStorage.setItem('test_services_offline','1');});
 // Reload the app shell while the service client sees offline; block all POI requests as well.
 await page.route('**/data/services/**',r=>r.abort('internetdisconnected'));await page.reload();await page.waitForFunction(()=>window.KampTrailServices);await page.evaluate(()=>KampTrailLayers.showServices());
 await expect(page.locator('.kt-services-status')).toContainText('Saved dated evidence');await expect.poll(()=>ids(page)).toEqual(['osm:node:1','osm:node:3']);
 await context.setOffline(true);await page.evaluate(()=>map.setView([38.5,-109.5],11));await expect(page.locator('.kt-services-status')).toContainText('missing areas are unknown');await expect.poll(()=>ids(page)).toEqual([]);await context.setOffline(false);expect(errors).toEqual([]);
});
test('corrupt shard is visibly partial and retry succeeds; nearby evidence and mobile controls are accessible',async({page,context})=>{
 const {repair,errors,manifest,files}=await fixture(page,context,{mobile:true,corrupt:true});
 const source=manifest.coverage[0];manifest.coverage=Object.entries(require('../../scripts/services-regions.json').regions).map(([region,entry],i)=>({...source,region,url:entry.url,count:region==='UT'?4:0,retrieved_at:i%2?'2026-01-02T00:00:00Z':source.retrieved_at}));manifest.generated_at='2026-01-03T00:00:00Z';files['index.json']=JSON.stringify(manifest);
 await page.evaluate(()=>KampTrailLayers.showServices());await expect(page.locator('.kt-services-status')).toContainText('Partial results');await expect.poll(()=>ids(page)).toEqual([]);repair();await page.getByRole('button',{name:'Retry service areas',exact:true}).click();await expect.poll(()=>ids(page)).toEqual(['osm:node:1','osm:node:3']);
 await expect(page.locator('.kt-services-status')).toContainText('50 state extracts, retrieved 2026-01-01 to 2026-01-02');expect(await page.locator('.kt-services-status').evaluate(e=>e.textContent.length)).toBeLessThan(400);
 const control=page.locator('.kt-services-control');expect(await control.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.kt-services-control').analyze()).violations).toEqual([]);
 await control.getByRole('button',{name:'Clear service categories',exact:true}).focus();await page.keyboard.press('Enter');await expect.poll(()=>ids(page)).toEqual([]);await control.getByLabel('Fuel',{exact:true}).check();
 // A passive startup notice must not block controls while it remains visible.
 await page.evaluate(()=>showToast('Offline saving is unavailable. You can still use the map online.','info',0));
 const toast=page.locator('#toast');await expect(toast).toBeVisible();await expect(toast).toHaveCSS('pointer-events','none');
 await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');
 const picker=page.locator('.leaflet-control-layers');await expect(picker).toHaveClass(/leaflet-control-layers-expanded/);await expect(control).toBeHidden();
 const servicesLayer=page.getByLabel('Services (7 categories)',{exact:true});await expect(servicesLayer).toBeVisible();await expect(servicesLayer).toBeChecked();
 await servicesLayer.uncheck();await expect(servicesLayer).not.toBeChecked();await expect(toast).toBeVisible();await page.locator('#map').click({position:{x:2,y:40}});
 await page.waitForFunction(()=>KampTrailData.getCampsiteById('camp:pilot'));await page.evaluate(()=>KampTrailData.focusCampsite('camp:pilot'));
 const popup=page.locator('.kt-site-popup');await popup.getByRole('button',{name:'Nearest RV services',exact:true}).click();
 await expect(popup.getByRole('heading',{name:'Services within 30 miles (straight-line)',level:3})).toBeVisible();await expect(popup.locator('[data-service-id="osm:node:1"]')).toContainText('customers');expect((await new AxeBuilder({page}).include('.kt-site-popup').analyze()).violations).toEqual([]);
 await page.evaluate(()=>KampTrailServices.setCategories(['laundry']));await expect(popup.locator('[data-service-id="osm:node:3"]')).toContainText('Pilot laundry');await expect(popup.locator('[data-service-id="osm:node:1"]')).toHaveCount(0);expect(errors).toEqual([]);
});
test('superseded viewport response cannot replace the current map services',async({page,context})=>{
 const {files,errors}=await fixture(page,context);let release,started=false;
 await page.route('**/data/services/snapshots/*/utah.json',async r=>{started=true;await new Promise(resolve=>release=resolve);try{await r.fulfill({contentType:'application/json',body:Object.entries(files).find(([p])=>p.endsWith('/utah.json'))[1]});}catch{}});
 await page.evaluate(()=>{KampTrailLayers.showServices();});await expect.poll(()=>started).toBe(true);await page.evaluate(()=>map.setView([38.5,-109.5],11));await expect.poll(()=>ids(page)).toEqual(['osm:node:4']);release();await expect.poll(()=>ids(page)).toEqual(['osm:node:4']);expect(errors).toEqual([]);
});
