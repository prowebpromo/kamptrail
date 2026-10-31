'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const capable=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")&&extension_loaded("mbstring")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('PHP with pdo_sqlite and mbstring is required; permission API tests must not silently skip.');
const place={kind:'spot',id:'spot:40.00000,-110.00000',name:'Permission API test spot',coordinates:[-110,40]};
const good={action:'submit',place,activity:'overnight_occupancy',observation:'granted_to_me',visited_on:'2020-01-01',firsthand:true,display_name:'Test camper',body:'The duty manager allowed my camper to stay for this one night.',authority_role:'Duty manager',authority_office:'Site management office',elapsed_ms:8000,website:''};
async function env(port,migrate=true,concurrent=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-permissions-')),file=path.join(dir,'test-config.php');
 const dsn=process.env.KT_TEST_MYSQL_DSN||'sqlite:'+path.join(dir,'test.sqlite');
 fs.writeFileSync(file,`<?php return ['db'=>['dsn'=>${JSON.stringify(dsn)},'user'=>'root','pass'=>'test-only'],'ip_salt'=>'permission-tests-only','moderator_password'=>'test moderator password','moderator_name'=>'tester'];`);fs.chmodSync(file,0o600);
 const sql=code=>execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`+code],{encoding:'utf8'});
 // This suite shares the disposable MySQL database with community/routing tests.
 // Reset only this feature in foreign-key order; preserve their rows and migrations.
 if(process.env.KT_TEST_MYSQL_DSN)sql("foreach(['permission_flags','permission_audit','permission_events','permission_state','permission_reports'] as $t)$p->exec('DROP TABLE IF EXISTS '.chr(96).$t.chr(96));if($p->query(\"SHOW TABLES LIKE 'schema_migrations'\")->fetchColumn()!==false)$p->exec(\"DELETE FROM schema_migrations WHERE version='005_permissions'\");");
 const p=spawn('php',['-S','127.0.0.1:'+port,'-t',root],{env:{...process.env,KAMPTRAIL_CONFIG:file},stdio:'ignore'}),base='http://127.0.0.1:'+port;
 for(let i=0;i<60;i++){try{await fetch(base+'/api/health.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const secondary=concurrent?spawn('php',['-S','127.0.0.1:'+(port+10),'-t',root],{env:{...process.env,KAMPTRAIL_CONFIG:file},stdio:'ignore'}):null;
 if(secondary)for(let i=0;i<60;i++){try{await fetch('http://127.0.0.1:'+(port+10)+'/api/health.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 let cookie='';const grab=res=>{const c=res.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return res;};
 const login=await grab(await fetch(base+'/api/admin.php')).text();const csrf=login.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const admin=async fields=>grab(await fetch(base+'/api/admin.php?permissions=1',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams({csrf,...fields})}));
 await admin({do:'login',password:'test moderator password'});if(migrate)await admin({do:'migrate'});
 const post=(data,token,headers={})=>fetch(base+'/api/permissions.php',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(data)});
 const parallelPost=(data,token)=>fetch('http://127.0.0.1:'+(port+10)+'/api/permissions.php',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)});
 const list=async(activity='overnight_occupancy',at=place)=>{const r=await post({action:'read',place:at,activity});assert.equal(r.status,200);return r.json();};
 const own=token=>post({action:'owner'},token);
 const queue=async(state='pending')=>(await fetch(base+'/api/admin.php?permissions=1&state='+state,{headers:{Cookie:cookie}})).text();
 return {base,p,dir,post,parallelPost,list,own,admin,sql,queue,cookie:()=>cookie,csrf,close:()=>{p.kill();if(secondary)secondary.kill();fs.rmSync(dir,{recursive:true,force:true});}};
}
const options={skip:!capable};
test('permission ownership, moderation, optimistic races, flag queue and irreversible erasure',options,async()=>{
 const e=await env(18966,true,true);try{
  let response=await e.post(good);assert.equal(response.status,201);const a=await response.json();assert.match(a.token,/^[a-f0-9]{64}$/);assert.equal(a.version,1);
  response=await e.post({...good,display_name:'Other camper'});assert.equal(response.status,201);const b=await response.json();assert.notEqual(a.token,b.token);
  const mine=async()=>{const r=await e.own(a.token);assert.equal(r.status,200);return (await r.json()).report;};
  let report=await mine();assert.equal(report.status,'pending');assert.equal(report.version,1);assert.deepEqual(report.place,place);assert.equal((await e.list()).count,0);
  assert.equal((await e.own()).status,401);assert.equal((await e.own('x'.repeat(64))).status,401);assert.equal((await e.own('b'.repeat(64))).status,404);
  for(const action of ['edit','delete'])assert.equal((await e.post(action==='edit'?{...good,action,id:a.id,version:1}:{action,id:a.id,version:1},b.token)).status,404,'second owner cannot mutate first report');
  assert.equal((await e.post({...good,action:'edit',id:a.id,version:1})).status,401);
  const hashed=e.sql(`$q=$p->query('SELECT LENGTH(owner_hash) AS n FROM permission_reports ORDER BY id');echo json_encode($q->fetchAll(PDO::FETCH_COLUMN));`);assert.deepEqual(JSON.parse(hashed).map(Number),[32,32]);
  let res=await e.admin({do:'permission_moderate',id:a.id,version:1,status:'published'});assert.equal(res.status,200);
  let pub=await e.list();assert.equal(pub.count,1);assert.equal(pub.reports[0].observation,'granted_to_me');assert.equal(pub.official.status,'unknown');assert.equal(pub.reports_available,true);
  for(const field of [a.token,'owner_hash','public_note','firsthand','place_name'])assert.ok(!JSON.stringify(pub.reports).includes(field));
  assert.equal((await e.list('unoccupied_vehicle_parking')).count,0);assert.equal((await e.list('unoccupied_vehicle_parking')).official.activity,'unoccupied_vehicle_parking');
  assert.equal((await e.list('overnight_occupancy',{...place,id:'spot:40.00001,-110.00000',coordinates:[-110,40.00001]})).count,0,'adjacent coordinate not same identity');
  report=await mine();assert.equal(report.version,2);
  res=await e.post({action:'flag',id:a.id,reason:'This one-night claim needs a moderator to review its scope.',elapsed_ms:5000,website:''});assert.equal(res.status,201);
  let queue=await e.queue('flags');assert.match(queue,/one-night claim/);const flagId=queue.match(/name="flag_id" value="(\d+)"/)[1];
  res=await e.admin({do:'permission_flag',id:a.id,version:2,flag_id:flagId,flag_version:1});assert.equal(res.status,200);assert.doesNotMatch(await e.queue('flags'),/one-night claim/);
  assert.equal((await e.admin({do:'permission_flag',id:a.id,version:2,flag_id:flagId,flag_version:1})).status,409);
  const forged=await fetch(e.base+'/api/admin.php?permissions=1',{method:'POST',headers:{Cookie:e.cookie(),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'forged',do:'permission_moderate',id:a.id,version:2,status:'rejected'})});assert.equal(forged.status,400);assert.equal((await e.list()).count,1);
  assert.equal((await e.admin({do:'permission_moderate',id:a.id,version:1,status:'rejected'})).status,409);assert.equal((await e.list()).count,1);
  const edits=await Promise.all([e.post({...good,action:'edit',id:a.id,version:2,body:'Updated firsthand details for the same individual overnight permission.'},a.token),e.parallelPost({...good,action:'edit',id:a.id,version:2,body:'A competing draft cannot overwrite the saved firsthand report.'},a.token)]);
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);report=await mine();assert.equal(report.status,'pending');assert.equal(report.version,3);assert.equal((await e.list()).count,0);
  assert.equal((await e.post({action:'delete',id:a.id,version:2},a.token)).status,409);
  assert.equal((await e.admin({do:'permission_moderate',id:a.id,version:3,status:'rejected',public_note:'Please clarify the office.'})).status,200);report=await mine();assert.equal(report.version,4);assert.equal(report.public_note,'Please clarify the office.');
  assert.equal((await e.post({...good,action:'edit',id:a.id,version:4},a.token)).status,200);
  assert.equal((await e.admin({do:'permission_moderate',id:a.id,version:5,status:'published'})).status,200);
  const race=await Promise.all([e.parallelPost({action:'delete',id:a.id,version:6},a.token),e.admin({do:'permission_moderate',id:a.id,version:6,status:'rejected'})]);
  assert.equal(race.filter(r=>r.status===200).length,1,'delete vs moderation exactly one wins');
  let owned=await e.own(a.token);if(owned.status===200){report=(await owned.json()).report;assert.equal((await e.post({action:'delete',id:a.id,version:report.version},a.token)).status,200);}else assert.equal(owned.status,404);
  assert.equal((await e.own(a.token)).status,404);assert.equal((await e.post({...good,action:'edit',id:a.id,version:7},a.token)).status,404);
  await e.admin({do:'permission_moderate',id:a.id,version:7,status:'published'});assert.equal((await e.list()).count,0);
  const tombstone=JSON.parse(e.sql(`$q=$p->query('SELECT * FROM permission_reports WHERE id=${a.id}');echo json_encode($q->fetch(PDO::FETCH_ASSOC));`));
  assert.equal(tombstone.status,'deleted');assert.equal(tombstone.owner_hash,null);assert.equal(tombstone.lng,null);assert.equal(tombstone.lat,null);
  for(const field of ['body','display_name','place_key','place_id','place_kind','place_name','authority_role','authority_office','visited_on','public_note'])assert.equal(tombstone[field],'',field+' erased');
  assert.equal(e.sql(`echo $p->query('SELECT reason FROM permission_flags WHERE report_id=${a.id}')->fetchColumn();`),'');
  const audit=JSON.parse(e.sql(`echo json_encode($p->query('SELECT action FROM permission_audit WHERE report_id=${a.id} ORDER BY id')->fetchAll(PDO::FETCH_COLUMN));`));assert.ok(audit.includes('delete'));assert.ok(audit.includes('moderate'));assert.ok(audit.includes('resolve_flag'));
  assert.equal((await e.own(b.token)).status,200,'second owner remains independent');
 }finally{e.close();}
});
test('permission validation, exact origins, method privacy, rate labels and migration retry',options,async()=>{
 const e=await env(18967);try{
  assert.equal((await fetch(e.base+'/api/permissions.php?place=private')).status,405);
  assert.equal((await fetch(e.base+'/api/permissions.php?token=secret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read',place})})).status,422);
  assert.equal((await e.post({action:'read',place},null,{Origin:e.base})).status,200);
  for(const origin of [e.base.replace('http:','https:'),e.base.replace('18967','18968'),'http://localhost:18967','null','http://evil.example','http://127.0.0.1:18967/path'])assert.equal((await e.post({action:'read',place},null,{Origin:origin})).status,403,origin);
  assert.equal((await e.post({action:'read',place},null,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await e.post({action:'read',place},null,{'Content-Type':'text/plain'})).status,415);
  for(const changes of [{firsthand:'1'},{visited_on:'2999-01-01'},{visited_on:'2025-02-30'},{authority_role:''},{authority_office:''},{display_name:'x'.repeat(61)},{body:'é'.repeat(3001)},{rating:5},{observation:'permission_for_everyone'},{activity:'parking'},{elapsed_ms:2999},{website:'spam.example'},{place:{...place,id:'spot:41.00000,-110.00000'}},{place:{...place,coordinates:['-110',40]}},{place:{...place,url:'https://evil.example'}}])assert.equal((await e.post({...good,...changes})).status,422,JSON.stringify(changes));
  assert.equal((await e.post({...good,display_name:'😀'.repeat(60)})).status,201,'limits count UTF-8 characters');
  for(let i=0;i<4;i++)assert.equal((await e.post({...good,observation:'stayed_without_asking',authority_role:'',authority_office:''})).status,201);
  assert.equal((await e.post(good)).status,429);
  const labels=JSON.parse(e.sql("echo json_encode($p->query('SELECT DISTINCT kind FROM permission_events')->fetchAll(PDO::FETCH_COLUMN));"));assert.deepEqual(labels,['permission_submit']);
  const before=e.sql("echo $p->query('SELECT COUNT(*) FROM permission_reports')->fetchColumn();");
  e.sql("$p->exec(\"DELETE FROM schema_migrations WHERE version='005_permissions'\");");
  let read=await e.list();assert.equal(read.reports_available,false);assert.equal(read.official.status,'unknown');
  assert.equal((await e.post(good)).status,503);
  await e.admin({do:'migrate'});assert.equal(e.sql("echo $p->query('SELECT COUNT(*) FROM permission_reports')->fetchColumn();"),before);assert.equal((await e.list()).reports_available,true);
  const res=await e.post({action:'read',place});assert.equal(res.headers.get('cache-control'),'no-store');
 }finally{e.close();}
});
test('official reads work without migrated reports; reads never write or create tables',options,async()=>{
 const e=await env(18968,false);try{
  const tables=()=>e.sql(process.env.KT_TEST_MYSQL_DSN?"echo json_encode($p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN));":"echo json_encode($p->query(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\")->fetchAll(PDO::FETCH_COLUMN));");
  const before=tables();
  const data=await e.list();assert.equal(data.reports_available,false);assert.equal(data.official.status,'unknown');assert.deepEqual(data.reports,[]);assert.equal((await e.post(good)).status,503);
  assert.equal(tables(),before,'unmigrated reads/writes leave the existing shared schema intact');
  assert.ok(!JSON.parse(before).some(name=>name.startsWith('permission_')));
 }finally{e.close();}
});

// ---- Visitor answers: explicit, moderated, one per visitor per place, tallied apart from permission ----
test('visitor answers are moderated, limited to one per place, tallied separately and never change official status',options,async()=>{
 const e=await env(18996);try{
  const answer={...good,observation:'stay_allowed',body:'',authority_role:'',authority_office:'',display_name:'Answer camper'};
  const other={...place,id:'spot:41.00000,-111.00000',coordinates:[-111,41],name:'Second answer spot'};
  const before=await e.list();assert.deepEqual(before.answers,{allowed:0,not_allowed:0,latest_allowed:null,latest_not_allowed:null,disagreement:false});
  assert.equal((await e.post({...answer,activity:'unoccupied_vehicle_parking'})).status,422,'answers are about overnight stays only');
  assert.equal((await e.post({...answer,authority_role:'Manager',authority_office:'Office'})).status,422,'answers do not name an authority');
  assert.equal((await e.post({...answer,body:'x'.repeat(1001)})).status,422);
  let r=await e.post(answer);assert.equal(r.status,201);const a=await r.json();
  r=await e.post({...answer,observation:'stay_not_allowed'});assert.equal(r.status,409,'second answer for the same place from the same visitor');assert.equal((await r.json()).error,'already_answered');
  r=await e.post({...answer,place:other});assert.equal(r.status,201,'another place is a separate answer');
  assert.equal((await e.list()).answers.allowed,0,'pending answers are never counted');
  assert.equal((await e.admin({do:'permission_moderate',id:a.id,version:1,status:'published'})).status,200);
  let read=await e.list();assert.equal(read.answers.allowed,1);assert.equal(read.answers.latest_allowed,'2020-01-01');assert.equal(read.answers.disagreement,false);
  assert.equal(read.official.status,'unknown','a visitor answer never changes the source conclusion');
  r=await e.post({...answer,action:'edit',id:a.id,version:2,observation:'granted_to_me',body:'The duty manager allowed my camper to stay for this one night.',authority_role:'Duty manager',authority_office:'Site office'},a.token);assert.equal(r.status,422,'an answer cannot become a narrative report');assert.equal((await r.json()).error,'type_changed');
  r=await e.post({...answer,action:'edit',id:a.id,version:2,observation:'stay_not_allowed',visited_on:'2021-05-01'},a.token);assert.equal(r.status,200);
  assert.equal((await e.list()).answers.not_allowed,0,'an edited answer returns to moderation');
  await e.admin({do:'permission_moderate',id:a.id,version:3,status:'published'});read=await e.list();
  assert.equal(read.answers.not_allowed,1);assert.equal(read.answers.allowed,0);assert.equal(read.answers.latest_not_allowed,'2021-05-01');
  const second=await (await e.post({...good,display_name:'Narrative camper'})).json();await e.admin({do:'permission_moderate',id:second.id,version:1,status:'published'});
  read=await e.list();assert.equal(read.answers.not_allowed,1,'narrative reports are not counted as answers');assert.equal(read.count,2);
  assert.match(await e.queue('published'),/VISITOR ANSWER: overnight stay not allowed/);
  assert.equal((await e.post({action:'read',place,activity:'unoccupied_vehicle_parking'})).status,200);assert.equal((await (await e.post({action:'read',place,activity:'unoccupied_vehicle_parking'})).json()).answers,null);
 }finally{e.close();}
});
test('two visitors who disagree are both counted and the disagreement is visible',options,async()=>{
 const e=await env(19026);try{
  const answer={...good,body:'',authority_role:'',authority_office:'',display_name:'Answer camper'};
  const a=await (await e.post({...answer,observation:'stay_allowed'})).json();
  const b=await (await e.post({...answer,observation:'stay_not_allowed'},null,{'X-Forwarded-For':'203.0.113.9'})).json().catch(()=>({}));
  // The PHP dev server sees one client address; a second visitor is simulated by clearing the duplicate marker.
  e.sql("$p->exec(\"DELETE FROM permission_events WHERE kind LIKE 'stay:%'\");");
  const c=await (await e.post({...answer,observation:'stay_not_allowed',visited_on:'2022-02-02'})).json();
  for(const x of [a,c])assert.equal((await e.admin({do:'permission_moderate',id:x.id,version:1,status:'published'})).status,200);
  const read=await e.list();assert.equal(read.answers.allowed,1);assert.equal(read.answers.not_allowed,1);assert.equal(read.answers.disagreement,true);assert.equal(read.official.status,'unknown');
  assert.equal(b.error,'already_answered','a forwarded-for header does not create a second visitor');
 }finally{e.close();}
});
