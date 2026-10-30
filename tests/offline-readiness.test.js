'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../offline-maps.js');
const href='https://example.test/app/',prefix=`kamptrail:${href}:`;
const bounds={getSouth:()=>40,getNorth:()=>40.001,getWest:()=>-105,getEast:()=>-104.999};
function env(files={},saved={}){
 const opened=[];
 return {href,controlled:true,opened,storage:{getItem:k=>saved[k]??null},caches:{keys:async()=>Object.keys(files),open:async name=>{opened.push(name);assert.ok(Object.hasOwn(files,name),'inventory must not create missing caches');return{keys:async()=>files[name].map(url=>({url}))};}}};
}
test('fresh device does not create caches or claim saved data from app startup',async()=>{
 const e=env(),r=await O.readiness(e);assert.equal(r.available,true);assert.equal(r.tiles,0);assert.equal(r.search,false);assert.equal(r.stops,0);assert.deepEqual(r.states,[]);assert.deepEqual(e.opened,[]);
});
test('actual scoped cache entries override stale area logs and expose evicted tile gaps',async()=>{
 const urls=O.plan(bounds,15).urls,log={s:40,n:40.001,w:-105,e:-104.999,zmin:15,zmax:16,saved:urls.length,at:'2026-10-30'};
 const e=env({[prefix+'tiles-v1']:urls.slice(1),[prefix+'data-v1']:[href+'data/campsites/CO_merged.geojson',href+'data/campsites/agency/CO.geojson',href+'data/campsites/search-index.json','https://other.test/app/data/campsites/NY_merged.geojson'], 'kamptrail:https://other.test/:data-v1':['https://other.test/data/campsites/TX_merged.geojson']},{kt_offline_areas_v1:JSON.stringify([log])});
 const r=await O.readiness(e);assert.equal(r.maps.length,1);assert.equal(r.maps[0].expected,urls.length);assert.equal(r.maps[0].present,urls.length-1);assert.equal(r.search,true);assert.deepEqual(r.states,['CO']);assert.deepEqual(r.agencyStates,['CO']);assert.equal(e.opened.some(s=>s.includes('other.test')),false);assert.match(O.readinessLines(r).join(' '),/cache dates are unknown/);
});
test('legacy stop IDs and complete saved snapshots are separate, never claiming all stops have locations',async()=>{
 const point={geometry:{type:'Point',coordinates:[-105,40]},properties:{id:'known'}};
 const e=env({}, {kt_trip:JSON.stringify(['legacy',{id:'known',feature:point},{id:'broken',feature:{...point,geometry:{type:'Point',coordinates:[Infinity,40]}}},null])});
 const r=await O.readiness(e);assert.equal(r.stops,3);assert.equal(r.stopSnapshots,1);assert.match(O.readinessLines(r).join(' '),/3 records, 1 with location snapshots/);
});
test('blocked storage and corrupt logs stay unknown without preventing the cache check',async()=>{
 const e=env();e.storage={getItem(){throw Error('denied');}};const r=await O.readiness(e);assert.equal(r.available,true);assert.equal(r.stops,null);assert.deepEqual(r.maps,[]);
 e.caches={keys(){throw Error('blocked');}};const failed=await O.readiness(e);assert.equal(failed.available,false);assert.match(O.readinessLines(failed)[0],/could not be checked/);
});
test('metadata alone cannot assert tiles remain, and malformed oversized logs are ignored',async()=>{
 const r=await O.readiness(env({}, {kt_offline_areas_v1:JSON.stringify([{s:40,n:40.001,w:-105,e:-104.999,zmin:15,zmax:16,saved:20,at:'2026-10-30'},{s:-85,n:85,w:-180,e:179,zmin:8,zmax:12,saved:100}])}));
 assert.equal(r.tiles,0);assert.equal(r.maps.length,1);assert.equal(r.maps[0].present,0);
});
