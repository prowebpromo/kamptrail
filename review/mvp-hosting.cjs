'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{setTimeout:delay}=require('node:timers/promises');
(async()=>{
 const base='https://kamptrail.com', expected=process.env.EXPECTED_SHA;
 assert.match(expected,/^[a-f0-9]{40}$/);
 let release,found=false;
 for(let i=0;i<56;i++){
   try{const response=await fetch(base+'/release.json?mvp_check='+Date.now());if(response.ok){release=await response.json();if(release.source_commit===expected){found=true;break;}}}catch{}
   if(i===0)console.log('Waiting for the authorized deployment; this workflow makes no production changes.');
   await delay(30000);
 }
 assert.ok(found,'Expected authorized source was not observed before the wait limit');
 const result={source:release.source_commit,checks:{}};
 for(const name of ['','robots.txt','sitemap.xml','favicon.ico','googled752656373e8ed52.html','api/health.php']){
   const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);
   assert.ok(!/noindex/i.test(response.headers.get('x-robots-tag')||''),'Production must not inherit staging noindex');
   result.checks[name||'homepage']={status:response.status,type:response.headers.get('content-type')};
   if(name===''){const html=await response.text();assert.ok(html.includes('content="2.46.2"'));assert.ok(!/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html));assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('strict-transport-security'));result.headers={hsts:response.headers.get('strict-transport-security'),referrer:response.headers.get('referrer-policy'),permissions:response.headers.get('permissions-policy')};}
   else if(name==='robots.txt'){const lines=(await response.text()).split(String.fromCharCode(10));assert.ok(!lines.some(line=>{const pair=line.split(':').map(x=>x.trim());return pair[0].toLowerCase()==='disallow'&&pair[1]==='/';}),'Public production crawl must not be blocked');}
   else if(name==='sitemap.xml'){const xml=await response.text();assert.ok(xml.includes('https://kamptrail.com/plan.html'));assert.ok(xml.includes('https://kamptrail.com/about.html'));result.sitemap_urls=(xml.match(/<loc>/g)||[]).length;}
   else if(name==='googled752656373e8ed52.html')assert.equal((await response.text()).trim(),'google-site-verification: googled752656373e8ed52.html');
   else if(name==='api/health.php'){const health=await response.json();assert.equal(health.ok,true);result.health={ok:health.ok,schema:health.schema};}
 }
 await fs.writeFile('live-hosting.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
