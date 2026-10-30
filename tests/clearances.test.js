'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const C=require('../clearances.js'),published=require('../data/clearances/RI.json');
const vm=require('node:vm');
const clone=()=>structuredClone(published);
test('height syntax converts documented units only and never treats nonnumeric/conditional values as safe',()=>{
  for(const [raw,metres] of [['3.8',3.8],['3 m',3],[`6'7"`,2.0066],[`12'`,3.6576],[`14'10"`,4.5212]])assert.ok(Math.abs(C.parseHeight(raw)-metres)<1e-9,raw);
  for(const raw of ['none','default','below_default','no_indications','unsigned','13 ft','3,8','3.8m',' 3.8','3.8 ','3.8;4.2',`6'12"`,`6' 7"`,'4 @ (wet)','4|5','0','-4','101',''])assert.equal(C.parseHeight(raw),null,raw);
});
test('exact node and way namespaces remain separate; physical and legal tags never substitute for each other',()=>{
  const d=clone(),way=d.records[0];d.records=[way,{...structuredClone(way),id:'osm:node:'+way.osm_id,osm_type:'node',geometry:{type:'Point',coordinates:way.geometry.coordinates[0]}}];
  assert.equal(C.validate(d),d);assert.notEqual(d.records[0].id,d.records[1].id);
  assert.match(C.heightText(way,'maxheight:physical'),/Unknown/);
  way.tags['maxheight:physical']='4.8';way.metres['maxheight:physical']=4.8;C.validate(d);
  assert.match(C.heightText(way,'maxheight:physical'),/4.80 m/);
  assert.equal(C.sourceLink(way),'https://www.openstreetmap.org/way/'+way.osm_id);
});
test('corrupt dates, hash fields, geometry, scope, identities and raw/normalized mismatches fail before display or cache',()=>{
  for(const mutate of [d=>d.region='MA',d=>d.source.url='https://evil.example/file',d=>d.source.resolved_url=d.source.resolved_url.replace('261028','261029'),d=>d.source.sha256='bad',d=>d.source.extract_timestamp='2026-02-30T00:00:00Z',d=>d.source.retrieved_at='2099-01-01T00:00:00Z',d=>d.records.push(d.records[0]),d=>d.records[0].id='osm:node:'+d.records[0].osm_id,d=>d.records[0].geometry.coordinates[0]=[-75,43],d=>d.records[0].metres.maxheight=99,d=>d.records[0].metres['maxheight:physical']=5,d=>d.records[0].tags['<img>']='yes',d=>d.records[0].edited_at='2026-10-29T00:00:00Z']){
    const d=clone();mutate(d);assert.throws(()=>C.validate(d));
  }
});
test('measured native pilot retains raw unknowns, all source dates and exact packaged geometry proof',()=>{
  C.validate(published);const report=require('../docs/CLEARANCE_RI_PROOF.json'),raw=fs.readFileSync('data/clearances/RI.json');
  assert.equal(raw.length,report.asset_bytes);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),report.asset_sha256);
  assert.equal(report.accepted,published.records.length);assert.equal(report.accepted,254);assert.equal(report.parsed_counts.maxheight,239);assert.equal(report.quarantined,4);assert.equal(report.statistics.lifecycle_excluded,1);
  assert.equal(published.source.sha256,'2e814ed12a070be2112f7e64bd80b05785ca082820c9a83f0c8e7ce9c6ce58b6');
  assert.equal(published.source.retrieved_at,'2026-10-30T16:30:30Z');assert.equal(published.source.extract_timestamp,'2026-10-28T21:21:02Z');
  const unknown=published.records.filter(r=>r.metres.maxheight===null);assert.equal(unknown.length,15);assert.ok(unknown.every(r=>['none','default'].includes(r.tags.maxheight)));
  assert.match(C.describe(unknown[0],published,true),/Saved snapshot/);assert.match(C.describe(unknown[0],published),/not an inspection/);assert.match(C.describe(unknown[0],published),/does not match these tags to your route/);
});
test('full tagged road geometry intersects view even when both endpoint vertices are outside',()=>{
  const r={geometry:{type:'LineString',coordinates:[[-71.6,41.8],[-71.2,41.8]]}},b={west:-71.5,east:-71.3,south:41.7,north:41.9};
  assert.equal(C.intersect(r,b),true);assert.equal(C.intersect(r,{...b,south:42,north:42.1}),false);
  assert.equal(C.intersect(r,{...b,west:170,east:190}),false);assert.equal(C.intersect(r,{...b,west:-180,east:180}),true);
});

