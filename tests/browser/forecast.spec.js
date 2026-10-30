const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block'});
const {createHash}=require('node:crypto');
const AxeBuilder=require('@axe-core/playwright').default;
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const now=Date.parse('2026-10-29T12:00:00Z'),iso=n=>new Date(n).toISOString().replace('.000Z','Z'),snapshot='a'.repeat(24),catalogue='b'.repeat(64);
async function fixture(page,context,{zoom=11,mobile=false,corrupt=false}={}){
 if(mobile)await page.setViewportSize({width:390,height:844});
 const errors=[],requests=[];let serverNow=now,invalidBytes=corrupt;page.on('pageerror',e=>errors.push(e.message));
 await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
 const samples=[['cold',-10],['zero',0],['warm',10],['partial',0],['unknown',null],['later',0]];
 const features=samples.map(([name],i)=>({type:'Feature',geometry:{type:'Point',coordinates:[-75.1+i*.005,43]},properties:{id:'forecast:'+name,name:'Forecast '+name+' Campground',camping_activity:'Campground Camping',schema_version:3,type:'established',source:'US Forest Service',amenities:[],rig_friendly:[]}}));
 const records=Object.fromEntries(features.map((f,i)=>{const [lng,lat]=f.geometry.coordinates,t=samples[i][1],key=lat.toFixed(7)+','+lng.toFixed(7);return[f.properties.id,t===null?{status:'unknown',coordinate_key:key,reason:'missing grid'}:{coordinate_key:key,region:'conus',status:'known',grid_lat:lat,grid_lng:lng,grid_distance_m:0,temperatures_c:Array(60).fill(t)}];}));
 records['forecast:partial'].temperatures_c[8]=null;records['forecast:later'].temperatures_c[24]=5;
 const generated=iso(now-300000),expires=iso(now+2*3600000),raw=JSON.stringify({version:1,snapshot_id:snapshot,state:'NY',generated_at:generated,expires_at:expires,records});
 const manifest={version:1,snapshot_id:snapshot,catalogue_sha256:catalogue,generated_at:generated,expires_at:expires,source:{name:'NOAA/NWS NDFD',files:[{region:'conus',url:'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.conus/VP.001-003/ds.temp.bin',etag:'opaque-validator',sha256:'e'.repeat(64),last_modified:iso(now-900000),bytes:100}]},regions:{conus:{times:Array.from({length:60},(_,i)=>iso(now+(i+1)*3600000)),grid_sha256:'c'.repeat(64),max_step_seconds:3600,reference_times:[iso(now)]}},states:{NY:{asset:`forecast-v1-${snapshot}-NY.json.gz`,sha256:'d'.repeat(64),json_sha256:createHash('sha256').update(raw).digest('hex'),bytes:200,json_bytes:Buffer.byteLength(raw),count:6}},coverage:{total:6,grid_known:5,unknown:1}};
 const search={version:1,filter_version:1,community_version:1,elevation_version:1,sites:features.map(f=>{const [lng,lat]=f.geometry.coordinates;return{id:f.properties.id,name:f.properties.name,states:['NY'],lat,lng,m:{t:'established'}};})};search.sites.push({id:'far',name:'Far California Campground',states:['CA'],lat:36,lng:-120,m:{t:'established'}});
 const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'NY',count:6}],total_sites:6}));
 await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
 await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
 await page.route('**/data/campsites/search-index.json',r=>json(r,search));
 await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features}));
 await page.route('**/data/campsites/elevation/**',r=>r.fulfill({status:503,body:'unavailable'}));
 await page.route('**/data/campsites/coordinate-index.json',r=>{requests.push(r.request().url());return json(r,{version:1,sha256:catalogue,count:6});});
 await page.route('**/api/forecast.php?*',r=>{requests.push(r.request().url());return new URL(r.request().url()).searchParams.get('kind')==='index'?json(r,{ok:true,server_now:iso(serverNow),manifest}):r.fulfill({contentType:'application/json',body:raw+(invalidBytes?' ':'')});});
 await page.addInitScript(zoom=>{if(localStorage.getItem('kt_last_position')===null)localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75.085,zoom}));},zoom);
 await page.goto('/');await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getLoadStatus().catalogueTotal===6);
 if(zoom>=8)await page.waitForFunction(()=>KampTrailData.getAllCampsites().length===6&&!KampTrailData.getLoadStatus().loading);
 return{errors,requests,manifest,setServerNow:value=>{serverNow=value;},repair:()=>{invalidBytes=false;}};
}
async function panel(page){await page.getByRole('button',{name:'Open filters',exact:true}).click();return page.getByRole('region',{name:'Campsite filters'});}
async function bound(p,label,value){const n=p.getByLabel(label,{exact:true});await n.fill(value);await n.press('Tab');}
const visible=page=>page.evaluate(()=>KampTrailData.getVisibleCampsites().map(f=>f.properties.id).sort());
test('forecast downloads are lazy and zero/negative inclusive controls persist, change horizon, and reset',async({page,context})=>{
 const {requests,errors}=await fixture(page,context,{zoom:4});const p=await panel(page);
 await bound(p,'Minimum forecast sample temperature (°F)','32');await bound(p,'Maximum forecast sample temperature (°F)','32');expect(requests).toHaveLength(0);await expect(p.locator('#f-forecast-status')).toContainText('Zoom in');
 await page.evaluate(()=>map.setView([43,-75.085],11));await expect.poll(()=>visible(page)).toEqual(['forecast:later','forecast:zero']);
 await expect(p.locator('#f-forecast-status')).toContainText('2 listings matching other filters');await p.getByLabel('Forecast window',{exact:true}).selectOption('48');await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);
 await p.getByLabel('Temperature units',{exact:true}).selectOption('C');await expect(p.getByLabel('Minimum forecast sample temperature (°C)',{exact:true})).toHaveValue('0');
 await bound(p,'Minimum forecast sample temperature (°C)','-10');await expect.poll(()=>visible(page)).toEqual(['forecast:cold','forecast:zero']);
 await bound(p,'Minimum forecast sample temperature (°C)','2');await expect(p.locator('#f-forecast-error')).toContainText('last valid filter remains applied');await expect.poll(()=>visible(page)).toEqual(['forecast:cold','forecast:zero']);
 await bound(p,'Minimum forecast sample temperature (°C)','-10');await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kt_last_position')).zoom)).toBe(11);await page.reload();await expect.poll(()=>visible(page)).toEqual(['forecast:cold','forecast:zero']);const restored=await panel(page);await expect(restored.getByLabel('Minimum forecast sample temperature (°C)',{exact:true})).toHaveValue('-10');await expect(restored.getByLabel('Forecast window',{exact:true})).toHaveValue('48');
 await restored.getByRole('button',{name:'Reset',exact:true}).click();await expect.poll(()=>visible(page)).toHaveLength(6);await expect(restored.getByLabel('Minimum forecast sample temperature (°F)',{exact:true})).toHaveValue('');expect(errors).toEqual([]);
});
test('route fetches only corridor candidate states and shares map matching; offline preserves controls and excludes forecasts',async({page,context})=>{
 const {requests,errors}=await fixture(page,context);expect(requests).toHaveLength(0);const p=await panel(page);await bound(p,'Minimum forecast sample temperature (°F)','32');await bound(p,'Maximum forecast sample temperature (°F)','32');await p.getByLabel('Forecast window',{exact:true}).selectOption('48');await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);
 await page.evaluate(async()=>{const points=[[-75.2,43],[-75,43]];for(const [i,coordinates]of points.entries()){const feature={type:'Feature',geometry:{type:'Point',coordinates},properties:{id:'stop:'+i,name:'Route stop '+i}};KampTrailTrip.addStop(feature.properties.id,feature);}KampTrailTrip.toggle();await KampTrailRoutes.open({distance:16000,duration:1200,calculated_at:new Date().toISOString(),geometry:{type:'LineString',coordinates:points},legs:[{distance:16000,duration:1200}],leg_ends:[1]},KampTrailTrip.getStops().map(s=>s.feature));});
 const d=page.getByRole('dialog',{name:'Campsites along your route'});await expect(d.locator('.kt-route-result')).toHaveCount(1);await expect(d).toContainText('Forecast zero Campground');await expect(d).toContainText('2 listings matching other filters in this corridor');await expect(d).toContainText('NOAA/NWS NDFD file updated');await expect(d).toContainText('not each location’s forecast issuance');expect(requests.filter(u=>u.includes('state=CA'))).toHaveLength(0);
 await context.setOffline(true);await expect(d.locator('.kt-route-result')).toHaveCount(0);await expect(d).toContainText('Offline');await expect.poll(()=>visible(page)).toEqual([]);expect(await page.evaluate(()=>KampTrailFilters.getFilters().forecastMinC)).toBe(0);
 await d.getByRole('button',{name:'Close',exact:true}).click();await expect(p.getByLabel('Maximum forecast sample temperature (°F)',{exact:true})).toHaveValue('32');await context.setOffline(false);await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);expect(errors).toEqual([]);
});
test('mobile forecast controls and shared canonical bounds are accessible',async({page,context})=>{
 const {errors}=await fixture(page,context,{mobile:true});const p=await panel(page);await bound(p,'Minimum forecast sample temperature (°F)','32');await bound(p,'Maximum forecast sample temperature (°F)','32');await p.getByLabel('Forecast window',{exact:true}).selectOption('48');await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);
 expect(await p.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.kt-forecast-filters').analyze()).violations).toEqual([]);
 await p.getByRole('button',{name:'Close filters',exact:true}).click();await expect(p).not.toBeVisible();
 const hash=await page.evaluate(()=>{const url=KampTrailShare.linkFor({site:'forecast:zero'});KampTrailFilters.reset();return new URL(url).hash;});await page.evaluate(hash=>location.hash=hash,hash);await expect.poll(()=>page.evaluate(()=>KampTrailFilters.getFilters().forecastMaxC)).toBe(0);await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);await expect(page.locator('.kt-site-popup')).toHaveCount(1);await expect(page.locator('.kt-site-popup')).toContainText('48 published samples');await expect(page.locator('.kt-site-popup')).toContainText('cadence up to 1 h');expect((await new AxeBuilder({page}).include('.kt-site-popup').analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
test('checksum failure is visible and retryable without clearing selected forecast bounds',async({page,context})=>{
 const {errors,repair}=await fixture(page,context,{corrupt:true});const p=await panel(page);await bound(p,'Maximum forecast sample temperature (°F)','32');await expect.poll(()=>visible(page)).toEqual([]);await expect(p.locator('#f-forecast-status')).toContainText('unavailable for NY');await expect(p.getByRole('button',{name:'Retry forecast samples',exact:true})).toBeEnabled();await expect(p.getByLabel('Maximum forecast sample temperature (°F)',{exact:true})).toHaveValue('32');repair();await p.getByRole('button',{name:'Retry forecast samples',exact:true}).click();await expect.poll(()=>visible(page)).toEqual(['forecast:cold','forecast:later','forecast:zero']);expect(errors).toEqual([]);
});

test('server clock survives device time skew, refreshes on resume and expires without clearing bounds',async({page,context})=>{
 await page.clock.install({time:new Date('2040-01-01T00:00:00Z')});
 const {errors,requests,setServerNow}=await fixture(page,context);const p=await panel(page);
 await bound(p,'Minimum forecast sample temperature (°F)','32');await bound(p,'Maximum forecast sample temperature (°F)','32');
 await expect.poll(()=>visible(page)).toEqual(['forecast:later','forecast:zero']);
 expect(await page.evaluate(()=>new Date().getUTCFullYear())).toBe(2040);
 expect(await page.evaluate(()=>Math.abs(KampTrailForecast.effectiveNow()-Date.parse('2026-10-29T12:00:00Z')))).toBeLessThan(60000);
 const indexes=requests.filter(u=>u.includes('kind=index')).length;setServerNow(now+3600000);
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect.poll(()=>requests.filter(u=>u.includes('kind=index')).length).toBeGreaterThan(indexes);
 await expect.poll(()=>visible(page)).toEqual(['forecast:zero']);
 setServerNow(now+2*3600000+1000);await page.clock.fastForward(2*3600000+1000);
 await expect.poll(()=>visible(page)).toEqual([]);await expect(p.locator('#f-forecast-status')).toContainText('expired');
 await expect(p.getByLabel('Minimum forecast sample temperature (°F)',{exact:true})).toHaveValue('32');
 expect(await page.evaluate(()=>KampTrailForecast.status().ready)).toBe(false);expect(errors).toEqual([]);
});
