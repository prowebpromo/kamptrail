/* Published camper evidence. Never treat source ratings or predicted coverage as observations. */
(function(global){
 'use strict';
 const AXES={access:{label:'Approach for your rig',values:{easy:'Easy',moderate:'Moderate',difficult:'Difficult'}},noise:{label:'Noise',values:{quiet:'Quiet',mixed:'Mixed',noisy:'Noisy'}},shade:{label:'Shade',values:{none:'None',partial:'Partial',full:'Full'}},crowding:{label:'Crowding',values:{sparse:'Sparse',moderate:'Moderate',crowded:'Crowded'}},comfort:{label:'Personal comfort',values:{comfortable:'Felt comfortable',concerns:'Had concerns'}}};
 const CARRIERS={att:'AT&T',verizon:'Verizon',tmobile:'T-Mobile',other:'Other carrier'},SIGNAL={none:'No service',weak:'Weak',usable:'Usable',strong:'Strong'},ENVIRONMENTS={unspecified:'Setting not specified',outdoors:'Outdoors',inside_rv:'Inside RV',other_vehicle:'Inside other vehicle'};
 const SIGNAL_FILTER={none:'No service reported',weak:'Weak or better',usable:'Usable or better',strong:'Strong'},SIGNAL_LEVEL={none:0,weak:1,usable:2,strong:3};
 const st={sites:new Map(),mode:'idle',checked:null,error:'',pending:null,generation:0};
 const active=f=>+f.minRating>0||+f.minReviews>1||Object.keys(AXES).some(k=>f['observed_'+k])||!!f.observed_carrier||!!f.observed_signal;
 const conditions=f=>Object.keys(AXES).some(k=>f['observed_'+k])||!!f.observed_carrier||!!f.observed_signal;
 function matchesSummary(s,f,now=Date.now()){
  if(!active(f))return true;
  if(!s||!Number.isInteger(s.rating_count)||s.rating_count<1)return false;
  if(s.rating_count<Math.max(1,+f.minReviews||1))return false;
  if(+f.minRating>0&&s.rating_sum/s.rating_count<+f.minRating)return false;
  if(!conditions(f))return true;
  return matchingGroups(s,f,now).length>0;
 }
 function matchingGroups(s,f,now=Date.now()){
  const cutoff=+f.observedDays>0?new Date(now-(+f.observedDays)*86400000).toISOString().slice(0,10):'0000-00-00';
  return (s.observations||[]).filter(g=>{
   if(g.latest_visit<cutoff)return false;
   const o=g.values||{};
   if(Object.keys(AXES).some(k=>f['observed_'+k]&&o[k]!==f['observed_'+k]))return false;
   return !(f.observed_carrier||f.observed_signal)||(o.signals||[]).some(x=>(!f.observed_carrier||x.carrier===f.observed_carrier)&&(!f.observed_signal||(f.observed_signal==='none'?x.signal==='none':SIGNAL_LEVEL[x.signal]>=SIGNAL_LEVEL[f.observed_signal])));
  });
 }
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const keys=(x,allowed)=>record(x)&&Object.keys(x).every(k=>allowed.includes(k));
 const has=(x,k)=>typeof k==='string'&&Object.hasOwn(x,k);
 function validSites(sites){
  if(!record(sites))return false;
  return Object.entries(sites).every(([id,s])=>id.length>0&&id.length<=200&&keys(s,['rating_count','rating_sum','latest_visit','observations'])&&Number.isInteger(s.rating_count)&&s.rating_count>0&&Number.isInteger(s.rating_sum)&&s.rating_sum>=s.rating_count&&s.rating_sum<=5*s.rating_count&&/^\d{4}-\d{2}-\d{2}$/.test(s.latest_visit)&&Array.isArray(s.observations)&&s.observations.every(g=>keys(g,['count','latest_visit','values'])&&Number.isInteger(g.count)&&g.count>0&&/^\d{4}-\d{2}-\d{2}$/.test(g.latest_visit)&&keys(g.values,[...Object.keys(AXES),'signals'])&&Object.keys(g.values).every(k=>k==='signals'||has(AXES,k)&&has(AXES[k].values,g.values[k]))&&(!g.values.signals||Array.isArray(g.values.signals)&&g.values.signals.every(x=>keys(x,['carrier','signal','environment'])&&has(CARRIERS,x.carrier)&&has(SIGNAL,x.signal)&&has(ENVIRONMENTS,x.environment)))));
 }

 const usable=()=>['ready','cached'].includes(st.mode)&&Number.isFinite(Date.parse(st.checked))&&Date.now()-Date.parse(st.checked)<=7*86400000;
 const summary=p=>{if(!usable())return null;for(const id of typeof p==='string'?[p]:[p.id,...(p.legacy_ids||[])]){const row=st.sites.get(id);if(row)return row;}return null;};
 const matches=(p,f)=>!active(f)||matchesSummary(summary(p),f);
 function matchNote(p,f){const s=summary(p);if(!s||!conditions(f))return '';const groups=matchingGroups(s,f);if(!groups.length)return '';const count=groups.reduce((n,g)=>n+g.count,0),latest=groups.map(g=>g.latest_visit).sort().at(-1);return `Matching visit evidence: ${count} published ${count===1?'report':'reports'} · latest ${latest}.`; }
 function notify(){if(global.dispatchEvent&&typeof CustomEvent==='function')global.dispatchEvent(new CustomEvent('kamptrail:discoveryupdated'));}
 const cacheName=()=>`kamptrail:${new URL('./',location.href).href}:camper-discovery-v1`;
 const cacheKey=()=>new URL('__published_camper_discovery__',new URL('./',location.href)).href;
 function status(){
  if(st.mode==='loading')return 'Loading published camper ratings and observations…';
  if(usable())return `${st.mode==='cached'?'Saved camper evidence':'Published camper evidence'} checked ${new Date(st.checked).toLocaleString()}. ${st.error?'Online refresh failed. ':''}Missing reports do not match. Ratings use all published reviews; conditions are self-reported visits, not current guarantees.`;
  return st.error||'Choose a camper filter to load published evidence. Missing reports stay unknown.';
 }
 async function load(force=false){
  if(st.pending)return st.pending;
  if(!force&&usable()&&Date.now()-Date.parse(st.checked)<60000)return;
  const generation=st.generation;
  st.pending=Promise.resolve().then(async()=>{
   st.mode='loading';st.error='';notify();
   try{
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('offline');
    if(location.hostname==='prowebpromo.github.io')throw new Error('legacy');
    let after='',revision=null,all=new Map(),bytes=0,checked=null;
    for(let page=0;page<500;page++){
     if(generation!==st.generation)throw new Error('superseded');
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
     let d;
     try{const r=await fetch('api/community-discovery.php'+(after?'?after='+encodeURIComponent(after)+'&revision='+encodeURIComponent(revision):''),{signal:controller.signal,cache:'no-store'});const text=await r.text();bytes+=text.length;if(bytes>15000000)throw new Error('size');d=JSON.parse(text);if(!r.ok||d.version!==1||!/^\d+$/.test(d.revision)||!Number.isFinite(Date.parse(d.checked_at))||!validSites(d.sites))throw new Error('invalid');}finally{clearTimeout(timer);}
     if(revision!==null&&revision!==d.revision)throw new Error('changed');revision=d.revision;checked=d.checked_at;
     for(const [id,s]of Object.entries(d.sites)){if(all.has(id))throw new Error('duplicate');all.set(id,s);}
     if(d.next_after===null){if(generation!==st.generation)throw new Error('superseded');st.sites=all;st.checked=checked;st.mode='ready';try{const c=await caches.open(cacheName());await c.put(cacheKey(),new Response(JSON.stringify({version:1,checked_at:checked,sites:Object.fromEntries(all)}),{headers:{'Content-Type':'application/json'}}));}catch{}if(generation!==st.generation){try{await caches.delete(cacheName());}catch{}}return;}
     if(typeof d.next_after!=='string'||d.next_after===after)throw new Error('pagination');after=d.next_after;
    }
    throw new Error('size');
   }catch{
    if(generation!==st.generation)return;
    st.error='Published camper evidence could not refresh. Retry online. No partial download is used.';
    try{const c=await caches.open(cacheName()),r=await c.match(cacheKey()),d=r&&await r.json();if(generation!==st.generation)return;if(d?.version===1&&validSites(d.sites)&&Number.isFinite(Date.parse(d.checked_at))&&Date.now()-Date.parse(d.checked_at)<=7*86400000){st.sites=new Map(Object.entries(d.sites));st.checked=d.checked_at;st.mode='cached';return;}}catch{}
    st.mode='error';st.sites=new Map();st.checked=null;
   }finally{st.pending=null;notify();}
  });return st.pending;
 }
 function observeFields(form,review,el,field){
  const values=review.observations||{},set=el('fieldset');set.append(el('legend',{},'Conditions you observed (optional)'),el('p',{class:'kt-fine'},'Report only this visit. Approach depends on your rig. Comfort is subjective. These reports do not establish permission, safety or current road conditions.'));
  const select=(name,options,value)=>{const n=el('select',{name});n.append(el('option',{value:''},'Not reported'));for(const[k,v]of Object.entries(options))n.append(el('option',{value:k,selected:k===value},v));return n;};
  for(const[k,a]of Object.entries(AXES))set.append(field(a.label,select('observed_'+k,a.values,values[k])));
  set.append(el('p',{class:'kt-fine'},'Cell signal is your experience on the visit date, not a carrier prediction or a speed measurement. Leave carriers you did not try unreported.'));
  for(const[k,name]of Object.entries(CARRIERS)){const old=(values.signals||[]).find(x=>x.carrier===k)||{};set.append(field(name+' signal',select('signal_'+k,SIGNAL,old.signal)),field(name+' setting',select('environment_'+k,ENVIRONMENTS,old.environment||'unspecified')));}
  form.append(set);
 }
 function formValues(form){const data=new FormData(form),out={};for(const k of Object.keys(AXES)){const v=data.get('observed_'+k);if(v)out[k]=v;}const signals=[];for(const carrier of Object.keys(CARRIERS)){const signal=data.get('signal_'+carrier);if(signal)signals.push({carrier,signal,environment:data.get('environment_'+carrier)||'unspecified'});}if(signals.length)out.signals=signals;return out;}
 function describe(o){const text=[];for(const[k,a]of Object.entries(AXES))if(a.values[o?.[k]])text.push(a.label+': '+a.values[o[k]]);for(const s of o?.signals||[])if(CARRIERS[s.carrier]&&SIGNAL[s.signal])text.push(CARRIERS[s.carrier]+': '+SIGNAL[s.signal]+' ('+(ENVIRONMENTS[s.environment]||'Setting not specified')+')');return text.join(' · ');}
 global.KampTrailDiscovery={version:'2.16.0',AXES,CARRIERS,SIGNAL,SIGNAL_FILTER,ENVIRONMENTS,active,conditions,matchesSummary,validSites,matches,summary,status,load,observeFields,formValues,describe,matchNote};
 if(typeof module!=='undefined'&&module.exports)module.exports=global.KampTrailDiscovery;
 if(global.addEventListener){global.addEventListener('kamptrail:communitychanged',async()=>{const reload=st.mode!=='idle'||active(global.kamptrailFilters||{}),pending=st.pending;st.generation++;st.sites=new Map();st.checked=null;st.mode='idle';notify();try{await caches.delete(cacheName());}catch{}if(pending)await pending;try{await caches.delete(cacheName());}catch{}if(reload)load(true);});global.addEventListener('focus',()=>{if(active(global.kamptrailFilters||{}))load();});}
})(typeof window!=='undefined'?window:globalThis);
