'use strict';
// Per-record analysis for groups A, B, C with trace of L230 promotions and browser identity.
const H=require('./harness'),V=require('./variants'),fs=require('fs'),path=require('path');
const root=process.argv[2]||require('path').resolve(__dirname,'../..'),I=H.inputs(root),file=path.join(root,'data-quality.js');
const own=new Map(),ownState=new Map();
for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of H.read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties;if(p.osm_id!=null&&p.osm_type){own.set(`osm:${p.osm_type}:${p.osm_id}`,p);}}
for(const n of fs.readdirSync(I.dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)))for(const f of H.read(path.join(I.dir,n)).features){const p=f.properties;if(p.facility_id!=null&&!own.has('ridb:'+p.facility_id))own.set('ridb:'+p.facility_id,p);}
for(const {geojson} of I.collections)for(const f of geojson.features){const p=f.properties;if(/^(usfs|blm)/.test(String(p.id))&&!own.has(p.id))own.set(p.id,p);}
// Snapshot rows by id (all states).
const rows=new Map();for(const {state,geojson} of I.collections)for(const f of geojson.features){const id=f.properties.id;if(!rows.has(id))rows.set(id,[]);rows.get(id).push({state,p:f.properties});}
const promo=new Map();
const tracePatch=s=>{const a="if (p.camping_classification === 'unverified_camping_record' && q.camping_classification === 'campsite') {";if(!s.includes(a))throw 0;return s.replace(a,a+"__trace({p:p.id,q:q.id,q_ev:q.camping_evidence,q_type:q.type,p_type:p.type});");};
const mk=(v,trace)=>H.loadDQ(file,{patch:s=>trace?V[v](tracePatch(s)):V[v](s),trace});
const tr=key=>r=>{if(!promo.has(key))promo.set(key,new Map());const m=promo.get(key);if(!m.has(r.p))m.set(r.p,[]);m.get(r.p).push(r);};
const cats={};
for(const v of ['base','A','C','AC'])cats[v]=new Map(H.catalogue(mk(v,tr(v)),I).features.map(f=>[f.properties.id,f]));
const DQ=mk('base');
const resolver=feats=>{const m=new Map();for(const f of feats){const p=f.properties;if(!m.has(p.id))m.set(p.id,p.id);}for(const f of feats)for(const a of f.properties.legacy_ids||[])if(!m.has(a))m.set(a,f.properties.id);return m;};
const R={};for(const v in cats)R[v]=resolver([...cats[v].values()]);
// Browser runtime: all states loaded alphabetically (data-loader.js L182, no preferredIds/previousHosts).
const browserAll={base:H.catalogue(DQ,I,{browser:true}).features};
const BR=resolver(browserAll.base);
fs.writeFileSync('state.json',JSON.stringify({}));
const base=cats.base;
const snapInh=require('./inherited-tourism-rows.json'),typeRows=require('./type-diff-rows.json');
const inhById=new Map(snapInh.map(r=>[r.id,r]));
// Group A: published listings whose index record carries inherited tourism on its canonical record or any merged member host.
const groupA=new Set(),groupB=new Set(),groupC=new Set();
for(const [id,f] of base){const p=f.properties;
  const ids=[p.id,...(p.legacy_ids||[])];
  if(ids.some(x=>inhById.has(x)))groupA.add(id);
}
// Restrict A to records whose listing outcome changes under the guard (type, publication, identity) and record the rest as no-effect.
const aAffected=new Set();
for(const id of groupA){const a=cats.A.get(id),b=base.get(id);if(!a||a.properties.type!==b.properties.type||JSON.stringify(a.properties.legacy_ids)!==JSON.stringify(b.properties.legacy_ids))aAffected.add(id);}
for(const [id] of base)if(!cats.A.has(id))aAffected.add(id);
for(const [id,f] of base){const ids=[id,...(f.properties.legacy_ids||[])];if(ids.some(x=>typeRows.some(r=>r.id===x&&r.donor)))groupB.add(id);}
for(const [id] of base){if(promo.get('base')?.has(id))groupC.add(id);}
// Also records whose publication depends on promotion only once borrowed tourism is removed.
const cDepAfterA=new Set([...base.keys()].filter(id=>cats.A.has(id)&&!cats.AC.has(id)));
console.log('A: published listings carrying inherited tourism',groupA.size,'with listing outcome change',aAffected.size);
console.log('B',[...groupB]);
console.log('C promoted in base',groupC.size,'of which unpublished without promotion',[...groupC].filter(id=>!cats.C.has(id)).length);
console.log('cDepAfterA',cDepAfterA.size,[...cDepAfterA].filter(id=>!groupC.has(id)).length);
const publishedDelta=v=>[...base.keys()].filter(id=>!cats[v].has(id));
const out={groupA:[...groupA],aAffected:[...aAffected],groupB:[...groupB],groupC:[...groupC],cDepAfterA:[...cDepAfterA],promo_base:Object.fromEntries(promo.get('base')||[]),promo_A:Object.fromEntries(promo.get('A')||[]),
  removed:{A:publishedDelta('A'),C:publishedDelta('C'),AC:publishedDelta('AC')},added:{A:[...cats.A.keys()].filter(id=>!base.has(id)),AC:[...cats.AC.keys()].filter(id=>!base.has(id))}};
