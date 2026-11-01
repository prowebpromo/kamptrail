// Live acceptance for the rig-tag repair (2.34.0) on kamptrail.com.
// Usage: node check.js <expected_commit> <cases.json> <expected_index_sha256>
const {chromium}=require('playwright');
const crypto=require('crypto'),fs=require('fs');
const [,,COMMIT,CASES,INDEX_SHA]=process.argv;const BASE=process.env.BASE||'https://kamptrail.com';
const cases=JSON.parse(fs.readFileSync(CASES,'utf8')).cases;
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
(async()=>{
  const rel=await fetch(`${BASE}/release.json?n=${Date.now()}`).then(r=>r.ok?r.json():{}).catch(()=>({}));
  ok(rel.source_commit===COMMIT,`release.json source_commit ${rel.source_commit}`);
  const buf=Buffer.from(await (await fetch(`${BASE}/data/campsites/search-index.json?n=${Date.now()}`)).arrayBuffer());
  const sha=crypto.createHash('sha256').update(buf).digest('hex');ok(sha===INDEX_SHA,`search-index sha256 ${sha.slice(0,12)}`);
  const idx=JSON.parse(buf),byId=new Map(idx.sites.map(s=>[s.id,s]));
  ok(cases.every(c=>byId.has(c.id)),`all ${cases.length} case ids in live index`);
  const states=[...new Set(cases.flatMap(c=>byId.get(c.id).states))].sort();
  const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  const runs=[['desktop forward',{width:1440,height:1000},states],['desktop reversed',{width:1440,height:1000},[...states].reverse()],['mobile reversed',{width:390,height:844},[...states].reverse()],['mobile forward',{width:390,height:844},states]];
  for(const [label,viewport,order] of runs){
    const mobile=label.startsWith('mobile');
    const ctx=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});const page=await ctx.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${BASE}/?n=${Date.now()}`,{timeout:90000});
    await page.waitForFunction(()=>window.KampTrailData&&window.DataQuality?.rigLine&&KampTrailData.getIdentityStatus?.().hosts==='published',null,{timeout:90000});
    const ver=await page.evaluate(()=>KampTrailData.version);ok(ver==='2.34.0',`${label}: page reports ${ver}`);
    await page.waitForTimeout(1500);
    const res=await page.evaluate(async ([order,watch])=>{
      for(const s of order)await KampTrailData.loadStates([s]);
      const failed=KampTrailData.getLoadStatus().failedStates.map(f=>f.state);if(failed.length)await KampTrailData.loadStates(failed);
      const retried=failed,still=KampTrailData.getLoadStatus().failedStates.map(f=>f.state);
      const all=KampTrailData.getAllCampsites();
      const T=new Set(DataQuality.applyFilters(all,{rigSize:'tent'}).map(f=>f.properties.id)),R=new Set(DataQuality.applyFilters(all,{rigSize:'trailer'}).map(f=>f.properties.id));
      const rows=watch.map(id=>{const f=KampTrailData.getCampsiteById(id);if(!f)return {id,found:false};const p=f.properties;return {id,found:true,browser_id:p.id,rig_line:DataQuality.rigLine(p),tents:T.has(p.id),trailers:R.has(p.id)};});
      return {retried,still,rows};
    },[order,cases.map(c=>c.id)]);
    const by=new Map(res.rows.map(r=>[r.id,r]));const bad={missing:[],id:[],line:[],tents:[],trailers:[]};
    for(const c of cases){const r=by.get(c.id);if(!r.found){bad.missing.push(c.id);continue;}
      if(r.browser_id!==c.id)bad.id.push(`${c.id}->${r.browser_id}`);
      if(r.rig_line!==c.popup_after)bad.line.push(`${c.id} got "${r.rig_line}" want "${c.popup_after}"`);
      if(r.tents!==c.tents_after)bad.tents.push(c.id);if(r.trailers!==c.trailers_after)bad.trailers.push(c.id);}
    if(res.retried.length)console.log(`INFO ${label}: state retried once: ${res.retried.join(',')}; still failed: ${res.still.join(',')||'none'}`);
    ok(!bad.missing.length,`${label}: all ${cases.length} listings loaded ${bad.missing.slice(0,5).join(' ')}`);
    ok(!bad.id.length,`${label}: browser id equals index id for every listing ${bad.id.slice(0,5).join(' ')}`);
    ok(!bad.line.length,`${label}: rig line matches fixture for ${cases.length-bad.line.length}/${cases.length} ${bad.line.slice(0,3).join(' | ')}`);
    ok(!bad.tents.length,`${label}: Tents filter matches fixture for ${cases.length-bad.tents.length}/${cases.length} ${bad.tents.slice(0,5).join(' ')}`);
    ok(!bad.trailers.length,`${label}: Trailers filter matches fixture for ${cases.length-bad.trailers.length}/${cases.length} ${bad.trailers.slice(0,5).join(' ')}`);
    ok(!errors.length,`${label}: no page errors ${errors.slice(0,2).join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`SUMMARY ${fails?'FAILED':'PASSED'} (${fails} failures)`);process.exit(fails?1:0);
})().catch(e=>{console.log('SCRIPT ERROR',e.stack);process.exit(2);});
