'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');const hasPhp=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!hasPhp)throw new Error('PHP with pdo_sqlite required');
function run(code,enabled=true){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-notice-'));try{const config=path.join(dir,'config.php');fs.writeFileSync(config,`<?php return ['notifications'=>['enabled'=>${enabled?'true':'false'}]];`);const script=path.join(dir,'test.php');fs.writeFileSync(script,`<?php require ${JSON.stringify(root.replaceAll('\\','/')+'/api/_lib/bootstrap.php')}; require ${JSON.stringify(root.replaceAll('\\','/')+'/api/_lib/notifications.php')}; function check($b){if(!$b)throw new Exception('Assertion failed');} $pdo=new PDO('sqlite::memory:');$pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE,PDO::FETCH_ASSOC); ${code}`);const p=spawnSync('php',[script],{env:{...process.env,KAMPTRAIL_CONFIG:config},encoding:'utf8'});assert.equal(p.status,0,p.stderr);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const setup=`kt_migrate($pdo);$now=kt_now();$pdo->exec("INSERT INTO submissions (public_token,kind,details,client_hash,status,created_at,updated_at) VALUES ('private-token','bug','private body','client','received','2026-11-02 12:00:00','2026-11-02 12:00:00')");`;
test('outbox scope, privacy, failure retention, lease exclusion, retry and accepted idempotence',{skip:!hasPhp},()=>run(setup+`
ktn_enqueue($pdo,1,'correction',$now);check($pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn()==0);
ktn_enqueue($pdo,1,'bug',$now);$calls=0;$captured=null;
check(!ktn_dispatch($pdo,1,function($m)use(&$calls,&$captured){$calls++;$captured=$m;throw new Exception('SMTP failure');}));
check($captured!==null);check(!str_contains(json_encode($captured),'private-token'));check(!str_contains(json_encode($captured),'private body'));check(str_contains($captured['body'],'https://kamptrail.com/api/admin.php'));check($calls===1);check($pdo->query('SELECT state FROM notification_outbox')->fetchColumn()==='failed');check($pdo->query('SELECT COUNT(*) FROM submissions')->fetchColumn()==1);
check(!ktn_dispatch($pdo,1,function()use(&$calls){$calls++;return true;}));check($calls===1);
$pdo->exec("UPDATE notification_outbox SET next_attempt_at='2000-01-01 00:00:00'");
check(ktn_dispatch($pdo,1,function()use(&$calls,$pdo){$calls++;check(!ktn_dispatch($pdo,1,fn()=>true));return true;}));
check(!ktn_dispatch($pdo,1,fn()=>true));check(!ktn_retry($pdo,1));check($calls===2);check($pdo->query('SELECT state FROM notification_outbox')->fetchColumn()==='sent');
check(ktn_transport_config()===null);check(!ktn_smtp_send(ktn_message(['kind'=>'feature','submission_id'=>2,'received_at'=>$now])));
`));
test('disabled notifications never backfill reports',{skip:!hasPhp},()=>run(setup+`ktn_enqueue($pdo,1,'bug',$now);check($pdo->query('SELECT COUNT(*) FROM notification_outbox')->fetchColumn()==0);check(ktn_drain($pdo)['attempted']===0);`,false));
test('pending migration does not prevent enqueue caller from retaining report',{skip:!hasPhp},()=>run(`check(!ktn_ready($pdo));ktn_enqueue($pdo,1,'feature',kt_now());`));
test('vendored SMTP dependency and release allowlist are pinned',()=>{const mail=fs.readFileSync(path.join(root,'api/_lib/phpmailer/PHPMailer.php'),'utf8');assert.match(mail,/7\.1\.1/);const release=fs.readFileSync(path.join(root,'scripts/build-release.js'),'utf8');for(const f of ['notifications.php','notification-worker.php','phpmailer/PHPMailer.php','phpmailer/SMTP.php','phpmailer/Exception.php','phpmailer/LICENSE'])assert.ok(release.includes('api/_lib/'+f));});
