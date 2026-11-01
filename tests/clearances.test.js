'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../clearances.js');
const root=path.resolve(__dirname,'..'),manifestRaw=fs.readFileSync(path.join(root,'data/clearances/index.json')),manifest=JSON.parse(manifestRaw);
const entry=manifest.tiles.find(e=>e.records>5),tileRaw=fs.readFileSync(path.join(root,'data/clearances',entry.path)),tile=JSON.parse(tileRaw);
const base=()=>structuredClone(tile.candidates.find(c=>c.status==='numeric_only'));
const ft=(f,i=0)=>Math.round((f*12+i)*25.4);// canonical rig millimetres
function candidate(over={}){const c=base();Object.assign(c,over);return c;}
function numeric(raw){const h=C.parseHundredths(raw);return candidate({tags:{maxheight:raw},metres:{maxheight:h.metres},inches:{maxheight:h.hundredths/100},parse:{maxheight:'numeric'},min_inches:h.hundredths/100,min_metres:h.metres,status:'numeric_only',comparable:true});}
function uncomparable(status,tags){const c=candidate({status,comparable:false,tags,plausibility:status==='suspect'?'suspect':'ok'});delete c.min_inches;delete c.min_metres;c.inches=Object.fromEntries(Object.keys(tags).map(k=>[k,null]));c.metres={...c.inches};return c;}

