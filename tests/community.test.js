'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{spawn,spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const capable=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")&&extension_loaded("gd")&&extension_loaded("mbstring")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('PHP with pdo_sqlite, gd and mbstring is required; API tests must not silently skip.');
const jpg=Buffer.from(fs.readFileSync(path.join(__dirname,'fixtures/community-photo.b64'),'utf8'),'base64');
const good={action:'submit',campsite_id:'usfs:community-qa',campsite_name:'Community QA campsite',display_name:'Test camper',rating:'4',body:'Firsthand test observation about this campsite and its approach road.',visited_on:'2026-10-01',rig:'22-foot camper van',firsthand:'1',elapsed_ms:'8000'};
function form(fields,photos=[]){const f=new FormData();for(const[k,v]of Object.entries(fields)){if(Array.isArray(v)){for(const item of v)f.append(k,item);}else f.set(k,v);}for(const p of photos)f.append('photos[]',new Blob([p.data||jpg],{type:p.type||'image/jpeg'}),p.name||'camp.jpg');return f;}
async function env(extra='',port=18905){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-community-')),file=path.join(dir,'config.php');
 const dsn=process.env.KT_TEST_MYSQL_DSN||'sqlite:'+path.join(dir,'test.sqlite');
 fs.writeFileSync(file,`<?php return ['db'=>['dsn'=>${JSON.stringify(dsn)},'user'=>'root','pass'=>'test-only'],'ip_salt'=>'unit-test-only-salt','moderator_password'=>'test moderator password','moderator_name'=>'tester'${extra}];`);fs.chmodSync(file,0o600);
 if(process.env.KT_TEST_MYSQL_DSN)execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass']);$p->exec('SET FOREIGN_KEY_CHECKS=0');foreach($p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t)$p->exec('DROP TABLE '.chr(96).$t.chr(96));`]);
 const p=spawn('php',['-d','upload_max_filesize=7M','-d','post_max_size=20M','-S','127.0.0.1:'+port,'-t',root],{env:{...process.env,KAMPTRAIL_CONFIG:file},stdio:'ignore'}),base='http://127.0.0.1:'+port;
 for(let i=0;i<60;i++){try{await fetch(base+'/api/health.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 let cookie='';const grab=res=>{const c=res.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return res;};
 const login=await grab(await fetch(base+'/api/admin.php')).text();const csrf=login.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const reviewHash=async id=>{
  const html=await(await fetch(base+'/api/admin.php?community=1&state=all&before='+(Number(id)+1),{headers:{Cookie:cookie}})).text();
  const form=[...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]).find(body=>body.includes('name="do" value="community_review"')&&body.includes('name="review_id" value="'+id+'"'));
  assert.ok(form,'moderation form exists');return form.match(/name="expected_hash" value="([a-f0-9]{64})"/)[1];
 };
 const admin=async fields=>{
  if(fields.do==='community_review'&&!Object.hasOwn(fields,'expected_hash'))fields={...fields,expected_hash:await reviewHash(fields.review_id)};
  return grab(await fetch(base+'/api/admin.php?community=1',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams({csrf,video_reviewed:'1',...fields})}));
 };
 await admin({do:'login',password:'test moderator password'});await admin({do:'migrate'});
 const sql=code=>execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`+code],{encoding:'utf8'});
 return {base,p,dir,admin,reviewHash,sql,cookie:()=>cookie,csrf,get:async url=>(await fetch(base+url)).json(),post:(fields,photos=[],token)=>fetch(base+'/api/community.php',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:form(fields,photos)}),close:()=>{p.kill();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('reviews and photos: moderation, ownership, re-review, reporting, removal, and quota accounting',{skip:!capable},async()=>{
 const e=await env();try{
  let h=await e.get('/api/health.php');assert.equal(h.photo_processing,'ready');assert.equal(h.community,'ready');
  assert.equal((await e.post({...good,firsthand:'0'})).status,422);
  assert.equal((await e.post({...good,visited_on:'2999-01-01'})).status,422);
  assert.equal((await e.post({...good,rating:'4.5'})).status,422);
  assert.equal((await e.post(good,[{data:'<svg onload="alert(1)"></svg>',name:'fake.jpg'}])).status,422);
  assert.equal((await e.post(good,[{},{},{},{}])).status,422);
  let res=await e.post(good,[{}]);assert.equal(res.status,201);const created=await res.json(),{id,token}=created;assert.match(token,/^[a-f0-9]{64}$/);
  const list=()=>e.get('/api/community.php?site='+encodeURIComponent(good.campsite_id));assert.equal((await list()).count,0);
  const mine=async()=>{const r=await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}});return (await r.json()).review;};
  let row=await mine();assert.equal(row.status,'pending');const photo=row.photos[0].id;
  assert.equal((await fetch(e.base+'/api/photo.php?id='+photo)).status,404);
  assert.equal((await fetch(e.base+'/api/photo.php?id='+photo+'&preview=1')).status,404);
  assert.equal((await fetch(e.base+'/api/photo.php?id='+photo+'&preview=1',{headers:{Cookie:e.cookie()}})).status,200);
  assert.equal((await e.post({...good,action:'edit'},[],'b'.repeat(64))).status,404);
  assert.equal((await e.post({...good,action:'delete'})).status,401);
  await e.admin({do:'community_review',review_id:id,status:'published'});
  assert.equal((await list()).count,1);assert.equal((await list()).reviews[0].photos.length,0,'review approval must not approve photos');
  await e.admin({do:'community_photo',review_id:id,photo_id:photo,status:'published'});
  let pub=await list();assert.equal(pub.average,4);assert.equal(pub.reviews[0].photos.length,1);assert.ok(!JSON.stringify(pub).includes(token));assert.ok(!JSON.stringify(pub).includes('owner_hash'));
  res=await fetch(e.base+'/api/photo.php?id='+photo);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/jpeg');assert.match(res.headers.get('content-security-policy'),/sandbox/);assert.equal(res.headers.get('cache-control'),'no-store');const bytes=Buffer.from(await res.arrayBuffer());assert.ok(!bytes.includes('KAMPTRAIL_PRIVATE_EXIF_QA'));assert.ok(!bytes.includes('KAMPTRAIL_APPENDED_QA'));assert.ok(pub.reviews[0].photos[0].width<=1600);
  res=await e.post({action:'report',review_id:id,photo_id:photo,reason:'Test report: this photograph needs a moderation check.'});assert.equal(res.status,201);
  let queue=await (await fetch(e.base+'/api/admin.php?community=1&state=reports',{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/needs a moderation check/);
  const report=queue.match(/name="report_id" value="(\d+)"/)[1];await e.admin({do:'community_report',review_id:id,report_id:report});
  await e.admin({do:'community_photo',review_id:id,photo_id:photo,status:'hidden'});assert.equal((await fetch(e.base+'/api/photo.php?id='+photo)).status,404);
  await e.admin({do:'community_photo',review_id:id,photo_id:photo,status:'published'});assert.equal((await fetch(e.base+'/api/photo.php?id='+photo)).status,200);
  const forged=await fetch(e.base+'/api/admin.php?community=1',{method:'POST',headers:{Cookie:e.cookie(),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'forged',do:'community_review',review_id:id,status:'hidden'})});assert.equal(forged.status,400);assert.equal((await list()).count,1);
  res=await e.post({...good,action:'edit',body:'Edited firsthand observation. This must return to moderation.'},[],token);assert.equal(res.status,200);assert.equal((await list()).count,0);assert.equal((await fetch(e.base+'/api/photo.php?id='+photo)).status,404);assert.equal((await mine()).photos[0].status,'pending');
  await e.admin({do:'community_review',review_id:id,status:'rejected',public_note:'Please clarify your visit date.'});assert.equal((await mine()).public_note,'Please clarify your visit date.');
  await e.admin({do:'community_review',review_id:id,status:'published'});await e.admin({do:'community_photo',review_id:id,photo_id:photo,status:'published'});
  res=await e.post({action:'delete'},[],token);assert.equal(res.status,200);row=await mine();assert.equal(row.status,'deleted');assert.equal(row.body,'');assert.equal(row.photos.length,0);assert.equal((await fetch(e.base+'/api/photo.php?id='+photo)).status,404);assert.equal((await list()).count,0);
  queue=await (await fetch(e.base+'/api/admin.php?community=1&state=all&before='+(Number(id)+1),{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/0 \/ 256 MB/);
 }finally{e.close();}
});
test('storage exhaustion rejects the whole upload but still accepts a text review; submit limits apply',{skip:!capable},async()=>{
 const e=await env(",'community_storage_bytes'=>100",18906);try{
  assert.equal((await e.post(good,[{}])).status,507);
  let r=await e.post(good);assert.equal(r.status,201);const {token}=await r.json();const own=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.equal(own.review.photos.length,0);
  for(let i=0;i<4;i++)assert.equal((await e.post(good)).status,201);
  assert.equal((await e.post(good)).status,429);
  assert.equal((await fetch(e.base+'/api/community.php',{method:'PUT'})).status,405);
  assert.equal((await fetch(e.base+'/api/community.php',{method:'POST',headers:{Origin:'https://other.example'},body:form(good)})).status,403);
 }finally{e.close();}
});

test('signal radio technology is optional, validated and stored without an unspecified marker',{skip:!capable},async()=>{
 const e=await env('',18958);try{
  const withRadio=(radio)=>({...good,observations:JSON.stringify({signals:[{carrier:'att',signal:'weak',environment:'outdoors',...(radio===undefined?{}:{radio})}]})});
  for(const bad of ['6g','LTE',5,null,''])assert.equal((await e.post(withRadio(bad))).status,422,String(bad));
  let res=await e.post(withRadio('5g'));assert.equal(res.status,201);let {token}=await res.json();
  let mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.deepEqual(mine.review.observations.signals,[{carrier:'att',signal:'weak',environment:'outdoors',radio:'5g'}]);
  res=await e.post({...withRadio('unspecified'),display_name:'Other camper'});if(res.status===201){({token}=await res.json());mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.ok(!('radio' in mine.review.observations.signals[0]),'unspecified is not stored');}
 }finally{e.close();}
});

test('published observations and rating discovery follow moderation, edit, hide, restore and delete',{skip:!capable},async()=>{
 const e=await env('',18957);try{
  const details={access:'moderate',noise:'quiet',shade:'partial',crowding:'sparse',comfort:'comfortable',signals:[{carrier:'verizon',signal:'usable',environment:'inside_rv'}]};
  const fields={...good,observations:JSON.stringify(details)};
  const discovery=()=>e.get('/api/community-discovery.php');
  const monthly=async()=>(await e.get('/api/community.php?site='+encodeURIComponent(good.campsite_id))).monthly;
  for(const bad of ['not json',JSON.stringify({noise:'secret'}),JSON.stringify({other:'x'}),JSON.stringify({signals:[{carrier:'verizon',signal:'usable'},{carrier:'verizon',signal:'none'}]})])assert.equal((await e.post({...good,observations:bad})).status,422);
  const res=await e.post(fields);assert.equal(res.status,201);const {id,token}=await res.json();
  assert.deepEqual((await discovery()).sites,{});
  assert.equal((await monthly()).condition_reports,0,'Pending reviews do not contribute seasonal counts');
  let mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.deepEqual(mine.review.observations,details);
  let queue=await(await fetch(e.base+'/api/admin.php?community=1',{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/approve with review/);assert.match(queue,/inside_rv/);
  await e.admin({do:'community_review',review_id:id,status:'published'});
  let data=await discovery(),row=data.sites[good.campsite_id];assert.equal(row.rating_count,1);assert.equal(row.rating_sum,4);assert.equal(row.observations[0].latest_visit,good.visited_on);assert.deepEqual(row.observations[0].values,details);
  let months=await monthly();assert.equal(months.condition_reports,1);assert.equal(months.months['10'].axes.noise.quiet,1);assert.equal(months.months['10'].latest_visit,good.visited_on);assert.ok(!JSON.stringify(months).includes('verizon'));
  for(const hidden of [token,'owner_hash','display_name',good.body,good.display_name])assert.ok(!JSON.stringify(data).includes(hidden));
  const revision=data.revision;await e.admin({do:'community_review',review_id:id,status:'hidden'});assert.deepEqual((await discovery()).sites,{});
  assert.equal((await monthly()).condition_reports,0,'Hidden reviews are removed from the complete monthly summary');
  assert.equal((await fetch(e.base+'/api/community-discovery.php?revision='+revision)).status,409);
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await discovery()).sites[good.campsite_id].rating_count,1);
  assert.equal((await e.post({...fields,action:'edit',rating:'5'},[],token)).status,200);assert.deepEqual((await discovery()).sites,{});
  assert.equal((await monthly()).condition_reports,0,'Edited reviews return to moderation before their counts reappear');
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await discovery()).sites[good.campsite_id].rating_sum,5);
  // An older client without observation fields preserves them. A new explicit empty object clears them.
  assert.equal((await e.post({...good,action:'edit'},[],token)).status,200);mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.deepEqual(mine.review.observations,details);
  assert.equal((await e.post({...fields,action:'edit',observations:'{}'},[],token)).status,200);
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.deepEqual((await discovery()).sites[good.campsite_id].observations,[]);
  months=await monthly();assert.equal(months.condition_reports,0);assert.equal(months.unreported_reviews,1,'Explicitly cleared observations stay unreported');
  assert.equal((await e.post({action:'delete'},[],token)).status,200);assert.deepEqual((await discovery()).sites,{});
  assert.equal((await monthly()).published_reviews,0,'Author deletion removes the review from seasonal counts');
  assert.equal((await fetch(e.base+'/api/community-discovery.php',{method:'POST'})).status,405);
 }finally{e.close();}
});
test('approach maximum and signal technology survive submission, moderation and publication into the client filter',{skip:!capable},async()=>{
 const e=await env('',18961);try{
  const D=require('../community-discovery.js'),now=Date.parse('2026-10-29T12:00:00Z');
  const withLte={access:'moderate',signals:[{carrier:'verizon',signal:'usable',environment:'outdoors',radio:'lte'}]};
  const noRadio={access:'easy',signals:[{carrier:'att',signal:'weak',environment:'outdoors'}]};
  const first=await e.post({...good,observations:JSON.stringify(withLte)});assert.equal(first.status,201);
  const second=await e.post({...good,display_name:'Second camper',observations:JSON.stringify(noRadio)});assert.equal(second.status,201);
  assert.deepEqual((await e.get('/api/community-discovery.php')).sites,{},'Pending reports are not published');
  for(const r of [first,second])await e.admin({do:'community_review',review_id:(await r.json()).id,status:'published'});
  const data=await e.get('/api/community-discovery.php');assert.ok(D.validSites(data.sites));
  const site=data.sites[good.campsite_id],m=f=>D.matchesSummary(site,f,now);
  assert.ok(JSON.stringify(site).includes('"radio":"lte"'));assert.ok(!JSON.stringify(site).includes('unspecified"}'));
  assert.equal(m({observed_carrier:'verizon',observed_radio:'lte'}),true);
  assert.equal(m({observed_carrier:'verizon',observed_radio:'5g'}),false);
  assert.equal(m({observed_carrier:'att',observed_radio:'lte'}),false,'A report without technology never matches a technology filter');
  assert.equal(m({observed_carrier:'att',observed_signal:'weak'}),true);
  assert.equal(m({observed_access:'easy'}),true);
  assert.equal(m({observed_access:'easy',observed_carrier:'verizon'}),false,'Criteria must match within one visit');
  assert.equal(m({observed_access:'moderate',observed_carrier:'verizon',observed_radio:'lte'}),true);
 }finally{e.close();}
});
test('monthly conditions cover all published review pages and keep malformed dates and other sites separate',{skip:!capable},async()=>{
 const e=await env('',18969);try{
  e.sql(`$p->beginTransaction();$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,'Seasonal fixture','Fixture',4,'Disposable seasonal condition fixture',?,'',?,'2026-10-01','2026-10-01')");$o=$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)');for($i=0;$i<23;$i++){$q->execute([hash('sha256','seasonal-'.$i),'qa:monthly','2026-01-05','published']);$o->execute([$p->lastInsertId(),'{"noise":"quiet","shade":"partial"}']);}foreach([['qa:monthly','2025-01-20','published','{"noise":"mixed"}'],['qa:monthly','2026-07-02','published','{"noise":"noisy"}'],['qa:monthly','2026-02-30','published','{"noise":"quiet"}'],['qa:monthly','2999-01-01','published','{"noise":"quiet"}'],['qa:monthly','2026-01-05','hidden','{"noise":"noisy"}'],['qa:other','2026-01-05','published','{"noise":"noisy"}']] as $i=>$v){$q->execute([hash('sha256','seasonal-extra-'.$i),$v[0],$v[1],$v[2]]);$o->execute([$p->lastInsertId(),$v[3]]);}$p->commit();`);
  const first=await e.get('/api/community.php?site=qa%3Amonthly');assert.equal(first.reviews.length,10);assert.ok(first.next_before);const m=first.monthly;assert.equal(m.published_reviews,27);assert.equal(m.condition_reports,25);assert.equal(m.excluded_dates,2);assert.equal(m.months['01'].reports,24);assert.equal(m.months['01'].axes.noise.quiet,23);assert.equal(m.months['01'].first_visit,'2025-01-20');assert.equal(m.months['01'].latest_visit,'2026-01-05');assert.equal(m.months['07'].axes.noise.noisy,1);assert.equal(m.months['01'].axes.noise.noisy,undefined);
  const next=await e.get('/api/community.php?site=qa%3Amonthly&before='+first.next_before);assert.equal(next.monthly.condition_reports,25);assert.deepEqual(next.monthly.months,m.months);for(const forbidden of ['owner_hash','display_name','body','private_code'])assert.ok(!JSON.stringify(m).includes(forbidden));
 }finally{e.close();}
});

