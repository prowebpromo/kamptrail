const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.cwd()+'/node_modules/playwright');
const AxeBuilder=require(process.cwd()+'/node_modules/@axe-core/playwright').default;
const root=process.cwd(),out=path.resolve(process.argv[2]||'dist/kamptrail');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.KAMPTRAIL_TEST_CHROME||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
 const requests=[];
 await context.route('**/*',r=>{const u=new URL(r.request().url()),name=u.pathname.slice(1);requests.push({origin:u.origin,file:name});if(u.origin==='https://lightslategrey-emu-717044.hostingersite.com'&&['consent-preview.html','consent-analytics.js','consent-controls.js'].includes(name))return r.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(path.join(out,name))});return r.abort();});
 const result={fixtureOnly:true,liveRequestsSent:0,checks:[]};
 try{
  const p=await context.newPage();await p.goto('https://lightslategrey-emu-717044.hostingersite.com/consent-preview.html');
  await p.getByRole('button',{name:'Allow optional analytics',exact:true}).waitFor();
  assert.match(await p.locator('#preview-status').innerText(),/Choice: unknown/);
  assert.equal(await p.locator('dialog').count(),0);
  await p.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  assert.match(await p.locator('#preview-status').innerText(),/Choice: granted[\s\S]*Adapter enabled: false[\s\S]*Collection permitted: false/);
  await p.reload();assert.match(await p.locator('#preview-status').innerText(),/Choice: granted/);
  const q=await context.newPage();await q.goto('https://lightslategrey-emu-717044.hostingersite.com/consent-preview.html');
  assert.match(await q.locator('#preview-status').innerText(),/Choice: granted/);
  await q.getByRole('button',{name:'Decline',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('#preview-status').textContent.includes('Choice: denied'));
  await p.reload();assert.match(await p.locator('#preview-status').innerText(),/Choice: denied/);
  await p.getByRole('button',{name:'Allow optional analytics',exact:true}).click();
  await q.waitForFunction(()=>document.querySelector('#preview-status').textContent.includes('Choice: granted'));
  await q.getByRole('button',{name:'Revoke and clear choice',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('#preview-status').textContent.includes('Choice: unknown'));
  assert.equal(await p.evaluate(()=>localStorage.getItem('kt_optional_analytics_choice_v1')),null);
  result.checks.push('Real browser grant/decline/reload and cross-tab revocation clear only the choice key; adapter stays disabled with collection forbidden');
  for(const width of [390,1440]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const axe=await new AxeBuilder({page:p}).analyze();assert.deepEqual(axe.violations.map(x=>({id:x.id,impact:x.impact})),[]);await p.screenshot({path:'/tmp/kt-consent-'+width+'.png',fullPage:true});}
  result.checks.push('390px and 1440px render without horizontal overflow; automated axe accessibility checks report zero violations');
  const blocked=await browser.newContext({serviceWorkers:'block'});await blocked.route('**/*',r=>{const name=new URL(r.request().url()).pathname.slice(1);return ['consent-preview.html','consent-analytics.js','consent-controls.js'].includes(name)?r.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(path.join(out,name))}):r.abort();});
  await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new Error('Blocked test storage');}}));
  const b=await blocked.newPage();await b.goto('https://lightslategrey-emu-717044.hostingersite.com/consent-preview.html');
  await b.getByRole('button',{name:'Allow optional analytics',exact:true}).click();assert.match(await b.locator('#preview-status').innerText(),/Choice: granted[\s\S]*Storage: memory/);assert.match(await b.locator('#consent-settings').innerText(),/lost on reload/);await b.reload();assert.match(await b.locator('#preview-status').innerText(),/Choice: unknown/);await blocked.close();
  result.checks.push('Blocked storage is visibly memory-only and reload returns to unknown/denied permission');
  assert.ok(requests.every(x=>x.origin==='https://lightslategrey-emu-717044.hostingersite.com'&&['consent-preview.html','consent-analytics.js','consent-controls.js'].includes(x.file)));
  result.requestedResourceNames=[...new Set(requests.map(x=>x.file))];
  fs.writeFileSync(root+'/consent-browser-acceptance.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
