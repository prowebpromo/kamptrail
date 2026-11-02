'use strict';
// Reconciles this candidate's group counts with the 2.32.0 provenance audit (scripts/audit/provenance-debt-audit.js
// on fix/rig-tag-ownership) on the same baseline, by definition and layer. Read-only.
//   node scripts/tourism-type-admission/reconcile-counts.js <baseline checkout> <out.json>
const H=require('./harness'),fs=require('fs'),path=require('path');
const root=path.resolve(process.argv[2]),out=process.argv[3];
const I=H.inputs(root),DQ=H.loadDQ(path.join(root,'data-quality.js'));
const own=new Map(),read=H.read;
for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties;if(p.osm_id!=null&&p.osm_type)own.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
for(const n of fs.readdirSync(I.dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)))for(const f of read(path.join(I.dir,n)).features){const p=f.properties;if(p.facility_id!=null&&!own.has('ridb:'+p.facility_id))own.set('ridb:'+p.facility_id,p);}
for(const {geojson} of I.collections)for(const f of geojson.features)if(!own.has(f.properties.id)&&!/^(ridb|osm):/.test(f.properties.id))own.set(f.properties.id,f.properties);
// The 2.32.0 audit builds its catalogue without the site-details option, exactly like the committed index.
const cat=H.catalogue(DQ,I).features;
// Definition 1 (2.32.0): published canonical record carries tourism different from its own source row.
const d1=cat.filter(f=>{const p=f.properties,v=p.tourism;if(v==null||v==='')return false;const o=own.get(p.id);return !(o&&String(o.tourism??'')===String(v));}).map(f=>f.properties.id);
// Definition 2 (this candidate rev 1): any id of the listing (canonical or alias) has a snapshot row whose tourism is not its own.
const inh=new Set();for(const {geojson} of I.collections)for(const f of geojson.features){const p=f.properties;if((p.source_ids||[]).length<2||p.tourism==null)continue;const o=own.get(p.id);if(!o||String(o.tourism??'')!==String(p.tourism))inh.add(p.id);}
const d2=cat.filter(f=>[f.properties.id,...(f.properties.legacy_ids||[])].some(x=>inh.has(x))).map(f=>f.properties.id);
const s1=new Set(d1),s2=new Set(d2);
const onlyD2=d2.filter(x=>!s1.has(x)),onlyD1=d1.filter(x=>!s2.has(x));
const byId=new Map(cat.map(f=>[f.properties.id,f]));
const whyD2=r=>{const p=byId.get(r).properties;return p.tourism==null?'canonical record has no tourism (inherited row is an alias or was not the surviving copy)':'canonical carries own value';};
const t={};for(const x of onlyD2){const k=whyD2(x);t[k]=(t[k]||0)+1;}
// Borrowed type. Layer S: the snapshot row's type differs from its own source row's type and equals a member's (merge_campsite_data.js).
// Layer I: the published type differs from the type the host's own record normalizes to alone (2.32.0 definition), all layers combined.
const snapLent=new Set();for(const {geojson} of I.collections)for(const f of geojson.features){const p=f.properties,o=own.get(p.id);if(!o||(p.source_ids||[]).length<2)continue;if(p.type!=null&&String(o.type??'')!==String(p.type)&&p.source_ids.some(m=>m!==p.id&&own.get(m)&&String(own.get(m).type)===String(p.type)))snapLent.add(p.id);}
const layerI=[];for(const f of cat){const p=f.properties,o=own.get(p.id);if(!o)continue;const n=DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[1,1]},properties:{...o,name:o.name||p.name}});if(n&&n.properties.type!==p.type)layerI.push({id:p.id,own:n.properties.type,published:p.type});}
// Attribute each layer-I row to its cause.
const cause=r=>{const p=byId.get(r.id).properties;const ids=[p.id,...(p.legacy_ids||[])];
  if(ids.some(x=>snapLent.has(x)))return 'S: snapshot merge lent a member type (merge_campsite_data.js L223-224)';
  if(ids.some(x=>inh.has(x))&&r.own==='other'&&r.published==='established')return 'A: inherited tourism makes data-quality.js L151 default to established';
  if(p.camping_evidence==='agency_camping_activity'||ids.some(x=>/^(usfs|blm)/.test(x)))return 'I: index merge data-quality.js L230 copied the promoter type';
  return 'other';};
const causes={};const rowsI=layerI.map(r=>({...r,cause:cause(r)}));for(const r of rowsI){causes[r.cause]=(causes[r.cause]||0)+1;}
const kinds={};for(const r of layerI){const k=r.own+'->'+r.published;kinds[k]=(kinds[k]||0)+1;}
const res={baseline:root,listings:cat.length,
 tourism:{def_2_32_0:{count:d1.length,definition:'published canonical record carries a tourism value that differs from its own source row'},
   def_candidate_rev1:{count:d2.length,definition:'any id of the listing (canonical or alias) has a snapshot row with tourism it does not own'},
   both:d1.filter(x=>s2.has(x)).length,only_candidate:onlyD2.length,only_2_32_0:onlyD1.length,only_candidate_reasons:t,only_candidate_examples:onlyD2.slice(0,6),only_2_32_0_examples:onlyD1.slice(0,6)},
 borrowed_type:{snapshot_layer:{count:[...snapLent].length,ids:[...snapLent]},combined_layer_2_32_0:{count:layerI.length,kinds,by_cause:causes,examples:Object.fromEntries(Object.keys(causes).map(c=>[c,rowsI.filter(r=>r.cause===c).slice(0,4).map(r=>r.id)]))},rows:rowsI}};
fs.writeFileSync(out,JSON.stringify(res,null,1));console.log(JSON.stringify({...res,borrowed_type:{...res.borrowed_type,rows:undefined}},null,1));