// Browser identity scope across the whole catalogue.
let differ=0,unresolved=0;const diffList=[];
for(const [id,f] of base){const ids=[id,...(f.properties.legacy_ids||[])];const b=BR.get(id);if(b===undefined){unresolved++;diffList.push({id,browser:null});}else if(b!==id){differ++;diffList.push({id,browser:b});}}
let aliasUnres=0;for(const [id,f] of base)for(const a of f.properties.legacy_ids||[])if(!BR.has(a))aliasUnres++;
out.browser_scope={listings:base.size,browser_canonical_differs:differ,index_id_unresolvable_in_browser:unresolved,aliases_unresolvable:aliasUnres,browser_listing_count:browserAll.base.length};
console.log('browser scope (all states alphabetical)',out.browser_scope);
fs.writeFileSync('analysis.json',JSON.stringify(out,null,1));fs.writeFileSync('browser-diff.json',JSON.stringify(diffList));
// Dump per-record detail for all affected ids.
const all=new Set([...aAffected,...groupB,...groupC,...cDepAfterA,...out.added.A]);
const det={};
for(const id of all){const b=base.get(id),pp=b?.properties;
  const snap=[...new Set([id,...(pp?.legacy_ids||[])])].flatMap(x=>(rows.get(x)||[]).map(r=>({state:r.state,id:x,source_ids:r.p.source_ids,tourism:r.p.tourism??null,type:r.p.type??null,access_hold:r.p.access_hold||null})));
  det[id]={name:pp?.name,base:pp&&{type:pp.type,cls:pp.camping_classification,ev:pp.camping_evidence,legacy:pp.legacy_ids,access:pp.access_status,fee:pp.fee_status,ll:b.geometry.coordinates},
    A:cats.A.get(id)?.properties&&{type:cats.A.get(id).properties.type,ev:cats.A.get(id).properties.camping_evidence,legacy:cats.A.get(id).properties.legacy_ids},A_resolves_to:R.A.get(id)||null,
    C:cats.C.get(id)?{type:cats.C.get(id).properties.type}:null,AC:cats.AC.get(id)?{type:cats.AC.get(id).properties.type,ev:cats.AC.get(id).properties.camping_evidence}:null,AC_resolves_to:R.AC.get(id)||null,
    browser_id:BR.get(id)||null,promo:promo.get('base')?.get(id)||null,promoA:promo.get('A')?.get(id)||null,snap};
}
fs.writeFileSync('detail.json',JSON.stringify(det,null,1));
