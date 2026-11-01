/* Published camper evidence. Never treat source ratings or predicted coverage as observations. */
(function(global){
 'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
 const AXES={access:{label:t("Approach for your rig"),values:{easy:t("Easy"),moderate:t("Moderate"),difficult:t("Difficult")}},noise:{label:t("Noise"),values:{quiet:t("Quiet"),mixed:t("Mixed"),noisy:t("Noisy")}},shade:{label:t("Shade"),values:{none:t("None"),partial:t("Partial"),full:t("Full")}},crowding:{label:t("Crowding"),values:{sparse:t("Sparse"),moderate:t("Moderate"),crowded:t("Crowded")}},comfort:{label:t("Personal comfort"),values:{comfortable:t("Felt comfortable"),concerns:t("Had concerns")}}};
 const SCORES={quietness:{label:t("Quietness"),low:t("Very noisy"),high:t("Very quiet")},shade:{label:t("Shade satisfaction"),low:t("Very dissatisfied"),high:t("Very satisfied")},comfort:{label:t("Personal comfort"),low:t("Very uncomfortable"),high:t("Very comfortable")}},SEASONS={winter:t("Winter (Dec–Feb)"),spring:t("Spring (Mar–May)"),summer:t("Summer (Jun–Aug)"),fall:t("Fall (Sep–Nov)")},SCORE_MINIMUM=3;
 const scoreAxes=f=>Object.keys(SCORES).filter(k=>+f['minScore_'+k]>0);
 const scoreActive=f=>!!f.scoreSeason||scoreAxes(f).length>0;
 const scoreFilterCount=f=>scoreAxes(f).length+Number(!!f.scoreSeason);
 const CARRIERS={att:'AT&T',verizon:'Verizon',tmobile:'T-Mobile',other:t("Other carrier")},SIGNAL={none:t("No service"),weak:t("Weak"),usable:t("Usable"),strong:t("Strong")},ENVIRONMENTS={unspecified:t("Setting not specified"),outdoors:t("Outdoors"),inside_rv:t("Inside RV"),other_vehicle:t("Inside other vehicle")};
 const RADIOS={unspecified:t("Technology not specified"),lte:'LTE','5g':'5G'},ACCESS_RANK={easy:0,moderate:1,difficult:2},ACCESS_FILTER={easy:t("Easy only"),moderate:t("Up to moderate"),difficult:t("Up to difficult")};
 const SIGNAL_FILTER={none:t("No service reported"),weak:t("Weak or better"),usable:t("Usable or better"),strong:t("Strong")},SIGNAL_LEVEL={none:0,weak:1,usable:2,strong:3};
 const st={sites:new Map(),mode:'idle',checked:null,error:'',pending:null,generation:0};
 const active=f=>scoreActive(f)||+f.minRating>0||+f.minReviews>1||Object.keys(AXES).some(k=>f['observed_'+k])||!!f.observed_carrier||!!f.observed_signal||!!f.observed_radio;
 const conditions=f=>Object.keys(AXES).some(k=>f['observed_'+k])||!!f.observed_carrier||!!f.observed_signal||!!f.observed_radio;
 function matchesSummary(s,f,now=Date.now()){
  if(!active(f))return true;
  if(!s||!Number.isInteger(s.rating_count)||s.rating_count<1)return false;
  if(s.rating_count<Math.max(1,+f.minReviews||1))return false;
  if(+f.minRating>0&&s.rating_sum/s.rating_count<+f.minRating)return false;
  if(scoreActive(f)&&!matchesScores(s,f,now))return false;
  if(!conditions(f))return true;
  return matchingGroups(s,f,now).length>0;
 }
// Approach is a maximum on a ranked scale. Missing or unrecognised access never matches, so unknown is never easy.
 function axisMatches(axis,value,wanted){
  if(axis!=='access')return value===wanted;
  return Object.hasOwn(ACCESS_RANK,value)&&Object.hasOwn(ACCESS_RANK,wanted)&&ACCESS_RANK[value]<=ACCESS_RANK[wanted];
 }
 function matchingGroups(s,f,now=Date.now()){
  const cutoff=+f.observedDays>0?new Date(now-(+f.observedDays)*86400000).toISOString().slice(0,10):'0000-00-00';
  return (s.observations||[]).filter(g=>{
   if(g.latest_visit<cutoff)return false;
   const o=g.values||{};
   if(Object.keys(AXES).some(k=>f['observed_'+k]&&!axisMatches(k,o[k],f['observed_'+k])))return false;
   return !(f.observed_carrier||f.observed_signal||f.observed_radio)||(o.signals||[]).some(x=>(!f.observed_carrier||x.carrier===f.observed_carrier)&&(!f.observed_radio||x.radio===f.observed_radio)&&(!f.observed_signal||(f.observed_signal==='none'?x.signal==='none':SIGNAL_LEVEL[x.signal]>=SIGNAL_LEVEL[f.observed_signal])));
  });
 }
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const keys=(x,allowed)=>record(x)&&Object.keys(x).every(k=>allowed.includes(k));
 const has=(x,k)=>typeof k==='string'&&Object.hasOwn(x,k);
 const MONTHS={'01':t('January'),'02':t('February'),'03':t('March'),'04':t('April'),'05':t('May'),'06':t('June'),'07':t('July'),'08':t('August'),'09':t('September'),'10':t('October'),'11':t('November'),'12':t('December')};
 function validVisitDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
 function validMonthly(d){
  const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
  if(!keys(d,['version','available','checked_at','basis','published_reviews','condition_reports','unreported_reviews','excluded_dates','invalid_observations','months'])||d.version!==1||d.available!==true||d.basis!=='calendar_visit_month_all_years'||typeof d.checked_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(d.checked_at)||!Number.isFinite(Date.parse(d.checked_at))||new Date(d.checked_at).toISOString().slice(0,19)!==d.checked_at.slice(0,19)||!record(d.months))return false;
  const totals=['condition_reports','unreported_reviews','excluded_dates','invalid_observations'].map(k=>d[k]);
  if(!count(d.published_reviews)||!totals.every(count)||totals.reduce((a,b)=>a+b,0)!==d.published_reviews)return false;
  let reports=0;
  const today=new Date(d.checked_at).toISOString().slice(0,10);
  for(const [month,row] of Object.entries(d.months)){
   if(!has(MONTHS,month)||!keys(row,['reports','first_visit','latest_visit','axes'])||!count(row.reports)||row.reports<1||!validVisitDate(row.first_visit)||!validVisitDate(row.latest_visit)||row.first_visit>row.latest_visit||row.latest_visit>today||row.first_visit.slice(5,7)!==month||row.latest_visit.slice(5,7)!==month||!keys(row.axes,Object.keys(AXES))||Object.keys(row.axes).length!==Object.keys(AXES).length)return false;
   let known=0;
   for(const [axis,a] of Object.entries(AXES)){
    const values=row.axes[axis];if(!keys(values,Object.keys(a.values)))return false;
    const ns=Object.values(values);if(!ns.every(n=>count(n)&&n>0)||ns.reduce((a,b)=>a+b,0)>row.reports)return false;
    known+=ns.reduce((a,b)=>a+b,0);
   }
   if(known<row.reports)return false;
   reports+=row.reports;
  }
  return reports===d.condition_reports;
 }
 function monthlyView(d,month='',now=Date.now()){
  if(!validMonthly(d))return {mode:'unavailable'};
  const age=now-Date.parse(d.checked_at);
  if(age>7*86400000||age< -300000)return {mode:'expired',checked_at:d.checked_at};
  if(month!==''&&!has(MONTHS,month))return {mode:'unavailable'};
  const out={mode:'ready',reports:0,first_visit:null,latest_visit:null,axes:Object.fromEntries(Object.keys(AXES).map(k=>[k,{}]))};
  for(const [key,row] of Object.entries(d.months)){
   if(month&&key!==month)continue;
   out.reports+=row.reports;out.first_visit=out.first_visit===null?row.first_visit:[out.first_visit,row.first_visit].sort()[0];out.latest_visit=out.latest_visit===null?row.latest_visit:[out.latest_visit,row.latest_visit].sort().at(-1);
   for(const [axis,counts] of Object.entries(row.axes))for(const [value,n] of Object.entries(counts))out.axes[axis][value]=(out.axes[axis][value]||0)+n;
  }
  return out;
 }
 const validVisit=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&x>='1900-01-01'&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
 function validScores(x){return keys(x,Object.keys(SCORES))&&Object.values(x).every(n=>Number.isInteger(n)&&n>=1&&n<=5);}
 function validSites(sites){
  if(!record(sites))return false;
  return Object.entries(sites).every(([id,s])=>id.length>0&&id.length<=200&&keys(s,['rating_count','rating_sum','latest_visit','observations'])&&Number.isInteger(s.rating_count)&&s.rating_count>0&&Number.isInteger(s.rating_sum)&&s.rating_sum>=s.rating_count&&s.rating_sum<=5*s.rating_count&&validVisit(s.latest_visit)&&Array.isArray(s.observations)&&s.observations.every(g=>keys(g,['count','latest_visit','values'])&&Number.isInteger(g.count)&&g.count>0&&validVisit(g.latest_visit)&&keys(g.values,[...Object.keys(AXES),'signals','scores'])&&Object.keys(g.values).every(k=>k==='signals'||k==='scores'&&validScores(g.values.scores)||has(AXES,k)&&has(AXES[k].values,g.values[k]))&&(!g.values.signals||Array.isArray(g.values.signals)&&g.values.signals.every(x=>keys(x,['carrier','signal','environment','radio'])&&has(CARRIERS,x.carrier)&&has(SIGNAL,x.signal)&&has(ENVIRONMENTS,x.environment)&&(!Object.hasOwn(x,'radio')||has(RADIOS,x.radio)))))&&s.observations.reduce((n,g)=>n+g.count,0)<=s.rating_count);
 }
 // US calendar seasons label the visit month; they do not predict temperatures.
 function season(date){const m=+date.slice(5,7);return m===12||m<=2?'winter':m<=5?'spring':m<=8?'summer':'fall';}
 function seasonalScores(groups){
  const out={};for(const g of groups||[]){const date=g.latest_visit,key=season(date);for(const axis of Object.keys(SCORES)){const value=g.values?.scores?.[axis];if(!Number.isInteger(value)||value<1||value>5||!Number.isInteger(g.count)||g.count<1)continue;const bucket=out[key]||(out[key]={}),r=bucket[axis]||(bucket[axis]={count:0,sum:0,first_visit:date,latest_visit:date});r.count+=g.count;r.sum+=value*g.count;if(date<r.first_visit)r.first_visit=date;if(date>r.latest_visit)r.latest_visit=date;}}return out;
 }
 function scoreEvidence(s,f,now=Date.now()){
  const selected=scoreAxes(f),groups=matchingGroups(s,f,now).filter(g=>(!f.scoreSeason||season(g.latest_visit)===f.scoreSeason)&&selected.every(k=>Number.isInteger(g.values?.scores?.[k]))),seasons=seasonalScores(groups),out={};
  for(const axes of Object.values(seasons))for(const[k,r]of Object.entries(axes)){const n=out[k]||(out[k]={count:0,sum:0,first_visit:r.first_visit,latest_visit:r.latest_visit});n.count+=r.count;n.sum+=r.sum;if(r.first_visit<n.first_visit)n.first_visit=r.first_visit;if(r.latest_visit>n.latest_visit)n.latest_visit=r.latest_visit;}return out;
 }
 function matchesScores(s,f,now){
  if(f.scoreSeason&&!has(SEASONS,f.scoreSeason))return false;
  const axes=scoreAxes(f),e=scoreEvidence(s,f,now);
  return axes.length?axes.every(k=>+f['minScore_'+k]<=5&&e[k]?.count>=SCORE_MINIMUM&&e[k].sum/e[k].count>=+f['minScore_'+k]):Object.values(e).some(r=>r.count>=SCORE_MINIMUM);
 }
 function seasonalText(seasons){
  const rows=[];for(const[key,label]of Object.entries(SEASONS)){const axes=seasons?.[key];if(!axes)continue;for(const[k,a]of Object.entries(SCORES)){const r=axes[k];if(!r?.count)continue;rows.push(t("{0} · {1}: {2} · {3} explicit {4} · visits {5} to {6}", {"0":(label),"1":(a.label),"2":(r.count>=SCORE_MINIMUM?(r.sum/r.count).toFixed(1)+'/5':t("insufficient evidence")),"3":(r.count),"4":(t(r.count===1?'rating':'ratings')),"5":(r.first_visit),"6":(r.latest_visit)}));}}return rows.length?rows.join('\n'):t("No published numeric sub-ratings yet. Unreported stays unknown.");
 }

 const usable=()=>['ready','cached'].includes(st.mode)&&Number.isFinite(Date.parse(st.checked))&&Date.now()-Date.parse(st.checked)<=7*86400000;
 // A listing's reviews may be keyed to any of its published ids (canonical or legacy).
 const summary=p=>{if(!usable())return null;const own=typeof p==='string'?[p]:[p.id,...(p.legacy_ids||[])],ids=new Set(own);for(const id of own)for(const x of global.KampTrailData?.identityIds?.(id)||[])ids.add(x);for(const id of ids){const row=st.sites.get(id);if(row)return row;}return null;};
 const matches=(p,f)=>!active(f)||matchesSummary(summary(p),f);
 function matchNote(p,f){const s=summary(p);if(!s)return '';if(scoreActive(f)){if(!matchesScores(s,f))return '';const e=scoreEvidence(s,f),selected=scoreAxes(f);return t("Matching numeric visit evidence: ")+Object.entries(e).filter(([k,r])=>(!selected.length||selected.includes(k))&&r.count>=SCORE_MINIMUM).map(([k,r])=>t("{0} {1}/5 · {2} explicit ratings · visits {3} to {4}", {"0":(SCORES[k].label),"1":((r.sum/r.count).toFixed(1)),"2":(r.count),"3":(r.first_visit),"4":(r.latest_visit)})).join('; ')+'.';}if(!conditions(f))return '';const groups=matchingGroups(s,f);if(!groups.length)return '';const count=groups.reduce((n,g)=>n+g.count,0),latest=groups.map(g=>g.latest_visit).sort().at(-1);return t("Matching visit evidence: {0} published {1} · latest {2}.", {"0":(count),"1":(count===1?t("report"):t("reports")),"2":(latest)}); }
 function notify(){if(global.dispatchEvent&&typeof CustomEvent==='function')global.dispatchEvent(new CustomEvent('kamptrail:discoveryupdated'));}
 const cacheName=()=>`kamptrail:${new URL('./',location.href).href}:camper-discovery-v1`;
 const cacheKey=()=>new URL('__published_camper_discovery__',new URL('./',location.href)).href;
 function status(){
  if(st.mode==='loading')return t("Loading published camper ratings and observations…");
  if(usable())return t("{0} checked {1}. {2}Missing reports do not match. Overall ratings use all published reviews. Numeric averages need 3+ explicit ratings in the selected visit cohort; conditions and scores are self-reported visits, not current guarantees.", {"0":(st.mode==='cached'?t("Saved camper evidence"):t("Published camper evidence")),"1":(new Date(st.checked).toLocaleString(global.KampTrailI18n?.locale())),"2":(st.error?t("Online refresh failed. "):'')});
  return st.error||t("Choose a camper filter to load published evidence. Missing reports stay unknown.");
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
    st.error=t("Published camper evidence could not refresh. Retry online. No partial download is used.");
    try{const c=await caches.open(cacheName()),r=await c.match(cacheKey()),d=r&&await r.json();if(generation!==st.generation)return;if(d?.version===1&&validSites(d.sites)&&Number.isFinite(Date.parse(d.checked_at))&&Date.now()-Date.parse(d.checked_at)<=7*86400000){st.sites=new Map(Object.entries(d.sites));st.checked=d.checked_at;st.mode='cached';return;}}catch{}
    st.mode='error';st.sites=new Map();st.checked=null;
   }finally{st.pending=null;notify();}
  });return st.pending;
 }
 function observeFields(form,review,el,field){
  const values=review.observations||{},set=el('fieldset');set.append(el('legend',{},t("Conditions you observed (optional)")),el('p',{class:'kt-fine'},t("Report only this visit. Approach depends on your rig. Comfort is subjective. These reports do not establish permission, safety or current road conditions.")));
  const select=(name,options,value)=>{const n=el('select',{name});n.append(el('option',{value:''},t("Not reported")));for(const[k,v]of Object.entries(options))n.append(el('option',{value:k,selected:k===value},v));return n;};
  for(const[k,a]of Object.entries(AXES))set.append(field(a.label,select('observed_'+k,a.values,values[k])));
  set.append(el('p',{class:'kt-fine'},t("Cell signal is your experience on the visit date, not a carrier prediction or a speed measurement. Leave carriers you did not try unreported.")));
  for(const[k,name]of Object.entries(CARRIERS)){const old=(values.signals||[]).find(x=>x.carrier===k)||{};set.append(field(t('{carrier} signal',{carrier:name}),select('signal_'+k,SIGNAL,old.signal)),field(t('{carrier} setting',{carrier:name}),select('environment_'+k,ENVIRONMENTS,old.environment||'unspecified')),field(t('{carrier} technology',{carrier:name}),select('radio_'+k,RADIOS,old.radio||'unspecified')));}
  const numeric=el('fieldset');numeric.append(el('legend',{},t("Your visit sub-ratings (optional)")),el('p',{class:'kt-fine'},t("Choose a number only for your own visit. These are subjective experiences: 1 is the low end and 5 the high end. Comfort does not establish safety. Leave untried aspects unreported; no score is inferred from your review or condition choices.")));
  for(const[k,a]of Object.entries(SCORES))numeric.append(field(a.label,select('score_'+k,Object.fromEntries([1,2,3,4,5].map(n=>[String(n),t('{number} of 5',{number:n})+(n===1?' — '+a.low:n===5?' — '+a.high:'')])),String(values.scores?.[k]||'')),t('{low} (1) to {high} (5).',{low:a.low,high:a.high.toLowerCase()})));
  form.append(set,numeric);
 }
 function formValues(form){const data=new FormData(form),out={};for(const k of Object.keys(AXES)){const v=data.get('observed_'+k);if(v)out[k]=v;}const signals=[];for(const carrier of Object.keys(CARRIERS)){const signal=data.get('signal_'+carrier);if(signal){const row={carrier,signal,environment:data.get('environment_'+carrier)||'unspecified'},radio=data.get('radio_'+carrier);if(radio==='lte'||radio==='5g')row.radio=radio;signals.push(row);}}if(signals.length)out.signals=signals;const scores={};for(const k of Object.keys(SCORES)){const v=data.get('score_'+k);if(v)scores[k]=+v;}if(Object.keys(scores).length)out.scores=scores;return out;}
 function describe(o){const text=[];for(const[k,a]of Object.entries(AXES))if(a.values[o?.[k]])text.push(a.label+': '+a.values[o[k]]);for(const s of o?.signals||[])if(CARRIERS[s.carrier]&&SIGNAL[s.signal])text.push(CARRIERS[s.carrier]+': '+SIGNAL[s.signal]+' ('+(ENVIRONMENTS[s.environment]||t("Setting not specified"))+')'+(s.radio==='lte'||s.radio==='5g'?' · '+RADIOS[s.radio]:''));for(const[k,a]of Object.entries(SCORES))if(Number.isInteger(o?.scores?.[k]))text.push(a.label+': '+o.scores[k]+t('/5 (visit rating)'));return text.join(' · ');}
 global.KampTrailDiscovery={version:'2.33.0',AXES,RADIOS,ACCESS_RANK,ACCESS_FILTER,MONTHS,validMonthly,monthlyView,SCORES,SEASONS,SCORE_MINIMUM,scoreFilterCount,season,seasonalScores,seasonalText,scoreEvidence,CARRIERS,SIGNAL,SIGNAL_FILTER,ENVIRONMENTS,active,conditions,matchesSummary,validSites,matches,summary,status,load,observeFields,formValues,describe,matchNote};
 if(typeof module!=='undefined'&&module.exports)module.exports=global.KampTrailDiscovery;
 if(global.addEventListener){global.addEventListener('kamptrail:communitychanged',async()=>{const reload=st.mode!=='idle'||active(global.kamptrailFilters||{}),pending=st.pending;st.generation++;st.sites=new Map();st.checked=null;st.mode='idle';notify();try{await caches.delete(cacheName());}catch{}if(pending)await pending;try{await caches.delete(cacheName());}catch{}if(reload)load(true);});global.addEventListener('focus',()=>{if(active(global.kamptrailFilters||{}))load();});}
})(typeof window!=='undefined'?window:globalThis);
