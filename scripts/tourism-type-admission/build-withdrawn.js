#!/usr/bin/env node
'use strict';
// Writes data/campsites/withdrawn.json: listings that were published on the baseline and have no qualifying own
// camping evidence under this candidate. Each keeps a resolvable legacy entry (id, aliases, point, own source link).
// Deterministic: sorted by id, no dates other than the source dates already in the data.
//   node scripts/tourism-type-admission/build-withdrawn.js --baseline=/unchanged/checkout
const H=require('./harness'),fs=require('fs'),path=require('path');
const arg=n=>process.argv.slice(2).find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const root=path.resolve(__dirname,'../..'),baseRoot=path.resolve(arg('baseline')||'');
if(!arg('baseline')||baseRoot===root)throw new Error('Use --baseline=/unchanged/checkout');
const BI=H.inputs(baseRoot),NI=H.inputs(root);
const base=H.catalogue(H.loadDQ(path.join(baseRoot,'data-quality.js')),BI).features;
const cand=H.catalogue(H.loadDQ(path.join(root,'data-quality.js')),NI).features;
const live=new Set(cand.flatMap(f=>[f.properties.id,...(f.properties.legacy_ids||[])]));
const idx=new Map(BI.idx.map(s=>[s.id,s]));
const listings=base.filter(f=>!live.has(f.properties.id)).map(f=>{const p=f.properties,s=idx.get(p.id);
  const aliases=(s?.legacy_ids||[]).filter(a=>!live.has(a)).sort();
  return {id:p.id,legacy_ids:aliases,name:p.name,states:s?.states||[],coordinates:f.geometry.coordinates,source_url:p.source_url||null,
    reason:'no_own_camping_classification',
    explanation:'The listing did not meet the reviewed campsite-discovery admission criteria. Consult the facility record for camping details and current availability.',
    previous_classification:{camping_evidence:p.camping_evidence,type:p.type}};}).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
const out={version:1,note:'Withdrawn from campsite discovery by the tourism-type-admission candidate. Old links resolve to this entry.',listings};
fs.writeFileSync(path.join(NI.dir,'withdrawn.json'),JSON.stringify(out,null,1)+'\n');
console.log(JSON.stringify({withdrawn:listings.length,ids:listings.map(l=>l.id)}));
