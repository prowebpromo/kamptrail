const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const source=require('../../data/rest-areas/TX.json');
const statePolicies=require('../../data/rest-areas/state-policies.json');
test.use({serviceWorkers:'block'});
const row={...source.records[0],name:'Test rest area <img src=x>',coordinates:[-97.5623,30.9001]},data={...source,records:[row]};
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
async function setup(page,context,{mobile=false,broken=false,policyBroken=false}={}){
  if(mobile)await page.setViewportSize({width:390,height:844});const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
  const json=(r,d)=>r.fulfill({contentType:'application/json',body:JSON.stringify(d)});
  await page.route('**/data/rest-areas/TX.json',r=>{calls.push(r.request().url());return broken?r.fulfill({status:503,body:'unavailable'}):json(r,data);});
  await page.route('**/data/rest-areas/state-policies.json',r=>policyBroken?r.fulfill({status:503,body:'unavailable'}):json(r,statePolicies));
  const camp={type:'Feature',geometry:{type:'Point',coordinates:[-97.56,30.90]},properties:{id:'camp:rest-test',name:'Nearby test campground',schema_version:3,type:'established',source:'US Forest Service',amenities:[],rig_friendly:[]}};
  await page.route('**/data/campsites/index.json',r=>json(r,{states:[{state:'TX',count:1}],total_sites:1}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  await page.route('**/data/campsites/ridb-sites.json',r=>json(r,{version:1,facilities:{}}));
  await page.route('**/data/campsites/*_merged.geojson',r=>json(r,{type:'FeatureCollection',features:[camp]}));
  await page.route('**/api/permissions.php*',r=>{const d=r.request().postDataJSON();return json(r,{ok:true,official:{status:'unknown',activity:d.activity,summary:'No current official permission evidence is recorded.',as_of:'2026-10-30T00:00:00Z',evidence:[]},reports_available:false,count:0,reports:[],next_before:null});});
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:30.9001,lng:-97.5623,zoom:10})));
  await page.goto('/');await page.waitForFunction(()=>window.KampTrailRestAreas&&window.map);
  return{calls,errors};
}
async function show(page,{keyboard=false}={}){
 const checkbox=page.getByLabel('Official rest areas (Texas pilot)',{exact:true});
 if(keyboard)await page.getByRole('button',{name:'Map layers',exact:true}).press('Enter');else await page.locator('.leaflet-control-layers').hover();
 // Leaflet suppresses clicks for one task while expanding the menu.
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 if(keyboard){await checkbox.focus();await checkbox.press('Space');await expect(checkbox).toBeChecked();}else await checkbox.check();
}
async function popup(page){await page.locator('#map').click({position:{x:2,y:40}});await page.evaluate(()=>map.eachLayer(l=>{if(l.ktRestAreaId)l.openPopup();}));return page.locator('.kt-rest-popup');}
test('rest areas load only when requested, retain provenance, and never turn 24h parking into permission',async({page,context})=>{
  const {calls,errors}=await setup(page,context);expect(calls).toEqual([]);await show(page);await expect(page.locator('.kt-rest-control')).toContainText('1 official rest-area location');
  const p=await popup(page);await expect(p).toContainText('Test rest area <img src=x>');await expect(p.locator('img')).toHaveCount(0);await expect(p).toContainText('does not establish permission to sleep overnight');await expect(p).toContainText(source.source.retrieved_at);
  await expect(p.getByRole('link',{name:'TxDOT place source',exact:true})).toHaveAttribute('href',row.source_url);
  await expect(p).toContainText('State policy checked 2026-10-30');await expect(p).toContainText('overnight parking Unknown');await expect(p.getByRole('link',{name:'State policy source 1',exact:true})).toHaveAttribute('href',statePolicies.policies[0].sources[0].url);
  await p.getByRole('button',{name:'Overnight permission',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Overnight permission',exact:true});await expect(dialog).toContainText('permission unknown');await expect(dialog).toContainText('Published reports are unavailable');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await p.getByRole('button',{name:'Save rest-area stop',exact:true}).click();const saved=await page.evaluate(()=>KampTrailTrip.getStops());expect(saved[0].feature.properties.type).toBe('spot');expect(saved[0].feature.properties.id).toBe('spot:30.90010,-97.56230');expect(saved[0].feature.properties.rest_area_evidence).toContain('Overnight permission');expect(errors).toEqual([]);
});
test('mobile controls and popup are accessible, and an outside viewport reports missing coverage',async({page,context})=>{
  const {errors}=await setup(page,context,{mobile:true});await show(page,{keyboard:true});const c=page.locator('.kt-rest-control');await expect(c).toContainText('1 official rest-area location');expect(await c.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  expect((await new AxeBuilder({page}).include('.kt-rest-control').analyze()).violations).toEqual([]);const p=await popup(page);await expect(p).toBeVisible();expect((await new AxeBuilder({page}).include('.kt-rest-popup').analyze()).violations).toEqual([]);
  await expect(c).toBeHidden();await expect(page.getByRole('button',{name:'Map layers',exact:true})).toBeHidden();await expect(page.locator('.kt-off-toggle')).toBeHidden();
  try{await page.getByRole('button',{name:'Close popup',exact:true}).click({timeout:5000});}catch(error){console.log('Mobile rest-area layout',await page.evaluate(()=>['#map','.leaflet-popup','.leaflet-popup-close-button','.kt-off-toggle','.kt-rest-control'].map(selector=>{const element=document.querySelector(selector),r=element?.getBoundingClientRect();return{selector,box:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,display:element?getComputedStyle(element).display:null};})));throw error;}
  await expect(c).toBeVisible();await expect(page.getByRole('button',{name:'Map layers',exact:true})).toBeVisible();await expect(page.locator('.kt-off-toggle')).toBeVisible();await page.evaluate(()=>map.setView([40.75,-111.88],10));await expect(c).toContainText('0 official rest-area locations');await expect(c).toContainText('other regions are not covered');expect(errors).toEqual([]);
});
test('source failure and offline views remain unknown and support an explicit retry',async({page,context})=>{
  const {errors}=await setup(page,context,{broken:true});await show(page);const c=page.locator('.kt-rest-control');await expect(c).toContainText('catalogue unavailable');await page.route('**/data/rest-areas/TX.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)}));await c.getByRole('button',{name:'Retry official rest areas'}).click();await expect(c).toContainText('1 official rest-area location');await context.setOffline(true);await expect(c).toContainText('Offline');await expect(c).toContainText('permission are unknown');expect(errors).toEqual([]);
});
test('state policy failure keeps sourced locations usable with explicit unknown policy',async({page,context})=>{
  const {errors}=await setup(page,context,{policyBroken:true});await show(page);await expect(page.locator('.kt-rest-control')).toContainText('1 official rest-area location');const p=await popup(page);await expect(p).toContainText('State rest-area policy unavailable');await expect(p.getByRole('link',{name:'State policy source 1',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
});
