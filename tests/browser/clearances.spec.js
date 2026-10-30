const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {mockServices}=require('./helpers/services-fixture');
const source=require('../../data/clearances/RI.json');
test.use({serviceWorkers:'block'});
const first=source.records[0],row={...first,geometry:{type:'LineString',coordinates:[[-71.45,41.81],[-71.44,41.81]]},tags:{maxheight:`13'6"`,'maxheight:conditional':'3 @ (wet)'},metres:{maxheight:4.1148},context:{name:'Bridge <img src=x>',highway:'secondary'}};
const data={...source,records:[row]},pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function setup(page,context,{mobile=false,broken=false}={}){
  if(mobile)await page.setViewportSize({width:390,height:844});const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const json=(r,d)=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  await page.route('**/data/clearances/RI.json',r=>{calls.push(r.request().url());return broken?r.fulfill({status:503,body:'unavailable'}):json(r,data);});
  const camp={type:'Feature',geometry:{type:'Point',coordinates:[-71.45,41.81]},properties:{id:'camp:clearance-test',name:'Nearby test campground',schema_version:3,type:'established',source:'US Forest Service',amenities:[],rig_friendly:[]}};
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'RI',count:1}],total_sites:1}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
  await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features:[camp]}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:41.81,lng:-71.445,zoom:12})));
  await page.goto('/');await page.waitForFunction(()=>window.KampTrailClearances&&window.map);return{calls,errors};
}
async function show(page){
  await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  const checkbox=page.getByLabel('Reported height tags (Rhode Island pilot)',{exact:true});if(!await checkbox.isChecked()){await checkbox.focus();await checkbox.press('Space');}await expect(checkbox).toBeChecked();
  await page.locator('#map').click({position:{x:2,y:40}});
}
test('height evidence is opt-in with safe raw tags, exact source link and no physical/route inference',async({page,context})=>{
  const {calls,errors}=await setup(page,context);expect(calls).toEqual([]);await show(page);
  const control=page.locator('.kt-clearance-control');await expect(control).toContainText('1 source height-tag record');
  await control.getByRole('button',{name:'Open selected height tags'}).click();const popup=page.locator('.kt-clearance-popup');
  await expect(popup).toContainText('Bridge <img src=x>');await expect(popup.locator('img')).toHaveCount(0);
  await expect(popup).toContainText('Physical-height tag (maxheight:physical): Unknown');await expect(popup).toContainText('conditions are not interpreted');
  await expect(popup).toContainText('does not match these tags to your route');await expect(popup).toContainText(source.source.retrieved_at);
  await expect(popup.getByRole('link',{name:'OpenStreetMap source object'})).toHaveAttribute('href',`https://www.openstreetmap.org/way/${row.osm_id}`);
  expect(errors).toEqual([]);
});
test('mobile keyboard details and close control are accessible; missing regional coverage stays unknown',async({page,context})=>{
  const {errors}=await setup(page,context,{mobile:true});await show(page);const control=page.locator('.kt-clearance-control');await expect(control).toContainText('1 source height-tag record');
  expect(await control.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.kt-clearance-control').analyze()).violations).toEqual([]);
  await control.getByRole('button',{name:'Open selected height tags'}).press('Enter');const popup=page.locator('.kt-clearance-popup');await expect(popup).toBeVisible();await expect(popup).toBeFocused();
  expect((await new AxeBuilder({page}).include('.kt-clearance-popup').analyze()).violations).toEqual([]);await page.getByRole('button',{name:'Close popup',exact:true}).click({timeout:5000});
  await expect(control).toBeVisible();await page.evaluate(()=>map.setView([40.75,-111.88],10));await expect(control).toContainText('0 source height-tag records');await expect(control).toContainText('other areas are unknown');expect(errors).toEqual([]);
});
test('failed and corrupt source reads preserve dated cache; a fresh loader without saved evidence stays unknown',async({page,context})=>{
  const {errors}=await setup(page,context);await show(page);const control=page.locator('.kt-clearance-control');await expect(control).toContainText('1 source height-tag record');
  await page.route('**/data/clearances/RI.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...data,source:{...data.source,sha256:'bad'}})}));
  await control.getByRole('button',{name:'Retry height-tag evidence'}).click();await expect(control).toContainText('Saved snapshot');
  await context.setOffline(true);await expect(control).toContainText('Saved snapshot');await context.setOffline(false);await page.reload();await show(page);await expect(control).toContainText('Saved snapshot');
  await page.evaluate(async()=>{for(const key of await caches.keys())if(key.endsWith(':clearance-v1'))await caches.delete(key);});await page.reload();await show(page);await expect(control).toContainText('evidence unavailable');await expect(control).toContainText('unknown');expect(errors).toEqual([]);
});
test('an open source popup keeps its original record and dates while a newer snapshot loads',async({page,context})=>{
  const {calls,errors}=await setup(page,context);await show(page);const control=page.locator('.kt-clearance-control');await expect(control).toContainText('1 source height-tag record');
  await control.getByRole('button',{name:'Open selected height tags'}).click();const popup=page.locator('.kt-clearance-popup');await expect(popup).toContainText(source.source.extract_timestamp);
  const newer={...data,source:{...data.source,extract_timestamp:'2026-10-29T21:21:02Z',resolved_url:data.source.resolved_url.replace('261028','261029'),retrieved_at:'2026-10-30T17:20:00Z',sha256:'b'.repeat(64)},records:[{...row,tags:{maxheight:`13'11"`},metres:{maxheight:4.2418}}]};
  await page.route('**/data/clearances/RI.json',r=>{calls.push(r.request().url());return r.fulfill({contentType:'application/json',body:JSON.stringify(newer)});});await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect.poll(()=>calls.length).toBe(2);await expect(control).toContainText('2026-10-29');
  await expect(popup).toContainText(source.source.extract_timestamp);await expect(popup).toContainText(`13'6"`);await expect(popup).not.toContainText(newer.source.extract_timestamp);
  await page.getByRole('button',{name:'Close popup',exact:true}).click();await expect(control).toContainText('2026-10-29');await control.getByRole('button',{name:'Open selected height tags'}).click();await expect(popup).toContainText(newer.source.extract_timestamp);await expect(popup).toContainText(`13'11"`);expect(errors).toEqual([]);
});
for(const viewport of [{width:1363,height:936},{width:390,height:844}]){
 test(`map layer clicks stay reachable with services, rest areas and height tags at ${viewport.width}px`,async({page,context})=>{
  await page.setViewportSize(viewport);await mockServices(page);
  const rest=require('../../data/rest-areas/TX.json');
  await page.route('**/data/rest-areas/TX.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(rest)}));
  const {errors}=await setup(page,context);
  async function toggle(name,checked=true){
   await page.getByRole('button',{name:'Map layers',exact:true}).click();
   const input=page.getByLabel(name,{exact:true});await expect(input).toBeVisible();
   await input.setChecked(checked);await expect(input).toBeChecked({checked});
   await page.locator('#map').click({position:{x:2,y:40}});
  }
  await toggle('Services (7 categories)');await expect(page.locator('.kt-services-control')).toBeVisible();
  await toggle('Official rest areas (Texas pilot)');await expect(page.locator('.kt-rest-control')).toBeVisible();
  await toggle('Reported height tags (Rhode Island pilot)');await expect(page.locator('.kt-clearance-control')).toContainText('1 source height-tag record');
  // Reach the last service action through the panel's real internal scrolling.
  await page.getByRole('button',{name:'Retry service areas',exact:true}).click();
  for(const selector of ['.kt-services-control','.kt-rest-control','.kt-clearance-control']){
   const panel=page.locator(selector);await expect(panel).toBeVisible();
   const fits=await panel.evaluate(e=>{const p=e.getBoundingClientRect(),m=document.querySelector('#map').getBoundingClientRect();return p.top>=m.top&&p.bottom<=m.bottom&&e.scrollWidth<=e.clientWidth+1;});expect(fits).toBe(true);
  }
  const left=await page.locator('.kt-clearance-control').boundingBox(),right=await page.locator('.kt-rest-control').boundingBox();expect(left.x+left.width).toBeLessThanOrEqual(right.x);
  // An existing popup must still let an ordinary pointer click reach Close.
  await page.getByRole('button',{name:'Open selected height tags',exact:true}).click();
  await expect(page.locator('.kt-clearance-popup')).toBeVisible();
  await page.getByRole('button',{name:'Close popup',exact:true}).click();
  await toggle('Reported height tags (Rhode Island pilot)',false);
  await toggle('Reported height tags (Rhode Island pilot)');
  await page.getByRole('button',{name:'Offline',exact:true}).click();await expect(page.getByRole('region',{name:'Offline maps',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
 });
}
