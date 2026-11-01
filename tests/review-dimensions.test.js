'use strict';
// R5 review dimensions through the real PHP endpoints and an isolated database (tests/helpers/php-harness.js).
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const{execFileSync,spawnSync}=require('node:child_process');
const H=require('./helpers/php-harness.js');
const D=require('../community-discovery.js');
const NEW=['crowds','fullness','noise_day','noise_night','cleanliness'];
const site='usfs:r5-dimensions';
const base={action:'submit',campsite_id:site,campsite_name:'R5 dimensions fixture',display_name:'Harness camper',rating:'4',body:'Firsthand harness visit report for the review dimensions.',visited_on:'2026-07-10',rig:'',firsthand:'1',elapsed_ms:'8000'};
const obs=(o,extra={})=>({...base,...extra,observations:JSON.stringify(o)});

test('new score axes are optional, validated, moderated, published, edited and removed through the API',{skip:!H.capable},async()=>{
 const e=await H.start({port:18931});try{
  const view=()=>e.get('/api/community.php?site='+encodeURIComponent(site));
  for(const bad of [{crowds:0},{fullness:6},{noise_day:2.5},{noise_night:'3'},{cleanliness:true},{crowding:3},{noise:4}]){
   assert.equal((await e.post(obs({scores:bad}))).status,422,JSON.stringify(bad));
  }
  assert.equal((await e.post(obs({scores:{crowds:2},season:'monsoon'}))).status,422,'unknown season');
  // Each new dimension alone is a valid, complete submission.
  const ids={};
  for(const axis of NEW){
   const r=await e.post(obs({scores:{[axis]:axis==='crowds'?2:4}}));assert.equal(r.status,201,axis);ids[axis]=await r.json();
   assert.deepEqual((await e.own(ids[axis].token)).observations,{scores:{[axis]:axis==='crowds'?2:4}},axis+' stored alone');
  }
  e.resetQuota();
  // Pending reviews are invisible everywhere.
  let v=await view();assert.deepEqual(v.site_scores,{});assert.deepEqual(v.seasonal_scores,{});assert.deepEqual((await e.get('/api/community-discovery.php')).sites,{});
  // The moderation queue shows each new axis with the review it belongs to.
  const queue=await e.moderationQueue(Math.max(...NEW.map(a=>ids[a].id)));for(const axis of NEW)assert.match(queue,new RegExp('&quot;'+axis+'&quot;|"'+axis+'"'),axis+' in queue');
  for(const axis of NEW)await e.publish(ids[axis].id);
  v=await view();
  for(const axis of NEW){assert.equal(v.site_scores[axis].count,1,axis);assert.equal(v.site_scores[axis].average,null,axis+': one rating never publishes an average');}
  assert.equal(v.site_scores.quietness,undefined,'untouched axis stays unknown, not zero');
  assert.equal(v.seasonal_scores.summer.crowds.count,1,'stored for the seasonal package');
  const disc=await e.get('/api/community-discovery.php');assert.equal(D.validSites(disc.sites),true,'client accepts the new axes');
  assert.deepEqual(disc.sites[site].observations.map(g=>Object.keys(g.values.scores)[0]).sort(),[...NEW].sort());
  // Author edit returns to pending and drops out of every aggregate until re-approved.
  assert.equal((await e.post(obs({scores:{crowds:5,noise_night:1}},{action:'edit'}),ids.crowds.token)).status,200);
  v=await view();assert.equal(v.site_scores.crowds,undefined,'edited review is pending');assert.equal(v.site_scores.noise_night.count,1);
  await e.publish(ids.crowds.id);v=await view();assert.equal(v.site_scores.crowds.count,1);assert.equal(v.site_scores.noise_night.count,2);
  // Hide and reject remove it, restore brings it back.
  for(const status of ['hidden','rejected','published']){await e.admin({do:'community_review',review_id:ids.crowds.id,status});v=await view();assert.equal(v.site_scores.crowds?.count,status==='published'?1:undefined,status);}
  // Legacy clients that omit observations keep the stored scores.
  assert.equal((await e.post({...base,action:'edit'},ids.fullness.token)).status,200);assert.deepEqual((await e.own(ids.fullness.token)).observations.scores,{fullness:4});
  // Clearing a score removes it; deleting removes the review and its observations.
  assert.equal((await e.post(obs({},{action:'edit'}),ids.cleanliness.token)).status,200);assert.deepEqual((await e.own(ids.cleanliness.token)).observations,[]);
  await e.publish(ids.cleanliness.id);await e.publish(ids.fullness.id);v=await view();assert.equal(v.site_scores.cleanliness,undefined);
  assert.equal((await e.post({action:'delete'},ids.noise_day.token)).status,200);v=await view();assert.equal(v.site_scores.noise_day,undefined);assert.deepEqual((await e.own(ids.noise_day.token)).observations,[]);
 }finally{e.close();}
});

