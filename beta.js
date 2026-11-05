/* BoB entry states and device-local engagement. No analytics network client. */
(function(root){
  'use strict';
  const VERSION='2.46.1';
  const MODES=Object.freeze({
    'overnight-parking':{label:'Overnight parking',note:'Parking-related listings. A marker does not establish overnight permission. Confirm with the property manager.'},
    'rest-areas':{label:'Official rest areas',note:'Official rest-area layer is on. Coverage is incomplete. A location or stay limit does not establish overnight permission.'},
    'dump-stations':{label:'Dump stations',note:'Dump-station layer is on. Tap a D marker for its source. Coverage, access, hours and fees need confirmation.'},
    'free-camping':{label:'Reported free camping',note:'Only listings reporting free are shown. Unknown fees and conditional offers are excluded. Confirm current fees and access.'},
    blm:{label:'BLM places and public land',note:'BLM source listings and public-land boundaries. A management area is not a verified campsite. Confirm camping rules with BLM.'}
  });
  function parse(search){const p=new URLSearchParams(search),mode=p.get('mode');return {mode:Object.hasOwn(MODES,mode)?mode:null,near:p.get('near')==='1',state:/^[A-Z]{2}$/.test(p.get('state')||'')?p.get('state'):null};}
  function eligible(s){return {install:s.searches>=3||s.saves>=1||s.visits>=3,tester:s.searches>=1&&s.views>=2&&s.saves>=1};}
  function articlePath(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&['boondockorbust.com','www.boondockorbust.com'].includes(u.hostname)&&/^\/[a-z0-9\/-]{0,240}$/i.test(u.pathname)?u.pathname:'';}catch{return '';}}
  // The share parser loads with the map. Recognize its location target before
  // landing instrumentation so a shared place also takes precedence in attribution.
  function hasSharedTarget(hash){
    const head=String(hash||'').replace(/^#/,'').split('&')[0],site=head.match(/^site=(.+)$/);
    if(site){try{return !!decodeURIComponent(site[1]);}catch{return false;}}
    const spot=head.match(/^spot=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    return !!spot&&Math.abs(+spot[1])<=90&&Math.abs(+spot[2])<=180;
  }
  function savedPlaceKind(site){
    const p=site?.properties;
    if(!p)return 'other_stop';
    if(p.type==='service'||p.rest_area_source_id)return 'service_or_rest_area';
    return ['established','dispersed','parking','backcountry','other'].includes(p.type)&&(!p.camping_classification||p.camping_classification==='campsite')?'campsite':'other_stop';
  }
  function matchesEntry(mode,f={}){return mode==='free-camping'?f.cost==='free':mode==='overnight-parking'?f.type==='parking':mode==='blm'?f.catalogueSource==='blm':['rest-areas','dump-stations'].includes(mode)?f.entryLayer===mode:false;}
  if(typeof module==='object'&&module.exports)module.exports={parse,eligible,articlePath,hasSharedTarget,savedPlaceKind,MODES};
  if(!root?.document)return;
  const t=(k,p)=>root.KampTrailI18n?.t(k,p)??k;
  const store='kt_beta_use_v1', now=Date.now(), timeout=30*60*1000;
  let s={visits:0,searches:0,views:0,saves:0,last:0,recent:[]};
  try{const v=JSON.parse(localStorage.getItem(store));if(v&&typeof v==='object'){for(const k of ['visits','searches','views','saves','last'])if(Number.isFinite(v[k])&&v[k]>=0)s[k]=Math.min(v[k],Number.MAX_SAFE_INTEGER);s.installed=v.installed===true;if(Array.isArray(v.recent))s.recent=v.recent.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string'&&x.id.length<201&&x.name.length<201).slice(0,12);}}catch{}
  let newVisit=now-s.last>timeout, sessionSearches=0, sessionViews=new Set(), reporter=null, sequence=0;
  const events=[],entry=parse(location.search),params=new URLSearchParams(location.search);
  let entryApplied=false;
  if(hasSharedTarget(location.hash))entry.mode=null;
  const article=articlePath(params.get('ref')||'')||articlePath(document.referrer);
  const source=article?'boondockorbust':params.get('source')==='pwa'?'pwa':'other';
  let visitId;try{visitId=sessionStorage.getItem('kt_beta_session');}catch{}
  function rotateSession(){visitId=root.crypto.randomUUID();try{sessionStorage.setItem('kt_beta_session',visitId);}catch{}}
  if(newVisit||!/^[-a-f0-9]{36}$/.test(visitId||''))rotateSession();
  function persist(){s.last=Date.now();try{localStorage.setItem(store,JSON.stringify(s));}catch{}}
  if(newVisit)s.visits++;persist();
  // No raw query, coordinates, listing names/IDs, email, full referrer or persistent visitor ID enters the bridge.
  function track(name,detail={}){const event=Object.freeze({event:'kt_'+name,session_id:visitId,sequence:++sequence,source,article_path:article,landing_path:location.pathname,mode:entry.mode||'map',...detail});events.push(event);if(events.length>100)events.shift();try{reporter?.(event);}catch{}root.dispatchEvent(new CustomEvent('kamptrail:metric',{detail:event}));}
  const dismissed={};try{Object.assign(dismissed,JSON.parse(sessionStorage.getItem('kt_beta_dismissed')||'{}'));}catch{}
  function dismiss(kind){dismissed[kind]=true;try{sessionStorage.setItem('kt_beta_dismissed',JSON.stringify(dismissed));}catch{}render();}
  function button(label,action){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=t(label);b.onclick=action;return b;}
  function render(){
    const e=eligible(s),section=document.getElementById('beta-testing');if(section)section.hidden=!e.tester;
    const n=document.getElementById('kt-use-nudge');if(!n)return;n.replaceChildren();n.hidden=true;
    // Returning arrivals still wait for an action in this document before a suggestion.
    if(!sessionSearches&&!sessionViews.size&&!s.savedThisPage)return;
    const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true||s.installed;
    const kind=e.install&&!installed&&!dismissed.install?'install':e.tester&&!dismissed.tester?'tester':null;
    if(!kind)return;
    const p=document.createElement('p');p.textContent=t(kind==='install'?'Keep KampTrail handy for your next stop. Install the app for easy return visits.':'You have tried KampTrail. Tell us what worked and what needs fixing.');
    n.append(p,button(kind==='install'?'Install KampTrail':'Share beta feedback',()=>{track(kind+'_opened');if(kind==='install')root.KampTrailInstall?.open();else root.KampTrailFeedback?.open('feature');}),button('Not now',()=>dismiss(kind)));n.hidden=false;
  }
  function beginActivity(){if(Date.now()-s.last>timeout){s.visits++;rotateSession();sessionSearches=0;sessionViews.clear();s.savedThisPage=false;s.last=Date.now();track('return_session');}}
  function use(kind){beginActivity();s[kind]++;persist();render();}
  function search(){beginActivity();sessionSearches++;use('searches');track('search_performed');}
  function viewPlace(site){const p=site?.properties;if(!p||typeof p.id!=='string')return;beginActivity();if(!sessionViews.has(p.id)){sessionViews.add(p.id);use('views');track('marker_viewed',{place_kind:'campsite'});}s.recent=[{id:p.id,name:String(p.name||'Campsite').slice(0,200)},...s.recent.filter(x=>x.id!==p.id)].slice(0,12);persist();render();}
  let recentDialog;
  function recent(){if(!recentDialog){recentDialog=document.createElement('dialog');recentDialog.id='kt-recent-dialog';recentDialog.setAttribute('aria-labelledby','kt-recent-title');document.body.append(recentDialog);}recentDialog.replaceChildren();const h=document.createElement('h2');h.id='kt-recent-title';h.textContent=t('Recently viewed places');recentDialog.append(h,button('Close',()=>recentDialog.close()));const list=document.createElement('ul');for(const item of s.recent){const li=document.createElement('li');const open=button('',async()=>{recentDialog.close();const hash='#site='+encodeURIComponent(item.id),unchanged=location.hash===hash;location.hash=hash;await root.KampTrailMapLoader?.start();if(unchanged)root.dispatchEvent(new Event('hashchange'));});open.textContent=item.name;li.append(open);list.append(li);}if(!s.recent.length){const p=document.createElement('p');p.textContent=t('Campsites you open will appear here. This list stays on this device.');recentDialog.append(p);}recentDialog.append(list,button('Clear recently viewed',()=>{s.recent=[];beginActivity();persist();recent();}));const trigger=document.getElementById('kt-recent');recentDialog.onclose=()=>trigger?.focus();if(!recentDialog.open)recentDialog.showModal();}
  function clearEntry(){if(!entry.mode&&!entryApplied)return;entry.mode=null;entryApplied=false;const box=document.getElementById('kt-entry-state');if(box)box.hidden=true;const u=new URL(location.href);for(const k of ['mode','near','state'])u.searchParams.delete(k);history.replaceState(null,'',u);}
  function applyEntry(){
    if(!entry.mode)return;
    if(hasSharedTarget(location.hash)){entry.mode=null;return;}
    root.KampTrailFilters?.applyEntry(entry.mode);
    entryApplied=true;
    if(entry.mode==='dump-stations'){root.KampTrailServices.setCategories(['dump']);root.KampTrailLayers.showServices();}
    if(entry.mode==='rest-areas')root.KampTrailLayers.showRestAreas();
    if(entry.mode==='blm')root.KampTrailLayers.showLand();
    const box=document.getElementById('kt-entry-state');box.hidden=false;const p=document.createElement('p');p.textContent=t(MODES[entry.mode].label)+'. '+t(MODES[entry.mode].note);box.replaceChildren(p,button('Show all campsites',()=>{root.KampTrailFilters.reset();clearEntry();}));
    if(entry.state&&document.querySelector('#state-select option[value="'+entry.state+'"]')){const select=document.getElementById('state-select');select.value=entry.state;select.dispatchEvent(new Event('change'));}
    if(entry.near)document.getElementById('near')?.click();
    track('open_in_kamptrail');
  }
  root.addEventListener('kamptrail:mapready',()=>{applyEntry();if(!entry.mode)track('open_in_kamptrail');});
  root.addEventListener('kamptrail:filterschanged',()=>{if(entryApplied&&!matchesEntry(entry.mode,root.kamptrailFilters))clearEntry();});
  root.addEventListener('appinstalled',()=>{beginActivity();s.installed=true;persist();track('pwa_installed');render();});
  document.getElementById('kt-recent')?.addEventListener('click',recent);
  root.KampTrailBeta={version:VERSION,entry,search,viewPlace,saveStop(site){beginActivity();const kind=savedPlaceKind(site);if(kind==='campsite'){s.savedThisPage=true;use('saves');}else persist();track('stop_saved',{place_kind:kind});},track,render,recent,setReporter(fn){if(typeof fn!=='function')return;reporter=fn;for(const event of events)try{reporter(event);}catch{}},events:()=>events.slice(),status:()=>({...s,...eligible(s)})};
  track('landing');if(newVisit&&s.visits>1)track('return_session');render();
})(typeof window==='object'?window:globalThis);