test('additive observation migration preserves legacy reviews/photos and paginated discovery is revision-consistent',{skip:!capable},async()=>{
 const e=await env('',18958);try{
  const response=await e.post(good,[{}]);const {id}=await response.json();await e.admin({do:'community_review',review_id:id,status:'published'});
  e.sql("$p->exec('DROP TABLE community_observations');$p->exec('DROP TABLE community_discovery_state');$p->exec(\"DELETE FROM schema_migrations WHERE version='004_observations'\");");
  const snapshot=()=>e.sql("$r=$p->query('SELECT * FROM community_reviews ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);$s=$p->query('SELECT used_bytes FROM community_storage WHERE id=1')->fetchColumn();$rows=$p->query('SELECT image_data,byte_size,status FROM community_photos ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);foreach($rows as &$row)$row['image_data']=base64_encode($row['image_data']);echo hash('sha256',json_encode([$r,$s,$rows]));");
  const before=snapshot();assert.equal((await e.get('/api/community.php?site='+encodeURIComponent(good.campsite_id))).scores_available,false);assert.equal((await e.get('/api/health.php')).community,'ready');assert.equal((await fetch(e.base+'/api/community-discovery.php')).status,503);
  await e.admin({do:'migrate'});assert.equal(snapshot(),before);let d=await e.get('/api/community-discovery.php');assert.equal(d.revision,'1');assert.equal(d.sites[good.campsite_id].rating_count,1);assert.deepEqual(d.sites[good.campsite_id].observations,[]);
  await e.admin({do:'migrate'});assert.equal(snapshot(),before);
  // Recover safely when DDL succeeded but its migration-version insert was interrupted.
  e.sql("$p->exec(\"DELETE FROM schema_migrations WHERE version='004_observations'\");");await e.admin({do:'migrate'});assert.equal(snapshot(),before);
  e.sql(`$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,?,?,4,?,'2026-10-01','','published','2026-10-01','2026-10-01')");for($i=0;$i<102;$i++){$q->execute([hash('sha256','synthetic-'.$i),'qa:'.sprintf('%03d',$i),'Synthetic pagination fixture','Fixture','Disposable review fixture for pagination.']);} $review=$p->query("SELECT id FROM community_reviews WHERE campsite_id='qa:000'")->fetchColumn();$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$review,'{"noise":"quiet"}']);`);
  e.sql(`$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?, 'qa:000','Synthetic old visit','Fixture',4,'Older disposable visit report','2020-01-01','','published','2020-01-01','2020-01-01')");$q->execute([hash('sha256','older-synthetic-visit')]);$review=$p->lastInsertId();$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$review,'{"noise":"quiet"}']);`);
  d=await e.get('/api/community-discovery.php');assert.equal(d.sites['qa:000'].observations.length,2);assert.deepEqual(d.sites['qa:000'].observations.map(x=>x.count),[1,1]);assert.equal(Object.keys(d.sites).length,100);assert.ok(d.next_after);const next=await e.get('/api/community-discovery.php?after='+encodeURIComponent(d.next_after)+'&revision='+d.revision);assert.equal(next.next_after,null);assert.equal(Object.keys(next.sites).length,3);assert.equal(new Set([...Object.keys(d.sites),...Object.keys(next.sites)]).size,103);
  await e.admin({do:'community_review',review_id:id,status:'hidden'});assert.equal((await fetch(e.base+'/api/community-discovery.php?after='+encodeURIComponent(d.next_after)+'&revision='+d.revision)).status,409);
 }finally{e.close();}
});

