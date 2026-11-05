'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parse,eligible,articlePath,hasSharedTarget,savedPlaceKind,MODES}=require('../beta.js');
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
test('published and legacy campsite links and coordinate spot links take priority over entry modes',()=>{
 for(const hash of ['#site=osm%3Away%3A1548179559','#site=usfs%3A5981','#site=old-id&emin=100','#spot=44,-115&emax=2000'])assert.equal(hasSharedTarget(hash),true,hash);
 for(const hash of ['', '#explore','#site=','#site=%xx','#spot=91,-115','#spot=44,-181'])assert.equal(hasSharedTarget(hash),false,hash);
});
test('only campsite snapshots qualify as campsite saves',()=>{
 for(const type of ['established','dispersed','parking','backcountry','other'])assert.equal(savedPlaceKind({properties:{type,camping_classification:'campsite'}}),'campsite',type);
 for(const type of ['service','spot','imported','rest_area',undefined])assert.notEqual(savedPlaceKind({properties:{type}}),'campsite',String(type));
 assert.equal(savedPlaceKind({properties:{type:'other',camping_classification:'unverified_camping_record'}}),'other_stop');
 assert.equal(savedPlaceKind({properties:{type:'spot',rest_area_source_id:'rest:1'}}),'service_or_rest_area');
});
test('saving a service or imported stop neither increments campsite engagement nor unlocks recruitment',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const browser={document:{referrer:'',getElementById:()=>null},location:{search:'',pathname:'/',hash:''},URL,URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},crypto:require('node:crypto'),CustomEvent:class{},addEventListener(){},dispatchEvent(){}};
 browser.window=browser;vm.createContext(browser);vm.runInContext(fs.readFileSync(require.resolve('../beta.js'),'utf8'),browser);
 const beta=browser.KampTrailBeta;beta.search();for(const id of ['one','two'])beta.viewPlace({properties:{id,name:id}});
 for(const type of ['service','spot','imported','rest_area'])beta.saveStop({properties:{type,id:type}});
 assert.equal(beta.status().saves,0);assert.equal(beta.status().install,false);assert.equal(beta.status().tester,false);
 assert.deepEqual(Array.from(beta.events().filter(e=>e.event==='kt_stop_saved'),e=>e.place_kind),['service_or_rest_area','other_stop','other_stop','other_stop']);
 beta.saveStop({properties:{type:'established',id:'camp'}});assert.equal(beta.status().saves,1);assert.equal(beta.status().tester,true);
});
test('an idle return rotates the session before a repeated marker, search or noncampsite save is recorded',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 for(const action of ['view','search','service']){
  let now=2000000000000;const stored=new Map(),browser={document:{referrer:'',getElementById:()=>null},location:{search:'',pathname:'/',hash:''},URL,URLSearchParams,Date:class extends Date{static now(){return now;}},localStorage:{getItem:()=>null,setItem:(k,v)=>stored.set(k,v)},sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},crypto:require('node:crypto'),CustomEvent:class{},addEventListener(){},dispatchEvent(){}};
  browser.window=browser;vm.createContext(browser);vm.runInContext(fs.readFileSync(require.resolve('../beta.js'),'utf8'),browser);
  const beta=browser.KampTrailBeta,site={properties:{id:'same',name:'Same'}};beta.viewPlace(site);const first=beta.events()[0].session_id;now+=31*60*1000;
  if(action==='view')beta.viewPlace(site);else if(action==='search')beta.search();else beta.saveStop({properties:{id:'service:1',type:'service'}});
  const events=beta.events(),returns=events.filter(e=>e.event==='kt_return_session');assert.equal(beta.status().visits,2,action);assert.equal(returns.length,1,action);assert.notEqual(returns[0].session_id,first,action);assert.equal(events.at(-1).session_id,returns[0].session_id,action);assert.equal(stored.get('kt_beta_session'),returns[0].session_id,action);
  if(action==='view')assert.equal(beta.status().views,2);
 }
});
