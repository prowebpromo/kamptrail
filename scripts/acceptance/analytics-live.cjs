#!/usr/bin/env node
'use strict';
// Read-only production acceptance using disposable anonymous browser state.
// No feedback submission, account, source refresh or content mutation occurs.
// All Google collect traffic is aborted by default; real library requests load.
// Reports retain only event names, safe URL paths and cookie names, never IDs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BETA='G-VQE0H1DNKL',LEGACY='G-895FCE9MJX',APP='https://kamptrail.com';
const EXPECTED=process.env.EXPECTED_SHA||null,MOBILE=process.env.MOBILE==='1';
const ARTICLES=[
 {path:'/resources/walmart-overnight-rv-parking-policy-by-state-2026/',mode:'overnight-parking',label:'Find Nearby Overnight Parking'},
 {path:'/resources/interstate-rest-areas/',mode:'rest-areas',label:'View Rest Areas on KampTrail'}
];
const FORBIDDEN=['KT_QA_QUERY_NEVER_SEND','KT_QA_HASH_NEVER_SEND','KT_QA_NOTE_NEVER_SEND','osm:way:999999999999','12.34567','54.32109'];
function decode(text){for(let i=0;i<3;i++){try{const next=decodeURIComponent(text.replace(/\+/g,' '));if(next===text)break;text=next;}catch{break;}}return text;}
function collectRecords(request){
 const u=new URL(request.url()),base=new URLSearchParams(u.search);
 return (request.postData()||'').split('\n').map(line=>{const p=new URLSearchParams(base);for(const [k,v]of new URLSearchParams(line))p.set(k,v);return {tid:p.get('tid')||'',event:p.get('en')||'',fields:Object.fromEntries(p)};});
}
async function until(page,test,message,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await page.waitForTimeout(100);}throw Error(message);}
async function metric(page,sequence,event){await page.evaluate(({sequence,event})=>window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{sequence,event,mode:'rest-areas',source:'boondockorbust',article_path:'/resources/walmart-overnight-rv-parking-policy-by-state-2026/',place_kind:'campsite',query:'KT_QA_QUERY_NEVER_SEND',note:'KT_QA_NOTE_NEVER_SEND',id:'osm:way:999999999999',lat:12.34567,lng:54.32109}})),{sequence,event});}
async function openChoices(page,site){const details=page.locator(site==='app'?'#kt-analytics-settings':'#kt-beta-analytics-settings');await details.waitFor({state:'attached',timeout:30000});if(!await details.evaluate(el=>el.open))await details.locator('summary').click();await page.getByRole('button',{name:'Allow optional analytics',exact:true}).waitFor({state:'visible'});}
function validatePayloads(requests,pageUrl){
 const beta=requests.filter(x=>x.tid===BETA),canonical=new URL(pageUrl);canonical.search='';canonical.hash='';
 assert.ok(beta.length,'beta SDK requests were observed');
 for(const row of beta){
  const decoded=decode(JSON.stringify(row.fields));
  for(const text of FORBIDDEN)assert.ok(!decoded.includes(text),'forbidden QA field leaked to actual Google request');
  assert.equal(row.fields.dl,canonical.href,'Google page location is canonical without query/hash');
  assert.equal(row.fields.dr||'','','Google referrer is blank');
  assert.equal(row.fields.dt,canonical.origin===APP?'KampTrail':'Boondock or Bust','Google title is fixed');
  assert.ok(!Object.keys(row.fields).some(k=>/^ep\.(?:query|search|lat|lng|lon|note|id|site|spot|feedback)/i.test(k)),'unsafe event field present');
 }
 return [...new Set(beta.map(x=>x.event).filter(Boolean))].sort();
}
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const report={started:new Date().toISOString(),kind:'read-only-live-analytics',mobile_emulation:MOBILE,version_expected:'2.46.3',expected_source:EXPECTED,all_google_measurement_aborted:true,payloads:'actual Google SDK request construction; not GA4 receipt',pages:[]};
 try{
  for(const target of [{site:'app',url:APP+'/?mode=rest-areas&ref='+encodeURIComponent('https://boondockorbust.com'+ARTICLES[0].path)+'&q=KT_QA_QUERY_NEVER_SEND&lat=12.34567&lng=54.32109#KT_QA_HASH_NEVER_SEND'},...ARTICLES.map(article=>({site:'bob',url:'https://boondockorbust.com'+article.path,article}))].filter(target=>!process.env.SITE||target.site===process.env.SITE)){
   const context=await browser.newContext(MOBILE?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1280,height:850}}),page=await context.newPage();
   const requests=[],loads=[];
   await context.addInitScript(()=>{const savedAt=Date.now();localStorage.setItem('kt_optional_analytics_choice_v1',JSON.stringify({version:1,choice:'granted',savedAt,expiresAt:savedAt+180*24*60*60*1000}));});
   await context.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());
    if(u.hostname==='www.googletagmanager.com'){loads.push({path:u.pathname,id:u.searchParams.get('id')||''});return route.continue();}
    if(/(^|\.)google-analytics\.com$/.test(u.hostname)||(/(^|\.)google\.com$/.test(u.hostname)&&/collect/.test(u.pathname))){requests.push(...collectRecords(req));return route.abort();}
    return route.continue();
   });
   await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:90000});
   await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:45000});
   const entry={site:target.site,path:new URL(target.url).pathname};
   if(target.site==='app'){
    await page.waitForFunction(()=>window.KampTrailData?.version==='2.46.3',null,{timeout:90000});
    const release=await page.evaluate(async()=> (await fetch('/release.json?n='+Date.now(),{cache:'no-store'})).json());
    if(EXPECTED)assert.equal(release.source_commit,EXPECTED,'expected deployed source');
    entry.source=release.source_commit;
    assert.equal(await page.evaluate(()=>KampTrailData.version),'2.46.3');
    await metric(page,1,'kt_search_performed');await metric(page,2,'kt_marker_viewed');await metric(page,3,'kt_stop_saved');
   }else{
    assert.equal(await page.locator('#wpadminbar').count(),0,'test browser is anonymous');
    const anchor=page.getByRole('link',{name:target.article.label,exact:true});
    assert.equal(await anchor.count(),1,'one original article CTA');
    const href=new URL(await anchor.getAttribute('href'));
    assert.equal(href.origin,APP);assert.equal(href.searchParams.get('mode'),target.article.mode);assert.equal(href.searchParams.get('ref'),'https://boondockorbust.com'+target.article.path);
    entry.cta={mode:target.article.mode,canonical_ref:true};
   }
   await openChoices(page,target.site);
   const before=await page.evaluate(()=>KampTrailAnalytics.getStatus());
   assert.equal(before.analyticsConsent,false,'off-era v1 grant is not consent');
   assert.equal(before.measuring,false,'initial measurement denied');
   await page.waitForTimeout(1400);
   assert.equal(requests.filter(x=>x.tid===BETA).length,0,'no beta SDK hits before fresh consent');
   if(target.site==='app')assert.equal(loads.filter(x=>x.id===BETA).length,0,'no Google loader before app consent');
   else {
    const initialLoaders=await page.locator('script[src*="googletagmanager.com/gtag/js"]').evaluateAll(els=>els.map(e=>new URL(e.src).searchParams.get('id')));
    assert.deepEqual(initialLoaders,[LEGACY],'before beta consent only the existing Site Kit library is present');
   }
   await page.getByRole('button',{name:'Decline',exact:true}).click();
   await page.waitForTimeout(800);
   assert.equal(requests.filter(x=>x.tid===BETA).length,0,'decline sends no beta SDK hits');
   await page.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
   await page.waitForFunction(()=>window.KampTrailAnalytics.getStatus().measuring===true,null,{timeout:45000});
   await until(page,()=>requests.some(x=>x.tid===BETA&&x.event==='kt_measurement_started'),'measurement boundary hit absent');
   assert.ok(!requests.some(x=>x.tid===BETA&&['kt_search_performed','kt_marker_viewed','kt_stop_saved','kt_landing','kt_open_in_kamptrail'].includes(x.event)),'old actions were not backfilled');
   if(target.site==='app'){
    await metric(page,4,'kt_search_performed');await metric(page,5,'kt_marker_viewed');await metric(page,6,'kt_stop_saved');
    await until(page,()=>['kt_search_performed','kt_marker_viewed','kt_stop_saved'].every(event=>requests.some(x=>x.tid===BETA&&x.event===event)),'allowed adapter probe events absent');
    entry.action_probe='synthetic events through shipped public metric bridge, not UI search/save acceptance';
   }else{
    const anchor=page.getByRole('link',{name:target.article.label,exact:true});await anchor.scrollIntoViewIfNeeded();
    await anchor.evaluate(el=>el.addEventListener('click',e=>e.preventDefault(),{once:true}));await anchor.click();
    await until(page,()=>requests.some(x=>x.tid===BETA&&x.event==='kt_launch_clicked'),'CTA click request absent');
    await page.evaluate(()=>{const a=document.createElement('a');a.id='kt-qa-legacy-affiliate';a.href='https://harvest-hosts.com/RJQTWQ/M2GJW/?probe=KT_QA_QUERY_NEVER_SEND';a.textContent='Disposable legacy routing probe';a.addEventListener('click',e=>e.preventDefault());document.body.appendChild(a);});
    await page.locator('#kt-qa-legacy-affiliate').click();
    await until(page,()=>requests.some(x=>x.tid===LEGACY&&x.event==='affiliate_click'),'actual legacy affiliate emitter request absent');
    await page.waitForTimeout(1200);
    assert.ok(!requests.some(x=>x.tid===BETA&&x.event==='affiliate_click'),'actual legacy affiliate event contaminated beta');
    entry.explicit_legacy_affiliate_routing=true;
    const loaders=await page.locator('script[src*="googletagmanager.com/gtag/js"]').evaluateAll(els=>els.map(e=>{const u=new URL(e.src);return {element_id:e.id,id:u.searchParams.get('id'),cx:u.searchParams.get('cx')};}));
    entry.google_sdk_modules=loaders;
    assert.equal(loaders.filter(x=>x.element_id==='google_gtagjs-js'&&x.id===LEGACY).length,1,'one application-owned Site Kit loader');
    assert.ok(loaders.every(x=>(x.element_id==='google_gtagjs-js'&&x.id===LEGACY)||(x.element_id===''&&x.id===BETA&&x.cx==='c')),'only Site Kit and Google-generated destination module may be present: '+JSON.stringify(loaders));
    assert.equal(await page.evaluate(()=>Object.hasOwn(window,'ktBetaAnalyticsQueue')),false,'no second application data layer on BoB');
    entry.single_site_kit_owner=true;
   }
   entry.events=validatePayloads(requests,target.url);
   const cookies=await context.cookies();entry.beta_cookie_names=cookies.filter(c=>/^ktbeta(?:_|$)/.test(c.name)).map(c=>c.name).sort();
   assert.ok(entry.beta_cookie_names.length,'dedicated beta cookies exist after allowance');
   for(const cookie of cookies.filter(c=>/^ktbeta(?:_|$)/.test(c.name)))assert.ok(cookie.expires<=Date.now()/1000+60*24*60*60+120,'beta cookie expiry exceeds 60 days');
   await openChoices(page,target.site);
   await page.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
   await page.waitForFunction(()=>window.KampTrailAnalytics.getStatus().measuring===false);
   await page.waitForTimeout(1500);const afterRevoke=requests.filter(x=>x.tid===BETA).length;
   if(target.site==='app')await metric(page,7,'kt_stop_saved');
   else await page.getByRole('link',{name:target.article.label,exact:true}).evaluate(el=>{el.addEventListener('click',e=>e.preventDefault(),{once:true});el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));});
   await page.waitForTimeout(1800);
   assert.equal(requests.filter(x=>x.tid===BETA).length,afterRevoke,'no future beta SDK requests after revoke');
   assert.equal((await context.cookies()).filter(c=>/^ktbeta(?:_|$)/.test(c.name)).length,0,'only dedicated beta cookies cleared');
   entry.revoke_stops_requests=true;entry.old_grant_ignored=true;entry.decline_sends_nothing=true;
   entry.layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(entry.layout.documentWidth<=entry.layout.width,'no horizontal overflow');
   await openChoices(page,target.site);await page.screenshot({path:'analytics-live-'+target.site+'-'+(target.article?.mode||'map')+'-'+(MOBILE?'mobile':'desktop')+'.png'});
   report.pages.push(entry);await context.close();
  }
  report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{await fs.writeFile(MOBILE?'analytics-live-mobile.json':'analytics-live-desktop.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
