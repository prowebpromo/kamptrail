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
 assert.equal(D.matchesSummary(summary,{observed_carrier:'verizon',observed_signal:'usable'},now),true);
 assert.equal(D.matchesSummary(summary,{observed_carrier:'verizon',observed_signal:'none'},now),false);
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
test('offline failure without CacheStorage can retry successfully after reconnecting',async()=>{
 let calls=0;const e=runtime(async()=>{calls++;return page({a:summary});});e.c.caches=undefined;e.c.navigator.onLine=false;await e.D.load();e.c.navigator.onLine=true;await e.D.load(true);assert.equal(calls,1);assert.equal(e.D.matches('a',{minRating:4}),true);
});

test('numeric seasonal scores require explicit entries and three matching dated visit ratings',()=>{
 const now=Date.parse('2026-10-29T12:00:00Z'),scored=(scores,date='2026-10-01',count=1,other={})=>({...group({...other,scores},date),count});
 const s={rating_count:20,rating_sum:80,latest_visit:'2026-10-01',observations:[scored({quietness:5,shade:1},'2020-10-01'),scored({quietness:4,shade:5},'2026-10-01',2),scored({quietness:1},'2026-06-01',5),group({noise:'quiet',shade:'full',comfort:'comfortable'})]};
 assert.equal(D.active({minScore_quietness:4}),true);assert.equal(D.active({scoreSeason:'fall'}),true);
 assert.equal(D.matchesSummary(null,{minScore_quietness:4},now),false);
 assert.equal(D.matchesSummary(summary,{minScore_quietness:4},now),false,'qualitative observations and overall stars do not create scores');
 assert.equal(D.matchesSummary(s,{scoreSeason:'fall',minScore_quietness:4,observedDays:0},now),true);
 assert.equal(D.matchesSummary(s,{scoreSeason:'fall',minScore_quietness:4,observedDays:365},now),false,'only two recent ratings');
 assert.equal(D.matchesSummary(s,{scoreSeason:'summer',minScore_quietness:4,observedDays:0},now),false);
 assert.equal(D.matchesSummary(s,{scoreSeason:'spring',minScore_quietness:1,observedDays:0},now),false);
 assert.equal(D.matchesSummary(s,{scoreSeason:'fall',minScore_comfort:1,observedDays:0},now),false);
 assert.equal(D.matchesSummary(s,{scoreSeason:'fall'},now),true);assert.equal(D.matchesSummary(s,{scoreSeason:'constructor'},now),false);
 assert.equal(D.matchesSummary(s,{scoreSeason:'fall',minScore_quietness:4,minScore_shade:4,observedDays:0},now),false,'shade average is 11/3, below 4');
 const seasons=D.seasonalScores(s.observations);assert.deepEqual(seasons.fall.quietness,{count:3,sum:13,first_visit:'2020-10-01',latest_visit:'2026-10-01'});assert.equal(seasons.fall.comfort,undefined);
 assert.match(D.seasonalText(seasons),/Fall \(Sep–Nov\) · Quietness: 4.3\/5 · 3 explicit ratings · visits 2020-10-01 to 2026-10-01/);
 assert.match(D.seasonalText(D.seasonalScores([scored({quietness:5})])),/insufficient evidence · 1 explicit rating/);
 assert.match(D.seasonalText({}),/Unreported stays unknown/);
 assert.deepEqual(['2025-12-21','2026-01-01','2026-02-28','2026-03-01','2026-05-31','2026-06-01','2026-08-31','2026-09-01','2026-11-30'].map(D.season),['winter','winter','winter','spring','spring','summer','summer','fall','fall']);
});
test('numeric selections use the same visit cohort as qualitative/carrier filters and all chosen score axes',()=>{
 const scored=(scores,other={})=>({...group({...other,scores}),count:3});
 let s={...summary,rating_count:6,rating_sum:24,observations:[scored({quietness:5},{noise:'quiet'}),scored({comfort:5},{noise:'noisy',signals:[{carrier:'verizon',signal:'strong',environment:'outdoors'}]})]};
 assert.equal(D.matchesSummary(s,{minScore_quietness:4,minScore_comfort:4}),false,'separate visits cannot supply combined numeric selections');
 assert.equal(D.matchesSummary(s,{minScore_quietness:4,observed_noise:'noisy'}),false);
 assert.equal(D.matchesSummary(s,{minScore_quietness:4,observed_carrier:'verizon',observed_signal:'strong'}),false);
 s={...s,observations:[scored({quietness:5,comfort:4},{noise:'quiet',signals:[{carrier:'verizon',signal:'strong',environment:'outdoors'}]})]};
 assert.equal(D.matchesSummary(s,{minScore_quietness:4,minScore_comfort:4,observed_noise:'quiet',observed_carrier:'verizon',observed_signal:'usable'}),true);
 assert.deepEqual(D.scoreEvidence(s,{minScore_quietness:4}).quietness,{count:3,sum:15,first_visit:'2026-10-01',latest_visit:'2026-10-01'});
});
test('numeric discovery rejects malformed, private, fractional and string scores',()=>{
 for(const scores of [null,[],{quietness:0},{quietness:6},{quietness:4.5},{quietness:'4'},{clearance:5},{comfort:true},{quietness:4,private_code:'secret'}])assert.equal(D.validSites({a:{...summary,observations:[group({scores})]}}),false,JSON.stringify(scores));
 assert.equal(D.validSites({a:{...summary,observations:[group({scores:{quietness:4,shade:2,comfort:1}})]}}),true);
 assert.equal(D.scoreFilterCount({}),0);assert.equal(D.scoreFilterCount({minScore_quietness:4,scoreSeason:'winter'}),2);assert.equal(D.scoreFilterCount({minScore_comfort:0,scoreSeason:''}),0);
});
test('published numeric season filters share map/route predicates and cached evidence expires',async()=>{
 const today=new Date().toISOString().slice(0,10),s={rating_count:3,rating_sum:12,latest_visit:today,observations:[{values:{scores:{quietness:4}},count:3,latest_visit:today}]},e=runtime(async()=>page({a:s}));await e.D.load();
 const previous=global.KampTrailDiscovery;global.KampTrailDiscovery=e.D;
 try{const Q=require('../data-quality.js');require('../routes.js');const R=global.KampTrailRoutes,row={id:'a',name:'Numeric evidence fixture',lat:40,lng:-104.5,m:{f:'free',a:[],r:[]}},route={geometry:{type:'LineString',coordinates:[[-105,40],[-104,40]]},leg_ends:[1]},f={minScore_quietness:4,scoreSeason:D.season(today),observedDays:365};
 assert.equal(Q.applyFilters([R.indexFeature(row)],f).length,1);assert.equal(R.find([row],route,5,f).length,1);f.minScore_quietness=5;assert.equal(Q.applyFilters([R.indexFeature(row)],f).length,0);assert.equal(R.find([row],route,5,f).length,0);
 e.c.navigator.onLine=false;await e.D.load(true);assert.match(e.D.status(),/Saved camper evidence/);assert.equal(e.D.matches('a',{minScore_quietness:4}),true);await e.events['kamptrail:communitychanged']();await new Promise(r=>setTimeout(r,0));assert.equal(e.D.matches('a',{minScore_quietness:4}),false);
 }finally{global.KampTrailDiscovery=previous;}
});

