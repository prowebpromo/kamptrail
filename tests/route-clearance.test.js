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
function dataset(candidates,{corrupt=false,extraTile=null,pilot=null}={}){
  const files=new Map(),tiles=[];
  const add=(name,list,x)=>{const xs=list.flatMap(c=>c.geometry.type==='Point'?[c.geometry.coordinates]:c.geometry.coordinates);const bbox=[Math.min(...xs.map(p=>p[0])),Math.min(...xs.map(p=>p[1])),Math.max(...xs.map(p=>p[0])),Math.max(...xs.map(p=>p[1]))];
    const doc={version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates',license:'ODbL-1.0',attribution:ATTR,tile:{z:12,x,y:1,part:1,parts:1},bbox,candidates:list};
    const raw=Buffer.from(JSON.stringify(doc)),p=`tiles/12-${x}-1.json`;files.set('data/clearances/'+p,raw);tiles.push({path:p,z:12,x,y:1,part:1,parts:1,bbox,bytes:raw.length,records:list.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')});};
  add('a',candidates,10);if(extraTile)add('b',extraTile,11);
  if(corrupt){const k='data/clearances/'+tiles[0].path,b=Buffer.from(files.get(k));b[b.length-3]^=1;files.set(k,b);}
  const manifest={version:3,schema:'kamptrail-clearances-3',kind:'clearance_candidates_manifest',license:'ODbL-1.0',copyright_url:'https://www.openstreetmap.org/copyright',attribution:ATTR,tiles,states_protected:{RI:{status:'protected'}},sources:{CO:{extract_timestamp:'2026-10-30T00:00:00Z',retrieved_at:'2026-10-31T00:00:00Z'}}};
  files.set('data/clearances/index.json',Buffer.from(JSON.stringify(manifest)));if(pilot)files.set('data/clearances/RI.json',pilot);
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
  assert.equal(by['osm:way:500'].association,'on_route');assert.equal(by['osm:way:500'].route_conflict,true);assert.deepEqual(by['osm:way:500'].association_evidence,['nearby_route_segment_way_id_equals_candidate_way','segment=0','applies_to=way_itself']);
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
  const r=await R.analyze(ri,{env:dataset([onRoad])});assert.equal(r.missing[0].reason,'ri_pilot_unavailable');assert.equal(r.summary.missing_segments,1);
  const empty=await R.analyze({geometry:{type:'LineString',coordinates:[[-100,35],[-99.99,35]]}},{env:dataset([onRoad])});
  assert.equal(empty.candidates.length,0);assert.equal(empty.missing.length,0);assert.equal(empty.route_clear,false);
});
test('invalid route identity is rejected rather than guessed',async()=>{
  for(const osm of [{way_ids:['500']},{way_ids:['500','x']},{node_ids:['1','2']},{way_ids:[500,501]},[]])await assert.rejects(R.analyze(route(osm),{env:dataset([onRoad])}),/Invalid route/,JSON.stringify(osm));
  await assert.rejects(R.analyze({geometry:{type:'LineString',coordinates:[[0,0]]}},{env:dataset([onRoad])}),/Invalid route/);
});
test('distance helper still measures points and crossings',()=>{const r=[[-71,41],[-70.99,41]],budget={left:1000};assert.ok(R.distance(r,[[-70.995,41]],budget)<1);assert.equal(R.distance(r,[[-70.995,40.999],[-70.995,41.001]],budget),0);assert.ok(R.distance(r,[[-70.995,41.01]],budget)>100);});

const fs=require('node:fs'),pilotRaw=fs.readFileSync(require('node:path').join(__dirname,'../data/clearances/RI.json')),pilotData=JSON.parse(pilotRaw);
const riRecord=pilotData.records.find(r=>r.geometry.type==='LineString'&&r.metres.maxheight),riPt=riRecord.geometry.coordinates[0];
const riRoute={geometry:{type:'LineString',coordinates:[riPt,[riPt[0]+.00002,riPt[1]]]}};
test('Rhode Island: a valid RI.json supplies pilot records on routes; they are raw tags, never compared or tied to the road',async()=>{
  const r=await R.analyze({...riRoute,osm:{way_ids:[riRecord.osm_id]}},{env:dataset([onRoad],{pilot:pilotRaw}),rigMm:10000});
  assert.equal(r.missing.length,0,'RI is covered by the pilot, not reported missing');assert.equal(r.dataset.ri_pilot.used,true);assert.equal(r.dataset.ri_pilot.extract_timestamp,pilotData.source.extract_timestamp);
  const x=r.candidates.find(c=>c.id===riRecord.id);assert.ok(x);assert.equal(x.source,'ri_pilot');
  assert.equal(x.association,'unresolved','even an exact way id does not associate an unreviewed pilot record');assert.equal(x.comparison.compared,false);assert.equal(x.route_conflict,false);
  assert.deepEqual(x.candidate.tags,riRecord.tags,'raw tags preserved');
});
test('Rhode Island is unknown only when RI.json is missing or fails validation',async()=>{
  const missing=await R.analyze(riRoute,{env:dataset([onRoad])});assert.deepEqual(missing.missing.map(m=>m.reason),['ri_pilot_unavailable']);assert.equal(missing.candidates.length,0);
  const bad=structuredClone(pilotData);bad.source.sha256='bad';
  const invalid=await R.analyze(riRoute,{env:dataset([onRoad],{pilot:Buffer.from(JSON.stringify(bad))})});assert.deepEqual(invalid.missing.map(m=>m.reason),['ri_pilot_unavailable']);assert.equal(invalid.candidates.length,0);
  const tampered=structuredClone(pilotData);tampered.records[0].metres.maxheight=99;
  assert.deepEqual((await R.analyze(riRoute,{env:dataset([onRoad],{pilot:Buffer.from(JSON.stringify(tampered))})})).missing.map(m=>m.reason),['ri_pilot_unavailable']);
  const outside=await R.analyze(route(),{env:dataset([onRoad])});assert.equal(outside.dataset.ri_pilot.needed,false,'routes outside RI never request the pilot');
});

// Codex review: an id match anywhere on the route must not associate a candidate that only lies near other segments.
// Route of 4 segments, two legs (leg 1 = segments 0-1, leg 2 = segments 2-3), each segment about 430 m long.
const long=(osm)=>({geometry:{type:'LineString',coordinates:[[-105,40],[-104.995,40],[-104.99,40],[-104.985,40],[-104.98,40]]},leg_ends:[2,4],osm});
test('a way id that matches only a distant segment leaves the nearby candidate unresolved',async()=>{
  const c=candidate(999,'way',[[-104.9990,40],[-104.9985,40]]);// near segment 0 only
  const r=await R.analyze(long({way_ids:['111','222','999','333']}),{env:dataset([c]),rigMm:ft(14)});
  const x=r.candidates[0];assert.equal(x.association,'unresolved');assert.deepEqual(x.association_evidence,['route_way_id_matches_only_on_distant_segment']);
  assert.equal(x.route_conflict,false);assert.equal(x.nearest_segment,0);assert.equal(x.segment_basis,'proximity');
});
test('a nearby way id match is on_route, and the reported segment and leg come from the match',async()=>{
  // The candidate straddles the vertex between segment 1 (way 111, leg 1) and segment 2 (way 999, leg 2), slightly nearer segment 1.
  const c=candidate(999,'way',[[-104.9902,40.00001],[-104.9899,40.00001]]);
  const r=await R.analyze(long({way_ids:['111','111','999','333']}),{env:dataset([c]),rigMm:ft(14)});
  const x=r.candidates[0];assert.equal(x.association,'on_route');assert.equal(x.nearest_segment,2);assert.equal(x.leg,2);assert.equal(x.segment_basis,'osm_identity_match');
  assert.deepEqual(x.association_evidence,['nearby_route_segment_way_id_equals_candidate_way','segment=2','applies_to=way_itself']);assert.equal(x.route_conflict,true);
});
test('an adjacent segment without identity leaves a candidate unresolved; a node matches only at a nearby vertex',async()=>{
  const c=candidate(999,'way',[[-104.9902,40.00001],[-104.9899,40.00001]]);// near segments 1 and 2
  assert.equal((await R.analyze(long({way_ids:['111','111',null,'333']}),{env:dataset([c])})).candidates[0].association,'unresolved');
  assert.deepEqual((await R.analyze(long({way_ids:['111','111',null,'333']}),{env:dataset([c])})).candidates[0].association_evidence,['route_way_ids_incomplete_near_candidate']);
  const gate=candidate(77,'node',[-104.99,40]);// at vertex 2
  const far=await R.analyze(long({node_ids:['1','2','3','4','77']}),{env:dataset([gate])});assert.equal(far.candidates[0].association,'unresolved');assert.deepEqual(far.candidates[0].association_evidence,['route_node_id_matches_only_at_distant_vertex']);
  const near=await R.analyze(long({node_ids:['1','2','77','4','5']}),{env:dataset([gate]),rigMm:ft(14)});assert.equal(near.candidates[0].association,'on_route');assert.ok([1,2].includes(near.candidates[0].nearest_segment));assert.equal(near.candidates[0].segment_basis,'osm_identity_match');
});

// Codex review 2: a node match is measured to the matching vertex itself, and counts only within 100 m.
const east=(m,lat=40)=>m/(111320*Math.cos(lat*Math.PI/180)),north=m=>m/111320;
test('node match: 853 m from the matching vertex is unresolved with no conflict, even though a route segment is near',async()=>{
  const gate=candidate(77,'node',[-105,40]);// at vertex 0; the matching id is on vertex 2, about 853 m away
  const r=await R.analyze(long({node_ids:['1','2','77','4','5']}),{env:dataset([gate]),rigMm:ft(14)});
  const x=r.candidates[0];assert.equal(x.association,'unresolved');assert.deepEqual(x.association_evidence,['route_node_id_matches_only_at_distant_vertex']);
  assert.equal(x.route_conflict,false);assert.equal(x.distance_m,0,'distance to the nearest segment, reported as proximity');assert.equal(x.segment_basis,'proximity');
});
test('node match boundary: 99 m from the matching vertex is on_route with that distance; 101 m is unresolved',async()=>{
  const at=m=>candidate(77,'node',[-104.99+east(m),40]);// along segment 2, so a segment is always within 100 m
  const ok=(await R.analyze(long({node_ids:['1','2','77','4','5']}),{env:dataset([at(99)]),rigMm:ft(14)})).candidates[0];
  assert.equal(ok.association,'on_route');assert.equal(ok.distance_m,99);assert.equal(ok.route_conflict,true);assert.equal(ok.segment_basis,'osm_identity_match');assert.equal(ok.nearest_segment,2);assert.equal(ok.leg,2);
  const no=(await R.analyze(long({node_ids:['1','2','77','4','5']}),{env:dataset([at(101)]),rigMm:ft(14)})).candidates[0];
  assert.equal(no.association,'unresolved');assert.equal(no.route_conflict,false);assert.equal(no.distance_m,0);
});
test('way match boundary: 99 m from the matching segment is on_route with that distance; 101 m is outside the search',async()=>{
  const off=m=>candidate(999,'way',[[-104.9885,40+north(m)],[-104.9865,40+north(m)]]);// parallel to segment 2 (way 999)
  const ok=(await R.analyze(long({way_ids:['111','222','999','333']}),{env:dataset([off(99)]),rigMm:ft(14)})).candidates[0];
  assert.equal(ok.association,'on_route');assert.equal(ok.distance_m,99);assert.equal(ok.nearest_segment,2);
  assert.equal((await R.analyze(long({way_ids:['111','222','999','333']}),{env:dataset([off(101)]),rigMm:ft(14)})).candidates.length,0);
});
