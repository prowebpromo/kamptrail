const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const AxeBuilder=require('@axe-core/playwright').default;
test.use({serviceWorkers:'block'});
test.beforeEach(async({context})=>context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64')})));
test('integrated optional choices stay off after grant, reload and revoke without loading Google',async({page})=>{
  const google=[];page.on('request',r=>{if(/googletagmanager|google-analytics/.test(r.url()))google.push(r.url());});
  await page.goto('/?source=pwa');await page.locator('#kt-analytics-settings>summary').click();
  const choices=page.locator('#kt-analytics-choice');await expect(choices).toContainText('measurement is currently off');
  await choices.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  expect(await page.evaluate(()=>KampTrailAnalytics.getStatus().analyticsConsent)).toBe(true);
  expect(await page.evaluate(()=>KampTrailAnalytics.getStatus().measuring)).toBe(false);
  await page.reload();await page.locator('#kt-analytics-settings>summary').click();await expect(choices).toContainText('allow optional analytics');
  await choices.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem('kt_optional_analytics_choice_v1'))).toBe(null);
  expect(await page.evaluate(()=>typeof window.ktBetaAnalyticsQueue)).toBe('undefined');expect(google).toEqual([]);
  for(const width of [360,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).include('#kt-analytics-settings').analyze()).violations).toEqual([]);}
});
test('sole-owner bootstrap uses only current consented events with sanitized config in an intercepted browser fixture',async({page,context})=>{
  const files=['consent-analytics.js','consent-controls.js','analytics-bootstrap.js'];let external=0;
  await context.route('https://kamptrail.com/**',async route=>{
    const name=new URL(route.request().url()).pathname.slice(1);
    if(files.includes(name))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.resolve(name),'utf8')});
    if(name==='')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Private canary title</title></head><body><div id="choice"></div>'+files.map(f=>'<script src="/'+f+'"></script>').join('')+'</body></html>'});
    if(name==='favicon.ico')return route.fulfill({status:204});
    throw new Error('Unexpected fixture request');
  });
  await context.route('https://www.googletagmanager.com/**',route=>{external++;return route.fulfill({contentType:'text/javascript',body:'/* Local inert loader fixture. No Google code or collection. */'});});
  await page.goto('https://kamptrail.com/?mode=blm&ref=https%3A%2F%2Fboondockorbust.com%2Fboondocking-guide%2Fare-you-breaking-the-new-blm-camping-rules%2F&q=private-canary#spot=38,-109');
  await page.evaluate(()=>{window.fixture=KampTrailAnalyticsBootstrap.mount({container:document.getElementById('choice'),release:{enabled:true,loadGoogleTag:true,automaticCollectionReviewed:true}});window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{event:'kt_search_performed',sequence:1,search:'private-canary'}}));});
  expect(external).toBe(0);await page.getByRole('button',{name:'Allow optional analytics'}).click();
  await expect.poll(()=>page.evaluate(()=>fixture.getStatus().measuring)).toBe(true);expect(external).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{event:'kt_search_performed',sequence:2,mode:'blm',source:'other',search:'private-canary',session_id:'private-canary'}})));
  const commands=await page.evaluate(()=>ktBetaAnalyticsQueue.map(args=>Array.from(args)));
  const config=commands.find(c=>c[0]==='config')[2];expect(config.send_page_view).toBe(false);expect(config.page_location).toBe('https://kamptrail.com/');expect(config.page_referrer).toBe('');
  expect(JSON.stringify(commands)).not.toContain('private-canary');expect(commands.filter(c=>c[0]==='event').map(c=>c[1])).toEqual(['kt_measurement_started','kt_search_performed']);
  await page.getByRole('button',{name:'Decline',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{event:'kt_search_performed',sequence:3}})));
  expect(await page.evaluate(()=>ktBetaAnalyticsQueue.filter(c=>c[0]==='event').length)).toBe(2);expect(await page.evaluate(()=>window['ga-disable-G-VQE0H1DNKL'])).toBe(true);
});
test('JSON toolbar download restores original IDs, private notes and dates through the real file input',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:43,lng:-75,zoom:8})));
  await page.goto('/?source=pwa');await page.evaluate(()=>KampTrailMapLoader.start());await page.waitForFunction(()=>KampTrailData?.getAllCampsites().length>1&&!KampTrailData.getLoadStatus().loading);
  await page.evaluate(()=>KampTrailTrip.addStop(KampTrailData.getAllCampsites()[0].properties.id));
  const drawer=page.locator('#kt-trip-drawer');await drawer.locator('.kt-stop-details summary').first().click();
  await drawer.getByLabel('Arrive',{exact:true}).first().fill('2026-11-05');await drawer.getByLabel('Arrive',{exact:true}).first().press('Tab');
  await drawer.getByLabel('Leave',{exact:true}).first().fill('2026-11-07');await drawer.getByLabel('Leave',{exact:true}).first().press('Tab');
  await drawer.locator('textarea').first().fill('Private recovery note <literal>');await drawer.locator('textarea').first().press('Tab');
  const before=await page.evaluate(()=>localStorage.getItem('kt_trip'));
  const downloadWait=page.waitForEvent('download');await page.locator('#kt-trip-backup-json-export').click();const download=await downloadWait;
  const bytes=fs.readFileSync(await download.path());expect(JSON.parse(bytes).stops).toEqual(JSON.parse(before));
  page.once('dialog',dialog=>dialog.accept());await page.locator('#kt-trip-clear').click();expect(await page.evaluate(()=>KampTrailTrip.getStops().length)).toBe(0);
  await page.locator('#kt-trip-backup-json-file').setInputFiles({name:'trip.json',mimeType:'application/json',buffer:bytes});
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('kt_trip'))).toBe(before);
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#kt-trip-backup-json-file').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from('{"format":"kamptrail-trip","version":1,"stops":[]}')});
  expect(await page.evaluate(()=>localStorage.getItem('kt_trip'))).toBe(before);
  await page.locator('#kt-trip-backup-json-file').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await expect(page.locator('#toast')).toContainText('Invalid trip backup');expect(await page.evaluate(()=>localStorage.getItem('kt_trip'))).toBe(before);
});
