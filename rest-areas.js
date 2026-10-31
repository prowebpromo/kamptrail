/* Official rest-area locations. Location and duration evidence never establishes overnight permission. */
(function(global){
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const LIST='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html';
  const POLICY='https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html';
  const detail=u=>typeof u==='string'&&/^https:\/\/www\.txdot\.gov\/discover\/rest-areas-travel-information-centers\/safety-rest-area-list\/[a-z0-9-]+\.html$/.test(u);
  // Reviewed official location publishers. Each region names the exact agency source, the
  // operator and facility class whose state policy may apply, and plausible state bounds.
  const REGIONS={
    TX:{name:'Texas',operator:'txdot',facility_kind:'safety_rest_area',publisher:'Texas Department of Transportation',list:LIST,id:/^txdot:[a-f0-9]{24}$/,place:detail,bbox:[-107,25,-93,37]},
    ID:{name:'Idaho',operator:'itd',facility_kind:'safety_rest_area',publisher:'Idaho Transportation Department',list:'https://gisp.itd.idaho.gov/server/rest/services/GDWarehouse/Assets/FeatureServer/5',id:/^itd:[a-f0-9-]{1,64}$/,place:u=>u==='https://itd.idaho.gov/faqs/rest-areas/',bbox:[-117.3,41.9,-111,49.1]},
    MT:{name:'Montana',operator:'mdt',facility_kind:'rest_area',publisher:'Montana Department of Transportation',list:'https://services1.arcgis.com/dKlvxNSUvl36IGMp/arcgis/rest/services/Montana_Rest_Areas/FeatureServer/0',id:/^mdt:[a-z0-9-]{1,64}$/,place:u=>u==='https://mdt.mt.gov/travinfo/restarea.aspx',bbox:[-116.1,44.3,-104,49.1]},
    FL:{name:'Florida',operator:'florida_turnpike',facility_kind:'turnpike_service_plaza',publisher:"Florida's Turnpike Enterprise",list:'https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/TurnpikeBaseData/FeatureServer/0',id:/^florida_turnpike:[a-z0-9-]{1,64}$/,place:u=>u==='https://floridasturnpike.com/traveler-resources/service-plazas/',bbox:[-87.7,24.4,-79.9,31.1]},
    OH:{name:'Ohio',operator:'odot',facility_kind:'rest_area_or_roadside_park',publisher:'Ohio Department of Transportation',list:'https://tims.dot.state.oh.us/ags/rest/services/Assets/ODOT_Facilities/MapServer/0',id:/^odot:[a-z0-9-]{1,64}$/,place:u=>u==='https://tims.dot.state.oh.us/ags/rest/services/Assets/ODOT_Facilities/MapServer/0',bbox:[-84.9,38.3,-80.4,42.4]}
  };
  const regionNames=regions=>regions.map(r=>t(REGIONS[r].name)).join(', ');
  const check=(ok,msg)=>{if(!ok)throw new Error('Official rest areas: '+msg);};
  const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s.replace('Z','.000Z');
  const activities=['overnight_parking','sleeping_in_vehicle','camping'],policyAge=180*86400000;
  const policyHosts=new Set(['www.txdot.gov','tcss.legis.texas.gov','mdt.mt.gov','mca.legmt.gov']);
  // New publishers are scoped to the exact reviewed URL, not every page on their domain.
  const exactPolicyUrls=new Set(["https://floridasturnpike.com/traveler-resources/service-plazas/","https://files.dfm.idaho.gov/dfm-admin-website/rules/current/39/390350.pdf","https://itd.idaho.gov/faqs/rest-areas/","https://codes.ohio.gov/ohio-administrative-code/rule-5501:2-4-01","https://tripcheck.com/Pages/Rest-Areas-Regulations","https://law.lis.virginia.gov/admincode/title24/agency30/chapter51/section30/","https://law.lis.virginia.gov/admincode/title24/agency30/chapter51/section10/"]);
  const unknownPolicy=()=>({policy_id:null,rules:{overnight_parking:'unknown',sleeping_in_vehicle:'unknown',camping:'unknown',max_stay_hours:null,conditions:[]},sources:[],review_required:[],current_opening:'unknown'});
  function policySources(sources,now){
    check(Array.isArray(sources)&&sources.length>0&&sources.length<=8,'missing policy sources');
    for(const s of sources){let u;try{u=new URL(s.url);}catch{check(false,'invalid policy URL');}check(u.protocol==='https:'&&(policyHosts.has(u.hostname)||exactPolicyUrls.has(s.url))&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^[a-f0-9]{64}$/.test(s.sha256)&&utc(s.retrieved_at)&&Date.parse(s.retrieved_at)<=now,'invalid policy evidence');}
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
  function policyFor(r,d,now=Date.now()){const g=REGIONS[d.region||'TX'];return resolvePolicy(d.state_policies,{state:r.state,operator:g.operator,facility_kind:g.facility_kind,facility_id:r.id},now);}
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
    const g=REGIONS[d?.region];
    check(d&&d.version===1&&g&&Array.isArray(d.records)&&d.records.length>0&&d.records.length<=1000,'invalid catalogue');
    source(d.source,g.list,now);
    if(d.region==='TX'){check(d.duration_context?.maximum_hours===24,'invalid duration context');source(d.duration_context.source,POLICY,now);}
    else check(d.operator===g.operator&&d.facility_kind===g.facility_kind&&d.publisher===g.publisher&&d.duration_context===undefined,'invalid catalogue scope');
    const ids=new Set(),[w,south,e,north]=g.bbox;
    for(const r of d.records){
      check(r&&g.id.test(r.id)&&!ids.has(r.id),'duplicate or invalid identity');ids.add(r.id);
      check(r.state===d.region&&r.permission==='unknown'&&Array.isArray(r.coordinates)&&r.coordinates.length===2&&r.coordinates.every(Number.isFinite)&&r.coordinates[0]>=w&&r.coordinates[0]<=e&&r.coordinates[1]>=south&&r.coordinates[1]<=north,'invalid place or unsupported permission claim');
      check(g.place(r.source_url)&&typeof r.name==='string'&&r.name.length>0&&new TextEncoder().encode(r.name).length<=200&&typeof r.location==='string'&&new TextEncoder().encode(r.location).length<=800&&(r.milepost===null||typeof r.milepost==='string'&&r.milepost.length<=60),'invalid source row');
      check(r.source_updated_at===undefined||r.source_updated_at===null||utc(r.source_updated_at)&&Date.parse(r.source_updated_at)<=now+300000,'invalid record update date');
    }
    return d;
  }
  // The region manifest lists only reviewed regions, each at most once.
  function validateIndex(index){
    check(index?.version===1&&Array.isArray(index.regions)&&index.regions.length>0&&index.regions.length<=Object.keys(REGIONS).length,'invalid rest-area index');const seen=new Set();
    for(const x of index.regions){check(x&&REGIONS[x.region]&&x.file===x.region+'.json'&&!seen.has(x.region),'invalid rest-area region');seen.add(x.region);}
    return index;
  }
  function coordinate5(x){const n=Math.sign(x)*Math.floor(Math.abs(x)*1e5+.5)/1e5;return(n===0?0:n).toFixed(5);}
  function place(r){const c=r.coordinates.map(x=>Number(coordinate5(x)));return{kind:'spot',id:`spot:${coordinate5(c[1])},${coordinate5(c[0])}`,name:r.name,coordinates:c};}
  function describe(r,d,now=Date.now()){
    const policy=' '+policyDescription(policyFor(r,d,now));
    if((d.region||'TX')==='TX')return t("{0}{1}. TxDOT location list retrieved {2}; source update date not supplied. TxDOT describes a visitor stay limit of up to 24 hours (duration source retrieved {3}). A time limit does not establish permission to sleep overnight.", {"0":(r.location),"1":(r.milepost?t(" \u00b7 Milepost ")+r.milepost:''),"2":(d.source.retrieved_at),"3":(d.duration_context.source.retrieved_at)})+policy;
    return t("{0}{1}. {2} location list retrieved {3}; record updated {4}. A listed location does not establish permission to park or sleep overnight.",{"0":r.location,"1":r.milepost?t(" \u00b7 Milepost ")+r.milepost:'',"2":t(REGIONS[d.region].publisher),"3":d.source.retrieved_at,"4":r.source_updated_at||t('date not supplied')})+policy;
  }
  function feature(r,d){const p=place(r);return{type:'Feature',geometry:{type:'Point',coordinates:p.coordinates},properties:{id:p.id,name:r.name,type:'spot',source:REGIONS[d.region].publisher,rest_area_source_id:r.id,rest_area_source_url:r.source_url,rest_area_evidence:describe(r,d)}};}
  function within(c,b){const lng=((c[0]+540)%360)-180,w=((b.west+540)%360)-180,e=((b.east+540)%360)-180;return c[1]>=b.south&&c[1]<=b.north&&(b.east-b.west>=360||(w<=e?lng>=w&&lng<=e:lng>=w||lng<=e));}
  function init(map){
    const L=global.L,layer=L.layerGroup();let data=null,pending=null,controller=null,control,status,view=0;
    const active=()=>map.hasLayer(layer);
    const el=(tag,text)=>{const n=global.document.createElement(tag);if(text)n.textContent=text;return n;};
    const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
    const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
    function popup(r,d){
      const box=el('div');box.className='kt-rest-popup';box.dataset.restAreaId=r.id;box.tabIndex=0;box.setAttribute('role','region');box.setAttribute('aria-label',t("Rest-area source details"));box.style.maxHeight=Math.max(80,Math.min(360,map.getSize().y-160))+'px';
      box.append(el('h2',r.name),el('p',describe(r,d)));
      if(d.region==='TX')box.append(link(t("TxDOT place source"),r.source_url),' · ',link(t("TxDOT duration source"),POLICY));
      else{box.append(link(t('{0} place source',{"0":t(REGIONS[d.region].publisher)}),r.source_url));if(d.source.url!==r.source_url)box.append(' · ',link(t('{0} location data',{"0":t(REGIONS[d.region].publisher)}),d.source.url));}
      const policy=policyFor(r,d);if(policy.sources.length){const sources=el('p');sources.className='kt-rest-policy-sources';policy.sources.forEach((s,i)=>{if(i)sources.append(' · ');sources.append(link(t('State policy source {number}',{number:i+1}),s.url));});box.append(sources);}
      const actions=el('div');actions.className='kt-popup-actions';
      actions.append(button(t("Save rest-area stop"),()=>{const f=feature(r,d);global.KampTrailTrip?.addStop(f.properties.id,f);}),button(t("Overnight permission"),()=>global.KampTrailPermissions?.open(place(r))));box.append(actions);return box;
    }
    async function readJSON(url,limit,signal){
      const response=await global.fetch(url,{cache:'no-store',signal});check(response.ok,'source unavailable');check(Number(response.headers.get('content-length'))<=limit,'response exceeds bound');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('Official rest-area response exceeds bound');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }
    async function load(force=false){
      if(data&&!force)return data;if(pending)return pending;
      controller=new AbortController();const timer=global.setTimeout(()=>controller.abort(),20000);
      pending=(async()=>{const signal=controller.signal,index=validateIndex(await readJSON('data/rest-areas/index.json',16*1024,signal));
        // One unavailable region never hides the others; its locations stay explicitly missing.
        const catalogues=[],missing=[];
        for(const x of index.regions){try{catalogues.push(validate(await readJSON('data/rest-areas/'+x.file,512*1024,signal)));}catch(error){if(signal.aborted)throw error;missing.push(x.region);}}
        check(catalogues.length>0,'no region available');
        // An unavailable policy cannot prevent use of the independently sourced locations.
        let policies=null;try{policies=validatePolicies(await readJSON('data/rest-areas/state-policies.json',64*1024,signal));}catch{policies=null;}
        for(const c of catalogues)c.state_policies=policies;
        data={catalogues,missing,regions:catalogues.map(c=>c.region).sort(),rows:catalogues.flatMap(c=>c.records.map(r=>({r,d:c})))};return data;
      })().finally(()=>{global.clearTimeout(timer);pending=null;controller=null;});return pending;
    }
    async function redraw(force=false){
      const current=++view;if(control)control.hidden=!active();if(!active())return;
      if(global.navigator.onLine===false){layer.clearLayers();status.textContent=t("Offline: reconnect to load official rest-area locations. Current opening and overnight permission are unknown.");return;}
      if(map.getZoom()<6){layer.clearLayers();status.textContent=t("Zoom to level 6 or closer. Official rest-area coverage: {0}. Overnight permission is unknown.",{"0":regionNames(data?.regions||Object.keys(REGIONS))});return;}
      status.textContent=t("Loading official rest-area locations…");
      try{
        const d=await load(force);if(current!==view||!active()||global.navigator.onLine===false)return;
        const b=map.getBounds(),bounds={south:b.getSouth(),west:b.getWest(),north:b.getNorth(),east:b.getEast()},rows=d.rows.filter(x=>within(x.r.coordinates,bounds));
        status.textContent=t("{0} official rest-area location{1} in this view. Coverage: {2}; other states are not covered. Overnight permission and current opening are unknown.",{"0":rows.length,"1":rows.length===1?'':'s',"2":regionNames(d.regions)})+(d.missing.length?' '+t("Unavailable now: {0}.",{"0":regionNames(d.missing)}):'');
        // Hold marker replacement while any popup is open, as with campsite discovery.
        if(map._popup?.isOpen?.())return;
        layer.clearLayers();for(const {r,d} of rows){const marker=L.marker([r.coordinates[1],r.coordinates[0]],{title:r.name,keyboard:true,icon:L.divIcon({className:'kt-rest-icon',html:'<span>R</span>',iconSize:[26,26],iconAnchor:[13,13]})});marker.ktRestAreaId=r.id;marker.bindPopup(()=>popup(r,d),{maxWidth:Math.max(120,Math.min(300,map.getSize().x-70)),autoPanPaddingTopLeft:[12,80],autoPanPaddingBottomRight:[12,28]});layer.addLayer(marker);}
      }catch(error){if(current===view&&active()){layer.clearLayers();status.textContent=t("Official rest-area catalogue unavailable. Missing locations and overnight permission remain unknown. Reconnect and retry.");}}
    }
    const widget=L.control({position:'bottomright'});widget.onAdd=()=>{control=el('div');control.className='kt-rest-control';control.hidden=true;status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');control.append(el('strong',t("Official rest areas")),status,button(t("Retry official rest areas"),()=>redraw(true)));L.DomEvent.disableClickPropagation(control);L.DomEvent.disableScrollPropagation(control);return control;};widget.addTo(map);
    map.on('overlayadd overlayremove',e=>{if(e.layer===layer){if(!active()){++view;controller?.abort();}redraw();}});
    let timer;map.on('moveend',()=>{global.clearTimeout(timer);timer=global.setTimeout(()=>redraw(),180);});map.on('popupclose',()=>global.setTimeout(()=>{if(!map._popup?.isOpen?.())redraw();},0));
    global.addEventListener('offline',()=>{++view;controller?.abort();redraw();});global.addEventListener('online',()=>redraw());
    return layer;
  }
  const api={version:'2.27.0',REGIONS,validateIndex,validate,validatePolicies,resolvePolicy,policyFor,policyDescription,place,feature,describe,within,detail,init};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.KampTrailRestAreas=api;
})(typeof window!=='undefined'?window:globalThis);