function loaderHarness({cached=false}={}){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.value='';}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(){}
  }
  const evidence={...clone(),records:clone().records.slice(0,1)},events=new Map(),timers=new Map(),requests=[];
  const layer={rows:[],clearLayers(){this.rows=[];},addLayer(item){this.rows.push(item);},getLayers(){return this.rows;}};
  let control,enabled=true,nextTimer=0,waiting=false,stored=cached?JSON.stringify(evidence):null;
  const env={TextEncoder,TextDecoder,Response,URL,AbortController,Date,Map,Set,
    document:{createElement:tag=>new Element(tag)},location:{href:'https://kamptrail.com/'},
    caches:{open:async()=>({put:async(url,response)=>{stored=await response.text();},match:async()=>stored?new Response(stored):null})},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},
    fetch:async(url,{signal})=>{
      if(!waiting)return new Response(JSON.stringify(evidence));
      return new Promise((resolve,reject)=>{const request={signal,resolve,ignoreAbort:false};requests.push(request);signal.addEventListener('abort',()=>{if(!request.ignoreAbort)reject(new Error('Request aborted'));});});
    }
  };
  env.L={layerGroup:()=>layer,control:()=>({addTo(){control=this.onAdd();}}),
    DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},
    polyline:()=>({bindPopup(){return this;}}),circleMarker:()=>({bindPopup(){return this;}})};
  const map={hasLayer:()=>enabled,on:(names,fn)=>names.split(' ').forEach(name=>events.set(name,fn)),getZoom:()=>12,
    getBounds:()=>({getSouth:()=>40.9,getWest:()=>-72,getNorth:()=>42.1,getEast:()=>-70.9}),getSize:()=>({x:390,y:500}),getContainer:()=>({querySelector:()=>null})};
  env.window=env;vm.createContext(env);vm.runInContext(fs.readFileSync(require.resolve('../clearances.js'),'utf8'),env);env.KampTrailClearances.init(map);
  return {evidence,layer,requests,get control(){return control;},get status(){return control.children[1].textContent;},
    load(){events.get('overlayadd')({layer});},waitForNetwork(){waiting=true;},retry(){control.children.at(-1).onclick();},
    deadline(){const entry=[...timers].find(([,timer])=>timer.delay===15000);assert.ok(entry,'A source request must have a deadline');timers.delete(entry[0]);entry[1].fn();},
    disable(){enabled=false;events.get('overlayremove')({layer});}
  };
}
const settleLoader=()=>new Promise(resolve=>setImmediate(resolve));
test('a refresh deadline retains validated in-memory height evidence and its original source date',async()=>{
  const h=loaderHarness();h.load();await settleLoader();assert.equal(h.layer.rows.length,1);
  h.waitForNetwork();h.retry();assert.equal(h.requests.length,1);h.deadline();await settleLoader();
  assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.layer.rows.length,1);
  assert.match(h.status,/Saved snapshot/);assert.match(h.status,new RegExp(h.evidence.source.extract_timestamp.slice(0,10)));
  assert.equal(h.control.children[2].children[0].disabled,false);
});
test('a cold source deadline may use a previously validated dated cache',async()=>{
  const h=loaderHarness({cached:true});h.waitForNetwork();h.load();h.deadline();await settleLoader();
  assert.equal(h.layer.rows.length,1);assert.match(h.status,/Saved snapshot/);
  assert.match(h.status,new RegExp(h.evidence.source.extract_timestamp.slice(0,10)));
});
test('removing the height layer suppresses both cancelled and late source responses',async()=>{
  for(const ignoresAbort of [false,true]){
    const h=loaderHarness({cached:true});h.waitForNetwork();h.load();h.requests[0].ignoreAbort=ignoresAbort;h.disable();
    assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.control.hidden,true);
    if(ignoresAbort)h.requests[0].resolve(new Response(JSON.stringify(h.evidence)));
    await settleLoader();assert.equal(h.control.hidden,true);assert.equal(h.layer.rows.length,0);
    assert.equal(h.control.children[2].children[0].disabled,true);assert.doesNotMatch(h.status,/Saved snapshot|evidence unavailable/);
  }
});
