/* Usage: NODE_PATH=/path/to/modules CHROMIUM_PATH=/path/to/chrome node census.cjs <capture-dir> <result-dir> <desktop|mobile> <forward|reverse> [404] */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, devices } = require('playwright');
const [capture, out, viewport, order, mode] = process.argv.slice(2);
const fallback = mode === '404';
const origin = 'https://kamptrail.com';
const manifest = JSON.parse(fs.readFileSync(path.join(capture, 'manifest.json')));
const digest = body => crypto.createHash('sha256').update(body).digest('hex');
function bodyFor(key) {
  const entry = manifest[key];
  const body = fs.readFileSync(path.join(capture, entry.file));
  if (digest(body) !== entry.sha256) throw Error('Response hash changed ' + key);
  return body;
}
const jsonFor = key => JSON.parse(bodyFor(key));
const states = jsonFor('/data/campsites/index.json').states.map(s => s.state).sort();
if (order === 'reverse') states.reverse();
const statesAgency = new Set(jsonFor('/data/campsites/agency/index.json').states);
if (states.length !== 50 || new Set(states).size !== 50) throw Error('state manifest');
const indexKey = '/data/campsites/search-index.json';
const types = {'.geojson':'application/json','.json':'application/json','.css':'text/css','.js':'text/javascript','.png':'image/png'};
const stats = {viewport,order,fallback,origin,release:jsonFor('/release.json'),indexSha256:manifest[indexKey].sha256,steps:[],errors:[],blocked:[],requests:[]};
const name = [viewport,order,fallback?'404':'published'].join('-');
fs.mkdirSync(out,{recursive:true});
const resultPath = path.join(out,name+'.json');
function save(){fs.writeFileSync(resultPath, JSON.stringify(stats,null,2)+'\n');}
async function main() {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH, headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    stats.browserVersion=browser.version();
    const config=viewport==='mobile'?{...devices['Pixel 7'],viewport:{width:390,height:844}}:{viewport:{width:1365,height:850}};
    const context=await browser.newContext({...config,serviceWorkers:'block',ignoreHTTPSErrors:true});
    let deny=fallback;
    await context.route('**/*',async r=>{
      const url=new URL(r.request().url());
      const key=url.pathname+url.search;
      if(deny && key==='/data/campsites/identity-hosts.json'){
        stats.host404=(stats.host404||0)+1;
        return r.fulfill({status:404,body:'Not found'});
      }
      if (url.origin!==origin || !manifest[key]) {
        if (!stats.blocked.includes(key)) stats.blocked.push(key);
        return r.abort();
      }
      stats.requests.push(key);
      const contentType=key==='/'?'text/html':types[path.extname(url.pathname)]||'application/octet-stream';
      return r.fulfill({status:200,contentType,body:bodyFor(key)});
    });
    const page=await context.newPage();
    page.on('pageerror',err=>stats.errors.push(String(err)));
    await page.goto(origin+'/', {waitUntil:'load', timeout:90000});
    await page.waitForFunction(()=>window.KampTrailData?.getLoadStatus?.().catalogueTotal>0 && document.querySelector('#result-summary').textContent.includes('nationwide'));
    await page.evaluate(async () => {
      const index=(await KampTrailData.loadSearchIndex()).sites;
      const hosts=new Map(),owners=new Map();
      for(const row of index){
        const ids=[...new Set([row.id,...row.legacy_ids])].sort();
        if(hosts.has(row.id)) throw Error('index repeats host '+row.id);
        hosts.set(row.id,ids);
        for(const id of ids){
          if(owners.has(id)) throw Error('index repeats ID '+id);
          owners.set(id,row.id);
        }
      }
      window.audit={hosts,owners,shown:new Set()};
    });
    stats.initial=await page.evaluate(()=>({hosts:audit.hosts.size,allIds:audit.owners.size,version:KampTrailData.version,identity:KampTrailData.getIdentityStatus(),loaded:KampTrailData.getLoadedStates(),display:[innerWidth, innerHeight],agent:navigator.userAgent}));
    if(stats.initial.version!=='2.34.0' || stats.initial.hosts!==33370 || stats.initial.loaded.length || (stats.initial.identity.hosts==='fallback')!==fallback) throw Error('unexpected initial state');
    for(const state of states){
      const row=await page.evaluate(async({state,fallback})=>{
        const stat=await KampTrailData.loadStates([state]);
        if(stat.failedStates.length || !stat.loadedStates.includes(state)) throw Error(JSON.stringify(stat));
        const info={state,sites:stat.totalSites,identity:KampTrailData.getIdentityStatus().hosts};
        if(fallback){
          Object.assign(info,{wrongMerges:0,unknown:0,disappeared:0,examples:[]});
          const visible=new Set();
          for(const f of KampTrailData.getAllCampsites()){
            const p=f.properties, owner=audit.owners.get(p.id);
            visible.add(p.id);
            const wrongIds=[];
            for(const id of [p.id,...(p.legacy_ids||[])]){
              if(!audit.owners.has(id))info.unknown++;
              if(audit.owners.get(id)!==owner)wrongIds.push(id);
            }
            if(wrongIds.length){info.wrongMerges++;if(info.examples.length<8)info.examples.push({shown:p.id,owner,wrongIds});}
          }
          for(const id of audit.shown)if(!visible.has(id)){info.disappeared++;if(info.examples.length<8)info.examples.push({disappeared:id});}
          for(const id of visible)audit.shown.add(id);
        }
        return info;
      },{state,fallback});
      stats.steps.push(row);
      if(row.identity!==(fallback?'fallback':'published'))throw Error('unexpected identity status '+state);
      if(stats.steps.length%5===0 || stats.steps.length===1){save();console.log(name,stats.steps.length,state,row.sites,new Date().toISOString());}
    }
    if(fallback){
      stats.fallback=await page.evaluate(()=>{
        const multiple=new Map();let nonCanonical=0;
        for(const id of audit.shown){const host=audit.owners.get(id);multiple.set(host,(multiple.get(host)||0)+1);}
        const currently=new Set(KampTrailData.getAllCampsites().map(f=>f.properties.id));
        for(const host of multiple.keys())if(!currently.has(host))nonCanonical++;
        return {states:KampTrailData.getLoadedStates().length,shown:audit.shown.size,withDuplicateMarkers:[...multiple.values()].filter(n=>n>1).length,nonCanonical};
      });
      deny=false;
      // Use the production reconnect listener, without calling the manual retry API.
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
      await page.waitForFunction(()=>KampTrailData.getIdentityStatus().hosts==='published',null,{timeout:100000});
    }
    stats.final=await page.evaluate(()=>{
      const {hosts,owners,shown}=audit;
      const actual=new Map(),seenOwners=new Set(),membersSeen=new Set(),problems=[];
      const errors={canonicalMissing:0,canonicalExtra:0,duplicateCanonical:0,differentMembers:0,unknownMembers:0,wrongMerges:0,shownResolvedElsewhere:0};
      const note=(kind,detail)=>{errors[kind]++;if(problems.length<50)problems.push({kind,...detail});};
      for(const f of KampTrailData.getAllCampsites()){
        const p=f.properties,ids=[...new Set([p.id,...(p.legacy_ids||[])])].sort();
        if(actual.has(p.id))note('duplicateCanonical',{id:p.id});
        actual.set(p.id,ids);
        const owner=owners.get(p.id),expected=hosts.get(p.id),wrong=ids.filter(id=>owners.get(id)!==owner);
        if(!expected)note('canonicalExtra',{id:p.id,expectedHost:owner});
        if(expected&&JSON.stringify(expected)!==JSON.stringify(ids))note('differentMembers',{id:p.id,expected,actual:ids});
        if(wrong.length)note('wrongMerges',{id:p.id,wrong});
        for(const id of ids){membersSeen.add(id); if(!owners.has(id))note('unknownMembers',{id});}
        seenOwners.add(owner);
      }
      for(const host of hosts.keys())if(!actual.has(host))note('canonicalMissing',{id:host});
      for(const id of shown){const expected=owners.get(id);if(KampTrailData.publishedId(id)!==expected || !actual.get(expected)?.includes(id))note('shownResolvedElsewhere',{id,expected});}
      return {states:KampTrailData.getLoadedStates(),rows:KampTrailData.getAllCampsites().length,distinctHosts:actual.size,distinctMembers:membersSeen.size,expectedHosts:hosts.size,expectedMembers:owners.size,errors,problems};
    });
    // Drive the actual rig selector, then apply its active filter to the national loaded map catalogue.
    await page.locator('#filters').click();
    stats.filters={};
    for(const rig of ['tent','trailer']){
      await page.locator('#f-rig').selectOption(rig);
      stats.filters[rig]=await page.evaluate(()=>{
        const filter=KampTrailData.getCurrentFilters();
        return {selection:filter.rigSize,nationalMatches:DataQuality.applyFilters(KampTrailData.getAllCampsites(),filter).length};
      });
    }
    const required=states.map(s=>'/data/campsites/'+s+'_merged.geojson').concat([...statesAgency].map(s=>'/data/campsites/agency/'+s+'.geojson'), ['/data/campsites/identity-hosts.json','/data/campsites/ridb-sites.json','/data/campsites/ridb-amenities.json','/data/campsites/usfs-site-amenities.json']);
    stats.missingRequests=required.filter(key=>!stats.requests.includes(key));
    stats.pass=!Object.values(stats.final.errors).some(Boolean) && !stats.steps.some(x=>x.wrongMerges||x.unknown||x.disappeared) && !stats.missingRequests.length && JSON.stringify(stats.final.states)===JSON.stringify(states) && (!fallback||stats.host404>0);
    if(!stats.pass)process.exitCode=1;
  } finally {save();await browser.close();}
}
main().catch(err=>{stats.failure=String(err.stack);save();console.error(err);process.exitCode=1;});