test('score forms retain explicit saved numbers and never derive them from qualitative values',()=>{
 const e=runtime(async()=>page({}));e.c.FormData=class{constructor(values){this.values=values;}get(k){return this.values[k]??null;}};
 const read=x=>JSON.parse(JSON.stringify(e.D.formValues(x)));
 assert.deepEqual(read({observed_noise:'quiet',observed_shade:'full',observed_comfort:'comfortable'}),{noise:'quiet',shade:'full',comfort:'comfortable'});
 assert.deepEqual(read({score_quietness:'4',score_shade:'',score_comfort:'1'}),{scores:{quietness:4,comfort:1}});
 assert.deepEqual(read({}),{});
 const el=(tag,attrs={},text)=>({tag,attrs,text,children:[],append(...nodes){this.children.push(...nodes);}}),form=el('form'),field=(label,input,hint)=>({label,input,hint});
 e.D.observeFields(form,{observations:{noise:'quiet',scores:{quietness:4,comfort:1}}},el,field);
 const fields=form.children[1].children.filter(x=>x.input);assert.equal(fields.length,3);
 assert.equal(fields[0].input.attrs.name,'score_quietness');assert.equal(fields[0].input.children.find(x=>x.attrs.selected).attrs.value,'4');assert.equal(fields[1].input.children.filter(x=>x.attrs.selected).length,0);assert.equal(fields[2].input.children.find(x=>x.attrs.selected).attrs.value,'1');assert.match(fields[0].hint,/Very noisy \(1\) to very quiet \(5\)/);
});
test('seasonal cache validation rejects invalid calendar dates and inflated observation counts',()=>{
 for(const date of ['2026-02-30','2026-00-01','2026-13-01'])assert.equal(D.validSites({a:{...summary,observations:[group({scores:{quietness:5}},date)]}}),false);
 assert.equal(D.validSites({a:{...summary,observations:[{...group({scores:{quietness:5}}),count:3}]}}),false);
});

