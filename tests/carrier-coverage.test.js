'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../carrier-coverage.js');
const region = {id:'RI',bounds:[-72,41,-71,42],minZoom:6,maxZoom:10};
const m = {schema:1,release:'2026-06-30-r1',asOf:'2026-06-30',retrievedAt:'2026-11-20',
  technology:'4G LTE',environment:'Outdoor stationary',carriers:[{id:'att',regions:[region]}]};
const now = Date.parse('2026-11-21');
test('only valid dated local coverage bundles are accepted', () => {
  assert.ok(C.validManifest(m,now));
  for (const changes of [{release:'../../private'},{retrievedAt:'2026-02-31'},{asOf:'2027-01-01'},{carriers:[]},
    {carriers:[m.carriers[0],m.carriers[0]]},{carriers:[{id:'verizon',regions:[{...region,id:'../../CA'}]}]},
    {carriers:[{id:'verizon',regions:[{...region,minZoom:13,maxZoom:7}]}]}]) assert.equal(C.validManifest({...m,...changes},now),false);
  assert.equal(C.tileTemplate(m,m.carriers[0],region),'data/fcc-coverage/2026-06-30-r1/att/RI/{z}/{x}/{y}.png');
});
test('only the three exact source palette semantics classify a pixel', () => {
  for (const [pixel,expected] of [[[24,96,176,255],'covered'],[[112,112,112,255],'uncovered'],[[0,0,0,0],'missing'],[[200,200,200,100],'unavailable']]) {
    assert.equal(C.pixelStatus(pixel),expected);
  }
});
test('map center reads native tile pixels at overzoom and keeps unbuilt regions, low zoom and failed tiles distinct', () => {
  const map={wrapLatLng:p=>p,getCenter:()=>({lat:41.4,lng:-71.5}),getZoom:()=>18,project:(p,z)=>{
    assert.equal(z,10); return {floor:()=>({x:513,y:771})};
  }};
  const tiles=new Map([['10/2/3',{state:'ready',image:42}]]), entries=[{region,tiles}];
  const sample=(image,x,y)=>{assert.deepEqual([image,x,y],[42,1,3]);return 'uncovered';};
  assert.equal(C.samplesAtCenter(map,entries,sample),'uncovered');
  tiles.set('10/2/3',{state:'unavailable'});assert.equal(C.samplesAtCenter(map,entries,sample),'unavailable');
  assert.equal(C.samplesAtCenter({...map,getZoom:()=>5},entries,sample),'zoom');
  assert.equal(C.samplesAtCenter({...map,getCenter:()=>({lat:41,lng:-75})},entries,sample),'missing');
});
test('fresh, stale and offline status use the filing date independently of retrieval', () => {
  assert.equal(C.freshness(m,false,false,now),'');
  assert.match(C.freshness({...m,asOf:'2024-06-30'},false,false,now),/not current/);
  assert.match(C.freshness(m,true,false,now),/Offline.*not current/);
  assert.match(C.freshness(m,false,true,now),/Saved.*not current/);
});
test('a missing or invalid manifest withdraws the control; only a validated copy is available offline',async () => {
  const rows=new Map(),storage={getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const url='https://example.invalid/data/fcc-coverage/manifest.json';
  // Avoid binding this regression to a future host clock.
  const sample={...m,asOf:'2023-06-30',retrievedAt:'2024-01-01'};
  assert.equal(await C.loadManifest(url,storage,false),null);
  assert.deepEqual(await C.loadManifest(url,storage,true,async()=>Response.json(sample)),{value:sample,fallback:false});
  assert.deepEqual(await C.loadManifest(url,storage,false),{value:sample,fallback:true});
  assert.deepEqual(await C.loadManifest(url,storage,true,async()=>new Response('',{status:503})),{value:sample,fallback:true});
  assert.equal(await C.loadManifest(url,storage,true,async()=>new Response('',{status:404})),null);
  assert.equal(await C.loadManifest(url,storage,false),null);
  assert.equal(await C.loadManifest(url,storage,true,async()=>Response.json({...sample,schema:99})),null);
});

test('a separate packed pointer takes precedence, keeps its date offline, and is withdrawn on rollback', async () => {
  const rows = new Map();
  const storage = {getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
  const base = new URL('https://example.invalid/data/fcc-coverage/');
  const regional = {...m,asOf:'2023-06-30',retrievedAt:'2024-01-01'};
  const packed = {...regional,schema:2,release:'2023-06-30-national',carriers:[{
    id:'att',regions:[{...region,archive:{format:'pmtiles-v3',bytes:65536,sha256:'a'.repeat(64)}}]
  }]};
  let published = packed;
  const urls=[];
  const request = async url => {
    urls.push(new URL(url).pathname.split('/').pop());
    if (url.endsWith('/manifest.json')) return Response.json(regional);
    if (published === null) return new Response('',{status:404});
    return Response.json(published);
  };
  assert.deepEqual(await C.preferredManifest(base,storage,true,request), {value:packed,fallback:false});
  assert.deepEqual(urls,['manifest-v2.json']);
  assert.deepEqual(await C.preferredManifest(base,storage,false,request), {value:packed,fallback:true});
  published = null;
  assert.deepEqual(await C.preferredManifest(base,storage,true,request), {value:regional,fallback:false});
  assert.deepEqual(await C.preferredManifest(base,storage,false,request), {value:regional,fallback:true});
  published = {...packed,carriers:regional.carriers};
  assert.equal(C.validManifest(published),false);
  assert.deepEqual(await C.preferredManifest(base,storage,true,request), {value:regional,fallback:false});
  published = regional; // A misconfigured server must not accept schema 1 at the packed pointer.
  assert.deepEqual(await C.preferredManifest(base,storage,true,request), {value:regional,fallback:false});
});
