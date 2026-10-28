/* MVP saved stops. A feature snapshot keeps saved locations usable between regions. */
(function () {
  'use strict';
  const st = {map:null,open:false,stops:[],el:null,previousFocus:null,savedMarker:null,recoveryStates:new Set(),storageAvailable:true};
  const valid = site => site?.geometry?.type === 'Point' && Array.isArray(site.geometry.coordinates)
    && site.geometry.coordinates.length >= 2 && site.geometry.coordinates.slice(0,2).every(Number.isFinite)
    && Math.abs(site.geometry.coordinates[0]) <= 180 && Math.abs(site.geometry.coordinates[1]) <= 90
    && site.properties && site.properties.id != null && String(site.properties.id).trim() !== '';
  const clone = value => JSON.parse(JSON.stringify(value));
  const nameOf = site => String(site.properties.name || 'Saved campsite');
  const notify = message => window.showToast?.(message, 'error');
  function save() {
    try { localStorage.setItem('kt_trip',JSON.stringify(st.stops));st.storageAvailable=true;return true; }
    catch { st.storageAvailable=false;notify('Your browser could not save these stops. Changes are available only while this page stays open.');return false; }
  }
  function load() {
    try {
      const data=JSON.parse(localStorage.getItem('kt_trip') || '[]');
      st.stops=Array.isArray(data) ? data.filter(item=>typeof item==='string' || typeof item==='number' || (item && item.id != null)).map(item=>typeof item==='object' ? {id:String(item.id),feature:valid(item.feature)?clone(item.feature):null} : {id:String(item),feature:null}).filter(stop=>stop.id.trim()) : [];
    } catch { st.stops=[];st.storageAvailable=false;notify('Saved stops could not be read in this browser. You can save new stops during this visit.'); }
  }
  function getSite(stop) {
    const current=window.KampTrailData?.getCampsiteById(stop.id);
    if(valid(current)) { stop.feature=clone(current);stop.id=String(current.properties.id); }
    return valid(stop.feature) ? stop.feature : null;
  }
  function directions(site) {
    const [lng,lat]=site.geometry.coordinates;
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
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
      const note=document.createElement('p');note.textContent='Saved location. Confirm current campsite access with the operator.';
      const link=document.createElement('a');link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Directions in Google Maps';
      popup.append(title,note,link);
      st.savedMarker=L.marker([lat,lng],{title:nameOf(site)}).addTo(st.map).bindPopup(popup).openPopup();
    }
  }
  function render() {
    if(!st.el)return;
    // Canonical aliases can resolve to the same source record after a migration.
    const seen=new Set();st.stops=st.stops.filter(stop=>{getSite(stop);if(seen.has(stop.id))return false;seen.add(stop.id);return true;});
    const badge=document.getElementById('trip-count');if(badge)badge.textContent=`(${st.stops.length})`;
    st.el.querySelector('.kt-saved-note').textContent=st.storageAvailable?'Saved on this device. Confirm current access before traveling.':'Browser storage is unavailable. Changes are available only while this page stays open.';
    const list=st.el.querySelector('#kt-trip-list');list.replaceChildren();
    st.el.querySelector('#kt-trip-clear').hidden=!st.stops.length;
    if(!st.stops.length) {const empty=document.createElement('p');empty.textContent='No saved stops yet. Save a campsite from its listing or map popup.';list.append(empty);return;}
    st.stops.forEach((stop,index)=>{
      const site=getSite(stop),coords=site?.geometry.coordinates;
      const card=document.createElement('article');card.className='kt-saved-stop';card.setAttribute('role','listitem');
      const title=document.createElement('h3');title.textContent=`${index+1}. ${site?nameOf(site):`Saved stop ${stop.id}`}`;
      const detail=document.createElement('p');detail.textContent=coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : 'This older saved stop has no location details. Find and save the campsite again, or remove this entry.';
      const actions=document.createElement('div');actions.className='kt-saved-actions';
      if(site) {
        const view=button('View on map',()=>viewStop(stop));view.classList.add('kt-trip-zoom');
        const link=document.createElement('a');link.className='btn';link.href=directions(site);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Directions';link.setAttribute('aria-label',`Directions to ${nameOf(site)} in Google Maps`);
        actions.append(view,link);
      }
      const remove=button('Remove',()=>{st.stops=st.stops.filter(item=>item!==stop);save();render();st.el.querySelector('#kt-trip-close').focus();});remove.classList.add('kt-trip-del');remove.setAttribute('aria-label',`Remove ${site?nameOf(site):`saved stop ${stop.id}`}`);
      actions.append(remove);card.append(title,detail,actions);list.append(card);
    });
  }
  function drawer() {
    const d=document.createElement('div');d.id='kt-trip-drawer';d.hidden=true;
    d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-labelledby','kt-saved-title');d.setAttribute('aria-hidden','true');
    d.innerHTML=`<div class="kt-saved-header"><h2 id="kt-saved-title">Saved stops</h2><button type="button" class="btn" id="kt-trip-close" aria-label="Close saved stops">Close</button></div>
      <p class="kt-saved-note">Saved on this device. Confirm current access before traveling.</p>
      <div id="kt-trip-list" role="list"></div>
      <div class="kt-saved-footer"><button type="button" class="btn" id="kt-trip-clear">Clear saved stops</button></div>`;
    const style=document.createElement('style');style.textContent=`
      #kt-trip-drawer {position:fixed;top:12px;right:0;width:390px;max-width:calc(100vw - 12px);height:calc(100dvh - 24px);display:flex;flex-direction:column;background:#10281f;color:#e3f0e5;border:1px solid #55705b;border-radius:12px 0 0 12px;box-shadow:-4px 0 20px #0006;z-index:1600;overflow:hidden}
      #kt-trip-drawer[hidden],#kt-trip-drawer [hidden] {display:none!important}
      #kt-trip-drawer .kt-saved-header {padding:12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #45624b}
      #kt-trip-drawer h2 {font-size:18px;margin:0;flex:1}
      #kt-trip-drawer .kt-saved-note {font-size:12px;line-height:1.5;margin:12px 14px 0;color:#bed3c4}
      #kt-trip-list {padding:12px;display:grid;align-content:start;gap:10px;overflow:auto;flex:1;min-height:0}
      #kt-trip-drawer .kt-saved-stop {padding:12px;border:1px solid #45624b;border-radius:8px;background:#0d2018}
      #kt-trip-drawer h3 {font-size:14px;line-height:1.4;margin:0 0 6px;overflow-wrap:anywhere}
      #kt-trip-drawer .kt-saved-stop p {font-size:12px;line-height:1.5;color:#bed3c4;margin:0 0 10px}
      #kt-trip-drawer .kt-saved-actions {display:flex;gap:7px;flex-wrap:wrap}
      #kt-trip-drawer .btn {display:inline-block;text-decoration:none;border:1px solid #73947b;background:#203d2e;color:#f5fff7;padding:7px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;min-height:34px}
      #kt-trip-drawer .btn:focus-visible {outline:3px solid #e2a535;outline-offset:2px}
      #kt-trip-drawer .kt-saved-footer {padding:12px;border-top:1px solid #45624b}
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
    version:'2.2.1',
    init(map) {
      if(st.el)return;
      st.map=map;load();st.el=drawer();render();
      const trigger=document.getElementById('trip');trigger?.setAttribute('aria-expanded','false');trigger?.setAttribute('aria-controls','kt-trip-drawer');
      if(trigger)trigger.onclick=()=>st.open?close():open();
      st.el.querySelector('#kt-trip-close').onclick=close;
      st.el.querySelector('#kt-trip-clear').onclick=()=>{if(confirm('Remove all saved stops from this device?')){st.stops=[];save();render();st.el.querySelector('#kt-trip-close').focus();}};
      document.addEventListener('keydown',event=>{
        if(!st.open)return;
        if(event.key==='Escape'){event.preventDefault();close();return;}
        if(event.key==='Tab') {
          const focusable=[...st.el.querySelectorAll('button:not([disabled]),a[href]')].filter(el=>!el.hidden&&!el.closest('[hidden]'));
          const first=focusable[0],last=focusable[focusable.length-1];
          if(!st.el.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();}
          else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
      });
      window.addEventListener('kamptrail:dataupdated',()=>{const before=JSON.stringify(st.stops);render();if(JSON.stringify(st.stops)!==before)save();recoverLegacyStops();});
    },
    addStop(id,snapshot) {
      const site=window.KampTrailData?.getCampsiteById(id) || snapshot;
      if(!valid(site)){notify('That campsite has not loaded yet. Try again after its listing loads.');return;}
      const key=String(site.properties.id);
      if(st.stops.some(stop=>{getSite(stop);return stop.id===key;})){open();return;}
      st.stops.push({id:key,feature:clone(site)});save();render();open();
    },
    toggle(){st.open?close():open();},
    getStops(){return st.stops.map(stop=>({id:stop.id,feature:getSite(stop)}));}
  };
})();
