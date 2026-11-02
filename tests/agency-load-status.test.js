'use strict';
// Forest Service and BLM listings (agency files) that fail to load are reported, never silently omitted
// (live census on 2.37.0, 2026-11-02: 122 listings missing with no failed state). Retry recovers them
// without removing listings that already loaded.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

function harness(fetcher){
  const evented=target=>Object.assign(target,{handlers:{},on(type,fn){(this.handlers[type]||=[]).push(fn);return this;},fire(type,event={}){for(const fn of this.handlers[type]||[])fn(event);return this;}});
  const cluster={layers:[],addLayers(items){this.layers.push(...items);},removeLayer(item){this.layers=this.layers.filter(x=>x!==item);}};
  // An ocean view: nothing loads until the test asks for states.
  const bounds={getSouth:()=>-10.1,getNorth:()=>-9.9,getWest:()=>-140.1,getEast:()=>-139.9,contains:()=>false};
  const map=evented({getBounds:()=>bounds,addLayer(){},removeLayer(){},hasLayer(){return false;},getZoom:()=>10,setView(){},closePopup(){}});
  const events=[];
  const context={console:{warn(){},log(){}},fetch:fetcher,setTimeout,clearTimeout,AbortController,URL,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},document:{addEventListener(){}},dispatchEvent:e=>events.push(e),
    L:{markerClusterGroup:()=>cluster,layerGroup:()=>({addLayer(){},items:[]}),divIcon:o=>o,marker:coords=>evented({coords,bindPopup(){return this;},setPopupContent(){return this;},isPopupOpen(){return false;}})}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(read('data-quality.js'),context);
  vm.runInContext(read('data-loader.js'),context);
  return {api:context.KampTrailData,map,events};
}
const ok=data=>({ok:true,json:async()=>data});
const fail=status=>({ok:false,status,json:async()=>({})});
const site=(id,name,[lng,lat],extra={})=>({type:'Feature',geometry:{type:'Point',coordinates:[lng,lat]},properties:{id,name,...extra}});
const agency=state=>({type:'dispersed',state,source:'Bureau of Land Management',sources:['Bureau of Land Management'],camping_activity:'BLM camping area',schema_version:3,amenities:[],rig_friendly:[]});
const fc=features=>({type:'FeatureCollection',features});
// Colorado and Idaho each have one Recreation.gov/OSM listing and one Forest Service listing.
const DATA={
  'data/campsites/agency/index.json':{version:1,states:['CO','ID'],counts:{CO:1,ID:1}},
  'data/campsites/CO_merged.geojson':fc([site('osm:node:1','Merged Colorado Camp',[-105.5,39.5],{osm_id:1,tourism:'camp_site'})]),
  'data/campsites/ID_merged.geojson':fc([site('osm:node:2','Merged Idaho Camp',[-114.5,44.5],{osm_id:2,tourism:'camp_site'})]),
  'data/campsites/agency/CO.geojson':fc([site('blm-area:1','Forest Colorado Camp',[-106.5,38.5],agency('CO'))]),
  'data/campsites/agency/ID.geojson':fc([site('blm-area:2','Forest Idaho Camp',[-115.5,45.5],agency('ID'))])
};
// fails: path -> HTTP status. Tests change it to restore a source before retrying.
function server(fails={}){
  const requests=[];
  const fetcher=async url=>{requests.push(url);if(fails[url])return fail(fails[url]);return DATA[url]?ok(structuredClone(DATA[url])):fail(404);};
  return {fails,requests,fetcher};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const names=api=>api.getAllCampsites().map(f=>f.properties.name).sort();

test('a failed agency index is reported while Recreation.gov and OSM listings still load, and retry recovers',async()=>{
  const s=server({'data/campsites/agency/index.json':404}),h=harness(s.fetcher);
  await h.api.init(h.map);
  await h.api.loadStates(['CO','ID']);
  let status=plain(h.api.getLoadStatus());
  assert.equal(status.agencyIndex,'failed');
  assert.deepEqual(status.failedStates,[],'failedStates keeps its meaning: whole states that did not load');
  assert.deepEqual(status.agencyFailedStates,[]);
  assert.deepEqual(status.loadedStates.sort(),['CO','ID']);
  assert.deepEqual(plain(names(h.api)),['Merged Colorado Camp','Merged Idaho Camp']);
  assert.ok(!s.requests.some(u=>/agency\/[A-Z]{2}\.geojson/.test(u)),'no agency file is requested without the index');
  // A retry that fails again keeps the failure and the loaded listings.
  status=plain(await h.api.retryAgency());
  assert.equal(status.agencyIndex,'failed');
  assert.deepEqual(plain(names(h.api)),['Merged Colorado Camp','Merged Idaho Camp']);
  delete s.fails['data/campsites/agency/index.json'];
  status=plain(await h.api.retryAgency());
  assert.equal(status.agencyIndex,'ok');
  assert.deepEqual(status.agencyFailedStates,[]);
  assert.deepEqual(plain(names(h.api)),['Forest Colorado Camp','Forest Idaho Camp','Merged Colorado Camp','Merged Idaho Camp']);
  assert.ok(h.events.at(-1).detail.agencyIndex==='ok','the update event carries the recovered status');
});

test('one failed agency file names that state and keeps its merged listings; retry clears the status',async()=>{
  const s=server({'data/campsites/agency/CO.geojson':500}),h=harness(s.fetcher);
  await h.api.init(h.map);
  await h.api.loadStates(['CO','ID']);
  let status=plain(h.api.getLoadStatus());
  assert.equal(status.agencyIndex,'ok');
  assert.deepEqual(status.agencyFailedStates,[{state:'CO',error:'HTTP 500'}]);
  assert.deepEqual(status.failedStates,[]);
  assert.deepEqual(plain(names(h.api)),['Forest Idaho Camp','Merged Colorado Camp','Merged Idaho Camp']);
  const before=h.api.getCampsiteById('osm:node:1');
  delete s.fails['data/campsites/agency/CO.geojson'];
  status=plain(await h.api.retryAgency());
  assert.deepEqual(status.agencyFailedStates,[]);
  assert.equal(status.agencyIndex,'ok');
  assert.deepEqual(plain(names(h.api)),['Forest Colorado Camp','Forest Idaho Camp','Merged Colorado Camp','Merged Idaho Camp']);
  assert.equal(h.api.getCampsiteById('osm:node:1').properties.id,before.properties.id,'stored ids are unchanged');
  assert.equal(s.requests.filter(u=>u==='data/campsites/agency/ID.geojson').length,1,'a loaded agency file is not fetched again');
});

test('a partial recovery leaves only the states still missing, and a failed retry never removes loaded agency listings',async()=>{
  const s=server({'data/campsites/agency/CO.geojson':500,'data/campsites/agency/ID.geojson':503}),h=harness(s.fetcher);
  await h.api.init(h.map);
  await h.api.loadStates(['CO','ID']);
  assert.deepEqual(plain(h.api.getLoadStatus().agencyFailedStates.map(x=>x.state)),['CO','ID']);
  assert.deepEqual(plain(names(h.api)),['Merged Colorado Camp','Merged Idaho Camp']);
  delete s.fails['data/campsites/agency/ID.geojson'];
  let status=plain(await h.api.retryAgency());
  assert.deepEqual(status.agencyFailedStates,[{state:'CO',error:'HTTP 500'}]);
  assert.deepEqual(plain(names(h.api)),['Forest Idaho Camp','Merged Colorado Camp','Merged Idaho Camp']);
  // Idaho fails on a later retry of a reloaded state; its agency listing stays.
  s.fails['data/campsites/agency/ID.geojson']=500;
  status=plain(await h.api.retryAgency());
  assert.deepEqual(status.agencyFailedStates.map(x=>x.state),['CO']);
  assert.deepEqual(plain(names(h.api)),['Forest Idaho Camp','Merged Colorado Camp','Merged Idaho Camp']);
  delete s.fails['data/campsites/agency/CO.geojson'];
  status=plain(await h.api.retryAgency());
  assert.deepEqual(status.agencyFailedStates,[]);
  assert.equal(names(h.api).length,4);
});

test('the same states give the same catalogue whether agency files load at once or after a retry',async()=>{
  const direct=harness(server().fetcher);await direct.api.init(direct.map);await direct.api.loadStates(['CO','ID']);
  const s=server({'data/campsites/agency/index.json':404}),retried=harness(s.fetcher);
  await retried.api.init(retried.map);await retried.api.loadStates(['CO','ID']);
  delete s.fails['data/campsites/agency/index.json'];await retried.api.retryAgency();
  const view=api=>plain(api.getAllCampsites()).map(f=>[f.properties.id,[...(f.properties.legacy_ids||[])].sort()]).sort();
  assert.deepEqual(view(retried.api),view(direct.api));
  assert.equal(direct.api.getLoadStatus().agencyIndex,'ok');
});

test('the notice text exists in Spanish and French with the same placeholder',()=>{
  const es=read('locale.js'),fr=read('locale-fr.js');
  for(const key of ['Forest Service and BLM listings could not load. Other listings are shown.','Forest Service and BLM listings could not load for {states}. Other listings are shown.']){
    for(const src of [es,fr]){const m=src.match(new RegExp('^  '+JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+': ("(?:[^"\\\\]|\\\\.)*")','m'));assert.ok(m,key);const v=JSON.parse(m[1]);assert.notEqual(v,key);assert.equal(v.includes('{states}'),key.includes('{states}'));}
  }
});
