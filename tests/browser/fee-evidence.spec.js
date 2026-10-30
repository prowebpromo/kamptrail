const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
// The app's worker can claim the first visit before state loading starts and
// bypass page.route, replacing these fixtures with the real state catalogue.
// Keep this mocked disclosure suite isolated; upgrade.spec.js covers the worker.
test.use({serviceWorkers:'block'});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const full='No camping fee. '+('Additional source context. '.repeat(25))+'An Adventure Pass is required. <script>doNotRun()</script>';
async function fixture(page,context,{mobile=false,unknown=false,openStatus=null,reviewed=false}={}){
 if(mobile)await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
 const record={source:'US Forest Service',source_field:'feedescription',source_record_id:'123',source_url:'https://www.fs.usda.gov/visit/example',query_url:'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query',retrieved_at:'2026-10-29',source_updated_at:null,text:full,classification_text:full,sha256:'a'.repeat(64)};
 const feature={type:'Feature',geometry:{type:'Point',coordinates:[-108.7,39.33]},properties:{id:'usfs:123',name:'Evidence Test Campground',camping_activity:'Campground Camping',schema_version:3,open_status:openStatus,fee_status:unknown?'unknown':'conditional',cost:null,fee_text:unknown?null:full,fee_source:'US Forest Service',fee_checked:'2026-10-29',fee_evidence_records:unknown?[]:[record],amenities:[],rig_friendly:[]}};
 if(reviewed){
  const fee={...record,source_field:'official_page.Fee Site and Info',query_url:null,text:'No fees are required for this site',classification_text:'No fees are required for this site',evidence_kind:'maintained_official_page_observation'};
  const access={...fee,source_field:'official_page.Camping and access',text:'RVs up to 25 feet. Closed in winter. A nearby picnic site costs $5.',classification_text:'',evidence_kind:'maintained_official_page_context',sha256:'b'.repeat(64)};
  Object.assign(feature.properties,{fee_status:'free',cost:0,fee_text:fee.text,fee_source_field:fee.source_field,retrieved_at:'2026-11-01',fee_evidence_records:[fee,access]});
 }
 await page.route('**/data/campsites/*_merged.geojson',r=>r.fulfill({contentType:'application/geo+json',body:JSON.stringify({type:'FeatureCollection',features:[feature]})}));
 await page.route('**/data/campsites/agency/*.geojson',r=>r.fulfill({contentType:'application/geo+json',body:'{"type":"FeatureCollection","features":[]}'}));
 await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.33,lng:-108.7,zoom:11})));
 await page.goto('/');await page.waitForFunction(()=>KampTrailData.getCampsiteById('usfs:123')&&!KampTrailData.getLoadStatus().loading);await page.evaluate(()=>KampTrailData.focusCampsite('usfs:123'));
 await page.getByRole('button',{name:'Fee evidence',exact:true}).click();return{box:page.locator('.kt-fee-records'),errors};
}
test('fee evidence displays complete source wording beyond the popup excerpt and is available offline',async({page,context})=>{const {box,errors}=await fixture(page,context);await expect(box).toContainText('An Adventure Pass is required.');await expect(box).toContainText('Record 123');await expect(box).toContainText('Retrieved 2026-10-29');await expect(box.locator('script')).toHaveCount(0);await expect(box.getByRole('link',{name:'Open source record'})).toHaveAttribute('href','https://www.fs.usda.gov/visit/example');const rowURL=new URL(await box.getByRole('link',{name:'View official data row'}).getAttribute('href'));expect(rowURL.hostname).toBe('apps.fs.usda.gov');expect(rowURL.searchParams.get('where')).toBe('recareaid=123');expect(rowURL.searchParams.get('returnGeometry')).toBe('false');await context.setOffline(true);await expect(box).toContainText('An Adventure Pass is required.');expect(errors).toEqual([]);});
test('unknown fee evidence never implies free camping',async({page,context})=>{const {box,errors}=await fixture(page,context,{unknown:true});await expect(box).toContainText('The fee remains unknown.');await expect(box.getByRole('link')).toHaveCount(0);expect(errors).toEqual([]);});
test('reviewed page fees retain access context and the original check date offline',async({page,context})=>{
 const {box,errors}=await fixture(page,context,{reviewed:true,mobile:true});
 const fee=box.locator('details').filter({has:page.locator('summary',{hasText:'Official campground fee information'})});
 const access=box.locator('details').filter({has:page.locator('summary',{hasText:'Camping and vehicle access'})});
 await fee.locator('summary').click();await expect(fee).toContainText('No fees are required for this site');
 await expect(fee).toContainText('Retrieved 2026-10-29');await expect(fee).not.toContainText('2026-11-01');
 await expect(fee).not.toContainText('Source record updated');await expect(fee.getByRole('link',{name:'View official data row'})).toHaveCount(0);
 await context.setOffline(true);await access.locator('summary').click();await expect(access).toContainText('RVs up to 25 feet. Closed in winter. A nearby picnic site costs $5.');
 expect(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 expect(await page.evaluate(()=>KampTrailData.getCampsiteById('usfs:123').properties.fee_status)).toBe('free');expect(errors).toEqual([]);
});
test('full fee source evidence fits mobile and has accessible disclosure controls',async({page,context})=>{const {box,errors}=await fixture(page,context,{mobile:true});await expect(page.locator('.kt-site-popup').getByRole('heading',{name:'Evidence Test Campground',level:2})).toBeVisible();await expect(box.getByRole('heading',{name:'Camping fee evidence',level:3})).toBeVisible();await expect(box).toContainText('An Adventure Pass is required.');expect(await box.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect((await new AxeBuilder({page}).include('.kt-site-popup').analyze()).violations).toEqual([]);expect(errors).toEqual([]);});
test('closed listings display agency closure immediately below the popup title',async({page,context})=>{
 const {errors}=await fixture(page,context,{openStatus:'temporarily closed'});
 const notice=page.locator('.kt-site-popup .kt-closure-notice');
 await expect(notice).toContainText('Agency reports: temporarily closed.');
 expect(await notice.evaluate(e=>e.previousElementSibling.tagName)).toBe('H2');
 await expect(notice).toContainText('Confirm reopening with the operator.');expect(errors).toEqual([]);
});
test('route cards show retained closure status before fee information and leave unknown status unknown',async({page,context})=>{
 const {errors}=await fixture(page,context);
 await page.evaluate(async()=>{
  const sites=['closed','temporarily closed',null].map((status,i)=>({id:'route:'+i,name:'Route Status '+i,states:['CO'],lat:39.33,lng:-108.7+i*.01,m:{f:'free',t:'established',...(status?{o:status}:{})}}));
  KampTrailData.loadSearchIndex=async()=>({version:1,filter_version:1,community_version:1,sites});
  const points=[[-108.8,39.33],[-108.5,39.33]],stops=points.map((coordinates,i)=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{id:'stop:'+i}}));
  await KampTrailRoutes.open({distance:30000,duration:1800,calculated_at:new Date().toISOString(),geometry:{type:'LineString',coordinates:points},legs:[{distance:30000,duration:1800}],leg_ends:[1]},stops);
 });
 const cards=page.locator('.kt-route-result');await expect(cards).toHaveCount(3);
 for(const [i,status] of ['closed','temporarily closed'].entries()){
  const notice=cards.nth(i).locator('.kt-closure-notice');await expect(notice).toContainText('Agency reports: '+status+'.');expect(await notice.evaluate(e=>e.previousElementSibling.tagName)).toBe('H3');
 }
 await expect(cards.nth(2).locator('.kt-closure-notice')).toHaveCount(0);expect(errors).toEqual([]);
});
