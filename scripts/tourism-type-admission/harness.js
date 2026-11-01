'use strict';
// Measurement harness: builds the published catalogue exactly as build-search-index.js does,
// using a given data-quality.js variant loaded in isolation, with optional trace hooks.
const fs=require('fs'),path=require('path'),vm=require('vm');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function loadDQ(file,{patch=s=>s,trace=null}={}){
  const ctx={module:{exports:{}},URL,Date,Set,Map,WeakSet,JSON,Math,Number,String,Object,Array,console,__trace:trace};
  ctx.globalThis=ctx;vm.runInNewContext(patch(fs.readFileSync(file,'utf8')),ctx,{filename:file});return ctx.module.exports;
}
function inputs(root){
  const dir=path.join(root,'data/campsites');
  const states=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
  const collections=states.map(state=>{const g=read(path.join(dir,state+'_merged.geojson'));const a=path.join(dir,'agency',state+'.geojson');
    if(fs.existsSync(a))g.features=[...g.features,...read(a).features];return {state,geojson:g};});
  const idx=read(path.join(dir,'search-index.json')).sites;
  return {dir,states,collections,idx,details:read(path.join(dir,'ridb-sites.json')).facilities,ridb:read(path.join(dir,'ridb-amenities.json')),usfs:read(path.join(dir,'usfs-site-amenities.json'))};
}
// Rebuild the selected states using the index's own candidates, sidecars and final host election.
// The actual browser loader is independently exercised by scripts/check-browser-identity.js.
function catalogue(DQ,I,{browser=false,statesOrder=I.collections}={}){
  const attach=f=>{DQ.attachSiteDetails(f,I.details);DQ.attachRIDBAmenities(f,I.ridb);DQ.attachUSFSSiteAmenities(f,I.usfs);};
  const input=[],stateById=new Map(),withheldMembers=new Set();
  for(const {state,geojson} of [...statesOrder].sort((a,b)=>a.state.localeCompare(b.state))){
    const options={state,siteDetails:I.details,amenityDetails:I.ridb};
    for(const id of DQ.withheldMembers?.(geojson.features,options)||[])withheldMembers.add(id);
    for(const raw of DQ.publicationCandidates(geojson.features,options)){
      const f=DQ.normalizeFeature(raw,options);if(!f)continue;
      attach(f);input.push(f);
      for(const id of [f.properties.id,...(f.properties.legacy_ids||[])]){
        if(!stateById.has(id))stateById.set(id,new Set());stateById.get(id).add(state);
      }
    }
  }
  const preferredIds=new Set(),previousHosts=new Map();
  for(const row of I.idx){
    if(!browser||row.legacy_ids.length)preferredIds.add(row.id);
    for(const id of row.legacy_ids)previousHosts.set(id,row.id);
  }
  const options={preferredIds,previousHosts,withheldMembers,siteDetails:I.details,amenityDetails:I.ridb};
  if(!browser)options.publishedPoints=new Map(I.idx.map(s=>[s.id,[s.lng,s.lat]]));
  const features=DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},options).features;
  features.forEach(attach);
  return {features,stateById};
}
module.exports={loadDQ,inputs,catalogue,read};
