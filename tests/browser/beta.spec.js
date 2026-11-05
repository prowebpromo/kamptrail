const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
test.use({viewport:{width:390,height:844},serviceWorkers:'block'});
test.beforeEach(async({context})=>context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel})));
async function ready(page,url='/?mode=free-camping&state=UT'){await page.goto(url);await page.waitForFunction(()=>window.map?.getZoom&&window.KampTrailData?.getLoadStatus().totalSites>2&&!KampTrailData.getLoadStatus().loading);}
for(const [mode,check]of [
 ['overnight-parking',()=>kamptrailFilters.type==='parking'],
 ['rest-areas',()=>KampTrailLayers.isOn('Official rest areas')&&kamptrailFilters.entryLayer==='rest-areas'],
 ['dump-stations',()=>KampTrailServices.getCategories().join()==='dump'&&kamptrailFilters.entryLayer==='dump-stations'],
 ['free-camping',()=>kamptrailFilters.cost==='free'],
 ['blm',()=>kamptrailFilters.catalogueSource==='blm'&&KampTrailLayers.isOn('Public land (BLM, USFS, NPS)')]
])test(mode+' launch opens its intent directly and replaces stale filters',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('kt_filters_mvp',JSON.stringify({rigLength:60,cost:'paid',amenities:['shower']})));
 await ready(page,'/?mode='+mode+'&state=UT');await expect(page.locator('body')).toHaveClass(/kt-workspace/);await expect(page.locator('.kt-home-hero')).toBeHidden();expect(await page.evaluate(check)).toBe(true);expect(await page.evaluate(()=>kamptrailFilters.rigLength)).toBe(0);if(mode==='blm'){await expect.poll(()=>page.evaluate(()=>KampTrailData.getVisibleCampsites().length)).toBeGreaterThan(0);expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.source==='Bureau of Land Management'))).toBe(true);}if(mode==='free-camping')expect(await page.evaluate(()=>KampTrailData.getVisibleCampsites().every(s=>s.properties.fee_status==='free'))).toBe(true);await expect(page.locator('#kt-entry-state')).toBeVisible();await expect(page.locator('#kt-use-nudge')).toBeHidden();await expect(page.locator('#beta-testing')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Show all campsites',exact:true}).click();await expect(page.locator('#kt-entry-state')).toBeHidden();expect(await page.evaluate(()=>kamptrailFilters.type)).toBe('all');expect(page.url()).not.toContain('mode=');
});
test('denied nearby permission keeps the entry filter and supplies a search fallback',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok,no){no({code:1});}}}));await ready(page,'/?mode=overnight-parking&near=1&state=UT');await expect(page.locator('#toast')).toContainText('permission was denied');expect(await page.evaluate(()=>kamptrailFilters.type)).toBe('parking');await expect(page.locator('#destination')).toBeVisible();
});
test('entry notices follow manual filter changes, keep valid narrowing and preserve share hashes on reset',async({page})=>{
 await ready(page);await expect(page.locator('#kt-entry-state')).toBeVisible();
 // Changing a rig constraint retains the free-camping predicate.
 await page.evaluate(()=>KampTrailFilters.setIncludeUnknownLength(true));await expect(page.locator('#kt-entry-state')).toBeVisible();expect(new URL(page.url()).searchParams.get('mode')).toBe('free-camping');
 await page.locator('#filters').click();await page.locator('[name="f-cost"][value="paid"]').check();await expect(page.locator('#kt-entry-state')).toBeHidden();expect(new URL(page.url()).searchParams.has('mode')).toBe(false);expect(await page.evaluate(()=>kamptrailFilters.cost)).toBe('paid');await page.locator('#kt-f-close').click();
 await ready(page,'/?mode=overnight-parking&state=UT');await page.locator('#filters').click();await page.locator('#f-type').selectOption('established');await expect(page.locator('#kt-entry-state')).toBeHidden();expect(await page.evaluate(()=>KampTrailBeta.entry.mode)).toBe(null);await page.locator('#kt-f-close').click();
 await ready(page,'/?mode=free-camping&state=UT');await page.evaluate(()=>{history.replaceState(null,'',location.href+'#site=usfs%3A5981');KampTrailFilters.reset();KampTrailFilters.reset();});await expect(page.locator('#kt-entry-state')).toBeHidden();expect(new URL(page.url()).hash).toBe('#site=usfs%3A5981');expect(new URL(page.url()).searchParams.has('mode')).toBe(false);expect(await page.evaluate(()=>KampTrailBeta.entry.mode)).toBe(null);
});
for(const id of ['osm:way:1548179559','usfs:5981'])test('shared campsite '+id+' keeps precedence over mode, state and nearby requests',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('kt_filters_mvp',JSON.stringify({cost:'free',rigLength:60}));window.nearRequests=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(ok){window.nearRequests++;ok({coords:{latitude:30,longitude:-100,accuracy:100}});}}});});
 const hash='#site='+encodeURIComponent(id);await page.goto('/?mode=free-camping&state=UT&near=1'+hash);await page.evaluate(()=>KampTrailMapLoader.start());
 await expect(page.locator('[data-kt-place-id="osm:way:1548179559"]')).toBeVisible();
 expect(await page.evaluate(()=>KampTrailData.getCampsiteById('usfs:5981').properties.fee_status)).toBe('paid');
 expect(await page.evaluate(()=>kamptrailFilters.cost)).toBe('all');expect(await page.evaluate(()=>window.nearRequests)).toBe(0);await expect(page.locator('#kt-entry-state')).toBeHidden();expect(new URL(page.url()).hash).toBe(hash);
 const center=await page.evaluate(()=>{const c=map.getCenter();return [c.lat,c.lng];});expect(center[0]).toBeCloseTo(43.6076983,1);expect(center[1]).toBeCloseTo(-115.2183993,1);
 expect(await page.evaluate(()=>KampTrailBeta.events().every(e=>e.mode==='map'))).toBe(true);
});
test('a shared coordinate spot keeps precedence over an entry mode',async({page})=>{
 await page.addInitScript(()=>{window.nearRequests=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){window.nearRequests++;}}});});
 await page.goto('/?mode=free-camping&state=UT&near=1#spot=44,-115');await page.evaluate(()=>KampTrailMapLoader.start());await expect(page.locator('.kt-spot-popup')).toContainText('44.00000, -115.00000');await expect(page.locator('#kt-entry-state')).toBeHidden();
 expect(await page.evaluate(()=>window.nearRequests)).toBe(0);expect(await page.evaluate(()=>kamptrailFilters.cost)).toBe('all');expect(await page.evaluate(()=>KampTrailBeta.events().every(e=>e.mode==='map'))).toBe(true);
});
test('persisted service saves retain accurate events without unlocking campsite recruitment',async({page})=>{
 await ready(page);await page.evaluate(()=>{KampTrailBeta.search();for(const id of ['view-one','view-two'])KampTrailBeta.viewPlace({properties:{id,name:id}});const site=KampTrailServices.feature({id:'service:test',name:'Test dump station',coordinates:[-110,40],categories:['dump'],tags:{},source_region:'US-UT'},null);KampTrailTrip.addStop(site.properties.id,site);KampTrailTrip.addStop(site.properties.id,site);});
 expect(await page.evaluate(()=>KampTrailBeta.status().saves)).toBe(0);expect(await page.evaluate(()=>KampTrailBeta.status().tester)).toBe(false);await expect(page.locator('#kt-use-nudge')).toBeHidden();await expect(page.locator('#beta-testing')).toBeHidden();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).filter(s=>s.id==='service:test').length)).toBe(1);expect(await page.evaluate(()=>KampTrailBeta.events().filter(e=>e.event==='kt_stop_saved').map(e=>e.place_kind))).toEqual(['service_or_rest_area']);
});
test('three real searches offer installation without opening a dialog; dismissal persists for the session',async({page})=>{
 await ready(page);for(let i=0;i<3;i++){await page.locator('#destination').fill('38.57,-109.55');await page.locator('#destination').press('Enter');if(i<2)await expect(page.locator('#kt-use-nudge')).toBeHidden();}await expect(page.locator('#kt-use-nudge')).toContainText('Install');expect(await page.locator('dialog[open]').count()).toBe(0);await page.locator('#kt-use-nudge').getByRole('button',{name:'Not now'}).click();await page.reload();await page.waitForFunction(()=>window.map?.getZoom);await page.locator('#destination').fill('38.57,-109.55');await page.locator('#destination').press('Enter');await expect(page.locator('#kt-use-nudge')).toBeHidden();expect(await page.evaluate(()=>KampTrailBeta.status().visits)).toBe(1);
});
test('an observed installation remains remembered after a regular browser tab reload',async({page})=>{
 await ready(page);await page.evaluate(()=>{window.dispatchEvent(new Event('appinstalled'));KampTrailBeta.search();KampTrailBeta.search();KampTrailBeta.search();});await page.reload();await page.evaluate(()=>KampTrailMapLoader.start());await page.locator('#destination').fill('38.57,-109.55');await page.locator('#destination').press('Enter');expect(await page.evaluate(()=>KampTrailBeta.status().installed)).toBe(true);await expect(page.locator('#kt-use-nudge')).toBeHidden();
});
test('the same recently viewed campsite can be reopened repeatedly without changing its stored id',async({page})=>{
 const id='usfs:5981';await page.addInitScript(id=>localStorage.setItem('kt_beta_use_v1',JSON.stringify({visits:1,searches:0,views:0,saves:0,last:Date.now(),recent:[{id,name:'Abbott legacy link'}]})),id);
 await page.goto('/?mode=free-camping&state=UT&near=1#site='+encodeURIComponent(id));await page.evaluate(()=>KampTrailMapLoader.start());await expect(page.locator('[data-kt-place-id="osm:way:1548179559"]')).toBeVisible();
 // Keep the previously published legacy identity as the recent selection.
 await page.reload();await page.evaluate(()=>KampTrailMapLoader.start());
 for(let attempt=0;attempt<2;attempt++){await page.evaluate(()=>map.closePopup());await page.locator('#kt-recent').click();await page.locator('#kt-recent-dialog li button').filter({hasText:'Abbott legacy link'}).click();await expect(page.locator('[data-kt-place-id="osm:way:1548179559"]')).toBeVisible();expect(new URL(page.url()).hash).toBe('#site='+encodeURIComponent(id));}
 expect(await page.evaluate(()=>KampTrailBeta.status().recent.some(x=>x.id==='usfs:5981'))).toBe(true);
});
test('real campsite viewing and saving unlock recruitment, retain exact recent IDs and emit bounded metadata',async({page})=>{
 await ready(page,'/?mode=blm&state=UT&ref='+encodeURIComponent('https://boondockorbust.com/resources/example/?email=secret'));
 await page.locator('#destination').fill('38.57,-109.55');await page.locator('#destination').press('Enter');await page.waitForTimeout(350);
 await page.waitForFunction(()=>KampTrailData.getAllCampsites().filter(s=>s.properties.source==='Bureau of Land Management').length>=2);
 const ids=await page.evaluate(()=>KampTrailData.getAllCampsites().filter(s=>s.properties.source==='Bureau of Land Management').slice(0,2).map(s=>s.properties.id));
 for(const id of ids){await page.evaluate(id=>KampTrailData.focusCampsite(id),id);await expect.poll(()=>page.evaluate(()=>KampTrailBeta.status().views)).toBe(ids.indexOf(id)+1);await page.evaluate(()=>map.closePopup());}
 await expect(page.locator('#beta-testing')).toBeHidden();await page.evaluate(id=>KampTrailTrip.addStop(id),ids[0]);await page.evaluate(id=>KampTrailTrip.addStop(id),ids[0]);expect(await page.evaluate(()=>KampTrailBeta.events().filter(x=>x.event==='kt_stop_saved').length)).toBe(1);expect(await page.evaluate(()=>KampTrailBeta.status().tester)).toBe(true);
 await page.locator('#kt-trip-close').click();await page.locator('#kt-recent').click();await expect(page.locator('#kt-recent-dialog li')).toHaveCount(2);expect((await new AxeBuilder({page}).include('#kt-recent-dialog').analyze()).violations).toEqual([]);await page.locator('#kt-recent-dialog').getByRole('button',{name:'Close',exact:true}).click();
 const events=await page.evaluate(()=>KampTrailBeta.events());expect(events.every(e=>e.source==='boondockorbust'&&e.article_path==='/resources/example/')).toBe(true);expect(JSON.stringify(events)).not.toMatch(/secret|email|latitude|longitude|blm-area:/);expect(events.some(e=>e.event==='kt_marker_viewed')).toBe(true);
 await page.reload();await page.waitForFunction(()=>window.map?.getZoom);await page.locator('#kt-recent').click();await expect(page.locator('#kt-recent-dialog li')).toHaveCount(2);await page.getByRole('button',{name:'Clear recently viewed',exact:true}).click();await expect(page.locator('#kt-recent-dialog li')).toHaveCount(0);
});
test('two return visits still wait for use before offering installation',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('kt_beta_use_v1',JSON.stringify({visits:2,searches:0,views:0,saves:0,last:Date.now()-1900000,recent:[]})));await ready(page);await expect(page.locator('#kt-use-nudge')).toBeHidden();await page.locator('#destination').fill('38.57,-109.55');await page.locator('#destination').press('Enter');await expect(page.locator('#kt-use-nudge')).toContainText('Install');expect(await page.evaluate(()=>KampTrailBeta.status().visits)).toBe(3);
});
test('prepared BoB article CTAs stay usable without scripts and fit narrow and wide layouts',async({page})=>{
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.goto('/integrations/bob/cta-blocks.html');await expect(page.locator('aside')).toHaveCount(5);await expect(page.locator('script,style,h1')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const modes=await page.locator('a').evaluateAll(all=>all.map(a=>{const u=new URL(a.href);return [u.origin,u.searchParams.get('mode'),u.searchParams.get('near')];}));expect(modes.map(x=>x[1])).toEqual(['overnight-parking','rest-areas','dump-stations','free-camping','blm']);expect(modes.every(x=>x[0]==='https://kamptrail.com'&&x[2]==='1')).toBe(true);}
});
