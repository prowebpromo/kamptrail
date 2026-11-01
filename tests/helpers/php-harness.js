'use strict';
// Isolated staging harness: the real PHP application served from this checkout by `php -S`, with a disposable
// SQLite database (or KT_TEST_MYSQL_DSN) and a test-only moderator. It never contacts production.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{spawn,spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const capable=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")&&extension_loaded("gd")&&extension_loaded("mbstring")?0:1);']).status===0;
async function start({port,mysql=process.env.KT_TEST_MYSQL_DSN||''}={}){
 if(!port)throw new Error('port required');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-harness-')),file=path.join(dir,'config.php');
 const dsn=mysql||'sqlite:'+path.join(dir,'test.sqlite');
 fs.writeFileSync(file,`<?php return ['db'=>['dsn'=>${JSON.stringify(dsn)},'user'=>'root','pass'=>'test-only'],'ip_salt'=>'harness-only-salt','moderator_password'=>'harness moderator password','moderator_name'=>'harness'];`);fs.chmodSync(file,0o600);
 if(mysql)execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass']);$p->exec('SET FOREIGN_KEY_CHECKS=0');foreach($p->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t)$p->exec('DROP TABLE '.chr(96).$t.chr(96));`]);
 const p=spawn('php',['-d','upload_max_filesize=7M','-d','post_max_size=20M','-S','127.0.0.1:'+port,'-t',root],{cwd:root,env:{...process.env,KAMPTRAIL_CONFIG:file},stdio:'ignore'}),base='http://127.0.0.1:'+port;
 let up=false;for(let i=0;i<80;i++){try{await fetch(base+'/api/health.php');up=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!up){p.kill();throw new Error('PHP harness did not start on '+base);}
 let cookie='';const grab=res=>{const c=res.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return res;};
 const csrf=(await grab(await fetch(base+'/api/admin.php')).text()).match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const reviewHash=async id=>{
  const html=await(await fetch(base+'/api/admin.php?community=1&state=all&before='+(Number(id)+1),{headers:{Cookie:cookie}})).text();
  const form=[...html.matchAll(/<form[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]).find(b=>b.includes('name="do" value="community_review"')&&b.includes('name="review_id" value="'+id+'"'));
  if(!form)throw new Error('moderation form missing for review '+id);return form.match(/name="expected_hash" value="([a-f0-9]{64})"/)[1];
 };
 const admin=async fields=>{
  if(fields.do==='community_review'&&!Object.hasOwn(fields,'expected_hash'))fields={...fields,expected_hash:await reviewHash(fields.review_id)};
  return grab(await fetch(base+'/api/admin.php?community=1',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie},body:new URLSearchParams({csrf,video_reviewed:'1',...fields})}));
 };
 await admin({do:'login',password:'harness moderator password'});await admin({do:'migrate'});
 const sql=code=>execFileSync('php',['-r',`$c=require ${JSON.stringify(file)};$p=new PDO($c['db']['dsn'],$c['db']['user'],$c['db']['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);`+code],{encoding:'utf8'});
 // Submissions share one loopback address; clear the hourly quota so a test can submit many reviews.
 const resetQuota=()=>sql(`$p->exec('DELETE FROM community_events');`);
 const form=fields=>{const f=new FormData();for(const[k,v]of Object.entries(fields))f.set(k,v);return f;};
 return {base,root,dsn,admin,reviewHash,sql,resetQuota,cookie:()=>cookie,
  moderationQueue:async id=>(await fetch(base+'/api/admin.php?community=1&state=all&before='+(Number(id)+1),{headers:{Cookie:cookie}})).text(),
  publish:id=>admin({do:'community_review',review_id:id,status:'published'}),
  get:async url=>(await fetch(base+url)).json(),
  own:async token=>(await(await fetch(base+'/api/community.php',{headers:{Authorization:'Bearer '+token}})).json()).review,
  post:(fields,token)=>fetch(base+'/api/community.php',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:form(fields)}),
  close:()=>{p.kill();fs.rmSync(dir,{recursive:true,force:true});}};
}
module.exports={start,capable,root};
