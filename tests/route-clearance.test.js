'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const R=require('../route-clearance.js'),C=require('../clearances.js');
const ATTR=C.ATTRIBUTION;
// A synthetic dataset built through the same manifest and hash contract as the committed one.
function candidate(id,type,coords,over={}){
  const c={id:`osm:${type}:${id}`,osm_type:type,osm_id:String(id),osm_version:1,edited_at:'2026-10-01T00:00:00Z',state:'CO',geometry:type==='node'?{type:'Point',coordinates:coords}:{type:'LineString',coordinates:coords},
    tags:{maxheight:`13'6"`},context:{highway:'secondary'},restriction_on:type,structure:[],metres:{maxheight:4.1148},inches:{maxheight:162},parse:{maxheight:'numeric'},status:'numeric_only',comparable:true,min_inches:162,min_metres:4.1148,
    plausibility:'ok',reasons:[],applies_to:type==='way'?'way_itself':'unknown',applies_to_evidence:type==='way'?['tag_on_highway_way','highway=secondary']:['barrier_node_parent_way_not_recorded'],...over};
  if(!c.comparable){delete c.min_inches;delete c.min_metres;}return c;
}
function dataset(candidates,{corrupt=false,extraTile=null}={}){
  const files=new Map(),tiles=[];
  const add=(name,list,x)=>{const xs=list.flatMap(c=>c.geometry.type==='Point'?[c.geometry.coordinates]:c.geometry.coordinates);const bbox=[Math.min(...xs.map(p=>p[0])),Math.min(...xs.map(p=>p[1])),Math.max(...xs.map(p=>p[0])),Math.max(...xs.map(p=>p[1]))];
    const doc={version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates',license:'ODbL-1.0',attribution:ATTR,tile:{z:12,x,y:1,part:1,parts:1},bbox,candidates:list};
    const raw=Buffer.from(JSON.stringify(doc)),p=`tiles/12-${x}-1.json`;files.set('data/clearances/'+p,raw);tiles.push({path:p,z:12,x,y:1,part:1,parts:1,bbox,bytes:raw.length,records:list.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});};
  add('a',candidates,10);if(extraTile)add('b',extraTile,11);
  if(corrupt){const k='data/clearances/'+tiles[0].path,b=Buffer.from(files.get(k));b[b.length-3]^=1;files.set(k,b);}
  const manifest={version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates_manifest',license:'ODbL-1.0',copyright_url:'https://www.openstreetmap.org/copyright',attribution:ATTR,tiles,states_protected:{RI:{status:'protected'}},sources:{CO:{extract_timestamp:'2026-10-30T00:00:00Z',retrieved_at:'2026-10-31T00:00:00Z'}}};
  files.set('data/clearances/index.json',Buffer.from(JSON.stringify(manifest)));
  return {crypto:globalThis.crypto,KampTrailClearances:C,fetch:async u=>files.has(u)?new Response(files.get(u)):new Response('missing',{status:404})};
}
// Route along y=40 from x=-105 to x=-104.99, two segments, driving OSM ways 500 and 501.
const route=(osm)=>({geometry:{type:'LineString',coordinates:[[-105,40],[-104.995,40],[-104.99,40]]},leg_ends:[2],...(osm?{osm}:{})});
const onRoad=candidate(500,'way',[[-104.999,40],[-104.997,40]]);// same way id as segment 0
const parallel=candidate(900,'way',[[-104.999,40.0004],[-104.997,40.0004]]);// about 45 m north, a different road
const far=candidate(901,'way',[[-104.999,40.01],[-104.997,40.01]]);
const ft=(f,i=0)=>Math.round((f*12+i)*25.4);

test('without route way ids nothing is associated: nearby candidates are unresolved, never hazards on the route',async()=>{
  const r=await R.analyze(route(),{env:dataset([onRoad,parallel,far]),rigMm:ft(14)});
  assert.equal(r.association_method,'none');assert.equal(r.route_clear,false);
  assert.deepEqual(r.candidates.map(x=>[x.id,x.association]),[['osm:way:500','unresolved'],['osm:way:900','unresolved']]);
  assert.equal(r.summary.on_route,0);assert.equal(r.summary.on_route_conflicts,0,'proximity alone never creates a route conflict');
  assert.ok(r.candidates.every(x=>x.association_evidence.includes('route_has_no_way_ids')));
  assert.equal(r.candidates[0].comparison.conflict,true,'the candidate itself still shows its rig comparison');
});
test('exact way ids resolve the driven road; a parallel road stays off the route',async()=>{
  const r=await R.analyze(route({way_ids:['500','501']}),{env:dataset([onRoad,parallel]),rigMm:ft(14)});
  const by=Object.fromEntries(r.candidates.map(x=>[x.id,x]));
  assert.equal(r.association_method,'exact_osm_identity');
  assert.equal(by['osm:way:500'].association,'on_route');assert.equal(by['osm:way:500'].route_conflict,true);assert.deepEqual(by['osm:way:500'].association_evidence,['route_way_id_equals_candidate_way','applies_to=way_itself']);
  assert.equal(by['osm:way:900'].association,'not_on_route');assert.equal(by['osm:way:900'].route_conflict,false);
  assert.equal(r.summary.on_route_conflicts,1);
});
test('below, equal and above along the driven road; equal is a conflict',async()=>{
  for(const [rig,relation,conflict] of [[ft(13,8),'below',true],[ft(13,6),'equal',true],[ft(13,4),'above',false]]){
    const x=(await R.analyze(route({way_ids:['500','501']}),{env:dataset([onRoad]),rigMm:rig})).candidates[0];
    assert.equal(x.comparison.relation,relation);assert.equal(x.route_conflict,conflict);
  }
});
test('incomplete way ids near a candidate leave it unresolved; road_below counts and applies_to unknown does not',async()=>{
  assert.equal((await R.analyze(route({way_ids:[null,'501']}),{env:dataset([parallel])})).candidates[0].association,'unresolved');
  const tunnel=candidate(500,'way',[[-104.999,40],[-104.997,40]],{applies_to:'road_below',applies_to_evidence:['way_is_tunnel']});
  assert.equal((await R.analyze(route({way_ids:['500','501']}),{env:dataset([tunnel])})).candidates[0].association,'on_route');
  const unknown=candidate(500,'way',[[-104.999,40],[-104.997,40]],{applies_to:'unknown',applies_to_evidence:['no_highway_way_evidence']});
  const u=(await R.analyze(route({way_ids:['500','501']}),{env:dataset([unknown]),rigMm:ft(14)})).candidates[0];assert.equal(u.association,'unresolved');assert.equal(u.route_conflict,false);
});
test('barrier nodes need exact node ids; directional and conditional values stay unresolved on the driven road',async()=>{
  const gate=candidate(77,'node',[-104.995,40]);
  assert.equal((await R.analyze(route({way_ids:['500','501']}),{env:dataset([gate])})).candidates[0].association,'unresolved');
  assert.equal((await R.analyze(route({node_ids:['1','77','2']}),{env:dataset([gate]),rigMm:ft(14)})).candidates[0].route_conflict,true);
  const dir=candidate(500,'way',[[-104.999,40],[-104.997,40]],{status:'directional_only',comparable:false,tags:{'maxheight:forward':`11'0"`},inches:{'maxheight:forward':132},metres:{'maxheight:forward':3.35},parse:{'maxheight:forward':'numeric'}});
  const d=(await R.analyze(route({way_ids:['500','501']}),{env:dataset([dir]),rigMm:ft(12)})).candidates[0];
  assert.equal(d.association,'on_route');assert.equal(d.direction,'unresolved');assert.equal(d.comparison.compared,false);assert.equal(d.route_conflict,false);
  const cond=candidate(500,'way',[[-104.999,40],[-104.997,40]],{status:'conditional',comparable:false,tags:{maxheight:'3','maxheight:conditional':'3 @ (wet)'},inches:{maxheight:118.11,'maxheight:conditional':null},metres:{maxheight:3,'maxheight:conditional':null}});
  const s=(await R.analyze(route({way_ids:['500','501']}),{env:dataset([cond]),rigMm:ft(12)}));assert.equal(s.candidates[0].comparison.compared,false);assert.equal(s.summary.on_route_unresolved_value,1);
});
test('missing data stays visible: failed integrity, protected RI and empty results are never clear',async()=>{
  const bad=await R.analyze(route(),{env:dataset([onRoad],{corrupt:true})});
  assert.equal(bad.tiles.failed,1);assert.deepEqual(bad.missing.map(m=>[m.from,m.to,m.reason]),[[0,1,'tile_failed_integrity']]);assert.equal(bad.candidates.length,0);assert.equal(bad.route_clear,false);
  const ri={geometry:{type:'LineString',coordinates:[[-71.45,41.81],[-71.44,41.81]]}};
  const r=await R.analyze(ri,{env:dataset([onRoad])});assert.equal(r.missing[0].reason,'region_not_in_dataset:RI');assert.equal(r.summary.missing_segments,1);
  const empty=await R.analyze({geometry:{type:'LineString',coordinates:[[-100,35],[-99.99,35]]}},{env:dataset([onRoad])});
  assert.equal(empty.candidates.length,0);assert.equal(empty.missing.length,0);assert.equal(empty.route_clear,false);
});
test('invalid route identity is rejected rather than guessed',async()=>{
  for(const osm of [{way_ids:['500']},{way_ids:['500','x']},{node_ids:['1','2']},{way_ids:[500,501]},[]])await assert.rejects(R.analyze(route(osm),{env:dataset([onRoad])}),/Invalid route/,JSON.stringify(osm));
  await assert.rejects(R.analyze({geometry:{type:'LineString',coordinates:[[0,0]]}},{env:dataset([onRoad])}),/Invalid route/);
});
test('distance helper still measures points and crossings',()=>{const r=[[-71,41],[-70.99,41]],budget={left:1000};assert.ok(R.distance(r,[[-70.995,41]],budget)<1);assert.equal(R.distance(r,[[-70.995,40.999],[-70.995,41.001]],budget),0);assert.ok(R.distance(r,[[-70.995,41.01]],budget)>100);});