test('explicit numeric visit scores validate and follow publication, seasons, edits and deletion without a migration',{skip:!capable},async()=>{
 const e=await env('',18959);try{
  const scored=(scores,extra={})=>({...good,...extra,observations:JSON.stringify({noise:'quiet',scores})});
  for(const scores of [null,[],{quietness:0},{quietness:6},{quietness:4.5},{quietness:'4'},{comfort:true},{clearance:5},{quietness:5,body:'private'}]){
   assert.equal((await e.post(scored(scores))).status,422,JSON.stringify(scores));
  }
  assert.equal((await e.post(scored([4,5]))).status,422);
  const created=[];
  for(const [visited_on,scores]of [['2020-09-21',{quietness:3,shade:2,comfort:5}],['2026-10-01',{quietness:4,shade:4,comfort:4}],['2026-09-01',{quietness:5,comfort:3}]]){
   const r=await e.post(scored(scores,{visited_on}));assert.equal(r.status,201);created.push(await r.json());
  }
  const publicView=(before='')=>e.get('/api/community.php?site='+encodeURIComponent(good.campsite_id)+(before?'&before='+before:''));
  const discovery=()=>e.get('/api/community-discovery.php');
  assert.deepEqual((await publicView()).seasonal_scores,{});assert.deepEqual((await discovery()).sites,{});
  for(const r of created.slice(0,2))await e.admin({do:'community_review',review_id:r.id,status:'published'});
  let view=await publicView();assert.equal(view.scores_available,true);assert.equal(view.score_minimum,3);assert.deepEqual(view.seasonal_scores.fall.quietness,{count:2,sum:7,first_visit:'2020-09-21',latest_visit:'2026-10-01'});
  await e.admin({do:'community_review',review_id:created[2].id,status:'published'});
  const legacy=await(await e.post({...good,observations:JSON.stringify({noise:'quiet',shade:'full',comfort:'comfortable'})})).json();await e.admin({do:'community_review',review_id:legacy.id,status:'published'});
  const spring=await(await e.post(scored({quietness:1},{visited_on:'2026-03-01'}))).json();await e.admin({do:'community_review',review_id:spring.id,status:'published'});
  view=await publicView();assert.equal(view.count,5);assert.equal(view.average,4);assert.deepEqual(view.seasonal_scores.fall.quietness,{count:3,sum:12,first_visit:'2020-09-21',latest_visit:'2026-10-01'});assert.equal(view.seasonal_scores.fall.shade.count,2);assert.equal(view.seasonal_scores.spring.quietness.count,1);
  const {id,token}=created[0];
  let own=(await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json()).review;assert.equal(own.observations.scores.quietness,3);
  assert.equal((await e.post(scored({quietness:5},{action:'edit'}),[],'e'.repeat(64))).status,404);
  const queue=await(await fetch(e.base+'/api/admin.php?community=1&state=all&before='+(Number(id)+1),{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/quietness/);assert.match(queue,/scores/);
  for(const status of ['hidden','rejected','published']){await e.admin({do:'community_review',review_id:id,status});view=await publicView();assert.equal(view.seasonal_scores.fall.quietness.count,status==='published'?3:2);}
  // Legacy clients that omit the entire observation payload retain explicit scores.
  assert.equal((await e.post({...good,action:'edit',visited_on:'2020-12-21'},[],token)).status,200);
  view=await publicView();assert.equal(view.seasonal_scores.fall.quietness.count,2);assert.equal(view.seasonal_scores.winter,undefined);
  own=(await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json()).review;assert.equal(own.observations.scores.quietness,3);
  await e.admin({do:'community_review',review_id:id,status:'published'});view=await publicView();assert.equal(view.seasonal_scores.winter.quietness.count,1);assert.equal(view.seasonal_scores.winter.quietness.first_visit,'2020-12-21');
  assert.equal((await e.post(scored({},{action:'edit',visited_on:'2020-12-21'}),[],token)).status,200);await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await publicView()).seasonal_scores.winter,undefined);
  assert.equal((await e.post({action:'delete'},[],token)).status,200);own=(await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json()).review;assert.deepEqual(own.observations,[]);
  // Aggregate the whole published site, independent of the review pagination cursor.
  e.sql(`$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,'qa:seasonal-pagination','Disposable pagination fixture','Fixture',4,'Explicit visit score pagination fixture','2026-06-01','','published','2026-06-01','2026-06-01')");for($i=0;$i<12;$i++){$q->execute([hash('sha256','seasonal-page-'.$i)]);$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$p->lastInsertId(),'{"scores":{"quietness":4}}']);}`);
  const first=await e.get('/api/community.php?site=qa:seasonal-pagination');assert.equal(first.reviews.length,10);assert.equal(first.seasonal_scores.summer.quietness.count,12);const next=await e.get('/api/community.php?site=qa:seasonal-pagination&before='+first.next_before);assert.equal(next.reviews.length,2);assert.deepEqual(next.seasonal_scores,first.seasonal_scores);
 }finally{e.close();}
});