test('a published average needs 3 qualifying ratings: 2 shows only a count, 3 shows the average',{skip:!H.capable},async()=>{
 const e=await H.start({port:18932});try{
  const view=()=>e.get('/api/community.php?site='+encodeURIComponent(site));const made=[];
  for(const [crowds,fullness] of [[2,5],[4,4]]){const r=await(await e.post(obs({scores:{crowds,fullness}}))).json();made.push(r);await e.publish(r.id);}
  // Unknowns: a review that did not rate crowds or fullness is not a qualifying rating.
  const other=await(await e.post(obs({scores:{cleanliness:5},noise:'noisy'}))).json();await e.publish(other.id);
  let v=await view();
  assert.deepEqual(v.site_scores.crowds,{count:2,average:null,first_visit:'2026-07-10',latest_visit:'2026-07-10'});assert.equal(v.site_scores.fullness.average,null);
  assert.match(D.siteScoresText(v.site_scores),/Crowds \(how crowded it felt\): insufficient evidence · 2 explicit ratings · 1 = not crowded, 5 = very crowded/);
  const third=await(await e.post(obs({scores:{crowds:3,fullness:5}},{visited_on:'2026-08-31'}))).json();await e.publish(third.id);
  v=await view();
  assert.deepEqual(v.site_scores.crowds,{count:3,average:3,first_visit:'2026-07-10',latest_visit:'2026-08-31'});assert.equal(v.site_scores.fullness.average,4.7);assert.equal(v.site_scores.cleanliness.count,1);
  assert.match(D.siteScoresText(v.site_scores),/Crowds \(how crowded it felt\): 3\.0\/5 · 3 explicit ratings/);assert.match(D.siteScoresText(v.site_scores),/Fullness \(camping spaces occupied\): 4\.7\/5 · 3 explicit ratings · 1 = nearly empty, 5 = completely full/);
  // The client refuses to show an average a server sends below the minimum.
  assert.doesNotMatch(D.siteScoresText({crowds:{count:2,average:4,first_visit:null,latest_visit:null}}),/4\.0/);
  // Hiding one drops back below the threshold.
  await e.admin({do:'community_review',review_id:third.id,status:'hidden'});v=await view();assert.equal(v.site_scores.crowds.count,2);assert.equal(v.site_scores.crowds.average,null);
 }finally{e.close();}
});

