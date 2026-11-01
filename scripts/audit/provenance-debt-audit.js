'use strict';
// Provenance debt and owner-decision measurements on a checkout (inherited operator/website/tourism, type borrowing, L230 promotion).
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(process.argv[2]);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
function load(src,file){const c={module:{exports:{}},URL,Date,Set,Map,WeakSet,JSON,Math,Number,String,Object,Array,console};c.globalThis=c;vm.runInNewContext(src,c,{filename:file});return c.module.exports;}
const file=path.join(root,'data-quality.js'),src=fs.readFileSync(file,'utf8');
const DQ=load(src,file);
const promo="if (p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {p.camping_classification=q.camping_classification;p.camping_evidence=q.camping_evidence;if(p.type==='other')p.type=q.type;}";
if(!src.includes(promo))throw new Error('promotion line not found');
const NOPROMO=load(src.replace(promo,''),file);
const dir=path.join(root,'data/campsites');
const states=fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
const own=new Map();
for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties||{};if(p.osm_id!=null&&p.osm_type)own.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
for(const n of fs.readdirSync(dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)))for(const f of read(path.join(dir,n)).features){const p=f.properties||{};if(p.facility_id!=null&&!own.has('ridb:'+p.facility_id))own.set('ridb:'+p.facility_id,p);}
const details=read(path.join(dir,'ridb-sites.json')).facilities,idx=read(path.join(dir,'search-index.json')).sites;
const preferredIds=new Set(idx.map(s=>s.id)),previousHosts=new Map();for(const s of idx)for(const a of s.legacy_ids||[])previousHosts.set(a,s.id);
function cat(Q){const input=[];for(const state of states){const features=read(path.join(dir,`${state}_merged.geojson`)).features,agency=path.join(dir,'agency',`${state}.geojson`);
  if(fs.existsSync(agency))for(const f of read(agency).features){features.push(f);if(!own.has(f.properties.id))own.set(f.properties.id,f.properties);}
  for(const raw of Q.publicationCandidates(features,{state})){const f=Q.normalizeFeature(raw,{state});if(f){Q.attachSiteDetails(f,details);input.push(f);}}}
 return Q.cleanAndDedupeGeoJSON({type:'FeatureCollection',features:input},{preferredIds,previousHosts}).features;}
const A=cat(DQ),B=cat(NOPROMO);const bIds=new Set(B.map(f=>f.properties.id));
const promoted=A.filter(f=>!bIds.has(f.properties.id)).map(f=>f.properties.id);
const out={listings:A.length,promoted_only_by_L230:promoted.length,promoted};
for(const key of ['operator','website','tourism']){
  const rows=[];
  for(const f of A){const p=f.properties,v=p[key];if(v==null||v==='')continue;const o=own.get(p.id);
    if(o&&String(o[key]??'')===String(v))continue;
    rows.push({id:p.id,value:String(v).slice(0,120),own:o?(o[key]??null):'no own source row'});}
  out['inherited_'+key]=rows.length;out['inherited_'+key+'_rows']=rows;
}
// type borrowed from another record (p.type differs from what the host's own record alone normalizes to)
let typeBorrowed=[];
for(const f of A){const p=f.properties,o=own.get(p.id);if(!o)continue;const n=DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[1,1]},properties:{...o,name:o.name||p.name}});if(n&&n.properties.type!==p.type)typeBorrowed.push({id:p.id,own:n.properties.type,published:p.type});}
out.type_differs_from_own=typeBorrowed.length;out.type_rows=typeBorrowed;
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).filter(([k,v])=>!Array.isArray(v))),null,1));
fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));