test('external video validates, re-moderates same-second replacements, projects cohorts and clears on deletion',{skip:!capable},async()=>{
 const e=await env('',18916);try{
  const first='abcdefghijk',second='lmnopqrstuv',third='123456789_-';
  for(const youtube_video of ['http://www.youtube.com/watch?v='+first,'https://youtube.com.evil.test/watch?v='+first,'https://www.youtube.com/watch?v='+first+'&autoplay=1','https://youtu.be/'+first+'?x=1','https://user@youtube.com/watch?v='+first,'<iframe src="x">','https://www.youtube.com/playlist?list='+first,' '+first,first+'\n',{},'']){
   if(youtube_video==='')continue;
   assert.equal((await e.post({...good,youtube_video})).status,422,String(youtube_video));
  }
  const observations=JSON.stringify({noise:'quiet',scores:{quietness:4}});
  let response=await e.post({...good,observations,youtube_video:'https://www.youtube.com/watch?v='+first});assert.equal(response.status,201);const {id,token}=await response.json();
  const published=()=>e.get('/api/community.php?site='+encodeURIComponent(good.campsite_id));
  const check=()=>fetch(e.base+'/api/community.php?site='+encodeURIComponent(good.campsite_id)+'&review_id='+id);
  const own=async()=> (await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json()).review;
  assert.equal((await published()).count,0);assert.equal((await check()).status,404);assert.equal((await own()).video.id,first);
  let queue=await(await fetch(e.base+'/api/admin.php?community=1',{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/View submitted video on YouTube/);assert.match(queue,/whole-review approval/);assert.ok(!queue.includes('youtube-nocookie.com'));
  e.sql(`$p->exec("UPDATE community_reviews SET updated_at='2026-10-01 01:01:01' WHERE id=${id}");`);
  const stale=await e.reviewHash(id);
  response=await e.post({...good,action:'edit',youtube_video:'https://youtu.be/'+second},[],token);assert.equal(response.status,200);
  e.sql(`$p->exec("UPDATE community_reviews SET updated_at='2026-10-01 01:01:01' WHERE id=${id}");`);
  response=await e.admin({do:'community_review',review_id:id,status:'published',expected_hash:stale});assert.equal(response.status,409);assert.match(await response.text(),/review changed/);assert.equal((await published()).count,0);
  for(const status of ['pending','published','hidden','rejected']){
   response=await e.admin({do:'community_review',review_id:id,status,expected_hash:stale});assert.equal(response.status,409);
   response=await e.admin({do:'community_review',review_id:id,status,expected_hash:''});assert.equal(response.status,409);
  }
  response=await e.admin({do:'community_review',review_id:id,status:'published',video_reviewed:''});assert.equal(response.status,422);assert.match(await response.text(),/Watch the attached video/);assert.equal((await published()).count,0);
  await e.admin({do:'community_review',review_id:id,status:'published'});
  let checked=await check();assert.equal(checked.headers.get('cache-control'),'no-store');assert.equal((await checked.json()).video.id,second);
  assert.equal((await own()).observations.scores.quietness,4);assert.equal((await published()).reviews[0].observations.video_id,undefined);
  // Different videos with identical dated scores remain one observation cohort.
  for(const youtube_video of [first,third]){
   const r=await(await e.post({...good,observations,youtube_video})).json();await e.admin({do:'community_review',review_id:r.id,status:'published'});
  }
  let discovery=await e.get('/api/community-discovery.php');const groups=discovery.sites[good.campsite_id].observations;assert.equal(groups.length,1);assert.equal(groups[0].count,3);assert.deepEqual(groups[0].values,{noise:'quiet',scores:{quietness:4}});assert.ok(!JSON.stringify(discovery).includes('video_id'));
  assert.equal((await published()).seasonal_scores.fall.quietness.count,3);assert.equal((await published()).seasonal_scores.fall.quietness.sum,12);
  assert.equal((await published()).monthly.months['10'].axes.noise.quiet,3,'Numeric scores and videos retain categorical monthly counts');
  // Simulate future server metadata: public projections must whitelist canonical condition fields.
  e.sql(`$q=$p->query("SELECT review_id,details FROM community_observations");foreach($q->fetchAll(PDO::FETCH_ASSOC) as $row){$d=json_decode($row['details'],true);$d['private_note']='private-'.$row['review_id'];$d['scores']['private_note']='private-score';$p->prepare('UPDATE community_observations SET details=? WHERE review_id=?')->execute([json_encode($d),$row['review_id']]);}`);
  discovery=await e.get('/api/community-discovery.php');assert.equal(discovery.sites[good.campsite_id].observations.length,1);assert.equal(discovery.sites[good.campsite_id].observations[0].count,3);assert.ok(!JSON.stringify(discovery).includes('private'));
  const projected=await published();assert.equal(projected.monthly.months['10'].axes.noise.quiet,3);assert.equal(projected.monthly.invalid_observations,0);assert.ok(!JSON.stringify(projected).includes('private'));
  // An older client still sends observations but has no video field.
  assert.equal((await e.post({...good,action:'edit',observations},[],token)).status,200);assert.equal((await own()).video.id,second);assert.equal((await check()).status,404);
  await e.admin({do:'community_review',review_id:id,status:'published'});
  assert.equal((await e.post({action:'report',review_id:id,reason:'The attached external video needs a moderator check.'})).status,201);
  for(const status of ['hidden','rejected']){await e.admin({do:'community_review',review_id:id,status});assert.equal((await check()).status,404);}
  await e.admin({do:'community_review',review_id:id,status:'published'});
  assert.equal((await e.post({...good,action:'edit',youtube_video:''},[],token)).status,200);assert.equal((await own()).video,null);
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await check()).status,404);
  assert.equal((await e.post({...good,action:'edit',youtube_video:first},[],token)).status,200);await e.admin({do:'community_review',review_id:id,status:'published'});
  const deletedHash=await e.reviewHash(id);assert.equal((await e.post({action:'delete'},[],token)).status,200);assert.equal((await check()).status,404);assert.equal((await own()).video,null);
  assert.equal((await e.admin({do:'community_review',review_id:id,status:'published',expected_hash:deletedHash})).status,409);
  assert.equal(e.sql(`echo (int)$p->query('SELECT COUNT(*) FROM community_observations WHERE review_id=${id}')->fetchColumn();`).trim(),'0');
 }finally{e.close();}
});

