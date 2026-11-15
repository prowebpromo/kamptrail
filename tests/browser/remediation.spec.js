const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
test.use({viewport:{width:390,height:844},serviceWorkers:'block'});
test.beforeEach(async({context})=>context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel})));
async function ready(page){await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));await page.goto('/');await page.evaluate(()=>KampTrailMapLoader.start());await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>2&&!KampTrailData.getLoadStatus().loading);}
test('cold English marketing loads neither optional languages nor the map until requested',async({page})=>{
 const requests=[];page.on('request',r=>requests.push(r.url()));await page.goto('/');await page.waitForTimeout(350);
 expect(await page.evaluate(()=>typeof window.map?.getZoom)).toBe('undefined');
 expect(requests.filter(u=>/locale-(es|fr)\.js|leaflet\.js|app\.bundle\.js|data-loader\.js/.test(u))).toEqual([]);
 expect(requests.some(u=>u.includes('lakeside-mobile.webp'))).toBe(true);expect(requests.some(u=>u.endsWith('lakeside-photo.webp'))).toBe(false);
 await page.getByRole('link',{name:'Explore the map',exact:true}).first().click();await page.waitForFunction(()=>typeof window.map?.getZoom==='function');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('PWA shortcut opens the map workspace and saved stops; full site remains reachable',async({page})=>{
 await page.goto('/?source=pwa&action=saved');await expect(page.locator('body')).toHaveClass(/kt-workspace/);await expect(page.locator('.kt-home-hero')).toBeHidden();await expect(page.locator('#install-kamptrail')).toBeHidden();await expect(page.locator('#kt-trip-drawer')).toBeVisible();await page.locator('#kt-trip-close').click();await page.getByRole('link',{name:'Feedback',exact:true}).first().click();await expect(page.locator('#feedback-panel')).toBeVisible();await page.locator('#kt-full-site').click();await expect(page.locator('.kt-home-hero')).toBeHidden();await page.locator('#kt-full-site').click();await expect(page.locator('.kt-home-hero')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('saved stops request persistence without depending on a grant and offer a valid GPX backup',async({page})=>{
 await page.addInitScript(()=>{window.persistCalls=0;Object.defineProperty(navigator.storage,'persist',{value:()=>{window.persistCalls++;return Promise.resolve(false);}});});await ready(page);
 await page.evaluate(()=>KampTrailData.getAllCampsites().slice(0,3).forEach(s=>KampTrailTrip.addStop(s.properties.id)));
 await expect(page.locator('#kt-trip-backup')).toBeVisible();expect(await page.evaluate(()=>persistCalls)).toBe(1);
 const before=await page.evaluate(()=>localStorage.getItem('kt_trip'));const download=page.waitForEvent('download');await page.locator('#kt-trip-backup-export').click();const file=await download;expect(file.suggestedFilename()).toMatch(/\.gpx$/);
 expect(await page.evaluate(()=>new DOMParser().parseFromString(KampTrailTrip.toGPX(),'application/xml').getElementsByTagName('wpt').length)).toBe(3);
 await page.locator('#kt-trip-backup-dismiss').click();await expect(page.locator('#kt-trip-backup')).toBeHidden();await page.reload();await page.evaluate(()=>KampTrailMapLoader.start());await page.locator('#trip').click();await expect(page.locator('#kt-trip-backup')).toBeHidden();expect(await page.evaluate(()=>localStorage.getItem('kt_trip'))).toBe(before);
});
test('mobile panels have one scroll region and return focus while counts match the map',async({page})=>{
 await ready(page);await page.locator('#filters').click();await expect(page.locator('#kt-filter-panel')).toBeVisible();const rect=await page.locator('#kt-filter-panel').boundingBox();expect(rect.height).toBe(844);expect(rect.y).toBe(0);
 await expect(page.locator('#kt-filter-show')).toHaveText(`Show ${await page.evaluate(()=>KampTrailData.getVisibleCampsites().length)} results`);
 expect((await new AxeBuilder({page}).include('#kt-filter-panel').analyze()).violations).toEqual([]);
 await page.keyboard.press('Escape');await expect(page.locator('#filters')).toBeFocused();
 await page.evaluate(()=>KampTrailData.getAllCampsites().slice(0,4).forEach(s=>KampTrailTrip.addStop(s.properties.id)));
 await expect(page.locator('#kt-trip-export')).toBeInViewport();await expect(page.locator('#kt-trip-import')).toBeInViewport();
 const scrolls=await page.locator('#kt-trip-drawer').evaluate(e=>[...e.querySelectorAll('*')].filter(n=>/(auto|scroll)/.test(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+2).map(n=>n.className||n.id));expect(scrolls).toEqual(['kt-trip-scroll']);
 await page.keyboard.press('Escape');await expect(page.locator('#kt-trip-drawer')).toBeHidden();
});

for(const width of [390,1280])test(`native sheets isolate modal content and preserve nested dialog focus at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.goto('/?source=pwa');await page.waitForFunction(()=>document.getElementById('kt-filter-panel')&&document.getElementById('kt-trip-drawer'));
 const filters=page.locator('#kt-filter-panel'),trip=page.locator('#kt-trip-drawer');
 await page.locator('#trip').click();expect(await trip.evaluate(e=>e.matches(':modal'))).toBe(true);
 if(width<=760){const rect=await trip.boundingBox();expect(rect.x).toBe(0);expect(rect.width).toBe(width);expect(rect.height).toBe(844);expect(await page.evaluate(()=>document.documentElement.clientWidth)).toBe(width);}
 // The legal links are outside #app: modal isolation must cover them too.
 await page.locator('.kt-legal-nav a').first().evaluate(e=>e.focus());await expect(page.locator('#kt-trip-close')).toBeFocused();
 await page.locator('#kt-trip-backup-json-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('#kt-trip-notice')).toBeVisible();await expect(page.locator('#kt-trip-notice')).not.toBeEmpty();await expect(page.locator('#kt-trip-notice')).toHaveAttribute('role','status');
 await page.keyboard.press('Escape');await expect(trip).toBeHidden();await expect(page.locator('#trip')).toBeFocused();
 await page.locator('#filters').click();expect(await filters.evaluate(e=>e.matches(':modal'))).toBe(width<=760);
 if(width<=760){const rect=await filters.boundingBox();expect(rect.x).toBe(0);expect(rect.width).toBe(width);}
 if(width<=760){await page.locator('#destination').evaluate(e=>e.focus());await expect(page.locator('#kt-f-close')).toBeFocused();}
 else {await page.locator('#destination').evaluate(e=>e.focus());await expect(page.locator('#destination')).toBeFocused();}
 await page.locator('#kt-filter-rig-profile').click();await expect(page.locator('#kt-rig-dialog')).toBeVisible();
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.getElementById('kt-rig-dialog').contains(document.activeElement))).toBe(true);
 const resizedWidth=width<=760?1280:390;await page.setViewportSize({width:resizedWidth,height:844});expect(await page.locator('#kt-rig-dialog').evaluate(e=>e.matches(':modal'))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('#kt-rig-dialog')).toBeHidden();await expect(filters).toBeVisible();await expect(page.locator('#kt-filter-rig-profile')).toBeFocused();
 expect(await filters.evaluate(e=>e.matches(':modal'))).toBe(resizedWidth<=760);
 await page.locator('#kt-filter-show').click();await expect(filters).toBeHidden();await expect(page.locator('#filters')).toBeFocused();
});
test('uncached state selection offline announces the limitation immediately',async({page,context})=>{
 await ready(page);await context.setOffline(true);await page.locator('#state-select').selectOption('WY');await expect(page.locator('#toast')).toContainText(/offline|unavailable/i,{timeout:2000});await expect(page.locator('#toast')).toHaveAttribute('aria-live','polite');expect(await page.locator('#state-select').inputValue()).toBe('WY');
});
test('explicit city search opens directly while ambiguous names keep their choices',async({page})=>{
 await ready(page);await page.locator('#destination').fill('Moab, Utah');await page.locator('#destination').press('Enter');await expect.poll(()=>page.evaluate(()=>map.getCenter().lat)).toBeCloseTo(38.57332,2);await expect(page.locator('#search-results')).toBeHidden();
 await page.locator('#destination').fill('Springfield');await page.locator('#search-form button').click();await expect(page.locator('#search-results')).toBeVisible();expect(await page.locator('#search-results button').count()).toBeGreaterThan(1);
});
test('an uncached offline language choice keeps the active language and announces recovery',async({page,context})=>{
 await page.goto('/');await context.setOffline(true);await page.locator('#kt-language').selectOption('es');await expect(page.locator('#kt-language')).toHaveValue('en');await expect(page.locator('html')).toHaveAttribute('lang','en');await expect(page.locator('#kt-language-help')).toContainText('Reconnect');
});
test.describe('update while editing',()=>{
 test.use({serviceWorkers:'allow'});
 test('controller handoff preserves a visible unsent draft and offers an explicit reload',async({page})=>{
  await page.goto('/#feedback-panel');await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await page.reload();await page.locator('#feedback-panel [data-feedback-kind="bug"]').click();const dialog=page.getByRole('dialog',{name:'Help improve KampTrail'});await dialog.locator('textarea').fill('Keep this unsent test draft intact.');
  await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(page.locator('#toast')).toContainText('Finish or back up your changes');await expect(dialog.locator('textarea')).toHaveValue('Keep this unsent test draft intact.');await expect(page.locator('#toast button')).toHaveText('Reload update');
 });
});
