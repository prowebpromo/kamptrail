'use strict';
// Compare catalogue built by baseline data-quality.js vs worktree data-quality.js on given snapshot roots.
const H=require('./harness'),fs=require('fs'),path=require('path');
const [baseRoot,newRoot,outFile]=process.argv.slice(2);
const sum=f=>{const p=f.properties;return {id:p.id,legacy:[...(p.legacy_ids||[])].sort(),type:p.type,cls:p.camping_classification,ev:p.camping_evidence,ll:f.geometry.coordinates,fee:p.fee_status,cost:p.cost,access:p.access_status,name:p.name};};
const b=new Map(H.catalogue(H.loadDQ(path.join(baseRoot,'data-quality.js')),H.inputs(baseRoot)).features.map(f=>[f.properties.id,sum(f)]));
const n=new Map(H.catalogue(H.loadDQ(path.join(newRoot,'data-quality.js')),H.inputs(newRoot)).features.map(f=>[f.properties.id,sum(f)]));
const removed=[...b.keys()].filter(k=>!n.has(k)),added=[...n.keys()].filter(k=>!b.has(k)),changes=[];
for(const [id,x] of b){const y=n.get(id);if(!y)continue;const d=Object.keys(x).filter(k=>JSON.stringify(x[k])!==JSON.stringify(y[k]));if(d.length)changes.push({id,name:x.name,fields:d,before:Object.fromEntries(d.map(k=>[k,x[k]])),after:Object.fromEntries(d.map(k=>[k,y[k]]))});}
const tally=changes.reduce((a,c)=>{const k=c.fields.join(',')+(c.fields.includes('type')?' '+c.before.type+'->'+c.after.type:'');a[k]=(a[k]||0)+1;return a;},{});
console.log({before:b.size,after:n.size,removed:removed.length,added:added.length,tally});
fs.writeFileSync(outFile,JSON.stringify({removed,added,changes},null,1));
