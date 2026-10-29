'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const hasPhp=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!hasPhp)throw new Error('PHP with SQLite is required');
test('FCC credential form requires moderator session, CSRF and origin; secrets never return to HTML', {skip:!hasPhp}, async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kt-fcc-form-')),config=path.join(directory,'kamptrail-config.php');
 const data=path.join(directory,'fcc-install','fcc-data');fs.mkdirSync(data,{recursive:true,mode:0o700});fs.chmodSync(data,0o700);
 fs.writeFileSync(config,`<?php return ['db'=>['dsn'=>'sqlite:${directory}/test.sqlite'],'ip_salt'=>'synthetic','moderator_password'=>'synthetic moderator password'];`);fs.chmodSync(config,0o600);
 const port=18955,base=`http://127.0.0.1:${port}`,url=base+'/api/fcc-setup.php';
 const proc=spawn('php',['-S',`127.0.0.1:${port}`,'-t',path.resolve(__dirname,'..')],{env:{...process.env,KAMPTRAIL_CONFIG:config},stdio:'ignore'});
 try{
  let ready=false;for(let i=0;i<50;i++){try{await fetch(url);ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready);
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{method:'POST',body:'fcc_token=synthetic-secret'})).status,403);
  let r=await fetch(base+'/api/admin.php'),html=await r.text(),cookie=r.headers.get('set-cookie').split(';')[0];
  let csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  r=await fetch(base+'/api/admin.php',{method:'POST',redirect:'manual',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,do:'login',password:'synthetic moderator password'})});
  cookie=r.headers.get('set-cookie').split(';')[0];
  r=await fetch(url,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/\bno-store\b/);assert.match(r.headers.get('content-security-policy'),/form-action 'self'/);
  html=await r.text();assert.match(html,/type="password" name="fcc_token" required/);assert.ok(!/name="fcc_token"[^>]*value=/.test(html));csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const submit=(body,origin=base)=>fetch(url,{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,...body})});
  const good={username:'owner@example.invalid',fcc_token:'synthetic-token-value-for-testing'};
  assert.equal((await submit({...good,csrf:'wrong'})).status,403);assert.equal((await submit(good,'https://attacker.invalid')).status,403);
  for(const bad of [{...good,fcc_token:''},{...good,username:''},{...good,fcc_token:'contains spaces'}]){r=await submit(bad);assert.equal(r.status,422);assert.ok(!(await r.text()).includes(good.fcc_token));}
  const file=path.join(data,'credentials.json');assert.equal(fs.existsSync(file),false);
  r=await submit(good);assert.equal(r.status,200);html=await r.text();assert.match(html,/saved privately/);assert.ok(!html.includes(good.fcc_token));assert.ok(!html.includes(good.username));
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{username:good.username,token:good.fcc_token});assert.equal(fs.statSync(file).mode&0o777,0o600);
  r=await fetch(url,{headers:{Cookie:cookie}});html=await r.text();assert.ok(!html.includes(good.fcc_token));assert.ok(!html.includes(good.username));csrf=html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  fs.chmodSync(file,0o644);assert.equal((await submit(good)).status,503);fs.chmodSync(file,0o600);
  fs.renameSync(file,file+'.keep');fs.symlinkSync(file+'.keep',file);assert.equal((await submit(good)).status,503);assert.deepEqual(JSON.parse(fs.readFileSync(file+'.keep')),{username:good.username,token:good.fcc_token});
 }finally{proc.kill();fs.rmSync(directory,{recursive:true,force:true});}
});