test('place review detail renders whole-site seasonal coverage and distinguishes unavailable from empty',async()=>{
 class Element{
  constructor(tag){this.tag=tag;this.attrs={};this.children=[];this._text='';this.dataset={};}
  setAttribute(k,v){this.attrs[k]=String(v);}append(...items){this.children.push(...items);}addEventListener(){}showModal(){this.open=true;}
  replaceChildren(...items){this._text='';this.children=items;}set textContent(x){this._text=String(x);this.children=[];}get textContent(){return this._text+this.children.map(x=>typeof x==='string'?x:x.textContent).join(' ');}
  querySelector(selector){for(const x of this.children){if((selector.startsWith('.')?x.attrs?.class?.split(' ').includes(selector.slice(1)):x.tag===selector))return x;const found=x.querySelector?.(selector);if(found)return found;}return null;}
 }
 async function render(overrides){const document={body:new Element('body'),activeElement:new Element('button'),createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},window={KampTrailDiscovery:D};const out={ok:true,count:0,average:null,reviews:[],next_before:null,scores_available:true,seasonal_scores:{},...overrides};vm.runInNewContext(fs.readFileSync('community.js','utf8'),{window,document,location:{hostname:'example.test'},navigator:{onLine:true},fetch:async()=>({ok:true,json:async()=>out}),Date});await window.KampTrailCommunity.open({properties:{id:'qa:seasonal',name:'Seasonal fixture'}});return document.body.textContent;}
 const scored=await render({seasonal_scores:{fall:{quietness:{count:3,sum:12,first_visit:'2020-09-01',latest_visit:'2026-10-01'},comfort:{count:1,sum:5,first_visit:'2026-10-01',latest_visit:'2026-10-01'}}}});
 assert.match(scored,/Quietness: 4.0\/5 · 3 explicit ratings · visits 2020-09-01 to 2026-10-01/);assert.match(scored,/Personal comfort: insufficient evidence · 1 explicit rating/);assert.match(scored,/Counts are ratings, not distinct campers/);
 assert.match(await render({}),/No published numeric sub-ratings yet. Unreported stays unknown/);
 const unavailable=await render({scores_available:false});assert.match(unavailable,/Seasonal sub-ratings are unavailable/);assert.doesNotMatch(unavailable,/No published numeric sub-ratings yet/);
});

