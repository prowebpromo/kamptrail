const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const D=require('../community-discovery.js');
const group=(values,date='2026-10-01')=>({values,count:1,latest_visit:date});
const summary={rating_count:2,rating_sum:8,latest_visit:'2026-10-01',observations:[group({noise:'quiet',signals:[{carrier:'att',signal:'none',environment:'outdoors'}]}),group({noise:'noisy',signals:[{carrier:'verizon',signal:'strong',environment:'inside_rv'}]})]};
test('community discovery requires the same visit and carrier; unknown reports never pass',()=>{
 const now=Date.parse('2026-10-29T12:00:00Z');
 assert.equal(D.matchesSummary(summary,{minRating:4},now),true);
 assert.equal(D.matchesSummary(summary,{minRating:4,minReviews:3},now),false);
 assert.equal(D.matchesSummary(summary,{minReviews:3},now),false);
 assert.equal(D.matchesSummary(null,{minRating:4},now),false);
 assert.equal(D.matchesSummary(summary,{observed_noise:'quiet',observed_carrier:'verizon',observed_signal:'strong'},now),false);
 assert.equal(D.matchesSummary(summary,{observed_noise:'noisy',observed_carrier:'verizon',observed_signal:'strong'},now),true);
 assert.equal(D.matchesSummary(summary,{observed_carrier:'att',observed_signal:'strong'},now),false);
 assert.equal(D.matchesSummary(summary,{observed_shade:'full'},now),false);
 assert.equal(D.matchesSummary({...summary,rating_sum:7},{minRating:4},now),false);
 assert.equal(D.matchesSummary({...summary,observations:[group({noise:'quiet'},'2024-01-01')]},{observed_noise:'quiet',observedDays:365},now),false);
 assert.equal(D.matchesSummary({...summary,observations:[group({noise:'quiet'},'2024-01-01')]},{observed_noise:'quiet',observedDays:0},now),true);
 assert.equal(D.validSites({'x':summary}),true);assert.equal(D.validSites({'x':{...summary,rating_sum:99}}),false);
 assert.equal(D.validSites({'x':{...summary,observations:[group({noise:'constructor'})]}}),false);
});
function runtime(fetcher){
 const stores=new Map(),events={};
 const c={URL,Response,AbortController,Date,Map,Set,JSON,Object,Number,Error,setTimeout,clearTimeout,navigator:{onLine:true},location:{href:'https://example.test/kamptrail/'},CustomEvent:class{constructor(type){this.type=type;}},addEventListener:(k,fn)=>events[k]=fn,dispatchEvent:()=>{},fetch:fetcher};
 c.caches={async open(n){if(!stores.has(n))stores.set(n,new Map());const s=stores.get(n);return{async put(k,v){s.set(k,v.clone());},async match(k){return s.get(k)?.clone();}};},async delete(n){return stores.delete(n);}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('community-discovery.js','utf8'),c);return{c,D:c.KampTrailDiscovery,events};
}
const page=(sites,next=null,revision='1',checked=new Date().toISOString())=>new Response(JSON.stringify({ok:true,version:1,revision,checked_at:checked,sites,next_after:next}));
test('a multi-page revision mismatch never publishes or caches a partial discovery snapshot',async()=>{
 let i=0;const e=runtime(async()=>++i===1?page({a:summary},'a'):page({b:summary},null,'2'));
 await e.D.load();assert.equal(e.D.summary('a'),null);assert.match(e.D.status(),/could not refresh/);
});
test('published aggregates work offline with a dated label; author changes invalidate the snapshot',async()=>{
 const e=runtime(async()=>page({a:summary}));await e.D.load();assert.equal(e.D.matches({id:'a'},{minRating:4}),true);
 e.c.navigator.onLine=false;await e.D.load(true);assert.match(e.D.status(),/Saved camper evidence/);assert.equal(e.D.matches({id:'a'},{minRating:4}),true);
 await e.events['kamptrail:communitychanged']();await new Promise(r=>setTimeout(r,0));assert.equal(e.D.summary('a'),null);
});
test('expired offline evidence and prototype-like fields do not turn unknowns into matches',async()=>{
 const e=runtime(async()=>page({a:summary},null,'1','2020-01-01T00:00:00Z'));await e.D.load();e.c.navigator.onLine=false;await e.D.load(true);assert.equal(e.D.matches('a',{minRating:4}),false);
});
test('map and route discovery use the same published rating and same-visit evidence',async()=>{
 const e=runtime(async()=>page({a:summary}));await e.D.load();
 const previous=global.KampTrailDiscovery;global.KampTrailDiscovery=e.D;
 try{
  const Q=require('../data-quality.js');require('../routes.js');const R=global.KampTrailRoutes;
  const f={minRating:4,observed_noise:'noisy',observed_carrier:'verizon',observed_signal:'strong'};
  const row={id:'a',name:'Evidence Creek',lat:40,lng:-104.5,m:{f:'free',a:[],r:[]}};
  const route={geometry:{type:'LineString',coordinates:[[-105,40],[-104,40]]},leg_ends:[1]};
  assert.equal(Q.applyFilters([R.indexFeature(row)],f).length,1);assert.equal(R.find([row],route,5,f).length,1);
  f.observed_noise='quiet';assert.equal(Q.applyFilters([R.indexFeature(row)],f).length,0);assert.equal(R.find([row],route,5,f).length,0);
 }finally{global.KampTrailDiscovery=previous;}
});
test('aggregate cache rejects extra private fields and malformed signal entries',()=>{
 assert.equal(D.validSites({a:{...summary,body:'private prose'}}),false);
 assert.equal(D.validSites({a:{...summary,observations:[{...summary.observations[0],body:'private prose'}]}}),false);
 assert.equal(D.validSites({a:{...summary,observations:[group({signals:[null]})]}}),false);
 assert.equal(D.validSites({a:{...summary,observations:[group({signals:[{carrier:'att',signal:'usable',environment:'outdoors',private_code:'secret'}]})]}}),false);
});
test('an author change removes the disk snapshot even while a refresh is still pending',async()=>{
 let release,fetching=0;const e=runtime(async()=>{fetching++;if(fetching===1)return page({a:summary});return new Promise(r=>release=()=>r(page({a:summary})));});
 await e.D.load();const pending=e.D.load(true);await new Promise(r=>setTimeout(r,0));e.c.navigator.onLine=false;const changed=e.events['kamptrail:communitychanged']();await new Promise(r=>setTimeout(r,0));
 const cache=await e.c.caches.open('kamptrail:https://example.test/kamptrail/:camper-discovery-v1');assert.equal(await cache.match('https://example.test/kamptrail/__published_camper_discovery__'),undefined);
 release();await pending;await changed;await new Promise(r=>setTimeout(r,0));assert.equal(e.D.summary('a'),null);
});
test('legacy campsite identifiers preserve the same rating match in map and rebuilt route index',async()=>{
 const e=runtime(async()=>page({old:summary}));await e.D.load();const prev=global.KampTrailDiscovery;global.KampTrailDiscovery=e.D;
 try{const Q=require('../data-quality.js');require('../routes.js');const R=global.KampTrailRoutes;const row={id:'canonical',legacy_ids:['old'],name:'Evidence Creek',lat:40,lng:-104.5,m:{f:'free',a:[],r:[]}},f={minRating:4};assert.equal(Q.applyFilters([R.indexFeature(row)],f).length,1);assert.equal(R.find([row],{geometry:{coordinates:[[-105,40],[-104,40]]},leg_ends:[1]},5,f).length,1);}finally{global.KampTrailDiscovery=prev;}
});
test('matching evidence counts include only qualifying report dates',async()=>{
 const today=new Date().toISOString().slice(0,10),e=runtime(async()=>page({a:{...summary,rating_count:101,rating_sum:404,observations:[{values:{noise:'quiet'},count:100,latest_visit:'2020-01-01'},{values:{noise:'quiet'},count:1,latest_visit:today}]}}));await e.D.load();assert.match(e.D.matchNote('a',{observed_noise:'quiet',observedDays:90}),/1 published report ·/);assert.match(e.D.matchNote('a',{observed_noise:'quiet',observedDays:0}),/101 published reports/);
});
