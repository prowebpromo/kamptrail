#!/usr/bin/env node
'use strict';
// NONPUBLISHING real-SDK acceptance for the shipped app analytics modules.
// The app origin is replaced in one anonymous disposable context with a local
// fixture. Only Google's public SDK loads remotely. All collect traffic is
// aborted; no production page, trip, feedback or reporting record is changed.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BETA='G-VQE0H1DNKL',BASE='https://kamptrail.com/';
const TARGET=BASE+'?mode=rest-areas&q=KT_QA_QUERY_NEVER_SEND&lat=12.34567&lng=54.32109#KT_QA_HASH_NEVER_SEND';
const SENTINELS=['KT_QA_QUERY_NEVER_SEND','KT_QA_HASH_NEVER_SEND','KT_QA_NOTE_NEVER_SEND','osm:way:999999999999','12.34567','54.32109'];
function records(request){const u=new URL(request.url()),base=new URLSearchParams(u.search);return(request.postData()||'').split('\n').map(line=>{const fields=new URLSearchParams(base);for(const[k,v]of new URLSearchParams(line))fields.set(k,v);return fields;});}
function decoded(value){for(let i=0;i<3;i++){try{const next=decodeURIComponent(value.replace(/\+/g,' '));if(next===value)break;value=next;}catch{break;}}return value;}
async function until(page,test,message,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await page.waitForTimeout(100);}throw Error(message);}
(async()=>{
 const files=['consent-analytics.js','consent-controls.js','analytics-bootstrap.js','analytics-settings.js'];
 const modules=await Promise.all(files.map(name=>fs.readFile(name,'utf8')));
 const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KT_QA_DOCUMENT_TITLE_NEVER_SEND</title></head><body><h1>Disposable KampTrail SDK fixture</h1><div id="kt-analytics-choice"></div>'+modules.map((source,i)=>'<script data-fixture-module="'+files[i]+'">'+source.replace(/<\/script/gi,'<\\/script')+'</script>').join('\n')+'</body></html>';
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'block'}),page=await context.newPage();
 const requests=[],sdkLoads=[],report={kind:'nonpublishing-shipped-app-real-google-sdk',started:new Date().toISOString(),source:process.env.GITHUB_SHA||'',module_files:files,all_google_collect_aborted:true,fixture_document:true,service_workers_blocked_for_interception:true,version_expected:'2.46.3'};
 try{
  await context.addInitScript(()=>{const savedAt=Date.now();localStorage.setItem('kt_optional_analytics_choice_v1',JSON.stringify({version:1,choice:'granted',savedAt,expiresAt:savedAt+180*24*60*60*1000}));});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.isNavigationRequest()&&url.href===TARGET.split('#')[0])return route.fulfill({status:200,contentType:'text/html',body:html});
   if(/(^|\.)google-analytics\.com$/.test(url.hostname)||(/(^|\.)google\.com$/.test(url.hostname)&&/collect/.test(url.pathname))){requests.push(...records(req));return route.abort();}
   if(url.hostname==='www.googletagmanager.com'){sdkLoads.push({path:url.pathname,id:url.searchParams.get('id')||'',layer:url.searchParams.get('l')||'',cx:url.searchParams.get('cx')||''});return route.continue();}
   return route.abort();
  });
  await page.goto(TARGET,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:10000});
  report.initial_status=await page.evaluate(()=>KampTrailAnalytics.getStatus());
  assert.equal(await page.evaluate(()=>KampTrailConsentControls.VERSION),2);
  assert.equal(report.initial_status.analyticsConsent,false,'old v1 grant cannot activate');
  assert.equal(report.initial_status.measuring,false);
  assert.equal(report.initial_status.ownerConflict,false);
  assert.equal(sdkLoads.length,0,'no Google SDK before fresh consent');
  assert.equal(requests.length,0,'no collect before fresh consent');
  await page.getByRole('button',{name:'Decline',exact:true}).click();
  await page.waitForTimeout(500);assert.equal(sdkLoads.length,0);assert.equal(requests.length,0);
  await page.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  try{await page.waitForFunction(()=>KampTrailAnalytics.getStatus().measuring===true,null,{timeout:35000});}
  finally{report.after_allow_status=await page.evaluate(()=>KampTrailAnalytics.getStatus());report.sdk_loads=sdkLoads;}
  await until(page,()=>requests.some(p=>p.get('tid')===BETA&&p.get('en')==='kt_measurement_started'),'actual Google measurement boundary request absent');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{sequence:1,event:'kt_search_performed',mode:'rest-areas',source:'other',place_kind:'campsite',query:'KT_QA_QUERY_NEVER_SEND',note:'KT_QA_NOTE_NEVER_SEND',id:'osm:way:999999999999',lat:12.34567,lng:54.32109}})));
  await until(page,()=>requests.some(p=>p.get('tid')===BETA&&p.get('en')==='kt_search_performed'),'allowed synthetic bridge request absent');
  const beta=requests.filter(p=>p.get('tid')===BETA);assert.ok(beta.length);
  report.beta_payloads=beta.map(p=>({event:p.get('en')||'',dlMatchesCanonical:p.get('dl')===BASE,dt:p.get('dt')||'',drEmpty:!(p.get('dr')||''),customkeys:[...p.keys()].filter(k=>/^ep[n]?\./.test(k)).sort(),canaryLeak:SENTINELS.some(s=>decoded([...p.values()].join(' ')).includes(s))}));
  for(const row of report.beta_payloads){assert.equal(row.dlMatchesCanonical,true,'canonical page URL');assert.equal(row.dt,'KampTrail','fixed SDK title');assert.equal(row.drEmpty,true,'blank SDK referrer');assert.equal(row.canaryLeak,false,'private/synthetic canary leakage');}
  assert.ok(!beta.some(p=>decoded([...p.values()].join(' ')).includes('KT_QA_DOCUMENT_TITLE_NEVER_SEND')),'document title leaked');
  assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().ownerConflict),false,'SDK must not create a foreign-owner conflict');
  report.owner_globals=await page.evaluate(()=>({gtag_present:'gtag' in window,dataLayer_present:'dataLayer' in window,private_queue:Array.isArray(window.ktBetaAnalyticsQueue)}));
  assert.equal(report.owner_globals.gtag_present,false,'no global gtag owner introduced');assert.equal(report.owner_globals.dataLayer_present,false,'no default dataLayer introduced');assert.equal(report.owner_globals.private_queue,true);
  const cookies=(await context.cookies()).filter(cookie=>/^ktbeta(?:_|$)/.test(cookie.name));assert.ok(cookies.length,'own beta cookies exist');
  report.beta_cookie_names=cookies.map(c=>c.name).sort();
  for(const cookie of cookies)assert.ok(cookie.expires>Date.now()/1000&&cookie.expires<=Date.now()/1000+60*24*60*60+120,'cookie lifespan at most 60 days');
  await page.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
  report.after_revoke_status=await page.evaluate(()=>KampTrailAnalytics.getStatus());assert.equal(report.after_revoke_status.measuring,false);
  await page.waitForTimeout(1000);const afterRevoke=requests.filter(p=>p.get('tid')===BETA).length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:{sequence:2,event:'kt_stop_saved',mode:'rest-areas',source:'other',place_kind:'campsite'}})));
  await page.waitForTimeout(1500);assert.equal(requests.filter(p=>p.get('tid')===BETA).length,afterRevoke,'revoke stops future requests');
  assert.equal((await context.cookies()).filter(c=>/^ktbeta(?:_|$)/.test(c.name)).length,0,'revoke clears dedicated cookies');
  report.revocation_pass=true;report.old_grant_ignored=true;report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{await fs.writeFile('app-sdk-fixture.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
