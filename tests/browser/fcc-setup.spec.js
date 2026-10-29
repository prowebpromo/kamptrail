const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const hasPhp=spawnSync('php',['-r','exit(extension_loaded("pdo_sqlite")?0:1);']).status===0;
if(process.env.KT_REQUIRE_PHP==='1'&&!hasPhp)throw new Error('PHP with SQLite is required');

test('native browser form saves FCC credentials without an opaque Origin',async({page})=>{
 test.skip(!hasPhp,'PHP with SQLite is required');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kt-fcc-browser-'));
 const config=path.join(directory,'kamptrail-config.php'),data=path.join(directory,'fcc-install','fcc-data');
 fs.mkdirSync(data,{recursive:true,mode:0o700});fs.chmodSync(data,0o700);
 fs.writeFileSync(config,`<?php return ['db'=>['dsn'=>'sqlite:${directory}/test.sqlite'],'ip_salt'=>'synthetic','moderator_password'=>'synthetic moderator password'];`);fs.chmodSync(config,0o600);
 const base='http://127.0.0.1:18956',url=base+'/api/fcc-setup.php';
 const proc=spawn('php',['-S','127.0.0.1:18956','-t',path.resolve(__dirname,'../..')],{env:{...process.env,KAMPTRAIL_CONFIG:config},stdio:'ignore'});
 try{
  await expect.poll(async()=>{try{return (await fetch(url)).status;}catch{return 0;}}).toBe(403);
  await page.goto(base+'/api/admin.php');
  await page.locator('input[name="password"]').fill('synthetic moderator password');
  await page.locator('button').filter({hasText:/Sign in/i}).click();
  const response=await page.goto(url);expect(response.status()).toBe(200);
  expect(response.headers()['referrer-policy']).toBe('same-origin');
  const email='owner@example.invalid',token='synthetic-token-value-for-browser-testing';
  await page.getByLabel('FCC account email',{exact:true}).fill(email);
  await page.getByLabel('FCC API token',{exact:true}).fill(token);
  const submitted=page.waitForRequest(r=>r.url()===url&&r.method()==='POST');
  await page.getByRole('button',{name:'Save FCC credentials',exact:true}).click();
  expect((await submitted).headers().origin).toBe(base);
  await expect(page.getByText(/FCC credentials saved privately/)).toBeVisible();
  const html=await page.content();expect(html).not.toContain(token);expect(html).not.toContain(email);
  expect(await page.getByLabel('FCC API token',{exact:true}).inputValue()).toBe('');
  const file=path.join(data,'credentials.json');expect(JSON.parse(fs.readFileSync(file))).toEqual({username:email,token});
  expect(fs.statSync(file).mode&0o777).toBe(0o600);
 }finally{proc.kill();fs.rmSync(directory,{recursive:true,force:true});}
});