test('season comes from the visit date, a boundary stay can pick the adjacent season, and no date gives no season',{skip:!H.capable},async()=>{
 const e=await H.start({port:18933});try{
  const view=()=>e.get('/api/community.php?site='+encodeURIComponent(site));
  // 2026-03-01 is spring. Winter (the stay began in February) and summer are adjacent; fall is not.
  assert.equal((await e.post(obs({scores:{crowds:4},season:'fall'},{visited_on:'2026-03-01'}))).status,422,'non-adjacent season rejected');
  assert.equal((await e.post(obs({season:'winter'},{visited_on:'2026-03-01'}))).status,201,'season without scores is accepted and ignored');
  const boundary=await(await e.post(obs({scores:{crowds:4,noise_night:5},season:'winter'},{visited_on:'2026-03-01'}))).json();
  assert.equal((await e.own(boundary.token)).observations.season,'winter');
  const confirmed=await(await e.post(obs({scores:{crowds:2},season:'spring'},{visited_on:'2026-03-02'}))).json();
  assert.equal((await e.own(confirmed.token)).observations.season,undefined,'the visit-date season is implied, not stored');
  const plain=await(await e.post(obs({scores:{crowds:3}},{visited_on:'2026-05-31'}))).json();
  for(const r of [boundary,confirmed,plain])await e.publish(r.id);
  let v=await view();
  assert.equal(v.seasonal_scores.winter.crowds.count,1,'boundary stay counts in the chosen season');assert.equal(v.seasonal_scores.spring.crowds.count,2);assert.equal(v.seasonal_scores.winter.noise_night.count,1);
  const disc=await e.get('/api/community-discovery.php');assert.equal(D.validSites(disc.sites),true);
  const js=D.seasonalScores(disc.sites[site].observations);assert.deepEqual(js.winter.crowds,v.seasonal_scores.winter.crowds,'client and server seasonal sums agree');assert.deepEqual(js.spring.crowds,v.seasonal_scores.spring.crowds);
  // Editing the date away from the boundary drops a season that is no longer adjacent (older clients omit observations).
  assert.equal((await e.post({...base,action:'edit',visited_on:'2026-07-15'},boundary.token)).status,200);
  assert.equal((await e.own(boundary.token)).observations.season,undefined);assert.equal((await e.own(boundary.token)).observations.scores.crowds,4);
  await e.publish(boundary.id);v=await view();assert.equal(v.seasonal_scores.winter,undefined);assert.equal(v.seasonal_scores.summer.crowds.count,1);
  // A published visit with no usable date: counted in the whole-site count, never in a season.
  e.sql(`$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,'Undated fixture','Fixture',4,'Legacy undated disposable fixture','','','published','2026-10-01','2026-10-01')")->execute([hash('sha256','undated'),${JSON.stringify(site)}]);$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$p->lastInsertId(),'{"scores":{"crowds":5,"fullness":5},"season":"summer"}']);`);
  v=await view();assert.equal(v.site_scores.crowds.count,4);assert.equal(v.site_scores.fullness.count,1);
  const seasonal=Object.values(v.seasonal_scores).reduce((n,s)=>n+(s.crowds?.count||0),0);assert.equal(seasonal,3,'undated rating adds no seasonal contribution, even with a stored season');assert.equal(v.seasonal_scores.summer.fullness,undefined);
  assert.equal(D.season(''),null);assert.deepEqual(D.allowedSeasons(''),[]);assert.deepEqual(D.seasonalScores([{values:{scores:{crowds:5},season:'summer'},count:3,latest_visit:''}]),{});
  // A submission cannot omit the visit date.
  assert.equal((await e.post(obs({scores:{crowds:3}},{visited_on:''}))).status,422);
 }finally{e.close();}
});

test('legacy categorical crowding, noise and shade stay categorical and are never converted to scores',{skip:!H.capable},async()=>{
 const e=await H.start({port:18934});try{
  const view=()=>e.get('/api/community.php?site='+encodeURIComponent(site));
  for(const o of [{crowding:'crowded',noise:'noisy',shade:'full'},{crowding:'crowded',noise:'quiet'},{crowding:'sparse',noise:'mixed',comfort:'concerns'}]){const r=await(await e.post(obs(o))).json();await e.publish(r.id);}
  // Also a stored legacy row written before this release.
  e.sql(`$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,'Legacy fixture','Fixture',4,'Legacy categorical disposable fixture','2026-07-01','','published','2026-07-01','2026-07-01')")->execute([hash('sha256','legacy'),${JSON.stringify(site)}]);$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$p->lastInsertId(),'{"crowding":"moderate","noise":"noisy","scores":{"quietness":2}}']);`);
  const v=await view();
  assert.deepEqual(Object.keys(v.site_scores),['quietness'],'only the explicit legacy quietness score exists');assert.equal(v.site_scores.quietness.count,1);
  for(const axis of NEW)assert.equal(v.site_scores[axis],undefined,axis+' is not derived from categorical reports');
  assert.equal(v.monthly.months['07'].axes.crowding.crowded,2);assert.equal(v.monthly.months['07'].axes.crowding.moderate,1);assert.equal(v.monthly.months['07'].axes.noise.noisy,2);
  const disc=await e.get('/api/community-discovery.php');assert.equal(D.validSites(disc.sites),true);
  assert.ok(disc.sites[site].observations.every(g=>!g.values.scores||Object.keys(g.values.scores).join()==='quietness'));
 }finally{e.close();}
});

