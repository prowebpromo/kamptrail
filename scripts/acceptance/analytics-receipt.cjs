#!/usr/bin/env node
'use strict';
// EXPLICIT, BOUNDED SYNTHETIC QA: one real debug event may reach the beta GA4
// property after a fresh opt-in in a disposable anonymous browser. All other
// Google collect traffic is aborted. No retry or duplicate is sent in this run.
// A 2xx collector response is transport evidence only. Root must observe the
// named event in GA4 Realtime/DebugView before claiming receipt.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BETA='G-VQE0H1DNKL',EVENT='kt_release_verification';
const TARGET='https://boondockorbust.com/resources/walmart-overnight-rv-parking-policy-by-state-2026/';
function fieldsFor(request){
 const url=new URL(request.url()),base=new URLSearchParams(url.search);
 return (request.postData()||'').split('\n').map(line=>{const fields=new URLSearchParams(base);for(const[k,v]of new URLSearchParams(line))fields.set(k,v);return fields;});
}
function isCollector(url){return /(^|\.)google-analytics\.com$/.test(url.hostname)||(/(^|\.)google\.com$/.test(url.hostname)&&/collect/.test(url.pathname));}
(async()=>{
 assert.equal(process.env.ALLOW_ONE_GA4_DEBUG_EVENT,'1','Explicit ALLOW_ONE_GA4_DEBUG_EVENT=1 is required');
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage();
 const report={kind:'one-synthetic-ga4-debug-verification',started:new Date().toISOString(),destination:BETA,event:EVENT,anonymous_disposable_browser:true,other_google_measurement_aborted:true,real_hits_allowed:0,collector_status:null,ga4_ui_receipt:'not established by this script'};
 let verificationArmed=false,verificationRequest=null,collectorResponse=null,routeError=null;
 const rejectedBoundaryEvents=[];
 try{
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!isCollector(url))return route.continue();
   const rows=fieldsFor(request);
   if(rows.some(fields=>fields.get('tid')===BETA&&fields.get('en')==='kt_measurement_started'))rejectedBoundaryEvents.push(true);
   const exact=rows.length===1&&rows[0].get('tid')===BETA&&rows[0].get('en')===EVENT;
   if(!exact||!verificationArmed||verificationRequest)return route.abort();
   const fields=rows[0];
   // Verify SDK construction before allowing this single transmission.
   try{
    assert.equal(url.protocol,'https:');
    assert.equal(fields.get('dl'),TARGET,'debug event page URL must be canonical');
    assert.equal(fields.get('dr')||'','','debug event referrer must be blank');
    assert.equal(fields.get('dt'),'Boondock or Bust','debug event title must be fixed');
    assert.ok(fields.get('_dbg')==='1'||fields.get('ep.debug_mode')==='true'||fields.get('ep.debug_mode')==='1','debug flag absent from constructed request');
    assert.ok(![...fields.keys()].some(key=>/^ep\.(?!debug_mode$)/.test(key)),'unexpected custom event properties');
   }catch(error){routeError=error.message;return route.abort();}
   verificationRequest=request;report.real_hits_allowed=1;
   return route.continue();
  });
  page.on('response',response=>{if(response.request()===verificationRequest)collectorResponse=response;});
  await page.goto(TARGET,{waitUntil:'domcontentloaded',timeout:90000});
  assert.equal(await page.locator('#wpadminbar').count(),0,'must remain anonymous');
  await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:45000});
  assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().analyticsConsent),false,'fresh browser must start denied');
  const details=page.locator('#kt-beta-analytics-settings');
  await details.waitFor({state:'attached'});
  if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
  await page.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  await page.waitForFunction(()=>KampTrailAnalytics.getStatus().measuring===true,null,{timeout:45000});
  const boundaryDeadline=Date.now()+15000;
  while(!rejectedBoundaryEvents.length&&Date.now()<boundaryDeadline)await page.waitForTimeout(100);
  assert.ok(rejectedBoundaryEvents.length,'expected active beta measurement boundary was not observed');
  // Drain the initial boundary batch. It is blocked, as are legacy hits.
  await page.waitForTimeout(1800);
  verificationArmed=true;
  report.sent_at=new Date().toISOString();
  await page.evaluate(({beta,event,target})=>{
   window.gtag('event',event,{send_to:beta,debug_mode:true,page_location:target,page_title:'Boondock or Bust',page_referrer:''});
  },{beta:BETA,event:EVENT,target:TARGET});
  const deadline=Date.now()+25000;
  while(!collectorResponse&&!routeError&&Date.now()<deadline)await page.waitForTimeout(100);
  assert.equal(routeError,null,routeError||'invalid payload');
  assert.equal(report.real_hits_allowed,1,'exactly one real debug collector request required');
  assert.ok(collectorResponse,'no collector response observed; do not retry this run');
  report.collector_status=collectorResponse.status();
  assert.ok(report.collector_status>=200&&report.collector_status<300,'collector did not return success; do not retry this run');
  report.transport_result='PASS';
  await page.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
  assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().measuring),false);
  report.revoked_after_test=true;
 }catch(error){report.transport_result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{
  report.finished=new Date().toISOString();
  await fs.writeFile('analytics-receipt-transport.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  await browser.close();
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
