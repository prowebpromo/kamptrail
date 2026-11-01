// Live acceptance for KampTrail 2.31.0 on kamptrail.com, desktop then mobile, one browser at a time.
// Usage: node live-231-check.js <expected_commit> <cases.json> <expected_search_index_sha256>
const {chromium}=require('playwright');
const crypto=require('crypto'),fs=require('fs');
const [,,COMMIT,CASES,INDEX_SHA]=process.argv;
const BASE='https://kamptrail.com';
const cases=JSON.parse(fs.readFileSync(CASES,'utf8')).cases;
let fails=0;const ok=(c,msg)=>{console.log((c?'PASS ':'FAIL ')+msg);if(!c)fails++;};

(async()=>{
  const rel=await (await fetch(`${BASE}/release.json?n=${Date.now()}`)).json();
  ok(rel.source_commit===COMMIT,`release.json source_commit ${rel.source_commit}`);
  const idxBuf=Buffer.from(await (await fetch(`${BASE}/data/campsites/search-index.json?n=${Date.now()}`)).arrayBuffer());
  const sha=crypto.createHash('sha256').update(idxBuf).digest('hex');
  ok(sha===INDEX_SHA,`search-index.json sha256 ${sha.slice(0,12)}`);
  const idx=JSON.parse(idxBuf);const byId=new Map(idx.sites.map(s=>[s.id,s]));
  const states=[...new Set(cases.flatMap(c=>byId.get(c.id)?.states||[]))].sort();
  ok(cases.every(c=>byId.has(c.id)),`all ${cases.length} case ids present in live search index (${states.length} states)`);

  for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
    const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    const ctx=await browser.newContext({viewport,isMobile:label==='mobile',hasTouch:label==='mobile',serviceWorkers:'block'});
    const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${BASE}/?n=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:90000});
    await page.waitForFunction(()=>window.KampTrailData&&window.DataQuality,null,{timeout:90000});
    const ver=await page.evaluate(()=>({js:KampTrailData.version,meta:document.querySelector('meta[name=kamptrail-version]')?.content}));
    ok(ver.js==='2.31.0'&&ver.meta==='2.31.0',`${label}: page reports ${ver.js}/${ver.meta}`);
    await page.waitForTimeout(5000);
    const res=await page.evaluate(async ([cases,states,L,idxIds])=>{
      for(let i=0;i<3&&cases.some(c=>!KampTrailData.getCampsiteById(c.id));i++)await KampTrailData.loadStates(states);
      const missing=cases.filter(c=>!KampTrailData.getCampsiteById(c.id)).map(c=>c.id);
      if(missing.length)return {missing,status:KampTrailData.getLoadStatus()};
      const all=KampTrailData.getAllCampsites(),base=KampTrailData.getDefaultFilters();
      const run=f=>new Set(DataQuality.applyFilters(all,{...base,...f}).map(s=>s.properties.id));
      const T=run({amenities:['toilet']}),W=run({amenities:['water']}),TL=run({amenities:['toilet'],rigLength:20});
      const box=document.createElement('div');
      return cases.map(c=>{
        const site=KampTrailData.getCampsiteById(c.id);box.innerHTML=KampTrailData.popupHTML(site);
        const ev=box.querySelector('.kt-amenity-evidence');
        const st=a=>ev?.querySelector(`[data-amenity="${a}"]`)?.getAttribute('data-status')||null;
        const R=a=>JSON.stringify(DataQuality.amenityFilterReason(site.properties,a));
        const exp=JSON.stringify([c.toilet,c.water,c.toilet_with_length_filter]),got='['+[R('toilet'),R('water'),DataQuality.amenityFilterReason(site.properties,'toilet',L)].map(x=>typeof x==='string'?x:JSON.stringify(x)).join(',')+']';
        const ix=idxIds[c.id],br=[site.properties.id,...(site.properties.legacy_ids||[])].filter((v,i,a)=>a.indexOf(v)===i).sort().join(',');
        return {id:c.id,reasonMatch:exp===got,identityDiffers:br!==ix,browserId:site.properties.id,t:T.has(site.properties.id),w:W.has(site.properties.id),tl:TL.has(site.properties.id),
          noSource:ev?.getAttribute('data-state')==='no_source',toiletStatus:st('toilet'),waterStatus:st('water'),
          oldLine:/Amenities reported:/.test(box.textContent)};
      });
    },[cases,states,JSON.parse(fs.readFileSync(CASES,'utf8')).length_filter_used,Object.fromEntries(cases.map(c=>{const x=byId.get(c.id);return [c.id,[x.id,...(x.legacy_ids||[])].filter((v,i,a)=>a.indexOf(v)===i).sort().join(',')];}))]);
    if(res.missing){ok(false,`${label}: ${res.missing.length} case listings not loaded ${res.missing.slice(0,5)} ${JSON.stringify(res.status).slice(0,300)}`);await browser.close();continue;}
    const m=new Map(res.map(r=>[r.id,r]));const bad={agree:[],old:[]};
    for(const c of cases){const r=m.get(c.id);
      if((r.toiletStatus==='present')!==r.t||(r.waterStatus==='present')!==r.w)bad.agree.push(`${c.id} t:${r.toiletStatus}/${r.t} w:${r.waterStatus}/${r.w}`);
      if(r.oldLine)bad.old.push(c.id);}
    const mism=res.filter(r=>!r.reasonMatch),idDiff=mism.filter(r=>r.identityDiffers),other=mism.filter(r=>!r.identityDiffers);
    ok(!other.length,`${label}: fixture outcomes (toilet, water, toilet+20 ft) reproduce for every listing whose browser identity matches the index: ${cases.length-mism.length} exact, ${idDiff.length} identity-divergent, ${other.length} unexplained ${other.map(r=>r.id).join(' ')}`);
    console.log(`INFO ${label}: identity-divergent listings: ${idDiff.map(r=>r.id+'->'+r.browserId).join(' ')}`);
    ok(!bad.agree.length,`${label}: popup and filters agree for ${cases.length-bad.agree.length}/${cases.length} ${bad.agree.slice(0,3).join(' | ')}`);
    ok(!bad.old.length,`${label}: unsourced "Amenities reported:" line absent`);
    // Catalogue-wide identity divergence in the loaded states.
    const div=await page.evaluate(ix=>{const by=new Map();for(const f of KampTrailData.getAllCampsites()){by.set(f.properties.id,f);for(const a of f.properties.legacy_ids||[])if(!by.has(a))by.set(a,f);}
      let n=0,miss=0;for(const [id] of ix){const f=by.get(id);if(!f)miss++;else if(f.properties.id!==id)n++;}return {n,miss,total:ix.length};},idx.sites.filter(s=>s.states.some(st=>states.includes(st))).map(s=>[s.id]));
    console.log(`INFO ${label}: catalogue listings in loaded states shown under a different canonical id: ${div.n} of ${div.total} (not found: ${div.miss})`);
    // Rendered popup on the real map for one listing per class.
    for(const id of [cases.find(c=>c.class==='ridb'&&c.toilet.included)?.id,cases.find(c=>c.toilet.reason==='no_amenity_source')?.id].filter(Boolean)){
      await page.evaluate(id=>{KampTrailData.updateFilters({});KampTrailData.focusCampsite(id);},id);
      const vis=await page.locator('.leaflet-popup .kt-amenity-evidence').first().waitFor({state:'visible',timeout:30000}).then(()=>true).catch(()=>false);
      ok(vis,`${label}: rendered popup shows amenity evidence for ${id}`);
    }
    ok(!errors.length,`${label}: no page errors ${errors.slice(0,2).join(' | ')}`);
    await browser.close();
  }
  console.log(`SUMMARY ${fails?'FAILED':'PASSED'} (${fails} failures)`);process.exit(fails?1:0);
})().catch(e=>{console.log('SCRIPT ERROR',e.stack);process.exit(2);});
