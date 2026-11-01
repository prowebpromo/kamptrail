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
// Index build (canonical identity) and browser build (data-loader.js L182: no preferredIds/previousHosts).
function catalogue(DQ,I,{browser=false,statesOrder=null}={}){
  const attach=f=>{DQ.attachSiteDetails(f,I.details);DQ.attachRIDBAmenities(f,I.ridb);DQ.attachUSFSSiteAmenities(f,I.usfs);};
  if(!browser){
    const input=[],stateById=new Map();
    for(const {state,geojson} of I.collections){const o={state,siteDetails:I.details};for(const raw of DQ.publicationCandidates(geojson.features,o)){const f=DQ.normalizeFeature(raw,o);if(!f)continue;attach(f);input.push(f);
      for(const id of [f.properties.id,...(f.properties.legacy_ids||[])]){if(!stateById.has(id))stateById.set(id,new Set());stateById.get(id).add(state);}}}
    const preferredIds=new Set(I.idx.map(s=>s.id)),previousHosts=new Map();for(const s of I.idx)for(const a of s.legacy_ids||[])previousHosts.set(a,s.id);
    const out=DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},{preferredIds,previousHosts,siteDetails:I.details}).features;out.forEach(attach);
    return {features:out,stateById};
  }
  // Browser: states merged one at a time into the running catalogue, as mergeLoaded does.
  let all=[];
  for(const {state,geojson} of (statesOrder||I.collections)){
    const o={state,siteDetails:I.details};const incoming=DQ.publicationCandidates(geojson.features,o).map(raw=>DQ.normalizeFeature(raw,o));
    incoming.forEach(attach);
    all=DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:[...all,...incoming]},o).features;all.forEach(attach);
  }
  return {features:all};
}
module.exports={loadDQ,inputs,catalogue,read};
