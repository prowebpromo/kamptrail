/* Persistent trip stops retain a feature snapshot so reopening in another state works. */
(function () {
  'use strict';
  const st = {map:null,open:false,stops:[],el:null};
  const esc = value => window.escapeHtml(String(value ?? ''));
  const valid = site => site?.geometry?.type === 'Point' && Array.isArray(site.geometry.coordinates) && site.geometry.coordinates.slice(0,2).length === 2 && site.geometry.coordinates.slice(0,2).every(Number.isFinite) && Math.abs(site.geometry.coordinates[0]) <= 180 && Math.abs(site.geometry.coordinates[1]) <= 90;
  function save() {
    try { localStorage.setItem('kt_trip',JSON.stringify(st.stops)); }
    catch { window.showToast?.('Your browser could not save the trip. Export GPX to keep a copy.', 'error'); }
  }
  function load() {
    try {
      const data=JSON.parse(localStorage.getItem('kt_trip') || '[]');
      st.stops=Array.isArray(data) ? data.filter(item=>typeof item==='string' || typeof item==='number' || (item && item.id != null)).map(item=>typeof item==='object' ? {id:String(item.id),feature:valid(item.feature)?item.feature:null} : {id:String(item),feature:null}) : [];
    } catch { st.stops=[]; }
  }
  function getSite(stop) {
    const site=window.KampTrailData?.getCampsiteById(stop.id);
    if (valid(site)) {
      stop.feature=JSON.parse(JSON.stringify(site));
      stop.id=String(site.properties.id);
    }
    return valid(stop.feature) ? stop.feature : null;
  }
  function render() {
    if (!st.el) return;
    document.getElementById('trip-count').textContent=`(${st.stops.length})`;
    const list=st.el.querySelector('#kt-trip-list');
    if (!st.stops.length) { list.innerHTML='<p>No stops yet. Add a campsite from its map popup.</p>'; return; }
    list.innerHTML=st.stops.map((stop,i)=>{
      const site=getSite(stop), coords=site?.geometry.coordinates;
      return `<div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;border:1px solid #284356;border-radius:8px;padding:8px;background:#0b141b">
        <strong>${i+1}</strong><div style="min-width:0"><strong>${esc(site?.properties.name || `Saved stop ${stop.id}`)}</strong><br>
        <small>${coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : 'Location data has not loaded. Open its region to recover this older saved stop.'}</small></div>
        <div style="display:flex;gap:6px"><button class="btn kt-trip-zoom" data-i="${i}" ${site?'':'disabled'} title="View stop on map">📍</button>
        <button class="btn kt-trip-del" data-i="${i}" title="Remove stop">✕</button></div></div>`;
    }).join('');
    list.querySelectorAll('.kt-trip-zoom').forEach(button=>button.onclick=()=>{
      const site=getSite(st.stops[Number(button.dataset.i)]);
      if (site) { const [lng,lat]=site.geometry.coordinates; st.map.setView([lat,lng],12); close(); }
    });
    list.querySelectorAll('.kt-trip-del').forEach(button=>button.onclick=()=>{st.stops.splice(Number(button.dataset.i),1);save();render();});
  }
  function drawer() {
    const d=document.createElement('div');d.id='kt-trip-drawer';
    d.setAttribute('role','dialog');d.setAttribute('aria-label','My trip');d.setAttribute('aria-hidden','true');
    d.style.cssText='position:fixed;top:60px;right:-380px;width:360px;max-width:calc(100vw - 16px);height:calc(100dvh - 80px);display:flex;flex-direction:column;background:rgba(15,27,36,.98);border:1px solid #284356;border-radius:12px 0 0 12px;box-shadow:-4px 0 20px rgba(0,0,0,.4);z-index:1002;transition:right .25s ease';
    d.innerHTML=`<div style="padding:12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px"><strong style="flex:1">My Trip</strong><button class="btn" id="kt-trip-close" aria-label="Close trip">✕</button></div>
      <div id="kt-trip-list" style="padding:12px;display:grid;align-content:start;gap:8px;overflow:auto;flex:1;min-height:0"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:flex;gap:8px"><button class="btn" id="kt-trip-export" style="flex:1">Export GPX</button><button class="btn" id="kt-trip-clear" style="flex:1">Clear</button></div>`;
    document.body.appendChild(d);return d;
  }
  function open() {st.open=true;render();st.el.style.right='0';st.el.setAttribute('aria-hidden','false');}
  function close() {st.open=false;st.el.style.right='-380px';st.el.setAttribute('aria-hidden','true');}
  function exportGPX() {
    const sites=st.stops.map(getSite);
    if (!sites.length || sites.some(site=>!site)) {window.showToast?.('Load the missing saved stops before exporting. No stops were omitted.', 'error');return;}
    const xml=str=>String(str).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    const points=sites.map((site,i)=>{const[lng,lat]=site.geometry.coordinates;return `  <wpt lat="${lat}" lon="${lng}"><name>${xml(`${i+1}: ${site.properties.name || 'Campsite'}`)}</name></wpt>`;}).join('\n');
    const gpx=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">\n${points}\n</gpx>`;
    const url=URL.createObjectURL(new Blob([gpx],{type:'application/gpx+xml'}));
    const a=document.createElement('a');a.href=url;a.download=`KampTrail_Trip_${new Date().toISOString().slice(0,10)}.gpx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.KampTrailTrip={
    init(map) {
      if (st.el) return;
      st.map=map;load();st.el=drawer();render();
      document.getElementById('trip').onclick=()=>st.open?close():open();
      st.el.querySelector('#kt-trip-close').onclick=close;
      st.el.querySelector('#kt-trip-export').onclick=exportGPX;
      st.el.querySelector('#kt-trip-clear').onclick=()=>{if(confirm('Clear trip?')){st.stops=[];save();render();}};
      document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
      window.addEventListener('kamptrail:dataupdated',()=>{render();save();});
      const codes=[...new Set(st.stops.map(stop=>stop.feature?.properties.state || stop.id.match(/^([A-Z]{2})[-_]/)?.[1]).filter(Boolean))];
      if(codes.length) Promise.resolve(window.KampTrailData?.loadStates?.(codes)).then(()=>{render();save();});
    },
    addStop(id, snapshot) {
      const site=window.KampTrailData?.getCampsiteById(id) || snapshot;
      if(!valid(site)) {window.showToast?.('That campsite has not loaded yet.', 'error');return;}
      const key=String(site.properties.id);
      if(st.stops.some(stop=>{getSite(stop);return stop.id===key;})) {open();return;}
      st.stops.push({id:key,feature:JSON.parse(JSON.stringify(site))});save();render();open();
    },
    toggle(){st.open?close():open();},
    exportGPX,
    getStops(){return st.stops.map(stop=>({id:stop.id,feature:getSite(stop)}));}
  };
})();
