'use strict';
const H=require('./harness'),fs=require('fs'),path=require('path');
const root=process.argv[2]||require('path').resolve(__dirname,'../..');
const I=H.inputs(root);
// Own source rows.
const own=new Map();
for(const n of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const f of H.read(path.join(root,'data/opencampingmap',n)).features){const p=f.properties;if(p.osm_id!=null&&p.osm_type)own.set(`osm:${p.osm_type}:${p.osm_id}`,p);}
for(const n of fs.readdirSync(I.dir).filter(n=>/^[A-Z]{2}(?:\(1\))?\.geojson$/.test(n)))for(const f of H.read(path.join(I.dir,n)).features){const p=f.properties;if(p.facility_id!=null&&!own.has('ridb:'+p.facility_id))own.set('ridb:'+p.facility_id,p);}
// Snapshot rows with inherited tourism / type.
const inh=[],typeB=[];
for(const {state,geojson} of I.collections)for(const f of geojson.features){const p=f.properties;if(!(p.source_ids||[]).length||p.source_ids.length<2)continue;
  const o=own.get(p.id);const members=p.source_ids.filter(m=>m!==p.id);
  if(p.tourism!=null&&(!o||String(o.tourism??'')!==String(p.tourism))){const donor=members.find(m=>own.get(m)&&String(own.get(m).tourism)===String(p.tourism));inh.push({state,id:p.id,tourism:p.tourism,own_tourism:o?.tourism??null,donor:donor||null,has_own:!!o});}
  if(o&&String(o.type??'')!==String(p.type??'')){const donor=members.find(m=>own.get(m)&&String(own.get(m).type)===String(p.type));typeB.push({state,id:p.id,own_type:o.type??null,merged_type:p.type??null,donor:donor||null});}
}
console.log('snapshot rows with inherited tourism',inh.length,'by host',inh.reduce((a,r)=>(a[r.id.split(':')[0]]=(a[r.id.split(':')[0]]||0)+1,a),{}),'no own row',inh.filter(r=>!r.has_own).length,'no donor',inh.filter(r=>!r.donor).length);
console.log('snapshot rows with type differing from own row',typeB.length,JSON.stringify(typeB.slice(0,10)));
fs.writeFileSync('inherited-tourism-rows.json',JSON.stringify(inh,null,1));fs.writeFileSync('type-diff-rows.json',JSON.stringify(typeB,null,1));
