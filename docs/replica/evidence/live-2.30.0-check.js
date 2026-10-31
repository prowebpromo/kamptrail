// Live check for 2.30.0: approach maximum, signal technology, mapping note, saved-session upgrade. Read-only.
const {chromium}=require('playwright');
const EXPECT=process.argv[2]||'';const BASE='https://kamptrail.com/';const res=[];
const rec=(n,ok,d='')=>{res.push(ok);console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' | '+d:''}`);};
(async()=>{
 const rel=await (await fetch(BASE+'release.json?n='+Date.now())).json();rec('release.json matches merge',rel.source_commit===EXPECT,rel.source_commit);
 const health=await fetch(BASE+'api/health.php?n='+Date.now());rec('api/health.php 200',health.status===200,String(health.status));
 const b=await chromium.launch();
 for(const [label,vp,mobile] of [['desktop',{width:1280,height:900},false],['mobile',{width:390,height:844},true]]){
  const c=await b.newContext({viewport:vp,isMobile:mobile,serviceWorkers:'block'});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  // Saved session from 2.29.1: a stored approach filter, a saved stop and position must survive the upgrade.
  await p.addInitScript(()=>{if(sessionStorage.getItem('kt_seeded'))return;sessionStorage.setItem('kt_seeded','1');localStorage.setItem('kt_last_position',JSON.stringify({lat:39.33,lng:-108.7,zoom:10}));const prev=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');localStorage.setItem('kt_filters_mvp',JSON.stringify({...prev,observed_access:'moderate'}));localStorage.setItem('kt_trip',JSON.stringify([{id:'test:upgrade',feature:{type:'Feature',geometry:{type:'Point',coordinates:[-108.7,39.33]},properties:{id:'test:upgrade',name:'Upgrade check stop',type:'spot'}},note:'',arrive:'',depart:''}]));});
  await p.goto(BASE);await p.waitForFunction(()=>window.KampTrailData?.getLoadStatus?.().totalSites>0&&!KampTrailData.getLoadStatus().loading,null,{timeout:90000});
  if(label==='desktop')rec('page version 2.30.0',await p.evaluate(()=>KampTrailDiscovery.version)==='2.30.0');
  const logic=await p.evaluate(()=>{const D=KampTrailDiscovery;const site=a=>({rating_count:1,rating_sum:4,latest_visit:'2026-10-01',observations:[{latest_visit:'2026-10-01',values:{access:a,signals:[{carrier:'verizon',signal:'usable',environment:'outside'}]}}]});
    const m=(s,f)=>D.matchesSummary?D.matchesSummary(s,f):null;
    return {upModEasy:m(site('easy'),{observed_access:'moderate'}),upModDiff:m(site('difficult'),{observed_access:'moderate'}),easyOnlyMod:m(site('moderate'),{observed_access:'easy'}),unknown:m(site(undefined),{observed_access:'difficult'}),radioUnknown:m(site('easy'),{observed_radio:'lte'})};});
  rec(`${label}: approach maximum and unknown handling`,logic.upModEasy===true&&logic.upModDiff===false&&logic.easyOnlyMod===false&&logic.unknown===false,JSON.stringify(logic));
  rec(`${label}: report without technology never matches a technology filter`,logic.radioUnknown===false);
  await p.locator('#filters').click();await p.waitForTimeout(600);
  const approach=p.getByLabel('Reported approach for your rig',{exact:false});const opts=await approach.locator('option').allInnerTexts().catch(()=>[]);
  rec(`${label}: approach options`,['Easy only','Up to moderate','Up to difficult'].every(o=>opts.includes(o)),opts.join(' / '));
  rec(`${label}: saved approach value upgraded as "Up to moderate"`,await approach.inputValue().catch(()=>null)==='moderate');
  const tech=p.getByLabel('Reported technology',{exact:false});rec(`${label}: technology filter present`,await tech.count()>0);
  rec(`${label}: signal mapping note visible`,await p.getByText('ordered visitor categories',{exact:false}).count()>0);
  rec(`${label}: saved stop survives upgrade`,await p.evaluate(()=>(KampTrailTrip.getStops()||[]).some(s=>s.id==='test:upgrade')));
  await p.evaluate(()=>{localStorage.removeItem('kt_trip');const f=JSON.parse(localStorage.getItem('kt_filters_mvp')||'{}');delete f.observed_access;localStorage.setItem('kt_filters_mvp',JSON.stringify(f));});
  rec(`${label}: no page errors`,errs.length===0,errs.slice(0,2).join(' | '));await c.close();
 }
 await b.close();const f=res.filter(x=>!x).length;console.log(`\nSUMMARY pass=${res.length-f} fail=${f}`);process.exit(f?1:0);
})().catch(e=>{console.error('SCRIPT ERROR',e.message);process.exit(3);});
