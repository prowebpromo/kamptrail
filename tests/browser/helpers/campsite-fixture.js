// Synthetic catalogues obey the same history/source-byte admission contract as production.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const allStates='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
async function bindCampsiteFixture(page,{states=['NY'],features=[],search=null,index=null}={}){
  const historyRaw=JSON.stringify({version:1,listings:[]})+'\n',history_sha256=digest(historyRaw);
  const raw=JSON.stringify({type:'FeatureCollection',features}),agencyRaw=JSON.stringify({type:'FeatureCollection',features:[]});
  const source_sha256=Object.fromEntries(allStates.flatMap(code=>[
    [`data/campsites/${code}_merged.geojson`,digest(raw)],
    [`data/campsites/agency/${code}.geojson`,digest(agencyRaw)]
  ]));
  const metadata={...(index||{states:states.map(state=>({state,count:features.length})),total_sites:states.length*features.length}),history_sha256,source_sha256};
  const sites=features.map(feature=>{const p=feature.properties,[lng,lat]=feature.geometry.coordinates;return{id:p.id,name:p.name,legacy_ids:p.legacy_ids||[],states,lat,lng,m:{f:p.fee_status||'unknown',t:p.type||'established'}};});
  const boundSearch={...(search||{version:1,filter_version:1,sites}),history_sha256,source_sha256};
  const hosts={};for(const feature of features){const p=feature.properties,aliases=[...new Set([...(p.legacy_ids||[]),...(p.source_ids||[])])].filter(id=>id!==p.id);if(p.id&&aliases.length)hosts[p.id]=aliases;}
  const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  await page.route('**/data/campsites/withdrawn.json',r=>r.fulfill({contentType:'application/json',body:historyRaw}));
  await page.route('**/data/campsites/index.json',r=>json(r,metadata));
  await page.route('**/data/campsites/search-index.json',r=>json(r,boundSearch));
  await page.route('**/data/campsites/identity-hosts.json',r=>json(r,{version:1,index_sites:Math.max(1,boundSearch.sites.length),index_sha256:digest(JSON.stringify(boundSearch)),history_sha256,hosts}));
  await page.route('**/data/campsites/agency/index.json',r=>json(r,{version:1,states:[]}));
  return {history_sha256,source_sha256};
}
function boundSearchFixture(search){
  const directory=path.join(__dirname,'../../../data/campsites');
  const metadata=JSON.parse(fs.readFileSync(path.join(directory,'index.json'),'utf8'));
  return {...search,history_sha256:metadata.history_sha256,source_sha256:metadata.source_sha256};
}
module.exports={bindCampsiteFixture,boundSearchFixture};
