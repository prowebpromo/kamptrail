const {chromium}=require('/home/claude/kamptrail/node_modules/playwright');
const fs=require('fs');
const index=JSON.parse(fs.readFileSync(process.env.INDEX_FILE,'utf8'));
const compact=index.sites.map(s=>[s.id,[s.id,...s.legacy_ids].sort()]);
const seedShuffle=(list,seed)=>{let s=seed>>>0||1;const rnd=()=>((s=Math.imul(s^(s>>>15),0x2c1b3c6d)+0x6d2b79f5>>>0)/4294967296);const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const BASE=process.env.BASE||'https://kamptrail.com';const MOBILE=process.env.MOBILE==='1';
async function boot(browser,{delay={},fail=false}={}){
  const ctx=await browser.newContext({serviceWorkers:'block',...(MOBILE?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{})}),page=await ctx.newPage();
  page.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,150)));
  await page.addInitScript(()=>localStorage.setItem('kt_last_position',JSON.stringify({lat:-10,lng:-140,zoom:9})));
  await page.route('**/api/**',r=>r.fulfill({status:404,body:'{}'}));
  for(const [c,ms] of Object.entries(delay))await page.route(`**/data/campsites/${c}_merged.geojson`,async r=>{await new Promise(x=>setTimeout(x,ms));await r.continue();});
  if(fail)await page.route('**/identity-hosts.json',r=>r.fulfill({status:404,body:'nf'}));
  await page.goto(BASE+'/?n='+Date.now());
  await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getStateBounds,null,{timeout:30000});
  if(!fail)await page.waitForFunction(()=>KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:30000});
  else await page.waitForTimeout(3500);
  return {ctx,page};
}
async function compare(page){
  return page.evaluate(idx=>{
    const all=KampTrailData.getAllCampsites();const byId=new Map();
    all.forEach((f,i)=>{for(const id of new Set([f.properties.id,...(f.properties.legacy_ids||[])]))byId.set(id,(byId.get(id)||[]).concat(i));});
    let diff=0,missing=0,wrongMerge=0,canonDiff=0,setDiff=0,dupSplit=0;const ex=[];
    const owner=new Map(); idx.forEach(([id,ids],k)=>ids.forEach(x=>owner.set(x,k)));
    for(const [id,ids] of idx){
      const hit=new Set();ids.forEach(x=>(byId.get(x)||[]).forEach(i=>hit.add(i)));
      if(!hit.size){missing++;diff++;if(ex.length<5)ex.push(['missing',id]);continue;}
      if(hit.size>1){dupSplit++;diff++;continue;}
      const f=all[[...hit][0]];const got=[...new Set([f.properties.id,...(f.properties.legacy_ids||[])])].sort();
      const c=f.properties.id!==id,s=JSON.stringify(got)!==JSON.stringify(ids);
      if(c)canonDiff++;if(s){setDiff++;if(ex.length<5)ex.push(['set',id,got.join('|'),ids.join('|')]);}
      if(c||s)diff++;
    }
    for(const f of all){const owners=new Set([f.properties.id,...(f.properties.legacy_ids||[])].map(x=>owner.get(x)));if(owners.size>1){wrongMerge++;if(ex.length<8)ex.push(['wrong',f.properties.id]);}}
    return {features:all.length,diff,missing,dupSplit,canonDiff,setDiff,wrongMerge,ex};
  },compact);
}
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']}).catch(()=>chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']}));
  const which=process.argv[2];
  const first=await boot(browser);
  const ALL=await first.page.evaluate(()=>Object.keys(KampTrailData.getStateBounds()));
  await first.ctx.close();
  const scen={
    reversed:{order:[...ALL].reverse()},
    seed7:{order:seedShuffle(ALL,7)},
    seed424242:{order:seedShuffle(ALL,424242)},
    delayed:{par:true,delay:{TX:4000}},
    default:{order:ALL}
  };
  if(which==='failure'){
    const {ctx,page}=await boot(browser,{fail:true});
    for(const c of seedShuffle(ALL,99))await page.evaluate(c=>KampTrailData.loadStates([c]),c);
    const r1=await compare(page);console.log('FALLBACK',JSON.stringify(r1),await page.evaluate(()=>KampTrailData.getIdentityStatus()));
    // shown ids -> still open right listing after load
    const shown=await page.evaluate(()=>KampTrailData.getAllCampsites().map(f=>f.properties.id));
    await page.unroute('**/identity-hosts.json');
    await page.evaluate(()=>KampTrailData.retryIdentity());
    await page.waitForFunction(()=>KampTrailData.getIdentityStatus().hosts==='published');
    const r2=await compare(page);console.log('AFTER',JSON.stringify(r2));
    const bad=await page.evaluate(({shown,idx})=>{const own=new Map();idx.forEach(([id,ids],k)=>ids.forEach(x=>own.set(x,k)));let b=0;for(const id of shown){const f=KampTrailData.getCampsiteById(id);if(!f||![f.properties.id,...(f.properties.legacy_ids||[])].some(x=>own.get(x)===own.get(id)&&true)||own.get(f.properties.id)!==own.get(id))b++;}return b;},{shown,idx:compact});
    console.log('fallback-shown ids not opening same listing after load:',bad,'of',shown.length);
    await ctx.close();await browser.close();return;
  }
  const names=which?[which]:Object.keys(scen);
  for(const n of names){
    const sc=scen[n];const {ctx,page}=await boot(browser,{delay:sc.delay||{}});const t=Date.now();
    if(sc.par)await page.evaluate(a=>KampTrailData.loadStates(a),ALL);
    else for(const c of sc.order)await page.evaluate(c=>KampTrailData.loadStates([c]),c);
    console.log(n,JSON.stringify(await compare(page)),'ms',Date.now()-t);
    await ctx.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