test('PHP and JS season rules are identical, including boundaries, adjacency, confirmation and missing dates',()=>{
 const dates=['2025-12-01','2025-12-31','2026-01-01','2026-02-28','2024-02-29','2026-03-01','2026-05-31','2026-06-01','2026-08-31','2026-09-01','2026-11-30','','2026-02-30','not-a-date','1899-12-31',null];
 const choices=['','winter','spring','summer','fall','monsoon'];
 const cases=[];for(const d of dates)for(const c of choices)cases.push([d,c]);
 const js=cases.map(([d,c])=>[D.season(d),D.allowedSeasons(d),D.ratedSeason(c?{season:c}:{},d)]);
 if(spawnSync('php',['-v'],{stdio:'ignore'}).status!==0)return;
 const src=path.resolve(__dirname,'../api/_lib/observations.php');
 const out=execFileSync('php',['-r',`require ${JSON.stringify(src)};$cases=json_decode(stream_get_contents(STDIN),true);echo json_encode(array_map(fn($x)=>[ko_season($x[0]),ko_allowed_seasons($x[0]),ko_rated_season($x[1]===''?[]:['season'=>$x[1]],$x[0])],$cases));`],{input:JSON.stringify(cases),encoding:'utf8'});
 assert.deepEqual(JSON.parse(out),js);
 assert.deepEqual(['2025-12-21','2026-01-01','2026-02-28','2026-03-01','2026-05-31','2026-06-01','2026-08-31','2026-09-01','2026-11-30'].map(D.season),['winter','winter','winter','spring','spring','summer','summer','fall','fall']);
 assert.deepEqual(D.allowedSeasons('2026-03-01'),['spring','winter','summer']);assert.deepEqual(D.allowedSeasons('2026-12-01'),['winter','fall','spring']);
});

test('the review form confirms the derived season, offers boundary choices, and posts season only with scores',()=>{
 const el=(tag,attrs={},text)=>{const n={tag,attrs,text,children:[],listeners:{},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},addEventListener(name,fn){this.listeners[name]=fn;},get textContent(){return this._t??'';},set textContent(x){this._t=x;}};return n;};
 const date=el('input',{name:'visited_on'});date.value='2026-03-01';
 const form=el('form');form.querySelector=s=>s==='[name="visited_on"]'?date:null;const field=(label,input,hint)=>({label,input,hint});
 D.observeFields(form,{observations:{}},el,field);
 const numeric=form.children[1],labels=numeric.children.filter(x=>x.input).map(x=>x.label);
 for(const label of ['Crowds (how crowded it felt)','Fullness (camping spaces occupied)','Quietness by day','Quietness by night','Cleanliness','Season being rated'])assert.ok(labels.includes(label),label);
 const crowds=numeric.children.find(x=>x.label==='Crowds (how crowded it felt)');assert.equal(crowds.hint,'Not crowded (1) to very crowded (5).');assert.equal(crowds.input.children[0].attrs.value,'','Not reported is the default');
 const fullness=numeric.children.find(x=>x.label==='Fullness (camping spaces occupied)');assert.equal(fullness.hint,'Nearly empty (1) to completely full (5).');
 const season=numeric.children.find(x=>x.label==='Season being rated').input;
 assert.deepEqual(season.children.map(o=>o.attrs.value),['spring','winter','summer']);assert.equal(season.children.find(o=>o.attrs.selected).attrs.value,'spring');assert.match(season.children[0].text,/from your visit date/);
 assert.match(numeric.children.find(x=>x.attrs?.class==='kt-fine kt-season-note').textContent,/2026-03-01 falls in Spring/);
 date.value='';date.listeners.input();assert.equal(season.disabled,true);assert.equal(season.children.length,1);assert.equal(season.children[0].attrs.value,'');
 date.value='2026-07-04';date.listeners.change();assert.deepEqual(season.children.map(o=>o.attrs.value),['summer','spring','fall']);
 const data=v=>{global.FormData=class{get(k){return v[k]??null;}};return D.formValues({});};
 try{
  assert.deepEqual(data({score_crowds:'4',score_fullness:'2',score_season:'spring'}),{scores:{crowds:4,fullness:2},season:'spring'});
  assert.deepEqual(data({observed_crowding:'crowded',score_season:'spring'}),{crowding:'crowded'},'no season without a score; no score from crowding');
  assert.deepEqual(data({score_noise_day:'5',score_noise_night:'1',score_cleanliness:'3'}),{scores:{noise_day:5,noise_night:1,cleanliness:3}});
 }finally{delete global.FormData;}
 assert.match(D.describe({scores:{crowds:4},season:'winter'}),/Crowds \(how crowded it felt\): 4\/5 \(visit rating\) · Season rated: Winter/);
 // Filters keep their existing aspects until the direction-aware filter package.
 assert.deepEqual(D.FILTER_SCORES,['quietness','shade','comfort']);assert.equal(D.matchesSummary({rating_count:3,rating_sum:12,latest_visit:'2026-07-01',observations:[{count:3,latest_visit:'2026-07-01',values:{scores:{crowds:5}}}]},{minScore_crowds:1}),true,'no crowds filter exists yet');
});
