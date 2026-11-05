'use strict';
// Own-site acceptance with anonymous disposable state. No production writes.
// All Google collect requests are blocked; no consent or geolocation is granted.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const APP=process.env.KT_QA_URL||'https://kamptrail.com',EXPECTED=process.env.EXPECTED_SHA,MOBILE=process.env.MOBILE==='1';
const modes=[
 ['overnight-parking','Overnight parking',()=>window.kamptrailFilters?.type==='parking'],
 ['rest-areas','Rest areas',()=>window.kamptrailFilters?.entryLayer==='rest-areas'&&window.KampTrailLayers?.isOn('Official rest areas')],
 ['dump-stations','Dump stations',()=>window.kamptrailFilters?.entryLayer==='dump-stations'&&window.KampTrailServices?.getCategories().join()==='dump'],
 ['free-camping','Free camping',()=>window.kamptrailFilters?.cost==='free'],
 ['blm','BLM land',()=>window.kamptrailFilters?.catalogueSource==='blm'&&window.KampTrailLayers?.isOn('Public land (BLM, USFS, NPS)')]
];
(async()=>{
 assert.match(EXPECTED||'',/^[a-f0-9]{40}$/,'Pin the authorized merge before checking production');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 const viewport=MOBILE?{width:390,height:844}:{width:1440,height:1000};
 const context=await browser.newContext({serviceWorkers:'block',viewport,...(MOBILE?{isMobile:true,hasTouch:true}:{})}),page=await context.newPage();
 const report={kind:'read-only-live-homepage-intents',started:new Date().toISOString(),mobile_emulation:MOBILE,expected_source:EXPECTED,version:'2.46.5',all_google_collect_aborted:true,modes:[]};
 let blockedCollect=0;
 try{
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(/(^|\.)google-analytics\.com$/.test(u.hostname)||(/(^|\.)google\.com$/.test(u.hostname)&&/collect/.test(u.pathname))){blockedCollect++;return route.abort();}return route.continue();});
  await context.addInitScript(()=>{window.ktQaLocationCalls=0;Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(){window.ktQaLocationCalls++;}}});});
  if(APP.startsWith('https:')){
  const deadline=Date.now()+8*60*1000;
  let release;
  while(Date.now()<deadline){
   try{const r=await context.request.get(APP+'/release.json?n='+Date.now());release=await r.json();if(r.ok()&&release.source_commit===EXPECTED)break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,10000));
  }
  assert.equal(release?.source_commit,EXPECTED,'authorized source must be live');report.source=release.source_commit;
  }else{report.source_under_test=EXPECTED;}
  await page.goto(APP+'/',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>!!window.KampTrailAnalytics);
  assert.equal(await page.locator('meta[name="kamptrail-version"]').getAttribute('content'),'2.46.5');
  assert.equal((await page.locator('#home-title').innerText()).replace(/\s+/g,' '),'Find camping, parking and RV services.');
  assert.equal(await page.locator('.kt-home-hero [data-install-open]').count(),0);
  assert.equal(await page.locator('#install-guide [data-install-open]').count(),1);
  const links=page.locator('.kt-intent-shortcuts a');assert.equal(await links.count(),5);
  const boxes=await links.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};}));
  assert.ok(boxes.every(b=>b.top>=0&&b.bottom<=viewport.height&&b.left>=0&&b.right<=viewport.width&&b.height>=44),'all five choices are reachable in the first screen');
  report.hero_choices_in_first_screen=true;report.install_removed_from_hero=true;report.install_guide_retained=true;
  report.home_layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(report.home_layout.documentWidth<=report.home_layout.width,'homepage has no horizontal overflow');
  const nav=page.getByRole('navigation',{name:'KampTrail pages',exact:true});for(const label of ['Plan a trip','Free tools','Guides'])assert.equal(await nav.getByRole('link',{name:label,exact:true}).count(),1);
  report.broader_product_navigation_retained=true;
  assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().analyticsConsent),false);
  await page.waitForFunction(()=>{const img=document.querySelector('.kt-hero-landscape');return img.complete&&img.naturalWidth>0;});
  await page.screenshot({path:'homepage-live-'+(MOBILE?'mobile':'desktop')+'.png'});
  assert.equal(await page.locator('.kt-phone,.kt-hero-product').count(),0);
  assert.equal(await page.locator('#install-kamptrail').isVisible(),false);
  const skip=page.locator('.kt-skip-map');
  assert.equal(await skip.evaluate(e=>getComputedStyle(e).clipPath),'inset(50%)');
  await skip.focus();assert.equal(await skip.evaluate(e=>getComputedStyle(e).clipPath),'none');
  await page.locator('#destination').focus();
  report.keyboard_skip_link=true;report.initial_install_hidden=true;report.device_mockup_removed=true;
  await page.locator('#how-it-works').screenshot({path:'homepage-live-'+(MOBILE?'mobile':'desktop')+'-guides.png'});
  await page.locator('#about-chuck').screenshot({path:'homepage-live-'+(MOBILE?'mobile':'desktop')+'-founder.png'});
  for(const id of ['install-guide','beta-faq','feedback-panel']){
   const section=page.locator('#'+id);assert.equal(await section.isVisible(),true);
   assert.ok(await section.evaluate(e=>e.scrollWidth<=e.clientWidth+1),id+' fits');
  }
  for(let i=0;i<3;i++){
   await page.locator('#destination').fill('38.57332,-109.54984');
   await page.locator('#destination').press('Enter');
   await page.waitForFunction(n=>window.KampTrailBeta?.status().searches>=n,i+1);
  }
  assert.equal(await page.locator('#install-kamptrail').isVisible(),true);
  assert.equal(await page.locator('dialog[open]').count(),0);
  report.install_after_three_searches=true;
  for(const [mode,label,check]of modes){
   await page.goto(APP+'/',{waitUntil:'domcontentloaded',timeout:90000});
   await page.getByRole('navigation',{name:'Choose a map view',exact:true}).getByRole('link',{name:label,exact:true}).press('Enter');
   await page.waitForFunction(check,null,{timeout:60000});
   assert.equal(new URL(page.url()).search,'?mode='+mode);assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('kt-workspace')));
   assert.equal(await page.locator('.kt-home-hero').isVisible(),false);assert.equal(await page.locator('.kt-intent-shortcuts').isVisible(),false);
   assert.equal(await page.locator('#kt-entry-state').isVisible(),true);
   assert.equal(await page.evaluate(()=>window.ktQaLocationCalls),0,'generic shortcut cannot request location');
   assert.equal(await page.evaluate(()=>KampTrailData.version),'2.46.5');
   assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().measuring),false,'test never opts into analytics');
   const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(layout.documentWidth<=layout.width,'workspace has no horizontal overflow');
   report.modes.push({mode,keyboard_activation:true,expected_filter_or_layer:true,entry_notice_visible:true,no_location_request:true,layout});
  }
  report.blocked_google_collect_requests=blockedCollect;report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{report.finished=new Date().toISOString();await fs.writeFile('homepage-live-'+(MOBILE?'mobile':'desktop')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
