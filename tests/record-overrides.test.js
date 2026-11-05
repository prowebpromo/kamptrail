const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const q=require('../data-quality'),builder=require('../scripts/build-record-overrides');
const point=(id,name,coordinates,extra={})=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{id,name,...extra}});
test('an operator-address correction survives a new retained source input without changing identity or fee evidence',()=>{
  const input=point('osm:node:1944017355','Up the Creek Campground',[-109.5468667,38.5678333],{osm_id:1944017355,osm_type:'node',tourism:'camp_site',state:null,fee:'yes'});
  const original=structuredClone(input);
  for(const source of [input,structuredClone(original)]){
    const f=q.normalizeFeature(source);assert.equal(f.properties.state,'UT');assert.equal(f.properties.id,original.properties.id);assert.equal(f.properties.fee_status,'paid');assert.equal(f.properties.cost,null);
    assert.equal(f.properties.record_override.source_field,'Physical Address');assert.equal(f.properties.record_override.state_applied,true);
    assert.equal(q.normalizeFeature(f).properties.state,'UT');
  }assert.deepEqual(input,original);
});
test('a correction cannot migrate to a moved or differently named record, or overwrite an explicit conflicting state',()=>{
  const f=point('osm:node:1944017355','Up the Creek Campground',[-109.5468667,38.5678333]);
  const moved=structuredClone(f);moved.geometry.coordinates[0]+=.01;assert.equal(q.normalizeFeature(moved).properties.state,null);
  const renamed=structuredClone(f);renamed.properties.name='Different Campground';assert.equal(q.normalizeFeature(renamed).properties.state,null);
  f.properties.state='CO';assert.equal(q.normalizeFeature(f).properties.state,'CO');assert.equal(q.normalizeFeature(f).properties.record_override.state_applied,false);
});
test('the exact BLM area notice does not withdraw or reclassify the record before independent review',()=>{
  const f=q.normalizeFeature(point('blm-area:16330','Moab Field Office (BLM)',[-109.549686,38.560942],{type:'dispersed',state:'UT'}));
  assert.equal(f.properties.id,'blm-area:16330');assert.equal(f.properties.type,'dispersed');assert.equal(f.properties.record_override.scope,'management_area');assert.match(f.properties.record_override.review_status,/independent_review/);
});
test('override validation rejects fee, access and identity mutations; generated browser and Node data agree',()=>{
  const data=JSON.parse(fs.readFileSync('data/record-overrides.json'));for(const key of ['fee','access','id','type','discovery']){const d=structuredClone(data);d.records['blm-area:16330'][key]='changed';assert.throws(()=>builder.validate(d),/Unsafe/);}
  const c={};vm.runInNewContext(builder.render(data),c);assert.deepEqual(JSON.parse(JSON.stringify(c.KampTrailRecordOverrides)),data);
  assert.equal(fs.readFileSync('record-overrides.js','utf8'),builder.render(data));
});