test('a video replacement during moderation rendering cannot borrow the displayed video decision hash',{skip:!capable},async()=>{
 const e=await env('',18978);try{
  const first='abcdefghijk',second='lmnopqrstuv',created=await(await e.post({...good,youtube_video:first,observations:JSON.stringify({noise:'quiet'})})).json();
  const {id,token}=created;
  const raced=JSON.parse(e.sql(`
   putenv('KAMPTRAIL_CONFIG='.${JSON.stringify(path.join(e.dir,'config.php'))});
   require ${JSON.stringify(path.join(root,'api/_lib/community-admin.php'))};
   function h($value): string {return htmlspecialchars((string)$value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
   $p->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE,PDO::FETCH_ASSOC);
   class KtModerationRaceStatement extends PDOStatement {
    public static bool $armed=true;
    protected function __construct(private PDO $connection) {}
    public function fetchColumn(int $column=0): mixed {
     $displayed=parent::fetchColumn($column);
     if(self::$armed && $this->queryString==='SELECT details FROM community_observations WHERE review_id=?'){
      self::$armed=false;
      $this->connection->prepare('UPDATE community_observations SET details=? WHERE review_id=?')->execute([${JSON.stringify(JSON.stringify({noise:'quiet',video_id:second}))},${id}]);
     }
     return $displayed;
    }
   }
   $before=kc_row($p,${id});
   $p->setAttribute(PDO::ATTR_STATEMENT_CLASS,[KtModerationRaceStatement::class,[$p]]);
   $html=kc_admin_body($p,'fixture-csrf','admin.php');
   $after=kc_row($p,${id});
   echo json_encode(['html'=>$html,'before'=>$before,'after'=>$after,'current_hash'=>kc_review_hash($p,$after),'interleaved'=>!KtModerationRaceStatement::$armed]);
  `));
  assert.equal(raced.interleaved,true,'The attachment changes after its displayed value is read');
  assert.deepEqual(raced.before,raced.after,'Review fields, status and timestamp remain identical');
  assert.match(raced.html,new RegExp('watch\\?v='+first));assert.ok(!raced.html.includes('watch?v='+second));
  const displayedHash=raced.html.match(/name="expected_hash" value="([a-f0-9]{64})"/)[1];
  assert.notEqual(displayedHash,raced.current_hash,'The displayed A snapshot must not receive the current B hash');
  const decision=await e.admin({do:'community_review',review_id:id,status:'published',expected_hash:displayedHash});
  assert.equal(decision.status,409);assert.match(await decision.text(),/review changed/);
  const own=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.equal(own.review.status,'pending');assert.equal(own.review.video.id,second);
  assert.equal((await e.admin({do:'community_review',review_id:id,status:'published'})).status,200,'Fresh inspection of B can be approved');
 }finally{e.close();}
});