test('maximum approach difficulty ranks easy < moderate < difficult; unknown and missing never match',()=>{
 const now=Date.parse('2026-10-29T12:00:00Z');
 const s=(...values)=>({rating_count:values.length,rating_sum:4*values.length,latest_visit:'2026-10-01',observations:values.map(v=>group(v))});
 const easy=s({access:'easy'}),moderate=s({access:'moderate'}),difficult=s({access:'difficult'}),missing=s({noise:'quiet'}),unknown=s({access:'unknown'});
 const m=(site,max)=>D.matchesSummary(site,{observed_access:max},now);
 assert.equal(m(easy,'difficult'),true);assert.equal(m(moderate,'difficult'),true);assert.equal(m(difficult,'difficult'),true);
 assert.equal(m(easy,'moderate'),true);assert.equal(m(moderate,'moderate'),true);assert.equal(m(difficult,'moderate'),false);
 assert.equal(m(easy,'easy'),true);assert.equal(m(moderate,'easy'),false);assert.equal(m(difficult,'easy'),false);
 for(const max of ['easy','moderate','difficult']){assert.equal(m(missing,max),false,'missing access never matches');assert.equal(m(unknown,max),false,'unrecognised access never matches');}
 assert.equal(m(easy,'extreme'),false,'an unrecognised maximum matches nothing');
 assert.equal(D.matchesSummary(missing,{observed_access:''},now),true,'Any does not filter');
 assert.deepEqual(Object.keys(D.ACCESS_FILTER),['easy','moderate','difficult'],'stored filter values are unchanged');
 assert.equal(m(s({access:'easy',noise:'noisy'},{access:'moderate',noise:'quiet'}),'moderate'),true);
 assert.equal(D.matchesSummary(s({access:'moderate',noise:'noisy'}),{observed_access:'difficult',observed_noise:'quiet'},now),false,'conditions still need the same visit');
});

test('radio technology is optional, validated, described and filterable on the same signal row',()=>{
 const now=Date.parse('2026-10-29T12:00:00Z');
 const sig=(radio)=>({carrier:'verizon',signal:'usable',environment:'outdoors',...(radio?{radio}:{})});
 const mk=(...rows)=>({rating_count:1,rating_sum:4,latest_visit:'2026-10-01',observations:[group({signals:rows})]});
 assert.equal(D.validSites({a:mk(sig('lte'))}),true);assert.equal(D.validSites({a:mk(sig('5g'))}),true);assert.equal(D.validSites({a:mk(sig())}),true,'old reports stay valid');
 assert.equal(D.validSites({a:mk(sig('6g'))}),false);assert.equal(D.validSites({a:mk({...sig('lte'),extra:1})}),false);
 assert.equal(D.matchesSummary(mk(sig('lte')),{observed_carrier:'verizon',observed_radio:'lte'},now),true);
 assert.equal(D.matchesSummary(mk(sig('lte')),{observed_radio:'5g'},now),false);
 assert.equal(D.matchesSummary(mk(sig()),{observed_radio:'lte'},now),false,'reports without technology never match a technology filter');
 assert.equal(D.matchesSummary(mk(sig()),{observed_carrier:'verizon',observed_signal:'usable'},now),true);
 assert.match(D.describe({signals:[sig('5g')]}),/Verizon: Usable \(Outdoors\) · 5G/);
 assert.doesNotMatch(D.describe({signals:[sig()]}),/LTE|5G/);assert.doesNotMatch(D.describe({signals:[sig('unspecified')]}),/LTE|5G/);
 assert.equal(D.active({observed_radio:'lte'}),true);
});

test('form values include radio only when the visitor named a technology',()=>{
 const data=new Map([['signal_att','weak'],['environment_att','outdoors'],['radio_att','lte'],['signal_verizon','usable'],['environment_verizon','outdoors'],['radio_verizon','unspecified']]);
 const prev=global.FormData;global.FormData=function(){return {get:k=>data.get(k)??null};};
 try{assert.deepEqual(D.formValues({}).signals,[{carrier:'att',signal:'weak',environment:'outdoors',radio:'lte'},{carrier:'verizon',signal:'usable',environment:'outdoors'}]);}finally{global.FormData=prev;}
});
