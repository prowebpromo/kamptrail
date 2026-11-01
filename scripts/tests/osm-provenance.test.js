'use strict';
const {test, mock}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {CampsiteMerger}=require('../merge_campsite_data');
const DQ=require('../../data-quality');
const fixtures=require('./fixtures/osm-provenance.json').fixtures;
const dir=path.resolve(__dirname,'../../data/opencampingmap'),raw=new Map();
for(const file of fs.readdirSync(dir).filter(f=>/^[A-Z]{2}\.geojson$/.test(f)))for(const f of JSON.parse(fs.readFileSync(path.join(dir,file))).features)if(!raw.has(f.properties.id))raw.set(f.properties.id,f);
const make=(input,synthetic)=>{
 if(!synthetic){assert.ok(raw.has(input.id),input.id);return structuredClone(raw.get(input.id));}
 return {type:'Feature',geometry:{type:'Point',coordinates:[-40,30]},properties:{id:input.id,name:'Synthetic Test Campground',schema_version:3,source:input.id.startsWith('osm:')?'openstreetmap':'recreation.gov',source_retrieved_at:'2026-10-30T00:00:00Z',...(input.id.startsWith('osm:')?{osm_type:input.id.split(':')[1],osm_id:Number(input.id.split(':')[2]),tourism:'camp_site'}:{}),...input.tags}};
};
for(const f of fixtures.filter(f=>f.kind!=='synthetic_index_layer'))test('Claude provenance '+f.fixture_id,()=>{
 const m=new CampsiteMerger();
 const inputs=f.inputs.map(i=>make(i,f.synthetic));
 let kept=inputs[0]; kept.properties=m.sanitizeProperties(kept.properties);kept.properties.id=m.stableId(kept);
 for(const next of inputs.slice(1)){next.properties=m.sanitizeProperties(next.properties);next.properties.id=m.stableId(next);kept.properties=m.mergeProperties(kept.properties,next.properties);}
 const p=kept.properties, keys=['fee','charge','fee:conditional','charge:conditional','access','osm_id','osm_type'];
 assert.deepEqual(Object.fromEntries(keys.filter(k=>p[k]!=null).map(k=>[k,p[k]])),f.expected.snapshot_fields);
 assert.deepEqual(p.access_hold||null,f.expected.access_hold);
 // 2.31.0 also retains amenity tags, and 2.34.0 rig-suitability tags, on their member element. These fixtures pin the fee and access part.
 const feeAccess=k=>/(^|:)(fee|charge)(:|$)/.test(k)||/^access(:|$)/.test(k),pick=o=>Object.fromEntries(Object.entries(o).filter(([k])=>feeAccess(k)));
 // A member's retrieval date belongs to its own source element and moves with each refresh of that element.
 // Pin ownership (the date equals the donor element's own retrieval date), not a calendar date.
 const own=id=>(inputs.find(i=>i.properties.id===id)||{}).properties?.source_retrieved_at;
 const evidence=(p.member_evidence||[]).map(e=>({source_record_id:e.source_record_id,fields:pick(e.fields),retrieved_at:e.retrieved_at})).filter(e=>Object.keys(e.fields).length);
 for(const e of evidence){assert.ok(e.retrieved_at,e.source_record_id+' retrieval date');if(!f.synthetic)assert.equal(e.retrieved_at,own(e.source_record_id),e.source_record_id+' retrieval date is its own element\'s');}
 const withoutDate=list=>list.map(({retrieved_at,...rest})=>rest);
 assert.deepEqual(withoutDate(evidence),withoutDate(f.expected.member_evidence));
 for(const e of p.member_evidence||[])for(const [k,v] of Object.entries(e.fields))if(!feeAccess(k)){assert.ok(k==='tourism'||DQ.OSM_AMENITY_TAG.test(k)||DQ.OSM_RIG_TAG.test(k),k);const donor=inputs.find(i=>i.properties.id===e.source_record_id);assert.equal(String(donor.properties[k]),String(v),e.source_record_id+' '+k);}
 const n=DQ.normalizeFeature(kept);
 if(f.expected.normalized.rejected)assert.equal(n,null);
 else{assert.ok(n);for(const k of ['fee_status','cost','access_status'])assert.equal(n.properties[k],f.expected.normalized[k],k);}
});
test('S17: unverified OSM index member cannot classify the kept record',()=>{
 const f=fixtures.find(f=>f.fixture_id==='S17');
 const result=DQ.cleanAndDedupeGeoJSON({features:f.inputs.map(i=>make(i,true))});
 assert.equal(result.features.length,1);const p=result.features[0].properties;
 assert.equal(p.id,f.inputs[0].id);assert.equal(p.fee_status,'unknown');assert.equal(p.access_status,'unknown');
 assert.ok(p.fee_evidence_records.some(r=>r.source_record_id===f.inputs[1].id));
});
test('borrowed restrictive access holds never advertise a previously excluded record',()=>{
 const m=new CampsiteMerger();
 const p={id:'ridb:5',facility_id:5,schema_version:3,name:'Held Campground',tourism:'camp_site'};
 const q={id:'osm:way:9',osm_id:9,osm_type:'way',access:'no'};
 const merged=m.mergeProperties(p,q);
 assert.equal(merged.access,undefined);assert.equal(merged.osm_id,undefined);
 assert.deepEqual(merged.access_hold,{value:'no',source_record_id:q.id});
 assert.equal(DQ.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates:[-73,42]},properties:merged}),null);
 assert.deepEqual(m.mergeProperties(merged,q).member_evidence,merged.member_evidence);
});
test('an earlier permissive donor does not become a new private-access hold',()=>{
 const m=new CampsiteMerger(),p={id:'osm:node:1'},a={id:'osm:node:2',access:'yes'},b={id:'osm:node:3',access:'private'};
 const r=m.mergeProperties(m.mergeProperties(p,a),b);
 assert.equal(r.access_hold,undefined);assert.equal(r.access,undefined);
});
test('own OSM evidence keeps retrieval dates through normalization and repeated merging',()=>{
 const f=make({id:'osm:node:4',tags:{osm_id:4,osm_type:'node',tourism:'camp_site',fee:'yes'}},true);
 const p=DQ.normalizeFeature(f).properties;
 assert.equal(p.fee_evidence_records[0].retrieved_at,'2026-10-30T00:00:00Z');
 assert.equal(p.fee_source_record_id,'osm:node:4');
 const agency=make({id:'usfs:5',tags:{camping_activity:'Campground Camping',fee_status:'paid',cost:20,fee_source:'US Forest Service'}},true);
 const r=DQ.cleanAndDedupeGeoJSON({features:[make({id:'osm:node:8',tags:{osm_id:8,osm_type:'node',tourism:'camp_site'}},true),agency]}).features[0].properties;
 assert.equal(r.fee_source_record_id,'usfs:5');assert.equal(r.fee_source,'US Forest Service');
});
