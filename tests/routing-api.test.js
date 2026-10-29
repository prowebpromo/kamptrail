'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const{spawn,spawnSync,execFileSync}=require('node:child_process');const root=path.resolve(__dirname,'..');
const capable=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")?0:1);']).status===0;if(process.env.KT_REQUIRE_PHP==='1'&&!capable)throw new Error('Routing API tests require PHP PDO SQLite.');
test('fixed-provider routing: validation, migration, geometry, rate limits, and no stored coordinates',{skip:!capable},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-route-')),config=path.join(dir,'config.php');const dsn=process.env.KT_TEST_MYSQL_DSN||'sqlite:'+path.join(dir,'test.sqlite');
 fs.writeFileSync(config,`<?php return ['db'=>['dsn'=>${JSON.stringify(dsn)},'user'=>'root','pass'=>'test-only'],'ip_salt'=>'test-only'];`,{mode:0o600});
 const sql=s=>execFileSync('php',['-r',`$c=require ${JSON.stringify(config)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass']);${s}`],{encoding:'utf8'});
 if(process.env.KT_TEST_MYSQL_DSN)sql("$p->exec('DROP TABLE IF EXISTS routing_events');$p->exec('DROP TABLE IF EXISTS routing_state');try{$p->exec(\"DELETE FROM schema_migrations WHERE version='003_routing'\");}catch(PDOException $e){}");
 let mode='ok',requests=[];const upstream=http.createServer((req,res)=>{requests.push({url:req.url,ua:req.headers['user-agent']});res.setHeader('Content-Type','application/json');if(mode==='bad')return res.end('{');if(mode==='none')return res.end(JSON.stringify({code:'NoRoute'}));const route={geometry:{type:'LineString',coordinates:[[-105,40],[-105,40.5],[-104,41]]},distance:200000,duration:7200,legs:[{distance:200000,duration:7200,annotation:{distance:mode==='unaligned'?[100000]:[100000,100000]}}]};res.end(JSON.stringify({code:'Ok',routes:[route]}));});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const p=spawn('php',['-S','127.0.0.1:18908','-t',root],{env:{...process.env,KAMPTRAIL_CONFIG:config,KAMPTRAIL_TEST_ROUTER:`http://127.0.0.1:${upstream.address().port}/`},stdio:'ignore'});const base='http://127.0.0.1:18908';const post=(points,headers={})=>fetch(base+'/api/route.php',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({points})});
 try{
  for(let i=0;i<60;i++){try{await fetch(base+'/api/health.php');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.equal((await fetch(base+'/api/route.php')).status,405);assert.equal((await post([[0,0],[1,1]],{Origin:'https://wrong.example'})).status,403);
  for(const pts of [null,[],[[0,0]],[[181,0],[1,1]],[[1,86],[1,1]],Array(27).fill([1,1]),[['no',1],[1,1]]])assert.equal((await post(pts)).status,422);
  assert.equal((await post([[-105,40],[-104,41]])).status,503);assert.equal(requests.length,0);
  sql(`require ${JSON.stringify(path.join(root,'api/_lib/bootstrap.php'))};kt_migrate($p);`);
  let r=await post([[-105,40],[-104,41]]);assert.equal(r.status,200);const d=await r.json();assert.equal(d.route.geometry.coordinates.length,3);assert.deepEqual(d.route.leg_ends,[2]);assert.equal(d.route.distance,200000);assert.match(d.route.calculated_at,/^\d{4}-/);assert.match(requests[0].ua,/KampTrail/);assert.match(requests[0].url,/overview=full/);assert.match(requests[0].url,/annotations=distance/);
  assert.equal((await post([[-105,40],[-104,41]])).status,429);assert.equal(requests.length,1,'shared provider limit must reserve before calling upstream');
  const reset=()=>sql("$p->exec('UPDATE routing_state SET last_started_ms=0');");
  for(const [m,status]of [['none',422],['bad',502],['unaligned',502]]){reset();mode=m;assert.equal((await post([[-105,40],[-104,41]])).status,status);}
  const snapshot=sql("foreach(['routing_state','routing_events'] as $t)echo json_encode($p->query('SELECT * FROM '.$t)->fetchAll(PDO::FETCH_ASSOC));");assert.ok(!snapshot.includes('-105'));assert.ok(!snapshot.includes('coordinates'));assert.ok(!snapshot.includes('geometry'));
  reset();sql("for($i=0;$i<60;$i++){$q=$p->prepare('INSERT INTO routing_events (client_hash,created_at) VALUES (?,?)');$q->execute([hash('sha256','test-only|127.0.0.1'),gmdate('Y-m-d H:i:s')]);}");assert.equal((await post([[-105,40],[-104,41]])).status,429);
 }finally{p.kill();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
