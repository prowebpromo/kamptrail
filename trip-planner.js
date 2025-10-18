/* trip-planner.js – minimal trip drawer + GPX export (localStorage only) */
(function(){
  'use strict';
  const st = { map:null, open:false, stops:[], el:null };

  function save(){ localStorage.setItem('kt_trip', JSON.stringify(st.stops)); }
  function load(){ try{ st.stops = JSON.parse(localStorage.getItem('kt_trip')||'[]'); }catch{ st.stops=[]; } }
  function getSite(id){ return (window.KampTrailData && window.KampTrailData.getCampsiteById(id)) || null; }

  function render(){
    const list = st.el.querySelector('#kt-trip-list');
    if(!st.stops.length){ list.innerHTML='<div style="opacity:.7;text-align:center;padding:20px">No stops yet</div>'; return; }
    list.innerHTML = st.stops.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates, n=s.properties.name||'Campsite';
      return `<div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;border:1px solid #284356;border-radius:8px;padding:8px;background:#0b141b;">
        <div style="background:#86b7ff;color:#001;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:700">${i+1}</div>
        <div style="min-width:0">
          <div style="font-weight:600;color:#cfe3f2">${n}</div>
          <div style="opacity:.7;font-size:12px">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button data-i="${i}" class="kt-trip-zoom" title="Zoom" style="padding:6px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:11px">📍</button>
          <button data-i="${i}" class="kt-trip-del" title="Remove" style="padding:6px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:11px">🗑️</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.kt-trip-zoom').forEach(b=>b.onclick=(e)=>{
      const idx=+e.currentTarget.dataset.i; const s=getSite(st.stops[idx]);
      if(s){ const [lng,lat]=s.geometry.coordinates; st.map.setView([lat,lng], 12); }
    });
    list.querySelectorAll('.kt-trip-del').forEach(b=>b.onclick=(e)=>{
      const idx=+e.currentTarget.dataset.i; st.stops.splice(idx,1); save(); render();
    });
  }

  function drawer(){
    const d=document.createElement('div');
    d.style.position='fixed'; d.style.top='60px'; d.style.right='-360px'; d.style.width='340px';
    d.style.maxWidth='calc(100vw - 24px)'; d.style.height='calc(100vh - 80px)';
    d.style.background='rgba(15,27,36,.98)'; d.style.border='1px solid #284356'; d.style.borderRadius='12px 0 0 12px';
    d.style.boxShadow='-4px 0 20px rgba(0,0,0,.4)'; d.style.zIndex=1002; d.style.transition='right .25s ease';
    d.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:#cfe3f2;flex:1">My Trip</div>
        <button id="kt-trip-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="kt-trip-list" style="padding:12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 120px)"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:flex;gap:8px">
        <button id="kt-trip-export" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer">💾 Export GPX</button>
        <button id="kt-trip-clear" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  function open(){ st.open=true; st.el.style.right='0'; }
  function close(){ st.open=false; st.el.style.right='-360px'; }

  function exportGPX(){
    const wpts = st.stops.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const name=(s.properties.name||`Stop ${i+1}`).replace(/[<&>"]/g,'');
      return `  <wpt lat="${lat}" lon="${lng}"><name>${i+1}: ${name}</name></wpt>`;
    }).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
    const blob=new Blob([gpx],{type:'application/gpx+xml'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`KampTrail_Trip_${Date.now()}.gpx`; a.click(); URL.revokeObjectURL(url);
  }

  window.KampTrailTrip = {
    init(map){
      st.map = map; load();
      st.el = drawer(); render();
      document.getElementById('trip').onclick = ()=> (st.open?close():open());
      st.el.querySelector('#kt-trip-close').onclick = close;
      st.el.querySelector('#kt-trip-clear').onclick = ()=>{ if(confirm('Clear trip?')){ st.stops=[]; save(); render(); } };
      st.el.querySelector('#kt-trip-export').onclick = exportGPX;
      console.log('Trip planner ready');
    },
    addStop(id){ if(!st.stops.includes(id)){ st.stops.push(id); save(); render(); open(); } },
    toggle(){ st.open?close():open(); }
  };
})();
