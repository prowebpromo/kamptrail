'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Services=require('../services.js');
const context={KampTrailServices:Services,DataQuality:{applyFilters(){throw new Error('Campsite filters must never process a service');}},URL,Set,Map,Math,Number,Date,Array,AbortController,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('routes.js','utf8'),context);const Routes=context.KampTrailRoutes;
const route={distance:200000,duration:7200,calculated_at:'2026-10-28T12:00:00Z',geometry:{type:'LineString',coordinates:[[-105,40],[-105,41],[-104,41]]},legs:[{distance:100000,duration:3600},{distance:100000,duration:3600}],leg_ends:[1,2]};
const row=(id,coordinates,categories,tags={})=>({id,osm_type:id.split(':')[1],osm_id:id.split(':')[2],osm_version:1,edited_at:null,coordinates,name:id,categories,tags,states:['CO'],source_region:'legacy'});
test('route service ordering uses shared categories/access and saves original OSM identity as a service',()=>{
 const items=[row('osm:node:2',[-104.5,41.01],['fuel','lpg']),row('osm:node:1',[-105.01,40.5],['water']),row('osm:way:1',[-105.01,40.51],['water'],{access:'private'}),row('osm:relation:1',[-105.01,40.52],['water'],{access:'customers'})];
 const found=Routes.serviceOrder(items,route,5,['water']);assert.deepEqual(Array.from(found,x=>x.item.id),['osm:node:1','osm:relation:1']);assert.ok(found.every(x=>x.feature.properties.type==='service'));assert.equal(found[0].feature.properties.id,'osm:node:1');assert.deepEqual(found[0].feature.properties.service_categories,['water']);
 assert.deepEqual(Array.from(Routes.serviceOrder(items,route,5,['water'],true),x=>x.item.id),['osm:node:1','osm:way:1','osm:relation:1']);
 const all=Routes.serviceOrder(items,route,5,Object.keys(Services.categories),false,['osm:node:1']);assert.deepEqual(Array.from(all,x=>[x.item.id,x.leg]),[['osm:relation:1',0],['osm:node:2',1]]);
});
test('already exact-filtered service matches are not lost to simplified route ordering or campsite predicates',()=>{
 const item=row('osm:node:3',[-105.08,40.5],['fuel']);const found=Routes.serviceOrder([item],route,1,['fuel']);assert.equal(found.length,1);assert.equal(found[0].leg,0);assert.ok(found[0].distance>1); // Ordering must not invent a second discovery predicate.
});
test('service leg ordering handles the dateline with exact node/way identities kept separate',()=>{
 const r={...route,geometry:{type:'LineString',coordinates:[[179.5,51],[-179.5,51]]},legs:[route.legs[0]],leg_ends:[1]};const found=Routes.serviceOrder([row('osm:way:7',[-179.8,51.01],['laundry']),row('osm:node:7',[179.8,51.01],['laundry'])],r,5,['laundry']);assert.deepEqual(Array.from(found,x=>x.item.id),['osm:node:7','osm:way:7']);assert.ok(found.every(x=>x.distance<1));
});
