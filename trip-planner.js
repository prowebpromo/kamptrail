/* Saved stops and trip planning. A feature snapshot keeps saved locations usable between regions.
   Trip tools: order, notes and dates, straight-line totals, route line, whole-trip directions, GPX. */
(function () {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const st = {revision:0,topologyKey:'',drive:null,driveKey:'',driveBusy:false,map:null,open:false,stops:[],el:null,previousFocus:null,savedMarker:null,recoveryStates:new Set(),storageAvailable:true,routeLayer:null,gpxLayer:null,showRoute:false};
  const valid = site => site?.geometry?.type === 'Point' && Array.isArray(site.geometry.coordinates)
    && site.geometry.coordinates.length >= 2 && site.geometry.coordinates.slice(0,2).every(Number.isFinite)
    && Math.abs(site.geometry.coordinates[0]) <= 180 && Math.abs(site.geometry.coordinates[1]) <= 90
    && site.properties && site.properties.id != null && String(site.properties.id).trim() !== '';
  const clone = value => JSON.parse(JSON.stringify(value));
  const nameOf = site => String(site.properties.name || t("Saved campsite"));
  const notify = message => window.showToast?.(message, 'error');
  const info = message => window.showToast?.(message, 'info');
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const cleanText = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  function syncRevision() {
    const key=JSON.stringify(st.stops.map(stop=>[stop.id,valid(stop.feature)?stop.feature.geometry.coordinates.slice(0,2):null]));
    if(key!==st.topologyKey){st.topologyKey=key;st.revision++;if(typeof window.CustomEvent==='function')window.dispatchEvent(new window.CustomEvent('kamptrail:tripchanged',{detail:{revision:st.revision}}));}
    return st.revision;
  }
  function save() {
    syncRevision();
    try { localStorage.setItem('kt_trip',JSON.stringify(st.stops));st.storageAvailable=true;return true; }
    catch { st.storageAvailable=false;notify(t("Your browser could not save these stops. Changes are available only while this page stays open."));return false; }
  }
  function load() {
    try {
      const data=JSON.parse(localStorage.getItem('kt_trip') || '[]');
      st.stops=Array.isArray(data) ? data.filter(item=>typeof item==='string' || typeof item==='number' || (item && item.id != null)).map(item=>typeof item==='object'
        ? {id:String(item.id),feature:valid(item.feature)?clone(item.feature):null,note:cleanText(item.note,1000),arrive:isDate(item.arrive)?item.arrive:'',depart:isDate(item.depart)?item.depart:''}
        : {id:String(item),feature:null,note:'',arrive:'',depart:''}).filter(stop=>stop.id.trim()) : [];
    } catch { st.stops=[];st.storageAvailable=false;notify(t("Saved stops could not be read in this browser. You can save new stops during this visit.")); }
    try { st.showRoute = localStorage.getItem('kt_trip_route') === '1'; } catch {}
  }
  function getSite(stop) {
    // A saved service may share an OSM identity with a campground; keep its service evidence.
    if(stop.feature?.properties?.type==='service')return valid(stop.feature)?stop.feature:null;
    const current=window.KampTrailData?.getCampsiteById(stop.id);
    if(valid(current)) { stop.feature=clone(current);stop.id=String(current.properties.id); }
    return valid(stop.feature) ? stop.feature : null;
  }
  const latLng = site => [site.geometry.coordinates[1], site.geometry.coordinates[0]];
  const pt = ([lat,lng]) => `${+lat.toFixed(6)},${+lng.toFixed(6)}`;
  function directions(site) {
    const [lng,lat]=site.geometry.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  function miles(a, b) {
    const rad = v => v * Math.PI / 180, dLat = rad(b[0]-a[0]), dLon = rad(b[1]-a[1]);
    const h = Math.sin(dLat/2)**2 + Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function nights(a, b) {
    if (!isDate(a) || !isDate(b)) return 0;
    const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
    return n > 0 ? n : 0;
  }
  // Google Maps URLs allow up to 3 waypoints on mobile browsers and 9 elsewhere.
  function maxWaypoints() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '') ? 3 : 9; }
  function routeLegs(points, perLeg = maxWaypoints()) {
    if (points.length < 2) return points.length ? [{from:1,to:1,url:`https://www.google.com/maps/dir/?api=1&destination=${pt(points[0])}`}] : [];
    const legs = [];let start = 0;
    while (start < points.length - 1) {
      const end = Math.min(points.length - 1, start + perLeg + 1);
      const mids = points.slice(start + 1, end).map(pt);
      let url = `https://www.google.com/maps/dir/?api=1&origin=${pt(points[start])}&destination=${pt(points[end])}&travelmode=driving`;
      if (mids.length) url += `&waypoints=${mids.map(encodeURIComponent).join('%7C')}`;
      legs.push({from:start + 1, to:end + 1, url});
      start = end;
    }
    return legs;
  }
  // ---- After-stay review prompt (local only; opens the existing moderated review form) ----
  const STAY_KEY='kt_stay_prompts_v1';
  function localToday(now=new Date()){const p=n=>String(n).padStart(2,'0');return `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;}
  function stayDismissed(){try{const v=JSON.parse(localStorage.getItem(STAY_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}}
  function stayKey(stop){return `${stop.id}|${stop.depart||stop.arrive}`;}
  function stayDue(stop,site,today=localToday()){
    const date=stop.depart||stop.arrive;
    return !!(site&&site.properties?.type!=='service'&&isDate(date)&&date<=today&&!stayDismissed()[stayKey(stop)]);
  }
  function dismissStay(stop){const v=stayDismissed();v[stayKey(stop)]=localToday();try{localStorage.setItem(STAY_KEY,JSON.stringify(v));}catch{}}
  function stayPrompt(stop,site,label){
    const box=document.createElement('div');box.className='kt-stay-prompt';
    const text=document.createElement('p');text.textContent=t("How was your stay? A dated review helps other campers. Nothing is sent unless you submit the review form.");
    const write=button(t("Write a review"),()=>{if(window.KampTrailCommunity)KampTrailCommunity.open(site);});write.setAttribute('aria-label',t("Write a review for {name}",{name:label}));
    const later=button(t("Dismiss"),()=>{dismissStay(stop);box.remove();});later.setAttribute('aria-label',t("Dismiss the review reminder for {name}",{name:label}));
    box.append(text,write,later);return box;
  }
  function button(text,action) {
    const el=document.createElement('button');el.type='button';el.className='btn';el.textContent=text;el.onclick=action;return el;
  }
  function viewStop(stop) {
    const site=getSite(stop);if(!site)return;
    close();
    st.savedMarker?.remove();st.savedMarker=null;
    if(site.properties.type!=='service'&&window.KampTrailData?.focusCampsite?.(stop.id))return;
    const [lng,lat]=site.geometry.coordinates;
    st.map.setView([lat,lng],12);
    // A snapshot location remains viewable even if its source region is not loaded.
    if(window.L?.marker) {
      const popup=document.createElement('div');
      const title=document.createElement('strong');title.textContent=nameOf(site);
      const note=document.createElement('p');note.textContent=stop.note ? stop.note : (site.properties.type==='service'?t("Saved service location. Confirm current access and opening with the operator."):t("Saved location. Confirm current campsite access with the operator."));
      const evidence=document.createElement('p');if(site.properties.type==='service')evidence.textContent=typeof site.properties.service_evidence==='string'?site.properties.service_evidence.slice(0,4000):t("Dated service evidence unavailable. Opening, RV access and overnight permission are unverified.");
      const link=document.createElement('a');link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent=t("Directions in Google Maps");
      popup.append(title,note);if(site.properties.type==='service')popup.append(evidence);if(typeof site.properties.rest_area_evidence==='string'){const rest=document.createElement('p');rest.textContent=t("Saved dated source context, not a current permission decision: ")+site.properties.rest_area_evidence.slice(0,4000);popup.append(rest);if(window.KampTrailRestAreas?.detail(site.properties.rest_area_source_url)){const source=document.createElement('a');source.href=site.properties.rest_area_source_url;source.target='_blank';source.rel='noopener noreferrer';source.textContent=t("TxDOT source");popup.append(source);}}popup.append(link,button(t("Overnight permission"),()=>window.KampTrailPermissions?.open({kind:site.properties.type==='service'?'service':['spot','imported'].includes(site.properties.type)||String(site.properties.id||stop.id).startsWith('gpx:')?'spot':'campsite',id:String(site.properties.id||stop.id),name:nameOf(site),coordinates:[lng,lat]})));
      st.savedMarker=L.marker([lat,lng],{title:nameOf(site)}).addTo(st.map).bindPopup(popup).openPopup();
    }
  }
  const ROUTE_CREDIT='Routes: <a href="https://routing.openstreetmap.de/about.html">OSRM / FOSSGIS</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap">fix the map</a>';
  function drawRoute() {
    if(!st.map||!window.L?.polyline)return;
    st.routeLayer?.remove();st.routeLayer=null;st.map.attributionControl?.removeAttribution(ROUTE_CREDIT);
    const drive=currentDrive();if(!st.showRoute||!drive?.raw?.geometry)return;
    const root=getComputedStyle(document.documentElement),points=drive.raw.geometry.coordinates.map(([lng,lat])=>[lat,lng]);
    st.routeLayer=L.polyline(points,{renderer:L.svg(),color:root.getPropertyValue('--route-color').trim(),weight:parseFloat(root.getPropertyValue('--route-stroke')),opacity:.85,interactive:false,className:'kt-road-route'}).addTo(st.map);st.map.attributionControl?.addAttribution(ROUTE_CREDIT);
  }
  function move(index, delta) {
    const target=index+delta;if(target<0||target>=st.stops.length)return;
    const [item]=st.stops.splice(index,1);st.stops.splice(target,0,item);save();render();drawRoute();
    st.el.querySelectorAll('.kt-saved-stop')[target]?.querySelector(delta<0?'.kt-trip-up':'.kt-trip-down')?.focus();
  }
  // One explicit road-route request, shared with discovery and cached on this device.
  const MAX_ROUTE_STOPS=25;
  const pointsKey=points=>points.map(pt).join(';');
  const fmtTime=s=>{const m=Math.round(s/60),h=Math.floor(m/60);return h?t("{0} hr {1} min", {"0":(h),"1":(m%60)}):`${m} min`;};
  async function fetchDrive(){
    const sites=st.stops.map(getSite),points=sites.filter(Boolean).map(latLng);
    if(points.length<2){notify(t("Save at least two stops to calculate a road route."));return;}
    if(sites.some(s=>!s)){notify(t("An older stop has no coordinates. Resolve or remove it before routing."));return;}
    if(points.length>MAX_ROUTE_STOPS){notify(t("Road routing covers up to {count} stops. Split this into shorter trips.", {count:MAX_ROUTE_STOPS}));return;}
    if(st.driveBusy)return;st.driveBusy=true;
    const btn=st.el.querySelector('#kt-trip-drive');btn.disabled=true;btn.textContent=t("Calculating road route…");const requestedKey=pointsKey(points),refresh=!!currentDrive();
    try{
      const route=await KampTrailRoutes.calculate(points.map(([lat,lng])=>[lng,lat]),{refresh});
      if(requestedKey!==pointsKey(st.stops.map(getSite).filter(Boolean).map(latLng))){info(t("Your stops changed while routing. Calculate the updated trip."));return;}
      st.drive={legs:route.legs.map(l=>({s:l.duration,m:l.distance/1609.344})),s:route.duration,m:route.distance/1609.344,raw:route};st.driveKey=requestedKey;st.showRoute=true;
      window.dispatchEvent(new Event('kamptrail:routechanged'));
      try{localStorage.setItem('kt_trip_route','1');}catch{}render();drawRoute();
    }catch(e){const message=e.message||t("Road routing is unavailable. External directions and saved stops still work.");notify(message);st.el.querySelector('#kt-trip-route-status').textContent=message;}
    finally{st.driveBusy=false;btn.disabled=false;btn.textContent=t("Calculate road route");}
  }
  function insertAfter(feature,index){
    if(!valid(feature))return;const id=String(feature.properties.id);if(st.stops.some(x=>x.id===id)){open();return;}
    st.stops.splice(Math.min(st.stops.length,index+1),0,{id,feature:clone(feature),note:'',arrive:'',depart:''});save();render();drawRoute();open();
  }
  function viewRoadRoute(){const drive=currentDrive();if(!drive?.raw)return;close();st.showRoute=true;drawRoute();const padding=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--route-fit-padding'));st.map.fitBounds(L.latLngBounds(drive.raw.geometry.coordinates.map(([lng,lat])=>[lat,lng])),{padding:[padding,padding],maxZoom:12});}
  function terrainRoute(){const drive=currentDrive();if(!drive?.raw)return;close();window.KampTrailRouteElevation?.open(drive.raw,{revision:window.KampTrailTrip.getRevision(),getRevision:()=>window.KampTrailTrip.getRevision()});}
  function discoverRoute(){const drive=currentDrive();if(!drive?.raw)return;const sites=st.stops.map(getSite);if(sites.some(s=>!s))return;close();KampTrailRoutes.open(drive.raw,sites,{insert:insertAfter});}
  function currentDrive() {
    const points=st.stops.map(getSite).filter(Boolean).map(latLng);
    return st.drive&&st.driveKey===pointsKey(points)?st.drive:null;
  }
  function summary(sites) {
    const points=sites.filter(Boolean).map(latLng);let total=0;
    for(let i=1;i<points.length;i++)total+=miles(points[i-1],points[i]);
    const planned=st.stops.reduce((n,s)=>n+nights(s.arrive,s.depart),0);
    const parts=[t("{count} {stops}", {count:st.stops.length,stops:t(st.stops.length===1?'stop':'stops')})];
    if(points.length>1)parts.push(t("about {distance} mi straight-line", {distance:Math.round(total).toLocaleString(window.KampTrailI18n?.locale())}));
    const drive=currentDrive();
    if(drive)parts.push(t('{time} driving, {distance} mi by road',{time:fmtTime(drive.s),distance:Math.round(drive.m).toLocaleString(window.KampTrailI18n?.locale() || 'en-US')}));
    if(planned)parts.push(t("{count} {nights} planned", {count:planned,nights:t(planned===1?'night':'nights')}));
    return parts.join(' · ');
  }
  function stopEditor(stop) {
    const wrap=document.createElement('details');wrap.className='kt-stop-details';
    if(stop.note||stop.arrive||stop.depart)wrap.open=false;
    const sum=document.createElement('summary');sum.textContent=stop.note||stop.arrive||stop.depart?t("Notes and dates"):t("Add notes and dates");
    const dates=document.createElement('div');dates.className='kt-stop-dates';
    const field=(label,key)=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type='date';i.value=stop[key]||'';i.onchange=()=>{stop[key]=isDate(i.value)?i.value:'';save();renderSummary();};l.append(i);return l;};
    dates.append(field(t("Arrive"),'arrive'),field(t("Leave"),'depart'));
    const noteLabel=document.createElement('label');noteLabel.textContent=t("Notes (cell signal, road, site number)");
    const note=document.createElement('textarea');note.rows=3;note.maxLength=1000;note.value=stop.note||'';
    note.onchange=()=>{stop.note=cleanText(note.value,1000);save();};
    noteLabel.append(note);
    wrap.append(sum,dates,noteLabel);
    return wrap;
  }
  function renderSummary() {
    const el=st.el?.querySelector('#kt-trip-summary');if(!el)return;
    el.textContent=st.stops.length?summary(st.stops.map(getSite)):'';
  }
  function renderLegs() {
    const box=st.el.querySelector('#kt-trip-legs');box.replaceChildren();box.hidden=true;
  }
  function showLegs() {
    const box=st.el.querySelector('#kt-trip-legs');box.replaceChildren();
    const points=st.stops.map(getSite).filter(Boolean).map(latLng);
    const legs=routeLegs(points);
    if(!legs.length){box.hidden=true;return;}
    const p=document.createElement('p');p.textContent=legs.length>1?t("Google Maps accepts a limited number of stops per route, so this trip opens as {0} legs. Each leg starts where the last one ended.", {"0":(legs.length)}):t("Opens the trip in Google Maps. Check the route suits your rig.");
    box.append(p);
    legs.forEach((leg,i)=>{const a=document.createElement('a');a.className='btn';a.href=leg.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=legs.length>1?t("Leg {0}: stops {1} to {2}", {"0":(i+1),"1":(leg.from),"2":(leg.to)}):t("Open route in Google Maps");box.append(a);});
    box.hidden=false;
  }
  function render() {
    if(!st.el)return;
    // Canonical aliases can resolve to the same source record after a migration.
    const seen=new Set();st.stops=st.stops.filter(stop=>{getSite(stop);if(seen.has(stop.id))return false;seen.add(stop.id);return true;});
    const badge=document.getElementById('trip-count');if(badge)badge.textContent=`(${st.stops.length})`;
    st.el.querySelector('.kt-saved-note').textContent=st.storageAvailable?t("Saved on this device. Confirm current access before traveling."):t("Browser storage is unavailable. Changes are available only while this page stays open.");
    const list=st.el.querySelector('#kt-trip-list');list.replaceChildren();
    st.el.querySelector('#kt-trip-clear').hidden=!st.stops.length;
    st.el.querySelector('#kt-trip-tools').hidden=!st.stops.length;
    const road=currentDrive();
    st.el.querySelector('#kt-trip-route').checked=st.showRoute&&!!road;st.el.querySelector('#kt-trip-route').disabled=!road;
    st.el.querySelector('#kt-trip-discover').disabled=!road;st.el.querySelector('#kt-trip-terrain').disabled=!road;st.el.querySelector('#kt-trip-clearance').disabled=!road;st.el.querySelector('#kt-trip-view-route').disabled=!road;
    st.el.querySelector('#kt-trip-route-status').textContent=road?t("{0} road route from {1}.{2}", {"0":(road.raw.from_cache?t("Saved"):t("Calculated")),"1":(road.raw.calculated_at.slice(0,10)),"2":(road.raw.offline?t(" Offline: conditions may have changed."):road.raw.source_unavailable?t(" Routing service unavailable; showing the saved route."):'')}):t("Calculate a road route to draw roads and search along the trip.");
    renderSummary();renderLegs();
    st.el.querySelector('#kt-trip-drive').hidden=st.stops.length<2;st.el.querySelector('#kt-trip-drive-credit').hidden=!currentDrive();
    if(!st.stops.length) {const empty=document.createElement('p');empty.textContent=t("No saved stops yet. Save a campsite from its listing or map popup, long-press the map to save any spot, or import a GPX file.");list.append(empty);return;}
    st.stops.forEach((stop,index)=>{
      const site=getSite(stop),coords=site?.geometry.coordinates;
      const card=document.createElement('article');card.className='kt-saved-stop';card.setAttribute('role','listitem');
      const title=document.createElement('h3');title.textContent=`${index+1}. ${site?nameOf(site):t("Saved stop {0}", {"0":(stop.id)})}`;
      const detail=document.createElement('p');
      let text=coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : t("This older saved stop has no location details. Find and save the campsite again, or remove this entry.");
      const drive=currentDrive();const legIndex=st.stops.slice(0,index).filter(s=>getSite(s)).length-1;
      if(coords&&index>0&&drive&&drive.legs[legIndex])text+=t(" · {0}, {1} mi from stop {2} by road", {"0":(fmtTime(drive.legs[legIndex].s)),"1":(Math.round(drive.legs[legIndex].m).toLocaleString(window.KampTrailI18n?.locale() || 'en-US')),"2":(index)});
      else if(coords&&index>0){const prev=getSite(st.stops[index-1]);if(prev)text+=t(" · {0} mi from stop {1} (straight-line)", {"0":(Math.round(miles(latLng(prev),latLng(site))).toLocaleString(window.KampTrailI18n?.locale() || 'en-US')),"1":(index)});}
      const n=nights(stop.arrive,stop.depart);if(n)text+=` · ${n} ${t(n===1?'night':'nights')}`;
      detail.textContent=text;
      const actions=document.createElement('div');actions.className='kt-saved-actions';
      if(site) {
        const view=button(t("View on map"),()=>viewStop(stop));view.classList.add('kt-trip-zoom');
        const link=document.createElement('a');link.className='btn';link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent=t("Directions");link.setAttribute('aria-label',t("Directions to {name} in Google Maps", {name:nameOf(site)}));
        actions.append(view,link);
      }
      const label=site?nameOf(site):t("saved stop {0}", {"0":(stop.id)});
      const up=button(t("Up"),()=>move(index,-1));up.classList.add('kt-trip-up');up.disabled=index===0;up.setAttribute('aria-label',t("Move {name} up", {name:label}));
      const down=button(t("Down"),()=>move(index,1));down.classList.add('kt-trip-down');down.disabled=index===st.stops.length-1;down.setAttribute('aria-label',t("Move {name} down", {name:label}));
      const remove=button(t("Remove"),()=>{st.stops=st.stops.filter(item=>item!==stop);save();render();drawRoute();st.el.querySelector('#kt-trip-close').focus();});remove.classList.add('kt-trip-del');remove.setAttribute('aria-label',t("Remove {name}", {name:label}));
      actions.append(up,down,remove);card.append(title,detail,actions);if(stayDue(stop,site))card.append(stayPrompt(stop,site,label));card.append(stopEditor(stop));list.append(card);
    });
  }
  // ---- GPX ----
  const xml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function toGPX() {
    const wpts=st.stops.map(stop=>{const site=getSite(stop);if(!site)return '';const [lng,lat]=site.geometry.coordinates;
      const desc=[stop.arrive&&t("Arrive {0}", {"0":(stop.arrive)}),stop.depart&&t("Leave {0}", {"0":(stop.depart)}),stop.note].filter(Boolean).join('\n');
      return `  <wpt lat="${lat}" lon="${lng}"><name>${xml(nameOf(site))}</name>${desc?`<desc>${xml(desc)}</desc>`:''}</wpt>`;}).filter(Boolean);
    const rtepts=st.stops.map(getSite).filter(Boolean).map(site=>{const [lng,lat]=site.geometry.coordinates;return `    <rtept lat="${lat}" lon="${lng}"><name>${xml(nameOf(site))}</name></rtept>`;});
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>KampTrail trip</name><time>${new Date().toISOString()}</time></metadata>\n${wpts.join('\n')}\n  <rte><name>KampTrail trip</name>\n${rtepts.join('\n')}\n  </rte>\n</gpx>\n`;
  }
  function exportGPX() {
    if(!st.stops.some(getSite)){notify(t("There are no saved locations to export."));return;}
    const missing=st.stops.filter(s=>!getSite(s)).length;
    const blob=new Blob([toGPX()],{type:'application/gpx+xml'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`kamptrail-trip-${new Date().toISOString().slice(0,10)}.gpx`;
    document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
    info(missing?t("GPX saved. {0} older stop{1} no location and {2} left out.", {"0":(missing),"1":(missing===1?' has':'s have'),"2":(missing===1?'was':'were')}):t('GPX file saved.'));
  }
  function parseGPX(text) {
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw new Error(t("This file is not valid GPX."));
    const byName=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
    const child=(node,name)=>byName(node,name).find(n=>n.parentNode===node)?.textContent?.trim()||'';
    const coord=n=>{const lat=parseFloat(n.getAttribute('lat')),lon=parseFloat(n.getAttribute('lon'));return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;};
    const points=[...byName(doc,'wpt'),...byName(doc,'rtept')].map(n=>({ll:coord(n),name:child(n,'name'),desc:child(n,'desc')})).filter(p=>p.ll);
    const tracks=byName(doc,'trkseg').map(seg=>byName(seg,'trkpt').map(coord).filter(Boolean)).filter(seg=>seg.length>1);
    return {points,tracks};
  }
  function importGPX(file) {
    if(!file)return;
    if(file.size>5*1024*1024){notify(t("That GPX file is larger than 5 MB."));return;}
    file.text().then(text=>{
      const {points,tracks}=parseGPX(text);
      let added=0;
      for(const p of points.slice(0,200)){
        const id=`gpx:${p.ll[0].toFixed(5)},${p.ll[1].toFixed(5)}`;
        if(st.stops.some(s=>s.id===id))continue;
        st.stops.push({id,feature:{type:'Feature',geometry:{type:'Point',coordinates:[p.ll[1],p.ll[0]]},properties:{id,name:(p.name||t("Imported {0}, {1}", {"0":(p.ll[0].toFixed(4)),"1":(p.ll[1].toFixed(4))})).slice(0,120),type:'imported',fee_status:'unknown',amenities:[],rig_friendly:[]}},note:cleanText(p.desc,1000),arrive:'',depart:''});
        added++;
      }
      if(tracks.length&&window.L?.polyline&&st.map){
        st.gpxLayer?.remove();
        st.gpxLayer=L.layerGroup(tracks.map(t=>L.polyline(t,{color:'#2375b9',weight:3,opacity:.8}))).addTo(st.map);
        const b=L.latLngBounds(tracks.flat());if(b.isValid())st.map.fitBounds?.(b,{padding:[30,30]});
      }
      save();render();drawRoute();
      const parts=[];if(added)parts.push(`${added} stop${added===1?'':'s'} added`);if(tracks.length)parts.push(t("{0} track{1} shown until you reload", {"0":(tracks.length),"1":(tracks.length===1?'':'s')}));
      info(parts.length?t("GPX imported: {0}.", {"0":(parts.join(', '))}):t("No new points or tracks found in that GPX file."));
    }).catch(err=>notify(err.message||t("That GPX file could not be read.")));
  }
  function drawer() {
    const d=document.createElement('div');d.id='kt-trip-drawer';d.hidden=true;
    d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-labelledby','kt-saved-title');d.setAttribute('aria-hidden','true');
    d.innerHTML=`<div class="kt-saved-header"><h2 id="kt-saved-title">${t("Saved stops")}</h2><button type="button" class="btn" id="kt-trip-close" aria-label="${t("Close saved stops")}">${t("Close")}</button></div>
      <p class="kt-saved-note">${t("Saved on this device. Confirm current access before traveling.")}</p>
      <p id="kt-trip-summary" role="status" aria-live="polite"></p>
      <div id="kt-trip-tools">
        <div class="kt-trip-row"><button type="button" class="btn" id="kt-trip-directions">${t("Directions for the whole trip")}</button><button type="button" class="btn" id="kt-trip-drive">${t("Calculate road route")}</button></div>
        <p class="kt-route-credit" id="kt-trip-drive-credit" hidden>Routes and drive times: car routing by <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">OSRM (FOSSGIS)</a>, map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">fix the map</a>. Not checked for RV height, weight, or length.</p>
        <label class="kt-route-toggle"><input type="checkbox" id="kt-trip-route"> ${t("Show road route on map")}</label>
        <p id="kt-trip-route-status" class="kt-route-credit" role="status"></p>
        <div class="kt-trip-row"><button type="button" class="btn" id="kt-trip-view-route" disabled>${t("View road route")}</button><button type="button" class="btn" id="kt-trip-discover" disabled>${t("Find campsites along route")}</button><button type="button" class="btn" id="kt-trip-terrain" disabled>${t("Terrain elevation")}</button><button type="button" class="btn" id="kt-trip-clearance" disabled>${t("Nearby mapped heights (RI pilot)")}</button></div>
        <p class="kt-route-credit">${t("Calculating sends stop coordinates to FOSSGIS, which records requests in its server logs. Successful routes are saved on this device when browser storage is available.")}</p>
        <div id="kt-trip-legs" hidden></div>
      </div>
      <div id="kt-trip-list" role="list"></div>
      <div class="kt-saved-footer">
        <button type="button" class="btn" id="kt-trip-export">${t("Export GPX")}</button>
        <button type="button" class="btn" id="kt-trip-import">${t("Import GPX")}</button>
        <input type="file" id="kt-trip-file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden>
        <button type="button" class="btn" id="kt-trip-clear">${t("Clear saved stops")}</button>
      </div>`;
    const style=document.createElement('style');style.textContent=`
      #kt-trip-drawer {position:fixed;top:12px;right:0;width:390px;max-width:calc(100vw - 12px);height:calc(100dvh - 24px);display:flex;flex-direction:column;background:#10281f;color:#e3f0e5;border:1px solid #55705b;border-radius:12px 0 0 12px;box-shadow:-4px 0 20px #0006;z-index:1600;overflow:hidden}
      #kt-trip-drawer[hidden],#kt-trip-drawer [hidden] {display:none!important}
      #kt-trip-drawer .kt-saved-header {padding:12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #45624b}
      #kt-trip-drawer h2 {font-size:18px;margin:0;flex:1}
      #kt-trip-drawer .kt-saved-note,#kt-trip-summary {font-size:12px;line-height:1.5;margin:10px 14px 0;color:#bed3c4}
      #kt-trip-summary {font-weight:600;color:#e3f0e5}
      #kt-trip-tools {padding:8px 14px 0;display:grid;gap:8px}
      #kt-trip-tools .kt-route-toggle {font-size:12px;display:flex;gap:6px;align-items:center}
      #kt-trip-tools .kt-trip-row {display:flex;gap:7px;flex-wrap:wrap}
      #kt-trip-drawer .kt-route-credit {font-size:11px;line-height:1.45;color:#bed3c4;margin:0}#kt-trip-drawer .kt-route-credit a{color:#e3f0e5}
      #kt-trip-legs {display:grid;gap:6px;font-size:12px}#kt-trip-legs p{margin:0;color:#bed3c4;line-height:1.5}
      #kt-trip-list {padding:12px;display:grid;align-content:start;gap:10px;overflow:auto;flex:1;min-height:0}
      #kt-trip-drawer .kt-saved-stop {padding:12px;border:1px solid #45624b;border-radius:8px;background:#0d2018}
      #kt-trip-drawer h3 {font-size:14px;line-height:1.4;margin:0 0 6px;overflow-wrap:anywhere}
      #kt-trip-drawer .kt-saved-stop p {font-size:12px;line-height:1.5;color:#bed3c4;margin:0 0 10px}
      #kt-trip-drawer .kt-saved-actions {display:flex;gap:7px;flex-wrap:wrap}
      #kt-trip-drawer .kt-stay-prompt {display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:10px;padding:10px;border:1px dashed #6f9a78;border-radius:8px}
      #kt-trip-drawer .kt-stay-prompt p {flex-basis:100%;margin:0}
      #kt-trip-drawer .btn {display:inline-block;text-decoration:none;border:1px solid #73947b;background:#203d2e;color:#f5fff7;padding:7px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;min-height:34px}
      #kt-trip-drawer .btn:disabled {opacity:.45;cursor:default}
      #kt-trip-drawer .btn:focus-visible,#kt-trip-drawer input:focus-visible,#kt-trip-drawer textarea:focus-visible,#kt-trip-drawer summary:focus-visible {outline:3px solid #e2a535;outline-offset:2px}
      #kt-trip-drawer .kt-stop-details {margin-top:8px;font-size:12px}
      #kt-trip-drawer .kt-stop-details summary {cursor:pointer;color:#cfe3d4;min-height:28px}
      #kt-trip-drawer .kt-stop-dates {display:flex;gap:8px;margin:6px 0}
      #kt-trip-drawer label {display:grid;gap:3px;font-size:12px;color:#cfe3d4}
      #kt-trip-drawer input[type=date],#kt-trip-drawer textarea {font:inherit;font-size:13px;background:#f5fff7;color:#10281f;border:1px solid #73947b;border-radius:5px;padding:5px}
      #kt-trip-drawer textarea {width:100%;resize:vertical}
      #kt-trip-drawer .kt-saved-footer {padding:12px;border-top:1px solid #45624b;display:flex;gap:7px;flex-wrap:wrap}
    `;
    document.head.append(style);document.body.append(d);return d;
  }
  function open() {
    if(!st.el)return;
    st.previousFocus=document.activeElement;st.open=true;render();st.el.hidden=false;st.el.style.right='0';st.el.setAttribute('aria-hidden','false');
    document.getElementById('trip')?.setAttribute('aria-expanded','true');
    const app=document.getElementById('app');if(app)app.inert=true;
    st.el.querySelector('#kt-trip-close').focus();
  }
  function close() {
    if(!st.el||!st.open)return;
    st.open=false;st.el.hidden=true;st.el.setAttribute('aria-hidden','true');
    document.getElementById('trip')?.setAttribute('aria-expanded','false');
    const app=document.getElementById('app');if(app)app.inert=false;
    const target=st.previousFocus?.isConnected?st.previousFocus:document.getElementById('trip');target?.focus();
  }
  function recoverLegacyStops() {
    const status=window.KampTrailData?.getLoadStatus?.();
    // Wait for loader activity; init may run before the map has reached the data loader.
    if(!status || (!status.loading && !status.totalSites && !status.loadedStates?.length))return;
    const codes=[...new Set(st.stops.filter(stop=>!getSite(stop)).map(stop=>stop.id.match(/^([A-Z]{2})[-_]/)?.[1]).filter(code=>code&&!st.recoveryStates.has(code)))];
    codes.forEach(code=>st.recoveryStates.add(code));
    if(codes.length)Promise.resolve(window.KampTrailData?.loadStates?.(codes)).then(()=>{render();save();}).catch(()=>{});
  }
  window.KampTrailTrip={
    version:'2.26.0',
    getRevision(){st.stops.forEach(getSite);return syncRevision();},
    init(map) {
      if(st.el)return;
      st.map=map;load();st.el=drawer();render();drawRoute();
      const trigger=document.getElementById('trip');trigger?.setAttribute('aria-expanded','false');trigger?.setAttribute('aria-controls','kt-trip-drawer');
      if(trigger)trigger.onclick=()=>st.open?close():open();
      st.el.querySelector('#kt-trip-close').onclick=close;
      st.el.querySelector('#kt-trip-clear').onclick=()=>{if(confirm(t("Remove all saved stops from this device?"))){st.stops=[];save();render();drawRoute();st.el.querySelector('#kt-trip-close').focus();}};
      st.el.querySelector('#kt-trip-directions').onclick=showLegs;
      st.el.querySelector('#kt-trip-drive').onclick=fetchDrive;
      st.el.querySelector('#kt-trip-clearance').onclick=()=>{const drive=currentDrive();if(drive?.raw){close();window.KampTrailRouteClearance.open(drive.raw);}};st.el.querySelector('#kt-trip-view-route').onclick=viewRoadRoute;st.el.querySelector('#kt-trip-discover').onclick=discoverRoute;st.el.querySelector('#kt-trip-terrain').onclick=terrainRoute;
      st.el.querySelector('#kt-trip-route').onchange=e=>{st.showRoute=e.target.checked;try{localStorage.setItem('kt_trip_route',st.showRoute?'1':'0');}catch{}drawRoute();};
      st.el.querySelector('#kt-trip-export').onclick=exportGPX;
      const file=st.el.querySelector('#kt-trip-file');
      st.el.querySelector('#kt-trip-import').onclick=()=>file.click();
      file.onchange=()=>{importGPX(file.files[0]);file.value='';};
      document.addEventListener('keydown',event=>{
        if(!st.open)return;
        if(event.key==='Escape'){event.preventDefault();close();return;}
        if(event.key==='Tab') {
          const focusable=[...st.el.querySelectorAll('button:not([disabled]),a[href],input:not([hidden]),textarea,summary')].filter(el=>!el.hidden&&!el.closest('[hidden]')&&el.getClientRects().length>0);
          const first=focusable[0],last=focusable[focusable.length-1];
          if(!st.el.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
          else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
      });
      window.addEventListener('kamptrail:dataupdated',()=>{const before=JSON.stringify(st.stops);render();if(JSON.stringify(st.stops)!==before){save();drawRoute();}recoverLegacyStops();});
    },
    addStop(id,snapshot) {
      const site=window.KampTrailData?.getCampsiteById(id) || snapshot;
      if(!valid(site)){notify(t("That campsite has not loaded yet. Try again after its listing loads."));return;}
      const key=String(site.properties.id);
      if(st.stops.some(stop=>{getSite(stop);return stop.id===key;})){open();return;}
      st.stops.push({id:key,feature:clone(site),note:'',arrive:'',depart:''});save();render();drawRoute();open();
    },
    toggle(){st.open?close():open();},
    getStops(){return st.stops.map(stop=>({id:stop.id,feature:getSite(stop),note:stop.note,arrive:stop.arrive,depart:stop.depart}));},
    // Exposed for tests and the share module.
    routeLegs, toGPX, parseGPX
  };
})();
