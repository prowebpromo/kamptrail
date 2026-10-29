const {test,expect}=require('@playwright/test');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const token='a'.repeat(32);
async function setup(page,context,{api='ok'}={}){
  const sent=[];
  await context.route(/^https:\/\//,r=>{const u=r.request().url();
    if(u.includes('gis.blm.gov'))return r.fulfill({contentType:'application/json',body:JSON.stringify({features:[{attributes:{ADMIN_AGENCY_CODE:'BLM'}}]})});
    return r.fulfill({contentType:'image/png',body:pixel});});
  await page.route('**/api/submit.php',async r=>{sent.push(JSON.parse(r.request().postData()));
    if(api==='down')return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'unavailable'})});
    if(api==='missing')return r.fulfill({status:404,body:'Not found'});
    return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token,status:'received'})});});
  await page.route('**/api/status.php*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status:'accepted',note:'Thanks, fee will be updated.'})}));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.33,lng:-108.7,zoom:11})));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
  return sent;
}
test('a camper reports a fee correction without an account and can check its status',async({page,context})=>{
  const sent=await setup(page,context);
  const id=await page.evaluate(()=>KampTrailData.getVisibleCampsites()[0].properties.id);
  await page.evaluate(id=>KampTrailData.focusCampsite(id),id);
  await page.locator('.leaflet-popup').getByRole('button',{name:'Suggest a fix'}).click();
  const d=page.getByRole('dialog',{name:'Suggest a fix'});
  await d.getByLabel('Fee is wrong').check();
  await d.getByLabel('What did you see?').fill('Pay station sign says $12 per night, seen 2026-10-20.');
  await d.getByLabel(/first-hand/).check();
  await d.getByRole('button',{name:'Send report'}).click();
  await expect(d).toContainText('was received');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({kind:'correction',campsite_id:id,problems:['fee'],firsthand:true,website:''});
  expect(sent[0].elapsed_ms).toBeGreaterThan(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_reports_v1'))[0].token)).toBe('a'.repeat(32));
  await d.getByRole('button',{name:'My reports'}).click();
  await expect(page.getByRole('dialog',{name:'My reports'})).toContainText('Accepted. The data will be updated');
  await expect(page.getByRole('dialog',{name:'My reports'})).toContainText('Moderator note: Thanks, fee will be updated.');
});
test('a new campsite can be proposed from a long-press spot',async({page,context})=>{
  const sent=await setup(page,context);
  await page.evaluate(()=>KampTrailLayers.openSpot(L.latLng(39.4,-108.8)));
  await page.locator('.kt-spot-popup').getByRole('button',{name:'Suggest a campsite here'}).click();
  const d=page.getByRole('dialog',{name:'Suggest a campsite'});
  await d.getByLabel('Campsite name').fill('Rabbit Valley pullout');
  await d.getByLabel('What is there?').fill('Dispersed site on BLM land, level, fits 30 ft trailer.');
  await d.getByLabel(/first-hand/).check();
  await d.getByRole('button',{name:'Send report'}).click();
  await expect(d).toContainText('was received');
  expect(sent[0]).toMatchObject({kind:'new_place',campsite_name:'Rabbit Valley pullout',lat:39.4,lng:-108.8});
});
test('when the reports service is unavailable the form says so and offers a fallback',async({page,context})=>{
  await setup(page,context,{api:'missing'});
  await page.evaluate(()=>KampTrailLayers.openSpot(L.latLng(39.4,-108.8)));
  await page.locator('.kt-spot-popup').getByRole('button',{name:'Suggest a campsite here'}).click();
  const d=page.getByRole('dialog',{name:'Suggest a campsite'});
  await d.getByLabel('Campsite name').fill('Test site');
  await d.getByLabel('What is there?').fill('Some details about this place.');
  await d.getByLabel(/first-hand/).check();
  await d.getByRole('button',{name:'Send report'}).click();
  await expect(d.locator('.kt-report-msg')).toContainText('Reports are unavailable right now');
  await expect(d.getByRole('link',{name:'report it on GitHub instead'})).toHaveAttribute('href',/github\.com\/prowebpromo\/kamptrail\/issues\/new/);
  expect(await page.evaluate(()=>localStorage.getItem('kt_reports_v1'))).toBeNull();
});
test('About the data shows source freshness, and a failed refresh run is visibly degraded',async({page,context})=>{
  await setup(page,context);
  await page.getByRole('button',{name:'About the data'}).click();
  const table=page.getByRole('table',{name:'Data freshness'});
  await expect(table.getByRole('rowheader',{name:'Forest Service recreation sites'})).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await page.keyboard.press('Escape');
  const now=new Date().toISOString();
  await context.route('**/data/health.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({version:1,stale_after_days:45,run:{started:now,counts:{failed:3}},sources:{
    osm:{label:'OpenStreetMap campsites',oldest_success:'2026-09-01T00:00:00Z',newest_success:'2026-09-01T00:00:00Z',scopes:{CA:{last_attempt:now,last_success:'2026-09-01T00:00:00Z',outcome:'failed'}}},
    usfs:{label:'Forest Service recreation sites',scopes:{US:{last_attempt:now,last_success:null,outcome:'failed'}}}}})}));
  await page.getByRole('button',{name:'About the data'}).click();
  await expect(page.locator('.kt-health-warn')).toContainText('Degraded: the last data refresh');
  await expect(page.getByRole('row',{name:/OpenStreetMap campsites/})).toContainText('Refresh failing. The last refresh failed. Saved data is shown.');
  await expect(page.getByRole('row',{name:/Forest Service/})).toContainText('Unknown');
});