test('rig comparison: below and equal are conflicts; above is not, and none claims passage',()=>{
  const c=numeric(`13'6"`);
  const below=C.compare(c,ft(13,8)),equal=C.compare(c,ft(13,6)),above=C.compare(c,ft(13,4));
  assert.deepEqual([below.relation,below.conflict],['below',true]);
  assert.deepEqual([equal.relation,equal.conflict],['equal',true],'equal is never clear');
  assert.deepEqual([above.relation,above.conflict],['above',false]);
  assert.match(C.comparisonText(equal),/Equal is not clear/);assert.match(C.comparisonText(above),/does not establish passage/);
  assert.equal(C.compare(c,null).relation,'no_rig_height');assert.equal(C.compare(c,null).conflict,false);
  for(const bad of [0,-5,1.5,'4000',10001,NaN])assert.equal(C.compare(c,bad).relation,'no_rig_height',String(bad));
});
test('unit handling: feet/inches exact, metric floored to hundredths of an inch, rig millimetres rounded up',()=>{
  assert.equal(C.parseHundredths(`13'6"`).hundredths,16200);assert.equal(C.parseHundredths(`12'`).hundredths,14400);
  assert.equal(C.parseHundredths('4.1').hundredths,16141);assert.equal(C.parseHundredths('4.1 m').hundredths,16141);// 161.417... floored
  assert.equal(C.parseHundredths('4.572').hundredths,18000);// exactly 15 ft
  for(const raw of ['13 ft','4,1','4.1m',`13' 6"`,`6'12"`,'none','default','below_default','0','101','4 @ (wet)'])assert.equal(C.parseHundredths(raw),null,raw);
  // Compared at the rig's whole-millimetre resolution: 13'6" is 4114.8 mm, so a 4115 mm rig is equal, a conflict.
  assert.equal(C.compare(numeric(`13'6"`),4115).relation,'equal');assert.equal(C.compare(numeric(`13'6"`),4116).relation,'below');assert.equal(C.compare(numeric(`13'6"`),4114).relation,'above');
  const metric=numeric('4.115');assert.equal(C.compare(metric,4115).relation,'equal');assert.equal(C.compare(metric,4115).conflict,true);
  assert.equal(C.compare(numeric('4.1'),4100).relation,'equal','metric sign and metric rig at the same height');
  // Python builder values agree with the client parser on every committed comparable candidate in this tile.
  for(const c of tile.candidates.filter(c=>c.comparable))assert.ok(['maxheight','maxheight:physical','height'].some(k=>c.tags[k]&&C.parseHundredths(c.tags[k])?.hundredths===Math.round(c.min_inches*100)),c.id);
});
test('each status: only numeric_only with comparable=true is compared',()=>{
  const cases={suspect:uncomparable('suspect',{maxheight:'55'}),conditional:uncomparable('conditional',{maxheight:'3.5','maxheight:conditional':'3 @ (wet)'}),
    directional_only:uncomparable('directional_only',{'maxheight:forward':'3.9'}),mixed:uncomparable('mixed',{maxheight:'4','maxheight:backward':'3.6'}),unknown:uncomparable('unknown',{maxheight:'default'})};
  for(const [status,c] of Object.entries(cases)){
    const r=C.compare(c,ft(40));assert.equal(r.compared,false,status);assert.equal(r.conflict,false,status);assert.equal(r.relation,'not_compared',status);
    assert.equal(C.state(c),status==='unknown'?'unknown':'needs_checking',status);
  }
  assert.match(C.stateText(cases.suspect),/needs checking/);assert.match(C.stateText(cases.conditional),/conditional/);assert.match(C.stateText(cases.directional_only),/direction/);assert.match(C.stateText(cases.unknown),/Unknown/);
  // A tampered record cannot become comparable without a minimum that its raw text supports.
  const forged=numeric(`13'6"`);forged.min_inches=200;forged.inches.maxheight=200;assert.throws(()=>C.validateCandidate(forged,entry.bbox),/minimum differs from raw source/);
  const flagged=uncomparable('suspect',{maxheight:'55'});flagged.comparable=true;assert.throws(()=>C.validateCandidate(flagged,entry.bbox),/invalid status/);
  const sneaky=uncomparable('conditional',{maxheight:'3'});sneaky.min_inches=118;assert.throws(()=>C.validateCandidate(sneaky,entry.bbox),/carries a minimum/);
});
test('empty set has no minimum and no comparison',()=>{
  const c=uncomparable('unknown',{maxheight:'none'});assert.equal(Object.hasOwn(c,'min_inches'),false);assert.equal(C.compare(c,ft(12)).compared,false);
  const empty={...tile,candidates:[]};assert.throws(()=>C.validateTile(empty,entry),/record count/);
});
test('directional and conditional candidates stay visible but uncompared',()=>{
  const dir=uncomparable('directional_only',{'maxheight:forward':`11'0"`,'maxheight:backward':`14'0"`});
  assert.equal(C.compare(dir,ft(12)).compared,false,'a lower forward value is never silently applied or ignored');
  assert.equal(C.validateCandidate(dir,entry.bbox),dir);
  const cond=uncomparable('conditional',{'maxheight:conditional':'3.5 @ (Mo-Fr 07:00-19:00)'});assert.equal(C.validateCandidate(cond,entry.bbox),cond);assert.equal(C.compare(cond,1000).conflict,false);
});
test('manifest integrity: every committed tile matches bytes and sha256 and validates against the client schema',()=>{
  C.validateManifest(manifest);let records=0;
  for(const e of manifest.tiles){const raw=fs.readFileSync(path.join(root,'data/clearances',e.path));assert.equal(raw.length,e.bytes,e.path);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),e.sha256,e.path);records+=C.validateTile(JSON.parse(raw),e).candidates.length;}
  assert.equal(records,manifest.totals.candidates);
  for(const mutate of [m=>m.attribution='OSM',m=>m.schema='kamptrail-clearances-2',m=>m.tiles[0].sha256='x',m=>m.tiles[0].path='../index.json',m=>m.tiles[0].bytes=600000,m=>m.tiles[0].bbox=[1,1,0,0],m=>m.tiles.push(m.tiles[0])]){
    const m=structuredClone(manifest);mutate(m);assert.throws(()=>C.validateManifest(m));
  }
});
test('store rejects a tile whose bytes or hash differ from the manifest, before any record is used',async()=>{
  const serve=(body)=>async url=>url.endsWith('index.json')?new Response(manifestRaw):new Response(body);
  const env={fetch:serve(tileRaw),crypto:globalThis.crypto};const store=C.createStore(env);const m=await store.loadManifest();
  const e=m.tiles.find(x=>x.path===entry.path);assert.equal((await store.loadTile(e)).candidates.length,entry.records);
  const tampered=Buffer.from(tileRaw.toString().replace(/"maxheight":"[^"]+"/,'"maxheight":"9\'9\\""'));
  await assert.rejects(C.createStore({fetch:serve(tampered),crypto:globalThis.crypto}).loadManifest().then(m2=>C.createStore({fetch:serve(tampered),crypto:globalThis.crypto}).loadTile(m2.tiles.find(x=>x.path===entry.path))),/size mismatch|checksum mismatch/);
  const sameSize=Buffer.from(tileRaw);sameSize[sameSize.length-3]^=1;
  const s3=C.createStore({fetch:serve(sameSize),crypto:globalThis.crypto});await s3.loadManifest();await assert.rejects(s3.loadTile(e),/checksum mismatch/);
  let cancelled=false;const s4=C.createStore({crypto:globalThis.crypto,fetch:async u=>u.endsWith('index.json')?new Response(manifestRaw):{ok:true,headers:new Headers(),body:new ReadableStream({pull(c){c.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}})}});
  await s4.loadManifest();await assert.rejects(s4.loadTile(e),/exceeds bound/);assert.equal(cancelled,true);
});
test('zoom gating and per-view budget: nothing below zoom 10, bounded tiles at street level',()=>{
  const nyc=[-74.03,40.69,-73.93,40.78];
  for(const z of [4,8,9,9.99])assert.deepEqual(C.tilesForView(manifest,nyc,z),{ok:false,reason:'zoom',tiles:[]},String(z));
  const z12=C.tilesForView(manifest,nyc,12);assert.equal(z12.ok,true);assert.ok(z12.tiles.length>0&&z12.tiles.length<=C.MAX_VIEW_TILES);assert.ok(z12.bytes<=C.MAX_VIEW_BYTES);
  const wide=C.tilesForView(manifest,[-125,24,-66,50],10);assert.equal(wide.ok,false);assert.equal(wide.reason,'budget');assert.deepEqual(wide.tiles,[]);
  // A tile is found through its bbox even when the view only touches the edge of a way stored in another cell.
  const e=manifest.tiles[0];assert.ok(C.tilesForView(manifest,[e.bbox[2]-1e-6,e.bbox[3]-1e-6,e.bbox[2]+.001,e.bbox[3]+.001],12).tiles.includes(e));
  const empty=C.tilesForView(manifest,[-40,-10,-39.9,-9.9],12);assert.equal(empty.ok,true);assert.equal(empty.tiles.length,0);
});
test('attribution: ODbL text and copyright link are attached to every display',()=>{
  assert.equal(C.ATTRIBUTION,manifest.attribution);assert.equal(C.COPYRIGHT_URL,'https://www.openstreetmap.org/copyright');
  const made=[];const doc={createElement:tag=>{const n={tag,children:[],append(...x){this.children.push(...x);}};made.push(n);return n;}};
  const p=C.attributionNode(doc);assert.ok(p.children[0].includes('Open Database Licence'));assert.equal(p.children[1].href,'https://www.openstreetmap.org/copyright');
  for(const f of ['clearances.js','route-clearance.js'])assert.match(fs.readFileSync(path.join(root,f),'utf8'),/attributionNode\(/,f);
});
test('visitor reports: only well-formed published rows pass, and they never carry a rig comparison',()=>{
  const r={id:3,lat:41.8,lng:-71.4,posted:`12'9"`,hundredths:15300,observed_on:'2026-10-01',published_at:'2026-10-02T00:00:00Z',direction:'both',osm_ref:'osm:way:12'};
  assert.equal(C.validReport(r),true);
  for(const bad of [{hundredths:15301},{posted:'12 ft'},{direction:'north'},{osm_ref:'way:12'},{lat:95},{observed_on:'yesterday'}])assert.equal(C.validReport({...r,...bad}),false,JSON.stringify(bad));
  assert.doesNotMatch(fs.readFileSync(path.join(root,'clearances.js'),'utf8').match(/function reportPopup[\s\S]*?return box;/)[0],/compare\(/);
});

test('Rhode Island pilot: the committed RI.json validates and its records are never comparable',async()=>{
  const raw=fs.readFileSync(path.join(root,'data/clearances/RI.json')),d=JSON.parse(raw);
  assert.equal(C.validatePilot(d),d);assert.equal(d.records.length,254);
  const list=C.pilotCandidates(d);assert.equal(list.length,254);
  for(const c of list){assert.equal(C.state(c),'needs_checking');assert.equal(C.compare(c,1000).compared,false);assert.equal(C.compare(c,1000).conflict,false);assert.equal(c.applies_to,'unknown');}
  assert.match(C.stateText(list[0]),/Rhode Island pilot record/);
  assert.ok(manifest.states_protected.RI,'RI remains protected in the national manifest');
  assert.equal(C.pilotNeeded(manifest,[-71.5,41.7,-71.3,41.9]),true);assert.equal(C.pilotNeeded(manifest,[-105,40,-104.9,40.1]),false);
  const serve=body=>({crypto:globalThis.crypto,fetch:async u=>u.endsWith('RI.json')?(body===null?new Response('',{status:404}):new Response(body)):new Response(manifestRaw)});
  assert.equal((await C.createStore(serve(raw)).loadPilot()).candidates.length,254);
  await assert.rejects(C.createStore(serve(null)).loadPilot(),/source unavailable/);
  const bad=structuredClone(d);bad.region='MA';await assert.rejects(C.createStore(serve(JSON.stringify(bad))).loadPilot(),/invalid pilot/);
  const off=structuredClone(d);off.records[0].metres.maxheight=1;await assert.rejects(C.createStore(serve(JSON.stringify(off))).loadPilot(),/differs from raw source/);
});
