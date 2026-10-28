// Check the real deployed MVP. Set KT_SMOKE_TARGET for a staging/local target.
const {chromium}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path');
const target=process.env.KT_SMOKE_TARGET || 'https://prowebpromo.github.io/kamptrail/';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    // Runtime proxy bridge is for this controlled check, not application code.
    // Worker upgrade/offline behavior is exercised separately by browser regressions.
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
    const errors=[],failures=[];
    await context.route(/^https:\/\//,async route=>{
      const url=route.request().url();
      try{
        const response=await fetch(url,{headers:{'User-Agent':'KampTrail/2.2.0 (+https://github.com/prowebpromo/kamptrail)','Referer':'https://prowebpromo.github.io/kamptrail/'},signal:AbortSignal.timeout(20000)});
        const body=Buffer.from(await response.arrayBuffer()),type=response.headers.get('content-type')||'application/octet-stream';
        if(!response.ok)failures.push({url,status:response.status});
        await route.fulfill({status:response.status,contentType:type,body});
      }catch(e){failures.push({url,error:e.message});await route.abort();}
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:42.7,lng:-73.8,zoom:8})));
    await page.goto(target,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('meta[name="kamptrail-version"]')?.content==='2.2.0'&&window.KampTrailData?.version==='2.2.0'&&KampTrailData.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
    await page.locator('#destination').fill('Albany, NY');await page.locator('#search-form button').click();await page.getByRole('button',{name:'Albany, NY · City',exact:true}).click();
    await page.waitForFunction(()=>KampTrailData.getVisibleCampsites().length>0);
    const name=await page.locator('#result-list h3').first().textContent();
    await page.locator('#result-list .site-actions button').filter({hasText:'Save stop'}).first().click();
    if(!(await page.locator('#kt-trip-list').textContent()).includes(name))throw new Error('Saved stop missing');
    await page.locator('#kt-trip-close').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].filter(i=>!i.complete||!i.naturalWidth).length===0);
    await fs.mkdir(path.join(__dirname,'../docs'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../docs/mvp-desktop.png')});
    const catalogue=await page.evaluate(async()=> (await (await fetch('data/campsites/search-index.json')).json()));
    const campsite=catalogue.sites.find(s=>s.states.length===1&&s.states[0]==='CA'&&s.name.length>8);
    await page.locator('#destination').fill(campsite.name);await page.locator('#search-form button').click();await page.getByRole('button',{name:`${campsite.name} · Campsite`,exact:true}).first().click();
    await page.waitForFunction(id=>!!KampTrailData.getCampsiteById(id),campsite.id);
    await page.locator('.kt-coordinates').waitFor({state:'visible'});
    const directions=await page.locator('.leaflet-popup a[href*="google.com/maps/dir"]').getAttribute('href');
    if(!directions.includes(`${campsite.lat},${campsite.lng}`))throw new Error('Directions coordinates mismatch');
    const mobile=await context.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.setViewportSize({width:390,height:844});
    await mobile.goto(target,{waitUntil:'domcontentloaded'});await mobile.waitForFunction(()=>window.KampTrailData?.getLoadStatus().totalSites>0&&!KampTrailData.getLoadStatus().loading);
    await mobile.locator('#trip').click();await mobile.locator('#kt-trip-close').click();
    if(await mobile.locator('#app').evaluate(el=>el.inert))throw new Error('Mobile map stayed blocked');
    await mobile.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile')].filter(i=>!i.complete||!i.naturalWidth).length===0);
    await mobile.screenshot({path:path.join(__dirname,'../docs/mvp-mobile.png')});
    const result={target,version:'2.2.0',catalogue:catalogue.sites.length,nationalSearch:campsite.name,savedStop:name,mobile:true,errors,failures};
    console.log(JSON.stringify(result,null,2));if(errors.length||failures.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
