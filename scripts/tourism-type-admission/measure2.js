'use strict';
const H=require('./harness'),E=require('./evidence'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..'),I=H.inputs(root),DQ=require(path.join(root,'data-quality.js')),L=E.load(root);
const idx=new Map(I.idx.map(s=>[s.id,s]));
// 1. Snapshot rows whose description is not their own record's description.
let descBorrow=0;const descDecisive=[];
for(const {state,geojson} of I.collections)for(const f of geojson.features){const p=f.properties;if(!/^ridb:/.test(p.id)||(p.source_ids||[]).length<2)continue;const own=L.ridbRows.get(String(p.facility_id));if(!own)continue;
  if(String(own.p.description||'')!==String(p.description||'')){descBorrow++;
   const a=DQ.classifyCampingRecord(p,p.name,{ridb:true}),b=DQ.classifyCampingRecord({...p,description:own.p.description},p.name,{ridb:true});
   if(a.camping_classification!==b.camping_classification||a.exclusion_reason!==b.exclusion_reason)descDecisive.push({state,id:p.id,with_borrowed:a.camping_evidence+'/'+a.exclusion_reason,own:b.camping_evidence+'/'+b.exclusion_reason,from:p.source_ids.filter(x=>x!==p.id),published:idx.has(p.id)||[...idx.values()].some(s=>s.legacy_ids.includes(p.id))});}}
console.log('ridb rows with non-own description',descBorrow,'classification decided by it',descDecisive.length,JSON.stringify(descDecisive,null,0));
// 2. Unpublished ridb records with own structured type (would newly publish if structured type admitted).
const published=new Set();for(const s of I.idx){published.add(s.id);s.legacy_ids.forEach(x=>published.add(x));}
const t={};const ex=[];for(const [fid,r] of L.ridbRows){const id='ridb:'+fid;if(published.has(id))continue;const c=DQ.classifyCampingRecord(r.p,r.p.name,{ridb:true});const k=r.p.type+'|'+(c.exclusion_reason||c.camping_evidence)+'|ovn:'+((L.sitesDoc.facilities[fid]?.t||0)>0);t[k]=(t[k]||0)+1;if(r.p.type==='established'&&!c.exclusion_reason&&ex.length<15)ex.push(id+' '+r.p.name);}
console.log('unpublished ridb rows',t,ex);
// 3. Same-facility-id pairs: distance and name.
const dist=(a,b)=>{const R=6371e3,r=x=>x*Math.PI/180,dl=r(b[1]-a[1]),dn=r(b[0]-a[0]);const h=Math.sin(dl/2)**2+Math.cos(r(a[1]))*Math.cos(r(b[1]))*Math.sin(dn/2)**2;return Math.round(2*R*Math.asin(Math.sqrt(h)));};
for(const fid of ['262781','261802','261804','251352','273310','251834','251835','251842','251843','251837','251838','250985','250031','252280']){const r=L.ridbRows.get(fid),b=L.blm.get(fid);console.log('ridb:'+fid,r.p.name,'|',b.p.name,'|',dist(r.ll,b.ll),'m |',b.p.source_url,'| reservable',b.p.reservable);}
