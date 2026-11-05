#!/usr/bin/env node
'use strict';
// Anonymous public-page diagnostic. Actual SDK may load its own destination
// module after beta configuration. All Google measurement traffic is blocked.
const {chromium}=require('playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const TARGET='https://boondockorbust.com/resources/walmart-overnight-rv-parking-policy-by-state-2026/';
function safeUrl(value){try{const u=new URL(value),out={origin:u.origin,path:u.pathname};for(const k of ['id','cx','l'])if(u.searchParams.has(k))out[k]=u.searchParams.get(k);return out;}catch{return {unparsed:true};}}
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext(),page=await context.newPage(),cdp=await context.newCDPSession(page);
 const scriptRequests=[],betaPayloads=[],report={kind:'anonymous-google-owner-diagnostic',all_google_collect_aborted:true,started:new Date().toISOString()};
 try{
  await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url());
   if(/(^|\.)google-analytics\.com$/.test(u.hostname)||(/(^|\.)google\.com$/.test(u.hostname)&&/collect/.test(u.pathname))){
    const base=new URLSearchParams(u.search);
    for(const line of (request.postData()||'').split('\n')){
     const fields=new URLSearchParams(base);for(const [key,value]of new URLSearchParams(line))fields.set(key,value);
     if(fields.get('tid')!=='G-VQE0H1DNKL')continue;
     const payload=[...fields.values()].join(' ');
     betaPayloads.push({event:fields.get('en')||'',dlMatchesCanonical:fields.get('dl')===TARGET,dt:(fields.get('dt')||'').slice(0,240),drEmpty:!(fields.get('dr')||''),customkeys:[...fields.keys()].filter(key=>/^ep[n]?\./.test(key)).sort(),canaryLeak:/KT_QA_|12\.34567|54\.32109|osm:way:999999999999/.test(payload)});
    }
    return route.abort();
   }
   return route.continue();
  });
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent',event=>{const u=new URL(event.request.url);if(u.hostname!=='www.googletagmanager.com')return;scriptRequests.push({url:safeUrl(u.href),initiator_type:event.initiator?.type,frames:(event.initiator?.stack?.callFrames||[]).slice(0,5).map(frame=>({url:safeUrl(frame.url),function:frame.functionName,line:frame.lineNumber}))});});
  await page.goto(TARGET,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:45000});
  const snap=()=>page.evaluate(()=>({scripts:[...document.querySelectorAll('script[src*="googletagmanager.com/"]')].map(el=>{const u=new URL(el.src),src={origin:u.origin,path:u.pathname};for(const key of ['id','cx','l'])if(u.searchParams.has(key))src[key]=u.searchParams.get(key);return {id:el.id,src,async:el.async,defer:el.defer,type:el.type,attribute_names:[...el.attributes].map(a=>a.name).sort()};}),shared_layer:Array.isArray(window.dataLayer),private_beta_queue_present:'ktBetaAnalyticsQueue' in window,gtag_exists:typeof window.gtag==='function',original_owner_unchanged:window.gtag===window.__qaSiteKitOwner,status:window.KampTrailAnalytics.getStatus()}));
  await page.evaluate(()=>{window.__qaSiteKitOwner=window.gtag;});
  report.before=await snap();
  const details=page.locator('#kt-beta-analytics-settings');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();await page.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  await page.waitForFunction(()=>KampTrailAnalytics.getStatus().measuring===true,null,{timeout:45000});await page.waitForTimeout(1500);
  report.after=await snap();
  // Probe a shipped explicit beta event separately from Google's automatic events.
  await page.evaluate(()=>{const a=document.querySelector('a[data-kamptrail-mode]');if(a){a.addEventListener('click',e=>e.preventDefault(),{once:true});a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));}});
  await page.waitForTimeout(2000);
  report.script_requests=scriptRequests;report.beta_payloads=betaPayloads;
  report.beta_commands=await page.evaluate(()=>window.dataLayer.filter(item=>(item[0]==='config'&&item[1]==='G-VQE0H1DNKL')||(item[0]==='event'&&item[2]?.send_to==='G-VQE0H1DNKL')).map(item=>({command:item[0],target_or_event:item[1],title_fixed:item[2]?.page_title==='Boondock or Bust',location_canonical:item[2]?.page_location===location.origin+location.pathname,referrer_blank:item[2]?.page_referrer==='',groups:item[2]?.groups||'',send_page_view:item[2]?.send_page_view,send_to:item[2]?.send_to||'',parameter_names:Object.keys(item[2]||{}).sort()})));

  assert.equal(report.before.original_owner_unchanged,true);assert.equal(report.after.original_owner_unchanged,true);
  assert.equal(report.after.private_beta_queue_present,false);
  report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{await fs.writeFile('google-owner-diagnostic.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
