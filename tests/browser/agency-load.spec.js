const {test,expect}=require('@playwright/test');
// Forest Service and BLM listings come from separate agency files. When the agency index or one state's agency file
// fails, the list says so by name and Retry recovers them (live census on 2.37.0, 2026-11-02: 122 listings missing silently).
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
const INDEX_NOTICE='Forest Service and BLM listings could not load. Other listings are shown.';
const STATE_NOTICE='Forest Service and BLM listings could not load for Colorado. Other listings are shown.';
const VIEWPORTS={desktop:{viewport:{width:1440,height:1000}},mobile:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}};

// Listings whose own or merged source ids include a Forest Service or BLM record.
const agencyCount=page=>page.evaluate(()=>KampTrailData.getAllCampsites().filter(f=>[f.properties.id,...(f.properties.legacy_ids||[])].some(id=>/^(usfs|blm-area|blm-facility):/.test(id))).length);

async function open(page,mobile){
  // Central Colorado at detail zoom: only Colorado is in view.
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.0,lng:-105.5,zoom:9})));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
  await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().loadedStates.includes('CO')&&!KampTrailData.getLoadStatus().loading,null,{timeout:30000});
  if(mobile&&!(await page.locator('#results').isVisible()))await page.locator('#results-toggle').click();
  await expect(page.locator('#results')).toBeVisible();
}

for(const [name,options] of Object.entries(VIEWPORTS)){
  test.describe(`agency load notice (${name})`,()=>{
    test.use({serviceWorkers:'block',...options});
    test.beforeEach(async({context})=>{
      await context.route(/^https:\/\//,r=>r.fulfill({contentType:'image/png',body:pixel}));
      await context.route('**/api/**',r=>r.fulfill({status:404,body:'{}'}));
    });

    test('a missing agency index is named, other listings stay, and Retry restores the agency listings',async({page})=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/data/campsites/agency/index.json*',r=>r.fulfill({status:404,body:'not found'}));
      await open(page,name==='mobile');
      const notice=page.locator('#data-errors .kt-agency-notice');
      await expect(notice).toContainText(INDEX_NOTICE);
      await expect(page.locator('#data-errors')).toBeVisible();
      const status=await page.evaluate(()=>KampTrailData.getLoadStatus());
      expect(status.agencyIndex).toBe('failed');
      expect(status.failedStates).toEqual([]);
      expect(status.totalSites).toBeGreaterThan(0);
      expect(await agencyCount(page)).toBe(0);
      await expect(page.locator('#result-list .site-card').first()).toBeVisible();
      const before=await page.evaluate(()=>KampTrailData.getLoadStatus().totalSites);

      await page.unroute('**/data/campsites/agency/index.json*');
      await notice.getByRole('button',{name:'Retry',exact:true}).click();
      await expect(page.locator('#data-errors .kt-agency-notice')).toHaveCount(0);
      await expect(page.locator('#data-errors')).toBeHidden();
      const after=await page.evaluate(()=>KampTrailData.getLoadStatus());
      expect(after.agencyIndex).toBe('ok');
      expect(after.agencyFailedStates).toEqual([]);
      expect(after.totalSites).toBeGreaterThan(before);
      expect(await agencyCount(page)).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });

    test('one failed agency file names its state, keeps that state listed, and Retry recovers',async({page})=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/data/campsites/agency/CO.geojson*',r=>r.fulfill({status:500,body:'error'}));
      await open(page,name==='mobile');
      const notice=page.locator('#data-errors .kt-agency-notice');
      await expect(notice).toContainText(STATE_NOTICE);
      const status=await page.evaluate(()=>KampTrailData.getLoadStatus());
      expect(status.agencyIndex).toBe('ok');
      expect(status.agencyFailedStates).toEqual([{state:'CO',error:'HTTP 500'}]);
      expect(status.failedStates).toEqual([]);
      expect(status.loadedStates).toContain('CO');
      // Colorado's Recreation.gov and OSM listings stay on the map and in the list.
      expect(await page.evaluate(()=>KampTrailData.getAllCampsites().filter(f=>f.properties.forecastStates?.includes('CO')).length)).toBeGreaterThan(0);
      await expect(page.locator('#result-list .site-card').first()).toBeVisible();
      expect(await agencyCount(page)).toBe(0);
      const before=status.totalSites;

      await page.unroute('**/data/campsites/agency/CO.geojson*');
      await notice.getByRole('button',{name:'Retry',exact:true}).click();
      await expect(page.locator('#data-errors .kt-agency-notice')).toHaveCount(0);
      const after=await page.evaluate(()=>KampTrailData.getLoadStatus());
      expect(after.agencyFailedStates).toEqual([]);
      expect(after.totalSites).toBeGreaterThan(before);
      expect(await agencyCount(page)).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });

    test('an agency index failure shows the notice and Retry in the national overview',async({page})=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/data/campsites/agency/index.json*',r=>r.fulfill({status:404,body:'not found'}));
      // National overview: zoomed out, so only state totals show.
      await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:39.5,lng:-98.5,zoom:4})));
      await page.goto('/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.KampTrailMapLoader?.start());
      await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().overview&&KampTrailData.getLoadStatus().agencyIndex==='failed',null,{timeout:30000});
      if(name==='mobile'&&!(await page.locator('#results').isVisible()))await page.locator('#results-toggle').click();
      const notice=page.locator('#data-errors .kt-agency-notice');
      await expect(notice).toContainText(INDEX_NOTICE);
      await expect(page.locator('#data-errors')).toBeVisible();
      await expect(page.locator('#result-summary')).toContainText('Zoomed out');
      await page.unroute('**/data/campsites/agency/index.json*');
      await notice.getByRole('button',{name:'Retry',exact:true}).click();
      await expect(page.locator('#data-errors .kt-agency-notice')).toHaveCount(0);
      await expect(page.locator('#data-errors')).toBeHidden();
      expect(await page.evaluate(()=>KampTrailData.getLoadStatus().agencyIndex)).toBe('ok');
      expect(errors).toEqual([]);
    });

    test('a detail-view agency failure stays visible after zooming out to the overview',async({page})=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/data/campsites/agency/CO.geojson*',r=>r.fulfill({status:500,body:'error'}));
      await open(page,name==='mobile');
      await expect(page.locator('#data-errors .kt-agency-notice')).toContainText(STATE_NOTICE);
      await page.evaluate(()=>map.setZoom(4));
      await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus().overview,null,{timeout:15000});
      await expect(page.locator('#result-summary')).toContainText('Zoomed out');
      const notice=page.locator('#data-errors .kt-agency-notice');
      await expect(notice).toContainText(STATE_NOTICE);
      await expect(page.locator('#data-errors')).toBeVisible();
      await page.unroute('**/data/campsites/agency/CO.geojson*');
      await notice.getByRole('button',{name:'Retry',exact:true}).click();
      await expect(page.locator('#data-errors .kt-agency-notice')).toHaveCount(0);
      expect(await page.evaluate(()=>KampTrailData.getLoadStatus().agencyFailedStates)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
