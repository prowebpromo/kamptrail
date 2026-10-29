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
 const admin=async fields=>grab(await fetch(base+'/api/admin.php?community=1',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams({csrf,...fields})}));
 await admin({do:'login',password:'test moderator password'});await admin({do:'migrate'});
 const sql=code=>execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`+code],{encoding:'utf8'});
 return {base,p,dir,admin,sql,cookie:()=>cookie,csrf,get:async url=>(await fetch(base+url)).json(),post:(fields,photos=[],token)=>fetch(base+'/api/community.php',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:form(fields,photos)}),close:()=>{p.kill();fs.rmSync(dir,{recursive:true,force:true});}};
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
  queue=await (await fetch(e.base+'/api/admin.php?community=1&state=all',{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/0 \/ 256 MB/);
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

test('published observations and rating discovery follow moderation, edit, hide, restore and delete',{skip:!capable},async()=>{
 const e=await env('',18907);try{
  const details={access:'moderate',noise:'quiet',shade:'partial',crowding:'sparse',comfort:'comfortable',signals:[{carrier:'verizon',signal:'usable',environment:'inside_rv'}]};
  const fields={...good,observations:JSON.stringify(details)};
  const discovery=()=>e.get('/api/community-discovery.php');
  for(const bad of ['not json',JSON.stringify({noise:'secret'}),JSON.stringify({other:'x'}),JSON.stringify({signals:[{carrier:'verizon',signal:'usable'},{carrier:'verizon',signal:'none'}]})])assert.equal((await e.post({...good,observations:bad})).status,422);
  const res=await e.post(fields);assert.equal(res.status,201);const {id,token}=await res.json();
  assert.deepEqual((await discovery()).sites,{});
  let mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.deepEqual(mine.review.observations,details);
  let queue=await(await fetch(e.base+'/api/admin.php?community=1',{headers:{Cookie:e.cookie()}})).text();assert.match(queue,/approve with review/);assert.match(queue,/inside_rv/);
  await e.admin({do:'community_review',review_id:id,status:'published'});
  let data=await discovery(),row=data.sites[good.campsite_id];assert.equal(row.rating_count,1);assert.equal(row.rating_sum,4);assert.equal(row.observations[0].latest_visit,good.visited_on);assert.deepEqual(row.observations[0].values,details);
  for(const hidden of [token,'owner_hash','display_name',good.body,good.display_name])assert.ok(!JSON.stringify(data).includes(hidden));
  const revision=data.revision;await e.admin({do:'community_review',review_id:id,status:'hidden'});assert.deepEqual((await discovery()).sites,{});
  assert.equal((await fetch(e.base+'/api/community-discovery.php?revision='+revision)).status,409);
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await discovery()).sites[good.campsite_id].rating_count,1);
  assert.equal((await e.post({...fields,action:'edit',rating:'5'},[],token)).status,200);assert.deepEqual((await discovery()).sites,{});
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.equal((await discovery()).sites[good.campsite_id].rating_sum,5);
  // An older client without observation fields preserves them. A new explicit empty object clears them.
  assert.equal((await e.post({...good,action:'edit'},[],token)).status,200);mine=await(await fetch(e.base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json();assert.deepEqual(mine.review.observations,details);
  assert.equal((await e.post({...fields,action:'edit',observations:'{}'},[],token)).status,200);
  await e.admin({do:'community_review',review_id:id,status:'published'});assert.deepEqual((await discovery()).sites[good.campsite_id].observations,[]);
  assert.equal((await e.post({action:'delete'},[],token)).status,200);assert.deepEqual((await discovery()).sites,{});
  assert.equal((await fetch(e.base+'/api/community-discovery.php',{method:'POST'})).status,405);
 }finally{e.close();}
});

test('additive observation migration preserves legacy reviews/photos and paginated discovery is revision-consistent',{skip:!capable},async()=>{
 const e=await env('',18908);try{
  const response=await e.post(good,[{}]);const {id}=await response.json();await e.admin({do:'community_review',review_id:id,status:'published'});
  e.sql("$p->exec('DROP TABLE community_observations');$p->exec('DROP TABLE community_discovery_state');$p->exec(\"DELETE FROM schema_migrations WHERE version='004_observations'\");");
  const snapshot=()=>e.sql("$r=$p->query('SELECT * FROM community_reviews ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);$s=$p->query('SELECT used_bytes FROM community_storage WHERE id=1')->fetchColumn();$rows=$p->query('SELECT image_data,byte_size,status FROM community_photos ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);foreach($rows as &$row)$row['image_data']=base64_encode($row['image_data']);echo hash('sha256',json_encode([$r,$s,$rows]));");
  const before=snapshot();assert.equal((await e.get('/api/health.php')).community,'ready');assert.equal((await fetch(e.base+'/api/community-discovery.php')).status,503);
  await e.admin({do:'migrate'});assert.equal(snapshot(),before);let d=await e.get('/api/community-discovery.php');assert.equal(d.revision,'1');assert.equal(d.sites[good.campsite_id].rating_count,1);assert.deepEqual(d.sites[good.campsite_id].observations,[]);
  await e.admin({do:'migrate'});assert.equal(snapshot(),before);
  // Recover safely when DDL succeeded but its migration-version insert was interrupted.
  e.sql("$p->exec(\"DELETE FROM schema_migrations WHERE version='004_observations'\");");await e.admin({do:'migrate'});assert.equal(snapshot(),before);
  e.sql(`$q=$p->prepare("INSERT INTO community_reviews(owner_hash,campsite_id,campsite_name,display_name,rating,body,visited_on,rig,status,created_at,updated_at) VALUES(?,?,?,?,4,?,'2026-10-01','','published','2026-10-01','2026-10-01')");for($i=0;$i<102;$i++){$q->execute([hash('sha256','synthetic-'.$i),'qa:'.sprintf('%03d',$i),'Synthetic pagination fixture','Fixture','Disposable review fixture for pagination.']);} $review=$p->query("SELECT id FROM community_reviews WHERE campsite_id='qa:000'")->fetchColumn();$p->prepare('INSERT INTO community_observations(review_id,details) VALUES(?,?)')->execute([$review,'{"noise":"quiet"}']);`);
  d=await e.get('/api/community-discovery.php');assert.equal(Object.keys(d.sites).length,100);assert.ok(d.next_after);const next=await e.get('/api/community-discovery.php?after='+encodeURIComponent(d.next_after)+'&revision='+d.revision);assert.equal(next.next_after,null);assert.equal(Object.keys(next.sites).length,3);assert.equal(new Set([...Object.keys(d.sites),...Object.keys(next.sites)]).size,103);
  await e.admin({do:'community_review',review_id:id,status:'hidden'});assert.equal((await fetch(e.base+'/api/community-discovery.php?after='+encodeURIComponent(d.next_after)+'&revision='+d.revision)).status,409);
 }finally{e.close();}
});