// 2.33.0 deterministic identity: a review stored under a legacy id of a listing still attaches to that
// listing when it is read by its index id, and the stored id itself is kept unchanged.
test('reviews keyed to a legacy id attach to the same listing and keep their stored id',{skip:!capable},async()=>{
 const e=await env('',18977);try{
  const legacy={...good,campsite_id:'ridb:232479',campsite_name:'Cosby Campground',observations:JSON.stringify({noise:'quiet'})};
  const res=await e.post(legacy);assert.equal(res.status,201);const {id,token}=await res.json();
  await e.admin({do:'community_review',review_id:id,status:'published'});
  for(const site of ['osm:way:1107154601','ridb:232479']){
   const out=await e.get('/api/community.php?site='+encodeURIComponent(site));
   assert.equal(out.count,1,site+' finds the review');assert.equal(out.reviews[0].id,id);assert.equal(out.monthly.condition_reports,1,site+' monthly');
  }
  // A different listing does not see it.
  assert.equal((await e.get('/api/community.php?site=usfs%3A20680')).count,0);
  const mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();
  assert.equal(mine.review.campsite_id,'ridb:232479','the stored id is not rewritten');
  assert.ok((await e.get('/api/community-discovery.php')).sites['ridb:232479'],'discovery reports it under its stored id; the client maps aliases');
 }finally{e.close();}
});
