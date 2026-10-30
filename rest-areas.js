/* Official rest-area locations. Location and duration evidence never establishes overnight permission. */
(function(global){
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const LIST='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html';
  const POLICY='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html';
  const detail=u=>typeof u==='string'&&/^https:\/\/www\.txdot\.gov\/discover\/rest-areas-travel-information-centers\/safety-rest-area-list\/[a-z0-9-]+\.html$/.test(u);
  const check=(ok,msg)=>{if(!ok)throw new Error('Official rest areas: '+msg);};
  const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s.replace('Z','.000Z');
  const activities=['overnight_parking','sleeping_in_vehicle','camping'],policyAge=180*86400000;
  const policyHosts=new Set(['www.txdot.gov','tcss.legis.texas.gov','mdt.mt.gov','mca.legmt.gov']);
  const unknownPolicy=()=>({policy_id:null,rules:{overnight_parking:'unknown',sleeping_in_vehicle:'unknown',camping:'unknown',max_stay_hours:null,conditions:[]},sources:[],review_required:[],current_opening:'unknown'});
  function policySources(sources,now){
    check(Array.isArray(sources)&&sources.length>0&&sources.length<=8,'missing policy sources');
    for(const s of sources){let u;try{u=new URL(s.url);}catch{check(false,'invalid policy URL');}check(u.protocol==='https:'&&policyHosts.has(u.hostname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^[a-f0-9]{64}$/.test(s.sha256)&&utc(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now,'invalid policy evidence');}
  }
  function validatePolicies(bundle,now=Date.now()){
    check(bundle?.version===1&&Array.isArray(bundle.policies)&&bundle.policies.length<=50,'invalid state policies');const ids=new Set(),scopes=new Set();
    for(const p of bundle.policies){const s=p.scope,key=JSON.stringify([s?.state,s?.operator,s?.facility_kind]);check(typeof p.id==='string'&&p.id.length<=100&&!ids.has(p.id)&&s&&/^[A-Z]{2}$/.test(s.state)&&/^[a-z_]{2,40}$/.test(s.operator)&&/^[a-z_]{2,40}$/.test(s.facility_kind)&&Object.keys(s).length===3&&!scopes.has(key),'invalid policy scope');ids.add(p.id);scopes.add(key);policySources(p.sources,now);check(p.rules&&activities.every(a=>['allowed','prohibited','unknown'].includes(p.rules[a]))&&(p.rules.max_stay_hours===null||Number.isFinite(p.rules.max_stay_hours)&&p.rules.max_stay_hours>0&&p.rules.max_stay_hours<=168)&&Array.isArray(p.rules.conditions)&&p.rules.conditions.length<=12&&p.rules.conditions.every(c=>typeof c==='string'&&c.length<=500),'invalid policy rules');}
    check(bundle.exceptions===undefined||Array.isArray(bundle.exceptions)&&bundle.exceptions.length<=1000,'invalid facility exceptions');const exceptions=new Set();
    for(const e of bundle.exceptions||[]){check(e&&typeof e.facility_id==='string'&&e.facility_id.length<=100&&/^[A-Z]{2}$/.test(e.state)&&typeof e.operator==='string'&&typeof e.facility_kind==='string'&&!exceptions.has(e.facility_id),'ambiguous facility exception');exceptions.add(e.facility_id);policySources(e.sources,now);check(e.rules&&Object.keys(e.rules).every(k=>activities.includes(k)?['allowed','prohibited','unknown'].includes(e.rules[k]):k==='max_stay_hours'&&(e.rules[k]===null||Number.isFinite(e.rules[k])&&e.rules[k]>0&&e.rules[k]<=168)),'invalid exception rules');}
    return bundle;
  }
  function resolvePolicy(bundle,scope,now=Date.now()){
    if(!bundle)return unknownPolicy();validatePolicies(bundle,now);const p=bundle.policies.find(p=>['state','operator','facility_kind'].every(k=>p.scope[k]===scope[k]));let result=unknownPolicy();
    const fresh=s=>s.every(s=>now-Date.parse(s.retrieved_at)<policyAge);
    if(p&&!fresh(p.sources))return result;
    if(p)result={...result,policy_id:p.id,rules:JSON.parse(JSON.stringify(p.rules)),sources:p.sources.slice()};
    const e=(bundle.exceptions||[]).find(e=>e.facility_id===scope.facility_id&&['state','operator','facility_kind'].every(k=>e[k]===scope[k]));
    if(e){if(!fresh(e.sources))return unknownPolicy();result.sources.push(...e.sources);for(const [field,value]of Object.entries(e.rules)){const old=result.rules[field];if((old==='prohibited'&&value==='allowed')||(field==='max_stay_hours'&&old!==null&&value>old)){result.rules[field]=field==='max_stay_hours'?null:'unknown';result.review_required.push(field);}else result.rules[field]=value;}}
    return result;
  }
  // This exact catalogue has already established TxDOT safety-rest-area scope.
  // State alone or a guessed OSM operator never establishes agency membership.
  function policyFor(r,d,now=Date.now()){return resolvePolicy(d.state_policies,{state:r.state,operator:'txdot',facility_kind:'safety_rest_area',facility_id:r.id},now);}
  function policyDescription(result){
    if(!result.sources.length)return t('State rest-area policy unavailable or older than 180 days. Overnight parking, sleeping and camping permission remain unknown.');
    const label=s=>s==='allowed'?t('Allowed'):s==='prohibited'?t('Prohibited'):t('Unknown');
    const checked=result.sources.map(s=>s.retrieved_at).sort()[0];
    let value=t('State policy checked {date}: overnight parking {parking}; sleeping in a vehicle {sleeping}; camping {camping}.',{date:checked,parking:label(result.rules.overnight_parking),sleeping:label(result.rules.sleeping_in_vehicle),camping:label(result.rules.camping)});
    if(result.rules.max_stay_hours!==null)value+=' '+t('Maximum stay: {hours} hours.',{hours:result.rules.max_stay_hours});
    return value+' '+result.rules.conditions.join(' ')+' '+t('Current opening and space availability remain unknown. Check posted facility exceptions.');
  }
  function source(s,url,now){check(s&&s.url===url&&/^[a-f0-9]{64}$/.test(s.sha256)&&utc(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now+300000&&s.source_updated_at===null,'invalid source evidence');}
  function validate(d,now=Date.now()){
    check(d&&d.version===1&&d.region==='TX'&&Array.isArray(d.records)&&d.records.length>0&&d.records.length<=1000,'invalid catalogue');
    source(d.source,LIST,now);check(d.duration_context?.maximum_hours===24,'invalid duration context');source(d.duration_context.source,POLICY,now);
    const ids=new Set();
    for(const r of d.records){
      check(r&&/^txdot:[a-f0-9]{24}$/.test(r.id)&&!ids.has(r.id),'duplicate or invalid identity');ids.add(r.id);
      check(r.state==='TX'&&r.permission==='unknown'&&Array.isArray(r.coordinates)&&r.coordinates.length===2&&r.coordinates.every(Number.isFinite)&&r.coordinates[0]>=-107&&r.coordinates[0]<=-93&&r.coordinates[1]>=25&&r.coordinates[1]<=37,'invalid place or unsupported permission claim');
      check(detail(r.source_url)&&typeof r.name==='string'&&r.name.length>0&&new TextEncoder().encode(r.name).length<=200&&typeof r.location==='string'&&new TextEncoder().encode(r.location).length<=800&&(r.milepost===null||typeof r.milepost==='string'&&r.milepost.length<=60),'invalid source row');
    }
    return d;
  }
  function coordinate5(x){const n=Math.sign(x)*Math.floor(Math.abs(x)*1e5+.5)/1e5;return(n===0?0:n).toFixed(5);}
  function place(r){const c=r.coordinates.map(x=>Number(coordinate5(x)));return{kind:'spot',id:`spot:${coordinate5(c[1])},${coordinate5(c[0])}`,name:r.name,coordinates:c};}
  function describe(r,d,now=Date.now()){return t("{0}{1}. TxDOT location list retrieved {2}; source update date not supplied. TxDOT describes a visitor stay limit of up to 24 hours (duration source retrieved {3}). A time limit does not establish permission to sleep overnight.", {"0":(r.location),"1":(r.milepost?t(" \u00b7 Milepost ")+r.milepost:''),"2":(d.source.retrieved_at),"3":(d.duration_context.source.retrieved_at)})+' '+policyDescription(policyFor(r,d,now));}
  function feature(r,d){const p=place(r);return{type:'Feature',geometry:{type:'Point',coordinates:p.coordinates},properties:{id:p.id,name:r.name,type:'spot',source:'Texas Department of Transportation',rest_area_source_id:r.id,rest_area_source_url:r.source_url,rest_area_evidence:describe(r,d)}};}
  function within(c,b){const lng=((c[0]+540)%360)-180,w=((b.west+540)%360)-180,e=((b.east+540)%360)-180;return c[1]>=b.south&&c[1]<=b.north&&(b.east-b.west>=360||(w<=e?lng>=w&&lng<=e:lng>=w||lng<=e));}
  function init(map){
    const L=global.L,layer=L.layerGroup();let data=null,pending=null,controller=null,control,status,view=0;
    const active=()=>map.hasLayer(layer);
    const el=(tag,text)=>{const n=global.document.createElement(tag);if(text)n.textContent=text;return n;};
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
    function popup(r,d){
      const box=el('div');box.className='kt-rest-popup';box.dataset.restAreaId=r.id;box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label',t("Rest-area source details"));box.style.maxHeight=Math.max(80,Math.min(360,map.getSize().y-160))+'px';
      box.append(el('h2',r.name),el('p',describe(r,d)),link(t("TxDOT place source"),r.source_url),' · ',link(t("TxDOT duration source"),POLICY));
      const policy=policyFor(r,d);if(policy.sources.length){const sources=el('p');sources.className='kt-rest-policy-sources';policy.sources.forEach((s,i)=>{if(i)sources.append(' · ');sources.append(link(t('State policy source {number}',{number:i+1}),s.url));});box.append(sources);}
      const actions=el('div');actions.className='kt-popup-actions';
      actions.append(button(t("Save rest-area stop"),()=>{const f=feature(r,d);global.KampTrailTrip?.addStop(f.properties.id,f);}),button(t("Overnight permission"),()=>global.KampTrailPermissions?.open(place(r))));box.append(actions);return box;
    }
    async function load(force=false){
      if(data&&!force)return data;if(pending)return pending;
      controller=new AbortController();const timer=global.setTimeout(()=>controller.abort(),20000);
      pending=(async()=>{const response=await global.fetch('data/rest-areas/TX.json',{cache:'no-store',signal:controller.signal});check(response.ok,'source unavailable');check(Number(response.headers.get('content-length'))<=512*1024,'response exceeds bound');
        const reader=response.body.getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024){await reader.cancel();throw new Error('Official rest-area response exceeds bound');}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}const catalogue=validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
        // An unavailable policy cannot prevent use of the independently sourced locations.
        try{const pr=await global.fetch('data/rest-areas/state-policies.json',{cache:'no-store',signal:controller.signal});check(pr.ok,'state policy unavailable');const reader=pr.body.getReader(),pieces=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>64*1024){await reader.cancel();throw new Error('State policy exceeds bound');}pieces.push(value);}const body=new Uint8Array(length);let pos=0;for(const piece of pieces){body.set(piece,pos);pos+=piece.byteLength;}catalogue.state_policies=validatePolicies(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));}catch{catalogue.state_policies=null;}
        data=catalogue;return data;
      })().finally(()=>{global.clearTimeout(timer);pending=null;controller=null;});return pending;
    }
    async function redraw(force=false){
      const current=++view;if(control)control.hidden=!active();if(!active())return;
      if(global.navigator.onLine===false){layer.clearLayers();status.textContent=t("Offline: reconnect to load official rest-area locations. Current opening and overnight permission are unknown.");return;}
      if(map.getZoom()<6){layer.clearLayers();status.textContent=t("Zoom to level 6 or closer. Official rest-area pilot covers Texas only. Overnight permission is unknown.");return;}
      status.textContent=t("Loading official rest-area locations…");
      try{
        const d=await load(force);if(current!==view||!active()||global.navigator.onLine===false)return;
        const b=map.getBounds(),bounds={south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()},rows=d.records.filter(r=>within(r.coordinates,bounds));
        status.textContent=t("{0} official rest-area location{1} in this view. Texas pilot only; other regions are not covered. TxDOT list retrieved {2}. Overnight permission and current opening are unknown.", {"0":(rows.length),"1":(rows.length===1?'':'s'),"2":(d.source.retrieved_at.slice(0,10))});
        // Hold marker replacement while any popup is open, as with campsite discovery.
        if(map._popup?.isOpen?.())return;
        layer.clearLayers();for(const r of rows){const marker=L.marker([r.coordinates[1],r.coordinates[0]],{title:r.name,keyboard:true,icon:L.divIcon({className:'kt-rest-icon',html:'<span>R</span>',iconSize:[26,26],iconAnchor:[13,13]})});marker.ktRestAreaId=r.id;marker.bindPopup(()=>popup(r,d),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]});layer.addLayer(marker);}
      }catch(error){if(current===view&&active()){layer.clearLayers();status.textContent=t("Official rest-area catalogue unavailable. Missing locations and overnight permission remain unknown. Reconnect and retry.");}}
    }
    const widget=L.control({position:'bottomright'});widget.onAdd=()=>{control=el('div');control.className='kt-rest-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');control.append(el('strong',t("Official rest areas")),status,button(t("Retry official rest areas"),()=>redraw(true)));L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;};widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer){if(!active()){++view;controller?.abort();}redraw();}});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});map.on('popupclose',()=>global.setTimeout(()=>{if(!map._popup?.isOpen?.())redraw();},0));
    global.addEventListener('offline',()=>{++view;controller?.abort();redraw();});global.addEventListener('online',()=>redraw());
    return layer;
  }
  const api={version:'2.20.0',validate,validatePolicies,resolvePolicy,policyFor,policyDescription,place,feature,describe,within,detail,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailRestAreas=api;
})(typeof window!=='undefined'?window:globalThis);
