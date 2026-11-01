'use strict';
// Step 1 measurement: borrowed rig values in the published catalogue of a checkout (default: baseline main).
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(process.argv[2]);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function loadIsolated(file){const c={module:{exports:{}},URL,Date,Set,Map,WeakSet,JSON,Math,Number,String,Object,Array,console};c.globalThis=c;vm.runInNewContext(fs.readFileSync(file,'utf8'),c,{filename:file});return c.module.exports;}
const DQ=loadIsolated(path.join(root,'data-quality.js'));
const dir=path.join(root,'data/campsites');
const states=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
const elements=new Map();
for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties||{};if(p.osm_id!=null&&p.osm_type)elements.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
const details=read(path.join(dir,'ridb-sites.json')).facilities,ridbA=read(path.join(dir,'ridb-amenities.json')),usfsA=read(path.join(dir,'usfs-site-amenities.json'));
const idx=read(path.join(dir,'search-index.json')).sites;
const attach=f=>{DQ.attachSiteDetails(f,details);DQ.attachRIDBAmenities(f,ridbA);DQ.attachUSFSSiteAmenities(f,usfsA);};
const rowsById=new Map(),agencyRows=new Map();
function catalogue(options){
  const input=[];
  for(const state of states){
    const features=read(path.join(dir,`${state}_merged.geojson`)).features,agency=path.join(dir,'agency',`${state}.geojson`);
    for(const f of features){const id=f.properties.id;if(!rowsById.has(id))rowsById.set(id,[]);rowsById.get(id).push({state,p:f.properties});}
    if(fs.existsSync(agency))for(const f of read(agency).features){agencyRows.set(f.properties.id,f.properties);features.push(f);}
    for(const raw of DQ.publicationCandidates(features,{state})){const f=DQ.normalizeFeature(raw,{state});if(f){attach(f);input.push(f);}}
  }
  const out=DQ.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},options).features;out.forEach(attach);return out;
}
const preferredIds=new Set(idx.map(s=>s.id)),previousHosts=new Map();for(const s of idx)for(const a of s.legacy_ids||[])previousHosts.set(a,s.id);
const cat=catalogue({preferredIds,previousHosts});
const browser=catalogue({});const browserBy=new Map();for(const f of browser)for(const id of [f.properties.id,...(f.properties.legacy_ids||[])])if(!browserBy.has(id))browserBy.set(id,f);
const TAG={tent:'tents',trailer:'caravans',rv:'motorhome'};
const own=p=>{const e=/^osm:/.test(p.id)?elements.get(p.id):null,o={};
  if(e)for(const [c,k] of Object.entries(TAG))if(e[k]!=null)o[k]=String(e[k]);
  return o;};
const ownList=p=>{const a=agencyRows.get(p.id);return a&&Array.isArray(a.rig_friendly)?a.rig_friendly.map(v=>v==='RV'?'rv':v):[];};
const expectedAfter=p=>{const o=own(p),s=new Set(ownList(p));for(const [c,k] of Object.entries(TAG))if(o[k]==='yes')s.add(c);return s;};
const rows=[];let union=0;
const memberIds=p=>[...new Set([...(p.legacy_ids||[]),...(rowsById.get(p.id)||[]).flatMap(r=>r.p.source_ids||[]),...(p.legacy_ids||[]).flatMap(l=>(rowsById.get(l)||[]).flatMap(r=>r.p.source_ids||[]))])].filter(m=>m!==p.id);
for(const f of cat){
  const p=f.properties,before=new Set(p.rig_friendly),after=expectedAfter(p);
  const borrowed=[...before].filter(c=>!after.has(c));
  const o=own(p);
  const members=memberIds(p).filter(m=>elements.has(m));
  const memberVals={};for(const m of members){const e=elements.get(m),v={};for(const k of Object.values(TAG))if(e[k]!=null)v[k]=String(e[k]);if(Object.keys(v).length)memberVals[m]=v;}
  const contradiction=Object.entries(memberVals).some(([m,v])=>Object.values(TAG).some(k=>o[k]&&v[k]&&/^(yes|no)$/.test(o[k])&&/^(yes|no)$/.test(v[k])&&o[k]!==v[k]));
  // Row-level (snapshot) values for the host: normalize its own snapshot row alone.
  const hostRows=rowsById.get(p.id)||[];const rowLevel=new Set();for(const r of hostRows){const n=DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[0.1,0.1]},properties:{...r.p}});if(n)for(const c of n.properties.rig_friendly)rowLevel.add(c);}
  const ag=agencyRows.get(p.id);if(ag){const n=DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[0.1,0.1]},properties:{...ag}});if(n)for(const c of n.properties.rig_friendly)rowLevel.add(c);}
  const viaUnion=borrowed.filter(c=>!rowLevel.has(c)),viaSnapshot=borrowed.filter(c=>rowLevel.has(c));
  if(!borrowed.length&&!contradiction)continue;
  const b=browserBy.get(p.id);
  rows.push({id:p.id,name:p.name,before:[...before].sort(),after:[...after].sort(),borrowed,via_union:viaUnion,via_snapshot:viaSnapshot,own:o,members:memberVals,
    contradiction,ridb_sites:p.site_count!=null?{t:p.site_count,r:p.rv_sites}:null,browser_id:b?b.properties.id:null});
}
const count=(c,set)=>cat.filter(f=>set(f.properties).has(c)).length;
const changed=rows.filter(r=>r.borrowed.length);
const out={listings:cat.length,changed:changed.length,
  by_class:changed.reduce((t,r)=>(t[r.id.split(':')[0]]=(t[r.id.split(':')[0]]||0)+1,t),{}),
  borrowed_by_category:changed.reduce((t,r)=>{for(const c of r.borrowed)t[c]=(t[c]||0)+1;return t;},{}),
  via_union_listings:changed.filter(r=>r.via_union.length).length,via_snapshot_listings:changed.filter(r=>r.via_snapshot.length).length,
  tents_before:count('tent',p=>new Set(p.rig_friendly)),tents_after:count('tent',expectedAfter),
  trailers_before:count('trailer',p=>new Set(p.rig_friendly)),trailers_after:count('trailer',expectedAfter),
  rv_before:count('rv',p=>new Set(p.rig_friendly)),rv_after:count('rv',expectedAfter),
  contradictions:rows.filter(r=>r.contradiction).map(r=>r.id),
  ridb_trailer_zero_rv:changed.filter(r=>/^ridb:/.test(r.id)&&r.borrowed.includes('trailer')&&r.ridb_sites&&r.ridb_sites.t>0&&r.ridb_sites.r===0).map(r=>r.id),
  browser_divergent:changed.filter(r=>r.browser_id!==r.id).map(r=>[r.id,r.browser_id])};
console.log(JSON.stringify(out,null,1));
fs.writeFileSync(process.argv[3]||'/dev/null',JSON.stringify({summary:out,rows},null,1));
