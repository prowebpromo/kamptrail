'use strict';
const H=require('./harness'),V=require('./variants'),fs=require('fs'),path=require('path');
const root=require('path').resolve(__dirname,'../..'),I=H.inputs(root),file=path.join(root,'data-quality.js');
const which=process.argv.slice(2);
const sum=f=>{const p=f.properties;return {id:p.id,legacy:[...(p.legacy_ids||[])].filter(x=>x!==p.id).sort(),type:p.type,cls:p.camping_classification,ev:p.camping_evidence,ll:f.geometry.coordinates,fee:p.fee_status,access:p.access_status,name:p.name};};
const base=new Map(H.catalogue(H.loadDQ(file),I).features.map(f=>[f.properties.id,sum(f)]));
const out={base_count:base.size};
for(const v of which){
  const cat=new Map(H.catalogue(H.loadDQ(file,{patch:V[v]}),I).features.map(f=>[f.properties.id,sum(f)]));
  const removed=[...base.keys()].filter(k=>!cat.has(k)),added=[...cat.keys()].filter(k=>!base.has(k));
  const typeShift=[],other=[];
  for(const [id,b] of base){const a=cat.get(id);if(!a)continue;if(a.type!==b.type)typeShift.push({id,from:b.type,to:a.type});
    const d=['legacy','cls','ev','ll','fee','access'].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));if(d.length)other.push({id,d,before:Object.fromEntries(d.map(k=>[k,b[k]])),after:Object.fromEntries(d.map(k=>[k,a[k]]))});}
  out[v]={count:cat.size,removed:removed.map(id=>base.get(id)),added:added.map(id=>cat.get(id)),typeShift,other};
  console.log(v,'count',cat.size,'removed',removed.length,'added',added.length,'typeShift',typeShift.length,JSON.stringify(typeShift.reduce((a,r)=>(a[r.from+'->'+r.to]=(a[r.from+'->'+r.to]||0)+1,a),{})),'other',other.length,JSON.stringify(other.reduce((a,r)=>{for(const k of r.d)a[k]=(a[k]||0)+1;return a},{})));
}
fs.writeFileSync('compare-'+which.join('-')+'.json',JSON.stringify(out,null,1));
