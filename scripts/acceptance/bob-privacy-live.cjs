#!/usr/bin/env node
'use strict';
// Bounded anonymous live edge-case acceptance. All Google collect requests are
// intercepted and aborted. Browser-only consent/cookies belong to a disposable
// context. No source edits, form submission or report hits occur.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const BETA='G-VQE0H1DNKL';
const ARTICLE='https://boondockorbust.com/resources/walmart-overnight-rv-parking-policy-by-state-2026/';
const PRIVACY='https://boondockorbust.com/privacy-policy/';
function eventRows(request){const u=new URL(request.url()),base=new URLSearchParams(u.search);return(request.postData()||'').split('\n').map(line=>{const p=new URLSearchParams(base);for(const[k,v]of new URLSearchParams(line))p.set(k,v);return {beta:p.get('tid')===BETA,event:p.get('en')||'',privacy_document:p.get('dl')===PRIVACY};});}
async function choices(page){const panel=page.locator('#kt-beta-analytics-settings');await panel.waitFor({state:'attached',timeout:30000});if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();}
(async()=>{
 const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1280,height:850},serviceWorkers:'block'}),page=await context.newPage(),events=[];
 const report={kind:'live-bob-privacy-page-revocation-edge-case',started:new Date().toISOString(),all_google_collect_aborted:true,anonymous_disposable_context:true,service_workers_blocked_for_interception:true};
 let privacyCommitted=false;
 try{
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(/(^|\.)google-analytics\.com$/.test(u.hostname)||(/(^|\.)google\.com$/.test(u.hostname)&&/collect/.test(u.pathname))){events.push(...eventRows(req).map(row=>({...row,after_privacy_commit:privacyCommitted})));return route.abort();}return route.continue();});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&frame.url()===PRIVACY)privacyCommitted=true;});
  await page.goto(ARTICLE,{waitUntil:'domcontentloaded',timeout:90000});
  assert.equal(await page.locator('#wpadminbar').count(),0,'test must remain anonymous');
  await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:45000});
  assert.equal(await page.evaluate(()=>KampTrailAnalytics.getStatus().analyticsConsent),false,'fresh context starts without beta grant');
  await choices(page);await page.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  await page.waitForFunction(()=>KampTrailAnalytics.getStatus().measuring===true,null,{timeout:45000});
  const end=Date.now()+20000;let grantedCookies=[];
  while(Date.now()<end){grantedCookies=await context.cookies();if(grantedCookies.some(c=>/^ktbeta(?:_|$)/.test(c.name))&&grantedCookies.some(c=>c.name==='_ga'))break;await page.waitForTimeout(100);}
  const betaBefore=grantedCookies.filter(c=>/^ktbeta(?:_|$)/.test(c.name));
  const legacyBefore=grantedCookies.filter(c=>/^_ga(?:_|$)/.test(c.name));
  assert.ok(betaBefore.length,'dedicated beta cookies must exist after fresh article grant');
  const legacyClient=legacyBefore.find(c=>c.name==='_ga');assert.ok(legacyClient,'existing Site Kit client cookie must exist');
  report.article_fresh_grant_measuring=true;report.beta_cookie_names=betaBefore.map(c=>c.name).sort();report.legacy_cookie_names=legacyBefore.map(c=>c.name).sort();
  await page.goto(PRIVACY,{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>!!window.KampTrailAnalytics,null,{timeout:45000});
  report.privacy_status_before_revoke=await page.evaluate(()=>{const s=KampTrailAnalytics.getStatus();return {analyticsConsent:s.analyticsConsent,configured:s.configured,measuring:s.measuring,eligible:s.eligible};});
  assert.equal(report.privacy_status_before_revoke.analyticsConsent,true,'valid choice must remain granted on privacy page');
  assert.equal(report.privacy_status_before_revoke.configured,false,'ineligible privacy page never configures beta');
  assert.equal(report.privacy_status_before_revoke.measuring,false);assert.equal(report.privacy_status_before_revoke.eligible,false);
  const onPrivacy=await context.cookies();
  assert.deepEqual(onPrivacy.filter(c=>/^ktbeta(?:_|$)/.test(c.name)).map(c=>c.name).sort(),report.beta_cookie_names,'restoring a valid grant preserves existing dedicated cookies before revoke');
  await page.waitForTimeout(1000);
  assert.equal(events.filter(e=>e.beta&&e.after_privacy_commit).length,0,'privacy page sends no beta request before revoke');
  await choices(page);await page.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
  report.privacy_status_after_revoke=await page.evaluate(()=>{const s=KampTrailAnalytics.getStatus();return {analyticsConsent:s.analyticsConsent,configured:s.configured,measuring:s.measuring,eligible:s.eligible};});
  assert.equal(report.privacy_status_after_revoke.analyticsConsent,false);assert.equal(report.privacy_status_after_revoke.configured,false);assert.equal(report.privacy_status_after_revoke.measuring,false);
  const finalCookies=await context.cookies();assert.equal(finalCookies.filter(c=>/^ktbeta(?:_|$)/.test(c.name)).length,0,'privacy revoke deletes dedicated cookies even when this page never configured beta');
  const finalLegacy=finalCookies.filter(c=>/^_ga(?:_|$)/.test(c.name));
  assert.equal(finalLegacy.find(c=>c.name==='_ga')?.value,legacyClient.value,'legacy client ID is preserved');
  for(const cookie of legacyBefore)assert.ok(finalLegacy.some(c=>c.name===cookie.name),'legacy cookie name remains present');
  await page.waitForTimeout(1200);assert.equal(events.filter(e=>e.beta&&e.after_privacy_commit).length,0,'privacy revoke sends no beta hits');
  report.beta_cookie_count_after_revoke=0;report.legacy_client_id_preserved=true;report.legacy_cookie_names_preserved=true;report.beta_requests_on_privacy=0;
  await page.screenshot({path:'bob-privacy-after-revoke.png'});report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1;}
 finally{report.finished=new Date().toISOString();await fs.writeFile('bob-privacy-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
