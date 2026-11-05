#!/usr/bin/env node
'use strict';
// NONPUBLISHING SDK contract test. A disposable, anonymous browser receives a
// local fixture for the BoB origin. Only Google's public SDK downloads remotely.
// All Google measurement requests (including legacy) are recorded in memory then
// aborted, so synthetic events do not reach either reporting property.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BETA='G-VQE0H1DNKL',LEGACY='G-895FCE9MJX';
const URL='https://boondockorbust.com/resources/walmart-overnight-rv-parking-policy-by-state-2026/';
const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>Disposable Google routing fixture</title><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('set','linker',{domains:['boondockorbust.com']});gtag('js',new Date());gtag('set','developer_id.dZTNiMT',true);gtag('config','${LEGACY}',{send_page_view:false,googlesitekit_post_type:'post'});</script><script async src="https://www.googletagmanager.com/gtag/js?id=${LEGACY}"></script></head><body><h1>Disposable SDK routing contract</h1><p>No fixture events are sent to Google.</p></body></html>`;
function records(request){
 const url=new globalThis.URL(request.url());
 const base=new URLSearchParams(url.search);
 const body=request.postData()||'';
 const lines=body?body.split('\n'):[''];
 return lines.map(line=>{const fields=new URLSearchParams(base);for(const [k,v]of new URLSearchParams(line))fields.set(k,v);return {destination:fields.get('tid')||'',event:fields.get('en')||''};}).filter(x=>x.destination||x.event);
}
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();
 const requests=[],report={kind:'nonpublishing-real-google-sdk-routing',started:new Date().toISOString(),browser:browser.version(),measurement_requests_aborted:true,fixture_replaces_public_document:true};
 try{
  await context.route('**/*',async route=>{
   const req=route.request(),url=new globalThis.URL(req.url());
   if(req.isNavigationRequest()&&url.href===URL)return route.fulfill({status:200,contentType:'text/html',body:fixture});
   if(/(^|\.)google-analytics\.com$/.test(url.hostname)||(/(^|\.)google\.com$/.test(url.hostname)&&/collect|g\/collect/.test(url.pathname))){requests.push(...records(req));return route.abort();}
   if(url.hostname==='www.googletagmanager.com')return route.continue();
   return route.abort();
  });
  await page.goto(URL,{waitUntil:'domcontentloaded',timeout:45000});
  await page.evaluate(id=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Google SDK did not process legacy readiness callback')),30000);gtag('get',id,'client_id',()=>{clearTimeout(t);resolve();});}),LEGACY);
  await page.evaluate(({beta,legacy})=>{
   gtag('config',beta,{groups:'kamptrail_beta',send_page_view:false,page_location:location.origin+location.pathname,page_referrer:'',page_title:'Boondock or Bust',cookie_prefix:'ktbeta',cookie_domain:'none',allow_google_signals:false,allow_ad_personalization_signals:false});
   gtag('event','kt_sdk_targeted_beta',{send_to:beta,page_location:location.origin+location.pathname,page_referrer:'',page_title:'Boondock or Bust'});
   gtag('event','kt_sdk_unscoped_legacy',{page_location:location.origin+location.pathname,page_referrer:'',page_title:'Boondock or Bust'});
   gtag('event','kt_sdk_explicit_legacy',{send_to:legacy,page_location:location.origin+location.pathname,page_referrer:'',page_title:'Boondock or Bust'});
  },{beta:BETA,legacy:LEGACY});
  const deadline=Date.now()+20000;
  while(Date.now()<deadline&&!['kt_sdk_targeted_beta','kt_sdk_unscoped_legacy','kt_sdk_explicit_legacy'].every(event=>requests.some(x=>x.event===event)))await page.waitForTimeout(100);
  await page.waitForTimeout(1800);
  const targets=event=>[...new Set(requests.filter(x=>x.event===event).map(x=>x.destination))].sort();
  report.routing={targeted_beta:targets('kt_sdk_targeted_beta'),unscoped_legacy:targets('kt_sdk_unscoped_legacy'),explicit_legacy:targets('kt_sdk_explicit_legacy')};
  report.observation_only=true;
  report.custom_group_keeps_beta_out_of_default=!report.routing.unscoped_legacy.includes(BETA);
  assert.deepEqual(report.routing.targeted_beta,[BETA],'explicit beta event must reach only beta');
  assert.deepEqual(report.routing.explicit_legacy,[LEGACY],'explicit legacy event must reach only legacy');
  assert.ok(report.routing.unscoped_legacy.includes(LEGACY),'unscoped legacy event must continue legacy routing');
  assert.equal(report.custom_group_keeps_beta_out_of_default,true,'STOP: custom groups did not isolate beta from existing unscoped legacy events');
  report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{await fs.writeFile('google-sdk-routing.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
