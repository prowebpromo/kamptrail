/* Saved stops and trip planning. A feature snapshot keeps saved locations usable between regions.
   Trip tools: order, notes and dates, straight-line totals, route line, whole-trip directions, GPX. */
(function () {
  'use strict';
  const st = {drive:null,driveKey:'',driveBusy:false,map:null,open:false,stops:[],el:null,previousFocus:null,savedMarker:null,recoveryStates:new Set(),storageAvailable:true,routeLayer:null,gpxLayer:null,showRoute:false};
  const valid = site => site?.geometry?.type === 'Point' && Array.isArray(site.geometry.coordinates)
    && site.geometry.coordinates.length >= 2 && site.geometry.coordinates.slice(0,2).every(Number.isFinite)
    && Math.abs(site.geometry.coordinates[0]) <= 180 && Math.abs(site.geometry.coordinates[1]) <= 90
    && site.properties && site.properties.id != null && String(site.properties.id).trim() !== '';
  const clone = value => JSON.parse(JSON.stringify(value));
  const nameOf = site => String(site.properties.name || 'Saved campsite');
  const notify = message => window.showToast?.(message, 'error');
  const info = message => window.showToast?.(message, 'info');
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const cleanText = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  function save() {
    try { localStorage.setItem('kt_trip',JSON.stringify(st.stops));st.storageAvailable=true;return true; }
    catch { st.storageAvailable=false;notify('Your browser could not save these stops. Changes are available only while this page stays open.');return false; }
  }
  function load() {
    try {
      const data=JSON.parse(localStorage.getItem('kt_trip') || '[]');
      st.stops=Array.isArray(data) ? data.filter(item=>typeof item==='string' || typeof item==='number' || (item && item.id != null)).map(item=>typeof item==='object'
        ? {id:String(item.id),feature:valid(item.feature)?clone(item.feature):null,note:cleanText(item.note,1000),arrive:isDate(item.arrive)?item.arrive:'',depart:isDate(item.depart)?item.depart:''}
        : {id:String(item),feature:null,note:'',arrive:'',depart:''}).filter(stop=>stop.id.trim()) : [];
    } catch { st.stops=[];st.storageAvailable=false;notify('Saved stops could not be read in this browser. You can save new stops during this visit.'); }
    try { st.showRoute = localStorage.getItem('kt_trip_route') === '1'; } catch {}
  }
  function getSite(stop) {
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
  function button(text,action) {
    const el=document.createElement('button');el.type='button';el.className='btn';el.textContent=text;el.onclick=action;return el;
  }
  function viewStop(stop) {
    const site=getSite(stop);if(!site)return;
    close();
    st.savedMarker?.remove();st.savedMarker=null;
    if(window.KampTrailData?.focusCampsite?.(stop.id))return;
    const [lng,lat]=site.geometry.coordinates;
    st.map.setView([lat,lng],12);
    // A snapshot location remains viewable even if its source region is not loaded.
    if(window.L?.marker) {
      const popup=document.createElement('div');
      const title=document.createElement('strong');title.textContent=nameOf(site);
      const note=document.createElement('p');note.textContent=stop.note ? stop.note : 'Saved location. Confirm current campsite access with the operator.';
      const link=document.createElement('a');link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Directions in Google Maps';
      popup.append(title,note,link);
      st.savedMarker=L.marker([lat,lng],{title:nameOf(site)}).addTo(st.map).bindPopup(popup).openPopup();
    }
  }
  function drawRoute() {
    if (!st.map || !window.L?.polyline) return;
    st.routeLayer?.remove(); st.routeLayer=null;
    if (!st.showRoute) return;
    const points=st.stops.map(getSite).filter(Boolean).map(latLng);
    if (points.length < 2) return;
    st.routeLayer=L.polyline(points,{color:'#c25b12',weight:3,dashArray:'6 8',opacity:.85,interactive:false}).addTo(st.map);
  }
  function move(index, delta) {
    const target=index+delta;if(target<0||target>=st.stops.length)return;
    const [item]=st.stops.splice(index,1);st.stops.splice(target,0,item);save();render();drawRoute();
    st.el.querySelectorAll('.kt-saved-stop')[target]?.querySelector(delta<0?'.kt-trip-up':'.kt-trip-down')?.focus();
  }
  // ---- Drive times: one on-demand request to the FOSSGIS OSRM server (light use, attribution required) ----
  const ROUTER='https://routing.openstreetmap.de/routed-car/route/v1/driving/';
  const MAX_ROUTE_STOPS=25;
  const pointsKey=points=>points.map(pt).join(';');
  const fmtTime=s=>{const m=Math.round(s/60),h=Math.floor(m/60);return h?`${h} hr ${m%60} min`:`${m} min`;};
  async function fetchDrive() {
    const points=st.stops.map(getSite).filter(Boolean).map(latLng);
    if(points.length<2){notify('Save at least two stops to get drive times.');return;}
    if(points.length>MAX_ROUTE_STOPS){notify(`Drive times cover up to ${MAX_ROUTE_STOPS} stops at a time. Remove or split stops and try again.`);return;}
    if(st.driveBusy)return;st.driveBusy=true;
    const btn=st.el.querySelector('#kt-trip-drive');btn.disabled=true;btn.textContent='Getting drive times…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try {
      const coords=points.map(([lat,lng])=>`${+lng.toFixed(5)},${+lat.toFixed(5)}`).join(';');
      const r=await fetch(`${ROUTER}${coords}?overview=false&steps=false`,{signal:controller.signal});
      const data=await r.json();
      if(!r.ok||data.code!=='Ok'||!data.routes?.[0]?.legs)throw new Error(data.message||'No route');
      const route=data.routes[0];
      st.drive={legs:route.legs.map(l=>({s:l.duration,m:l.distance/1609.344})),s:route.duration,m:route.distance/1609.344};
      st.driveKey=pointsKey(points);render();
    } catch(err) {
      notify('Drive times are unavailable right now. Use Directions for the whole trip to see times in Google Maps.');
    } finally {clearTimeout(timer);st.driveBusy=false;btn.disabled=false;btn.textContent='Drive times';}
  }
  function currentDrive() {
    const points=st.stops.map(getSite).filter(Boolean).map(latLng);
    return st.drive&&st.driveKey===pointsKey(points)?st.drive:null;
  }
  function summary(sites) {
    const points=sites.filter(Boolean).map(latLng);let total=0;
    for(let i=1;i<points.length;i++)total+=miles(points[i-1],points[i]);
    const planned=st.stops.reduce((n,s)=>n+nights(s.arrive,s.depart),0);
    const parts=[`${st.stops.length} ${st.stops.length===1?'stop':'stops'}`];
    if(points.length>1)parts.push(`about ${Math.round(total).toLocaleString('en-US')} mi straight-line`);
    const drive=currentDrive();
    if(drive)parts.push(`${fmtTime(drive.s)} driving, ${Math.round(drive.m).toLocaleString('en-US')} mi by road`);
    if(planned)parts.push(`${planned} ${planned===1?'night':'nights'} planned`);
    return parts.join(' · ');
  }
  function stopEditor(stop) {
    const wrap=document.createElement('details');wrap.className='kt-stop-details';
    if(stop.note||stop.arrive||stop.depart)wrap.open=false;
    const sum=document.createElement('summary');sum.textContent=stop.note||stop.arrive||stop.depart?'Notes and dates':'Add notes and dates';
    const dates=document.createElement('div');dates.className='kt-stop-dates';
    const field=(label,key)=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type='date';i.value=stop[key]||'';i.onchange=()=>{stop[key]=isDate(i.value)?i.value:'';save();renderSummary();};l.append(i);return l;};
    dates.append(field('Arrive','arrive'),field('Leave','depart'));
    const noteLabel=document.createElement('label');noteLabel.textContent='Notes (cell signal, road, site number)';
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
    const p=document.createElement('p');p.textContent=legs.length>1?`Google Maps accepts a limited number of stops per route, so this trip opens as ${legs.length} legs. Each leg starts where the last one ended.`:'Opens the trip in Google Maps. Check the route suits your rig.';
    box.append(p);
    legs.forEach((leg,i)=>{const a=document.createElement('a');a.className='btn';a.href=leg.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=legs.length>1?`Leg ${i+1}: stops ${leg.from} to ${leg.to}`:'Open route in Google Maps';box.append(a);});
    box.hidden=false;
  }
  function render() {
    if(!st.el)return;
    // Canonical aliases can resolve to the same source record after a migration.
    const seen=new Set();st.stops=st.stops.filter(stop=>{getSite(stop);if(seen.has(stop.id))return false;seen.add(stop.id);return true;});
    const badge=document.getElementById('trip-count');if(badge)badge.textContent=`(${st.stops.length})`;
    st.el.querySelector('.kt-saved-note').textContent=st.storageAvailable?'Saved on this device. Confirm current access before traveling.':'Browser storage is unavailable. Changes are available only while this page stays open.';
    const list=st.el.querySelector('#kt-trip-list');list.replaceChildren();
    st.el.querySelector('#kt-trip-clear').hidden=!st.stops.length;
    st.el.querySelector('#kt-trip-tools').hidden=!st.stops.length;
    st.el.querySelector('#kt-trip-route').checked=st.showRoute;
    renderSummary();renderLegs();
    st.el.querySelector('#kt-trip-drive').hidden=st.stops.length<2;st.el.querySelector('#kt-trip-drive-credit').hidden=!currentDrive();
    if(!st.stops.length) {const empty=document.createElement('p');empty.textContent='No saved stops yet. Save a campsite from its listing or map popup, long-press the map to save any spot, or import a GPX file.';list.append(empty);return;}
    st.stops.forEach((stop,index)=>{
      const site=getSite(stop),coords=site?.geometry.coordinates;
      const card=document.createElement('article');card.className='kt-saved-stop';card.setAttribute('role','listitem');
      const title=document.createElement('h3');title.textContent=`${index+1}. ${site?nameOf(site):`Saved stop ${stop.id}`}`;
      const detail=document.createElement('p');
      let text=coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : 'This older saved stop has no location details. Find and save the campsite again, or remove this entry.';
      const drive=currentDrive();const legIndex=st.stops.slice(0,index).filter(s=>getSite(s)).length-1;
      if(coords&&index>0&&drive&&drive.legs[legIndex])text+=` · ${fmtTime(drive.legs[legIndex].s)}, ${Math.round(drive.legs[legIndex].m).toLocaleString('en-US')} mi from stop ${index} by road`;
      else if(coords&&index>0){const prev=getSite(st.stops[index-1]);if(prev)text+=` · ${Math.round(miles(latLng(prev),latLng(site))).toLocaleString('en-US')} mi from stop ${index} (straight-line)`;}
      const n=nights(stop.arrive,stop.depart);if(n)text+=` · ${n} ${n===1?'night':'nights'}`;
      detail.textContent=text;
      const actions=document.createElement('div');actions.className='kt-saved-actions';
      if(site) {
        const view=button('View on map',()=>viewStop(stop));view.classList.add('kt-trip-zoom');
        const link=document.createElement('a');link.className='btn';link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Directions';link.setAttribute('aria-label',`Directions to ${nameOf(site)} in Google Maps`);
        actions.append(view,link);
      }
      const label=site?nameOf(site):`saved stop ${stop.id}`;
      const up=button('Up',()=>move(index,-1));up.classList.add('kt-trip-up');up.disabled=index===0;up.setAttribute('aria-label',`Move ${label} up`);
      const down=button('Down',()=>move(index,1));down.classList.add('kt-trip-down');down.disabled=index===st.stops.length-1;down.setAttribute('aria-label',`Move ${label} down`);
      const remove=button('Remove',()=>{st.stops=st.stops.filter(item=>item!==stop);save();render();drawRoute();st.el.querySelector('#kt-trip-close').focus();});remove.classList.add('kt-trip-del');remove.setAttribute('aria-label',`Remove ${label}`);
      actions.append(up,down,remove);card.append(title,detail,actions,stopEditor(stop));list.append(card);
    });
  }
  // ---- GPX ----
  const xml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function toGPX() {
    const wpts=st.stops.map(stop=>{const site=getSite(stop);if(!site)return '';const [lng,lat]=site.geometry.coordinates;
      const desc=[stop.arrive&&`Arrive ${stop.arrive}`,stop.depart&&`Leave ${stop.depart}`,stop.note].filter(Boolean).join('\n');
      return `  <wpt lat="${lat}" lon="${lng}"><name>${xml(nameOf(site))}</name>${desc?`<desc>${xml(desc)}</desc>`:''}</wpt>`;}).filter(Boolean);
    const rtepts=st.stops.map(getSite).filter(Boolean).map(site=>{const [lng,lat]=site.geometry.coordinates;return `    <rtept lat="${lat}" lon="${lng}"><name>${xml(nameOf(site))}</name></rtept>`;});
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>KampTrail trip</name><time>${new Date().toISOString()}</time></metadata>\n${wpts.join('\n')}\n  <rte><name>KampTrail trip</name>\n${rtepts.join('\n')}\n  </rte>\n</gpx>\n`;
  }
  function exportGPX() {
    if(!st.stops.some(getSite)){notify('There are no saved locations to export.');return;}
    const missing=st.stops.filter(s=>!getSite(s)).length;
    const blob=new Blob([toGPX()],{type:'application/gpx+xml'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`kamptrail-trip-${new Date().toISOString().slice(0,10)}.gpx`;
    document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
    info(missing?`GPX saved. ${missing} older stop${missing===1?' has':'s have'} no location and ${missing===1?'was':'were'} left out.`:'GPX file saved.');
  }
  function parseGPX(text) {
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw new Error('This file is not valid GPX.');
    const byName=(node,name)=>[...node.getElementsByTagNameNS('*',name)];
    const child=(node,name)=>byName(node,name).find(n=>n.parentNode===node)?.textContent?.trim()||'';
    const coord=n=>{const lat=parseFloat(n.getAttribute('lat')),lon=parseFloat(n.getAttribute('lon'));return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;};
    const points=[...byName(doc,'wpt'),...byName(doc,'rtept')].map(n=>({ll:coord(n),name:child(n,'name'),desc:child(n,'desc')})).filter(p=>p.ll);
    const tracks=byName(doc,'trkseg').map(seg=>byName(seg,'trkpt').map(coord).filter(Boolean)).filter(seg=>seg.length>1);
    return {points,tracks};
  }
  function importGPX(file) {
    if(!file)return;
    if(file.size>5*1024*1024){notify('That GPX file is larger than 5 MB.');return;}
    file.text().then(text=>{
      const {points,tracks}=parseGPX(text);
      let added=0;
      for(const p of points.slice(0,200)){
        const id=`gpx:${p.ll[0].toFixed(5)},${p.ll[1].toFixed(5)}`;
        if(st.stops.some(s=>s.id===id))continue;
        st.stops.push({id,feature:{type:'Feature',geometry:{type:'Point',coordinates:[p.ll[1],p.ll[0]]},properties:{id,name:(p.name||`Imported ${p.ll[0].toFixed(4)}, ${p.ll[1].toFixed(4)}`).slice(0,120),type:'imported',fee_status:'unknown',amenities:[],rig_friendly:[]}},note:cleanText(p.desc,1000),arrive:'',depart:''});
        added++;
      }
      if(tracks.length&&window.L?.polyline&&st.map){
        st.gpxLayer?.remove();
        st.gpxLayer=L.layerGroup(tracks.map(t=>L.polyline(t,{color:'#2375b9',weight:3,opacity:.8}))).addTo(st.map);
        const b=L.latLngBounds(tracks.flat());if(b.isValid())st.map.fitBounds?.(b,{padding:[30,30]});
      }
      save();render();drawRoute();
      const parts=[];if(added)parts.push(`${added} stop${added===1?'':'s'} added`);if(tracks.length)parts.push(`${tracks.length} track${tracks.length===1?'':'s'} shown until you reload`);
      info(parts.length?`GPX imported: ${parts.join(', ')}.`:'No new points or tracks found in that GPX file.');
    }).catch(err=>notify(err.message||'That GPX file could not be read.'));
  }
  function drawer() {
    const d=document.createElement('div');d.id='kt-trip-drawer';d.hidden=true;
    d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-labelledby','kt-saved-title');d.setAttribute('aria-hidden','true');
    d.innerHTML=`<div class="kt-saved-header"><h2 id="kt-saved-title">Saved stops</h2><button type="button" class="btn" id="kt-trip-close" aria-label="Close saved stops">Close</button></div>
      <p class="kt-saved-note">Saved on this device. Confirm current access before traveling.</p>
      <p id="kt-trip-summary" role="status" aria-live="polite"></p>
      <div id="kt-trip-tools">
        <div class="kt-trip-row"><button type="button" class="btn" id="kt-trip-directions">Directions for the whole trip</button><button type="button" class="btn" id="kt-trip-drive">Drive times</button></div>
        <p class="kt-route-credit" id="kt-trip-drive-credit" hidden>Drive times: car routing by <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">OSRM (FOSSGIS)</a>, map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">fix the map</a>. Not checked for RV height, weight, or length.</p>
        <label class="kt-route-toggle"><input type="checkbox" id="kt-trip-route"> Show route line on map (straight-line, not roads)</label>
        <div id="kt-trip-legs" hidden></div>
      </div>
      <div id="kt-trip-list" role="list"></div>
      <div class="kt-saved-footer">
        <button type="button" class="btn" id="kt-trip-export">Export GPX</button>
        <button type="button" class="btn" id="kt-trip-import">Import GPX</button>
        <input type="file" id="kt-trip-file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden>
        <button type="button" class="btn" id="kt-trip-clear">Clear saved stops</button>
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
    version:'2.4.2',
    init(map) {
      if(st.el)return;
      st.map=map;load();st.el=drawer();render();drawRoute();
      const trigger=document.getElementById('trip');trigger?.setAttribute('aria-expanded','false');trigger?.setAttribute('aria-controls','kt-trip-drawer');
      if(trigger)trigger.onclick=()=>st.open?close():open();
      st.el.querySelector('#kt-trip-close').onclick=close;
      st.el.querySelector('#kt-trip-clear').onclick=()=>{if(confirm('Remove all saved stops from this device?')){st.stops=[];save();render();drawRoute();st.el.querySelector('#kt-trip-close').focus();}};
      st.el.querySelector('#kt-trip-directions').onclick=showLegs;
      st.el.querySelector('#kt-trip-drive').onclick=fetchDrive;
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
      if(!valid(site)){notify('That campsite has not loaded yet. Try again after its listing loads.');return;}
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
