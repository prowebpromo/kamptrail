/* Dated official environmental context. Dynamic hazards are never saved for offline use. */
(function(global){
  'use strict';
  const MIN_ZOOM=7,MAX_AGE=20*60*1000,MAX_BYTES=6000000,MAX_FEATURES=500;
  const SOURCES={fire:{label:'Fire perimeters (NIFC)',name:'NIFC',url:'https://data-nifc.opendata.arcgis.com/'},smoke:{label:'Smoke plumes (NOAA)',name:'NOAA HMS',url:'https://www.ospo.noaa.gov/products/land/hms.html'},alerts:{name:'National Weather Service',url:'https://www.weather.gov/'}};
  const st={map:null,groups:{},enabled:new Set(),status:{},control:null,sequence:{fire:0,smoke:0},controllers:{},timers:{},dialog:null,pointSequence:0,pointController:null,point:null,interval:null,expiry:null,reading:new Set(),requestQueue:Promise.resolve(),lastRequest:0};
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const text=v=>typeof v==='string'?v:'';
  function stamp(value){const d=Date.parse(value);return Number.isFinite(d)?new Date(d).toLocaleString():'Not reported';}
  function validBounds(b){return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90&&b[0]<b[2]&&b[1]<b[3]&&b[2]-b[0]<=10&&b[3]-b[1]<=10;}
  function validGeometry(g,budget={count:0}){
    if(!g||!['Polygon','MultiPolygon'].includes(g.type))return false;
    const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
    return Array.isArray(polygons)&&polygons.length>0&&polygons.length<=1000&&polygons.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(p=>++budget.count<=100000&&Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1]));
  }
  function validate(d,kind,now=Date.now()){
    if(!Object.hasOwn(SOURCES,kind)||!d||d.ok!==true||d.version!==1||d.kind!==kind||d.partial===true||d.data?.type!=='FeatureCollection'||!Array.isArray(d.data.features)||d.data.features.length>MAX_FEATURES)throw new Error('Invalid context');
    if(kind==='smoke'&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.source?.observation_date||'')||!Number.isFinite(Date.parse(d.source.observation_date))))throw new Error('Missing observation day');
    const at=Date.parse(d.retrieved_at);if(!Number.isFinite(at)||at>now+60000||now-at>MAX_AGE)throw new Error('Outdated context');
    const budget={count:0};
    for(const f of d.data.features){
      if(f?.type!=='Feature'||!f.properties||typeof f.properties!=='object'||Array.isArray(f.properties))throw new Error('Invalid feature');
      if(kind==='alerts'){
        const p=f.properties;if(!text(p.event)||!text(p.headline)||!Number.isFinite(Date.parse(p.expires)))throw new Error('Invalid alert');
      }else if(!validGeometry(f.geometry,budget))throw new Error('Invalid shape');
    }
    return d;
  }
  function activeAlerts(features,now=Date.now()){return features.filter(f=>Date.parse(f.properties.expires)>now&&(!f.properties.ends||Date.parse(f.properties.ends)>now));}
  function query(kind,coords){const p=new URLSearchParams({kind});if(kind==='alerts'){p.set('lat',coords[0].toFixed(4));p.set('lng',coords[1].toFixed(4));}else p.set('bbox',coords.map(x=>x.toFixed(3)).join(','));return 'api/environment.php?'+p;}
  async function fetchContext(kind,coords,signal){
    if(!navigator.onLine)throw new Error('Offline');
    if(signal.aborted)throw new Error('Cancelled');
    const delay=Math.max(0,2100-(Date.now()-st.lastRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(signal.aborted)throw new Error('Cancelled');st.lastRequest=Date.now();
    let r=await fetch(query(kind,coords),{signal,cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}});
    if(r.status===503&&!signal.aborted){await new Promise(resolve=>setTimeout(resolve,2100));if(signal.aborted)throw new Error('Cancelled');st.lastRequest=Date.now();r=await fetch(query(kind,coords),{signal,cache:'no-store',credentials:'omit',headers:{Accept:'application/json'}});}
    if(!r.ok)throw new Error('Source unavailable');
    const body=await r.text();if(body.length>MAX_BYTES)throw new Error('Context too large');return validate(JSON.parse(body),kind);
  }
  function request(kind,coords,signal){const pending=st.requestQueue.then(()=>fetchContext(kind,coords,signal));st.requestQueue=pending.catch(()=>{});return pending;}
  function sourceLink(kind){const a=node('a',SOURCES[kind].name+' source');a.href=SOURCES[kind].url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function evidence(feature,kind,retrieved){
    const p=feature.properties,box=node('div',null,'kt-environment-popup');box.append(node('h3',text(p.name)||(kind==='fire'?'Reported fire perimeter':'Satellite smoke plume')));
    if(kind==='fire'){
      box.append(node('p',`Incident type: ${text(p.type)||'Not reported'}`));
      if(typeof p.acres==='number'&&Number.isFinite(p.acres))box.append(node('p',`Reported area: ${p.acres.toLocaleString()} acres`));
      box.append(node('p',`Source updated: ${stamp(p.source_updated_at)}`),node('p','Shapes are simplified for map display; consult source boundaries. A reported perimeter may be incomplete or outdated. It does not establish evacuation zones, closures, containment, or safe access.','kt-fine'));
    }else{
      box.append(node('p',`Satellite plume density: ${text(p.density)||'Not reported'}`),node('p',`Observation: ${stamp(p.start)} to ${stamp(p.end)}`),node('p','Smoke can be above ground level. This is satellite plume analysis, not ground-level air quality, AQI, or a smoke forecast. Clouds and observation gaps can hide smoke.','kt-fine'));
    }
    box.append(node('p',`Retrieved: ${stamp(retrieved)}`),sourceLink(kind));return box;
  }
  function color(kind,f){const key=kind==='fire'?'--environment-fire':text(f.properties.density).toLowerCase()==='heavy'?'--environment-smoke-heavy':text(f.properties.density).toLowerCase()==='medium'?'--environment-smoke-medium':'--environment-smoke-light';return getComputedStyle(document.documentElement).getPropertyValue(key).trim();}
  function draw(kind,d){
    st.groups[kind].clearLayers();L.geoJSON(d.data,{renderer:st.renderer,bubblingMouseEvents:false,style:f=>({color:color(kind,f),weight:Number(getComputedStyle(document.documentElement).getPropertyValue('--environment-stroke')),fillOpacity:Number(getComputedStyle(document.documentElement).getPropertyValue(kind==='fire'?'--environment-fire-opacity':'--environment-smoke-opacity'))}),onEachFeature(f,l){l.bindPopup(()=>evidence(f,kind,d.retrieved_at));l.on('popupopen',()=>st.reading.add(kind));l.on('popupclose',()=>st.reading.delete(kind));l.on('add',()=>{const e=l.getElement?.();if(e){e.setAttribute('tabindex','0');e.setAttribute('role','button');e.setAttribute('aria-label',`${kind==='fire'?'Fire perimeter':'Smoke plume'}: ${text(f.properties.name)||text(f.properties.density)||'source details'}`);e.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();l.openPopup();}});}});}}).addTo(st.groups[kind]);
  }
  function bounds(){const b=st.map.getBounds(),w=((b.getWest()+540)%360)-180;return [w,b.getSouth(),w+b.getEast()-b.getWest(),b.getNorth()].map(x=>+x.toFixed(3));}
  function status(kind,message){if(st.status[kind])st.status[kind].textContent=message;}
  async function refresh(kind){
    if(!st.enabled.has(kind))return;
    const seq=++st.sequence[kind];st.controllers[kind]?.abort();clearTimeout(st.timers[kind]);st.groups[kind].clearLayers();
    if(!navigator.onLine){status(kind,'Offline: live context is hidden. Reconnect and refresh.');return;}
    const b=bounds();if(st.map.getZoom()<MIN_ZOOM||!validBounds(b)){status(kind,`Zoom to level ${MIN_ZOOM} or closer into an area smaller than 10° to load this layer.`);return;}
    status(kind,'Loading official source…');const controller=new AbortController();st.controllers[kind]=controller;const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const d=await request(kind,b,controller.signal);if(seq!==st.sequence[kind]||!st.enabled.has(kind)||!navigator.onLine)return;draw(kind,d);
      status(kind,`${kind==='smoke'?'Observation day '+d.source.observation_date+' (UTC). ':''}${d.data.features.length} ${kind==='fire'?'reported perimeters':'satellite plumes'} returned. Retrieved ${stamp(d.retrieved_at)}. ${kind==='fire'?'Not every fire has a mapped perimeter.':'No plume does not mean clean air.'}`);
      st.timers[kind]=setTimeout(()=>refresh(kind),5*60*1000);
    }catch{if(seq!==st.sequence[kind]||!st.enabled.has(kind))return;status(kind,navigator.onLine?'Source unavailable or incomplete. No shapes are shown. Refresh or zoom closer.':'Offline: live context is hidden. Reconnect and refresh.');}
    finally{clearTimeout(timeout);}
  }
  function panel(){const c=L.control({position:'bottomleft'});c.onAdd=()=>{
    const box=node('div',null,'kt-environment-control'),details=node('details');details.open=!matchMedia('(max-width:760px)').matches;details.append(node('summary','Fire and smoke context'));
    const body=node('div',null,'kt-environment-body');body.append(node('p','Official source context, not an emergency warning service. Shapes are simplified for map display. Check local authorities, closures, and posted restrictions before travel.','kt-fine'));
    for(const kind of ['fire','smoke']){const section=node('section');section.dataset.environment=kind;section.append(node('strong',SOURCES[kind].label));const line=node('p','Not enabled.');line.setAttribute('role','status');line.setAttribute('aria-live','polite');st.status[kind]=line;section.append(line,sourceLink(kind));body.append(section);}
    const legend=node('ul',null,'kt-environment-key');for(const [key,label]of [['fire','Reported fire perimeter'],['smoke-light','Light smoke plume'],['smoke-medium','Medium smoke plume'],['smoke-heavy','Heavy smoke plume']]){const li=node('li'),swatch=node('i');swatch.className='kt-environment-key-'+key;swatch.setAttribute('aria-hidden','true');li.append(swatch,label);legend.append(li);}body.append(legend,node('p','Smoke shading is satellite plume density, not AQI. Empty or unavailable layers do not establish safe conditions.','kt-fine'));
    const retry=node('button','Refresh fire and smoke','btn');retry.type='button';retry.onclick=()=>st.enabled.forEach(refresh);body.append(retry);details.append(body);box.append(details);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);st.box=box;return box;};return c;}
  function syncPanel(){if(st.enabled.size){if(!st.control)st.control=panel().addTo(st.map);}else{st.control?.remove();st.control=null;st.status={};}}
  function init(map){
    st.map=map;st.renderer=L.svg();const overlays={};for(const kind of ['fire','smoke']){const group=L.layerGroup();st.groups[kind]=group;overlays[SOURCES[kind].label]=group;
      group.on('add',()=>{st.enabled.add(kind);syncPanel();refresh(kind);});
      group.on('remove',()=>{st.enabled.delete(kind);st.sequence[kind]++;st.controllers[kind]?.abort();clearTimeout(st.timers[kind]);group.clearLayers();status(kind,'Not enabled.');syncPanel();});
    }
    map.on('moveend',()=>st.enabled.forEach(kind=>{if(st.reading.has(kind))return;clearTimeout(st.timers[kind]);st.timers[kind]=setTimeout(()=>refresh(kind),600);}));
    global.addEventListener('offline',()=>{st.enabled.forEach(refresh);if(st.point&&st.dialog?.open)renderAlertsOffline();});
    global.addEventListener('online',()=>{st.enabled.forEach(refresh);if(st.point&&st.dialog?.open)loadAlerts();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){st.enabled.forEach(refresh);if(st.point&&st.dialog?.open)loadAlerts();}});
    return overlays;
  }
  function showNear(lat,lng){if(!st.map)return;st.map.closePopup();st.map.setView([lat,lng],Math.max(8,st.map.getZoom()));for(const kind of ['fire','smoke'])if(!st.map.hasLayer(st.groups[kind]))st.groups[kind].addTo(st.map);else refresh(kind);st.box?.querySelector('details')?.setAttribute('open','');}
  function renderAlertsOffline(){clearTimeout(st.expiry);st.pointSequence++;st.pointController?.abort();st.alertBody.replaceChildren(node('p','Offline: current weather alerts cannot be checked. Reconnect and refresh.'));}
  function renderAlerts(d){
    clearTimeout(st.expiry);
    const features=activeAlerts(d.data.features);st.alertBody.replaceChildren(node('p',`National Weather Service · retrieved ${stamp(d.retrieved_at)}`));
    if(!features.length)st.alertBody.append(node('p','No active NWS alerts returned for this coordinate. This does not establish safe weather, fire conditions, road access, or camping permission.'));
    for(const f of features){const p=f.properties,article=node('article',null,'kt-alert');article.append(node('h3',text(p.event)),node('p',text(p.headline)),node('p',`Severity: ${text(p.severity)||'Not reported'} · expires ${stamp(p.expires)}`),node('p',`Issued ${stamp(p.sent)} · effective ${stamp(p.effective)}${p.onset?' · onset '+stamp(p.onset):''}`));if(p.areaDesc)article.append(node('p',text(p.areaDesc)));for(const [label,key]of [['Details','description'],['Instructions','instruction']])if(text(p[key])){const details=node('details');details.append(node('summary',label),node('p',p[key]));article.append(details);}st.alertBody.append(article);}
    st.alertBody.append(sourceLink('alerts'));
    const next=features.flatMap(f=>[Date.parse(f.properties.expires),Date.parse(f.properties.ends)]).filter(t=>t>Date.now());if(next.length)st.expiry=setTimeout(()=>{if(st.dialog.open&&navigator.onLine)renderAlerts(d);},Math.min(...next)-Date.now()+10);
  }
  async function loadAlerts(){
    const seq=++st.pointSequence;st.pointController?.abort();if(!navigator.onLine){renderAlertsOffline();return;}
    st.alertBody.replaceChildren(node('p','Checking active NWS alerts for this coordinate…'));const controller=new AbortController();st.pointController=controller;const timeout=setTimeout(()=>controller.abort(),45000);
    try{const d=await request('alerts',st.point,controller.signal);if(seq!==st.pointSequence||!st.dialog.open||!navigator.onLine)return;renderAlerts(d);}catch{if(seq===st.pointSequence&&st.dialog.open)st.alertBody.replaceChildren(node('p','NWS alerts could not be checked. Refresh when connected or check the official source directly.'),sourceLink('alerts'));}finally{clearTimeout(timeout);}
  }
  function openAlerts(lat,lng){
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
    if(!st.dialog){const dialog=node('dialog');dialog.id='kt-environment-alerts';dialog.setAttribute('aria-labelledby','kt-environment-title');const head=node('div',null,'kt-environment-heading'),title=node('h2','Weather alerts');title.id='kt-environment-title';const close=node('button','Close','btn');close.type='button';close.setAttribute('aria-label','Close weather alerts');close.onclick=()=>dialog.close();head.append(title,close);dialog.append(head);st.alertLocation=node('p');dialog.append(st.alertLocation,node('p','NWS alerts apply at this coordinate. This is an on-demand check, not a push notification or evacuation service. Confirm restrictions with the land manager.','kt-fine'));st.alertBody=node('div');st.alertBody.setAttribute('role','status');st.alertBody.setAttribute('aria-live','polite');dialog.append(st.alertBody);const refresh=node('button','Refresh weather alerts','btn');refresh.type='button';refresh.onclick=loadAlerts;const nearby=node('button','Fire and smoke nearby','btn');nearby.type='button';nearby.onclick=()=>{dialog.close();showNear(...st.point);};dialog.append(refresh,nearby);dialog.addEventListener('close',()=>{st.pointSequence++;st.pointController?.abort();clearInterval(st.interval);clearTimeout(st.expiry);});document.body.append(dialog);st.dialog=dialog;}
    st.point=[lat,lng];st.alertLocation.textContent=`Coordinate ${lat.toFixed(4)}, ${lng.toFixed(4)}`;if(!st.dialog.open)st.dialog.showModal();loadAlerts();clearInterval(st.interval);st.interval=setInterval(()=>{if(st.dialog.open)loadAlerts();},60000);
  }
  global.KampTrailEnvironment={version:'2.13.0',init,showNear,openAlerts,refresh,validate,validBounds,validGeometry,activeAlerts,query};
})(typeof window!=='undefined'?window:globalThis);
