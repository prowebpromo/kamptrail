'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,eligible,articlePath,MODES}=require('../beta.js');
const dq=require('../data-quality.js');
test('only supported intent modes and explicit nearby actions are accepted',()=>{
 for(const mode of Object.keys(MODES))assert.equal(parse('?mode='+mode).mode,mode);
 for(const value of ['__proto__','constructor','<script>','unknown',''])assert.equal(parse('?mode='+encodeURIComponent(value)).mode,null);
 assert.equal(parse('?mode=dump-stations&near=1&state=TX').near,true);assert.equal(parse('?near=true&state=javascript:').near,false);assert.equal(parse('?state=javascript:').state,null);
});
test('prompts require product use and two return visits means visit three',()=>{
 assert.deepEqual(eligible({searches:0,views:0,saves:0,visits:1}),{install:false,tester:false});
 assert.equal(eligible({searches:2,views:0,saves:0,visits:2}).install,false);
 for(const patch of [{searches:3},{saves:1},{visits:3}])assert.equal(eligible({searches:0,views:0,saves:0,visits:1,...patch}).install,true);
 assert.equal(eligible({searches:1,views:1,saves:1,visits:1}).tester,false);assert.equal(eligible({searches:1,views:2,saves:1,visits:1}).tester,true);
});
test('attribution accepts BoB article paths and strips queries and fragments',()=>{
 assert.equal(articlePath('https://boondockorbust.com/resources/interstate-rest-areas/?email=private#x'),'/resources/interstate-rest-areas/');
 for(const v of ['https://boondockorbust.com.evil.test/path','javascript:alert(1)','https://elsewhere.test/a','https://boondockorbust.com/a%40b'])assert.equal(articlePath(v),'');
});
test('entry filters never promote unknown fees or borrowed publisher evidence',()=>{
 const f=p=>({type:'Feature',geometry:{type:'Point',coordinates:[-100,40]},properties:{id:'own',type:'parking',...p}});
 const rows=[f({fee_status:'free',source:'Bureau of Land Management'}),f({fee_status:'unknown',source:'OSM',sources:['Bureau of Land Management']}),f({fee_status:'conditional',source:'OSM'})];
 assert.equal(dq.applyFilters(rows,{cost:'free'}).length,1);assert.equal(dq.applyFilters(rows,{catalogueSource:'blm'}).length,1);assert.equal(dq.applyFilters(rows,{entryLayer:'dump-stations'}).length,0);assert.equal(dq.applyFilters(rows,{type:'parking'}).length,3);
});
