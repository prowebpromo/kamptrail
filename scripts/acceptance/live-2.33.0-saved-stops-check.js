// Live: saved stop under a legacy id keeps its stored id and opens the index listing, in both load orders,
// and a cached offline second visit (service worker on) gives the same identity and claims.
const {chromium}=require('playwright');
const BASE=process.env.BASE||'https://kamptrail.com';
const LEGACY='ridb:232479',CANON='osm:way:1107154601';
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const snap=page=>page.evaluate(ids=>ids.map(id=>{const f=KampTrailData.getCampsiteById(id);if(!f)return [id,null];const p=f.properties;
  return [id,p.id,[p.id,...(p.legacy_ids||[])].sort().join('|'),p.name,JSON.stringify(DataQuality.amenityFilterReason(p,'toilet'))];}),[LEGACY,CANON]);
(async()=>{
  const browser=await (process.env.CHROMIUM_PATH?chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}):chromium.launch({args:['--no-sandbox']}));
  for(const order of [['NC','TN'],['TN','NC']]){
    const ctx=await browser.newContext({serviceWorkers:'block'}),page=await ctx.newPage();
    await page.addInitScript(()=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('kt_trip',JSON.stringify([{id:'ridb:232479',feature:null,note:'legacy',arrive:'',depart:''}]));}});
    for(let visit=0;visit<2;visit++){
      if(visit)await page.reload();else await page.goto(BASE+'/?n='+Date.now());
      await page.waitForFunction(()=>window.KampTrailData&&window.KampTrailTrip&&KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:60000});
      for(const s of order)await page.evaluate(s=>KampTrailData.loadStates([s]),s);
      await page.waitForTimeout(1500);
      const stops=await page.evaluate(()=>KampTrailTrip.getStops().map(s=>[s.id,s.feature?.properties.id,s.feature?.properties.name]));
      const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kt_trip')).map(s=>s.id));
      ok(stored.length===1&&stored[0]===LEGACY,`order ${order.join('>')} visit ${visit+1}: stored id stays ${LEGACY} (${stored})`);
      ok(stops[0]?.[1]===CANON,`order ${order.join('>')} visit ${visit+1}: saved stop opens ${CANON} ${stops[0]?.[2]}`);
    }
    await ctx.close();
  }
  // Cached second visit with the service worker on, then offline, states in the other order.
  const ctx=await browser.newContext(),page=await ctx.newPage();
  await page.goto(BASE+'/');
  await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:60000});
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.evaluate(()=>KampTrailData.loadStates(['NC']));await page.evaluate(()=>KampTrailData.loadStates(['TN']));await page.waitForTimeout(3000);
  const online=await snap(page);
  await page.reload();await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:60000});
  await page.evaluate(()=>KampTrailData.loadStates(['NC']));await page.evaluate(()=>KampTrailData.loadStates(['TN']));await page.waitForTimeout(3000);
  await ctx.setOffline(true);
  await page.reload();await page.waitForFunction(()=>window.KampTrailData&&KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:60000}).catch(()=>{});
  const status=await page.evaluate(()=>KampTrailData.getIdentityStatus?.());
  await page.evaluate(()=>KampTrailData.loadStates(['TN']));await page.evaluate(()=>KampTrailData.loadStates(['NC']));await page.waitForTimeout(3000);
  const offline=await snap(page);
  console.log('online ',JSON.stringify(online));console.log('offline',JSON.stringify(offline),JSON.stringify(status));
  ok(JSON.stringify(online)===JSON.stringify(offline)&&online[0][1]===CANON,'cached offline visit in reversed order gives the same identity and toilet claim');
  await ctx.close();await browser.close();
  console.log(`SUMMARY ${fails?'FAILED':'PASSED'} (${fails})`);process.exit(fails?1:0);
})().catch(e=>{console.log('SCRIPT ERROR',e.stack);process.exit(2);});
