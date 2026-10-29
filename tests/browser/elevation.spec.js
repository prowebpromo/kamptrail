const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const {createHash}=require('node:crypto');
const AxeBuilder=require('@axe-core/playwright').default;
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const source='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',snapshot='a'.repeat(24),date='2026-10-29T10:00:00Z';
async function fixture(page,context,{zoom=11,mobile=false}={}){
 if(mobile)await page.setViewportSize({width:390,height:844});
 const errors=[],elevationRequests=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
 const samples=[['below',-20],['zero',0],['high',304.8],['unknown',null]];
 const features=samples.map(([name],i)=>({type:'Feature',geometry:{type:'Point',coordinates:[-75.1+i*.01,43]},properties:{id:'elev:'+name,name:'Elevation '+name+' Campground',camping_activity:'Campground Camping',schema_version:3,type:'established',source:'US Forest Service',amenities:[],rig_friendly:[]}}));
 const records=Object.fromEntries(features.map((f,i)=>{const [lng,lat]=f.geometry.coordinates,m=samples[i][1];return[f.properties.id,{status:m===null?'unknown':'known',elevation_m:m,coordinate_key:lat.toFixed(7)+','+lng.toFixed(7),sample_coordinates:m===null?null:{lat,lng},retrieved_at:date,source:{url:source,sample_url:source+'/getSamples',units:'metres',interpolation:'RSP_BilinearInterpolation',horizontal_crs:'EPSG:4326'}}];}));
 const sidecar={version:1,snapshot_id:snapshot,state:'NY',records,sources:{}},raw=JSON.stringify(sidecar),manifest={version:1,snapshot_id:snapshot,generated_at:date,source:{url:source,units:'metres',interpolation:'RSP_BilinearInterpolation'},states:{NY:{url:`snapshots/${snapshot}/NY.json`,sha256:createHash('sha256').update(raw).digest('hex'),count:4}}};
 const search={version:1,filter_version:1,community_version:1,elevation_version:1,sites:features.map(f=>{const r=records[f.properties.id],[lng,lat]=f.geometry.coordinates;return{id:f.properties.id,name:f.properties.name,states:['NY'],lat,lng,m:{t:'established',...(r.status==='known'?{e:{m:r.elevation_m,k:r.coordinate_key,d:r.retrieved_at}}:{})}};})};
 const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'NY',count:4}],total_sites:4}));
 await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
 await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
 await page.route('**/data/campsites/search-index.json',r=>json(r,search));
 await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features}));
 await page.route('**/data/campsites/elevation/**',r=>{elevationRequests.push(r.request().url());return r.request().url().endsWith('/index.json')?json(r,manifest):r.fulfill({contentType:'application/json',body:raw});});
 await page.addInitScript(zoom=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75.085,zoom})),zoom);
 await page.goto('/');await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getLoadStatus().catalogueTotal===4);
 if(zoom>=8)await page.waitForFunction(()=>KampTrailData.getAllCampsites().length===4&&!KampTrailData.getLoadStatus().loading&&DataQuality.elevationInfo(KampTrailData.getCampsiteById('elev:zero')));
 return{errors,elevationRequests};
}
async function panel(page){await page.getByRole('button',{name:'Open filters',exact:true}).click();return page.getByRole('region',{name:'Campsite filters'});}
async function bound(panel,label,value){const input=panel.getByLabel(label,{exact:true});await input.fill(value);await input.press('Tab');}
const visible=page=>page.evaluate(()=>KampTrailData.getVisibleCampsites().map(f=>f.properties.id).sort());
test('elevation snapshots are lazy; inclusive feet/metres bounds persist and report unknown exclusions',async({page,context})=>{
 const {errors,elevationRequests}=await fixture(page,context,{zoom:4});expect(elevationRequests).toHaveLength(0);
 await page.evaluate(()=>map.setView([43,-75.085],11));await page.waitForFunction(()=>KampTrailData.getAllCampsites().length===4&&!KampTrailData.getLoadStatus().loading&&DataQuality.elevationInfo(KampTrailData.getCampsiteById('elev:zero')));
 const p=await panel(page);await bound(p,'Minimum elevation (feet)','0');await bound(p,'Maximum elevation (feet)','1000');
 await expect.poll(()=>visible(page)).toEqual(['elev:high','elev:zero']);await expect(p).toContainText('1 listings matching other filters in this view have unknown elevation and are excluded.');
 await p.getByLabel('Elevation units',{exact:true}).selectOption('m');await expect(p.getByLabel('Maximum elevation (metres)',{exact:true})).toHaveValue('304.8');
 await bound(p,'Minimum elevation (metres)','-20');await bound(p,'Maximum elevation (metres)','0');await expect.poll(()=>visible(page)).toEqual(['elev:below','elev:zero']);
 await bound(p,'Minimum elevation (metres)','20');await expect(p.locator('#f-elevation-error')).toContainText('last valid filter remains applied');await expect.poll(()=>visible(page)).toEqual(['elev:below','elev:zero']);
 await bound(p,'Minimum elevation (metres)','-20');await page.reload();const restored=await panel(page);await expect(restored.getByLabel('Minimum elevation (metres)',{exact:true})).toHaveValue('-20');await expect(restored.getByLabel('Maximum elevation (metres)',{exact:true})).toHaveValue('0');
 await restored.getByRole('button',{name:'Reset',exact:true}).click();await expect(restored.getByLabel('Minimum elevation (feet)',{exact:true})).toHaveValue('');await expect.poll(()=>visible(page)).toHaveLength(4);expect(errors).toEqual([]);
});
test('map and route share zero-elevation filtering, cached evidence and source/date explanations',async({page,context})=>{
 const {errors}=await fixture(page,context);const p=await panel(page);await bound(p,'Minimum elevation (feet)','0');await bound(p,'Maximum elevation (feet)','0');await expect.poll(()=>visible(page)).toEqual(['elev:zero']);
 await page.evaluate(async()=>{const points=[[-75.2,43],[-75,43]],stops=points.map((coordinates,i)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{id:'stop:'+i}}));await KampTrailRoutes.open({distance:16000,duration:1200,calculated_at:new Date().toISOString(),geometry:{type:'LineString',coordinates:points},legs:[{distance:16000,duration:1200}],leg_ends:[1]},stops);});
 const d=page.getByRole('dialog',{name:'Campsites along your route'});await expect(d.locator('.kt-route-result')).toHaveCount(1);await expect(d).toContainText('Elevation zero Campground');await expect(d).toContainText('1 listings matching other filters in this corridor have unknown elevation and are excluded.');await expect(d).toContainText('USGS 3DEP · retrieved 2026-10-29');await d.getByRole('button',{name:'View listing',exact:true}).click();await expect(d).not.toBeVisible();expect(await page.evaluate(()=>KampTrailFilters.getFilters().elevationMax)).toBe(0);
 await context.setOffline(true);await page.evaluate(()=>KampTrailData.refresh());await expect(p).toContainText('Saved static elevation evidence is in use.');await expect.poll(()=>visible(page)).toEqual(['elev:zero']);
 await page.evaluate(()=>KampTrailData.focusCampsite('elev:zero'));await expect(page.locator('.kt-site-popup')).toContainText('Approx. elevation 0 ft');await expect(page.locator('.kt-site-popup')).toContainText('Retrieval date is not acquisition date.');expect(errors).toEqual([]);
});
test('mobile elevation controls fit, pass a scoped accessibility scan and restore shared canonical bounds',async({page,context})=>{
 const {errors}=await fixture(page,context,{mobile:true});const p=await panel(page);await bound(p,'Minimum elevation (feet)','0');await bound(p,'Maximum elevation (feet)','1000');
 expect(await p.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.kt-elevation-filters').analyze()).violations).toEqual([]);
 const hash=await page.evaluate(()=>{const url=KampTrailShare.linkFor({site:'elev:high'});KampTrailFilters.reset();return new URL(url).hash;});await page.evaluate(hash=>location.hash=hash,hash);await expect.poll(()=>page.evaluate(()=>KampTrailFilters.getFilters().elevationMax)).toBe(304.8);await expect.poll(()=>page.evaluate(()=>KampTrailFilters.getFilters().elevationMin)).toBe(0);await expect(page.locator('.kt-site-popup')).toContainText('Approx. elevation 1,000 ft');await expect(page.locator('.kt-site-popup').getByRole('heading',{name:'Elevation high Campground',level:2})).toBeVisible();await page.getByRole('button',{name:'Fee evidence',exact:true}).click();await expect(page.locator('.kt-site-popup').getByRole('heading',{name:'Camping fee evidence',level:3})).toBeVisible();expect((await new AxeBuilder({page}).include('.kt-site-popup').analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
