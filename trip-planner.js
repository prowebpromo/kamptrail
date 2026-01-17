/* trip-planner.js – minimal trip drawer + GPX export */
(function(){
  'use strict';
  const st = { map:null, open:false, stops:[], el:null };

  function save(){ localStorage.setItem('kt_trip', JSON.stringify(st.stops)); }
  function load(){ try{ st.stops = JSON.parse(localStorage.getItem('kt_trip')||'[]'); }catch{ st.stops=[]; } }
  function getSite(id){ return (window.KampTrailData && window.KampTrailData.getCampsiteById(id)) || null; }

  function render(){
    // Update header badge
    const badge = document.getElementById('trip-count');
    if(badge) badge.textContent = `(${st.stops.length})`;

    const list = st.el.querySelector('#kt-trip-list');
    if(!st.stops.length){
      list.innerHTML='<div style="opacity:.7;text-align:center;padding:20px">No stops yet</div>';
      return;
    }
    const esc = window.escapeHtml || ((t) => t);
    list.innerHTML = st.stops.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const safeName = esc(s.properties.name||'Campsite');
      return `<div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;border:1px solid #284356;border-radius:8px;padding:8px;background:#0b141b;">
        <div style="background:#86b7ff;color:#001;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:700">${i+1}</div>
        <div style="min-width:0">
          <div style="font-weight:600;color:#cfe3f2">${safeName}</div>
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
    d.style.background='rgba(15,27,36,.98)'; d.style.border='1px solid #284356';
    d.style.borderRadius='12px 0 0 12px';
    d.style.boxShadow='-4px 0 20px rgba(0,0,0,.4)'; d.style.zIndex=1002;
    d.style.transition='right .25s ease';
    d.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:#cfe3f2;flex:1">My Trip</div>
        <button id="kt-trip-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="kt-trip-list" style="padding:12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 160px)"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:grid;gap:8px">
        <div style="display:flex;gap:8px">
          <button id="kt-trip-export-gpx" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer;font-size:11px">GPX</button>
          <button id="kt-trip-export-csv" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer;font-size:11px">CSV</button>
          <button id="kt-trip-export-kml" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer;font-size:11px">KML</button>
        </div>
        <button id="kt-trip-clear" style="padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear All</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  function open(){ st.open=true; st.el.style.right='0'; }
  function close(){ st.open=false; st.el.style.right='-360px'; }

  function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
  }

  function escapeCsv(str) {
    if (!str) return '';
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function exportGPX(){
    const wpts = st.stops.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const name=escapeXml(s.properties.name||`Stop ${i+1}`);
      return `  <wpt lat="${lat}" lon="${lng}"><name>${i+1}: ${name}</name></wpt>`;
    }).join('\n');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;
    const blob=new Blob([gpx],{type:'application/gpx+xml'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`KampTrail_Trip_${Date.now()}.gpx`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV(){
    const rows = [['Stop','Name','Latitude','Longitude','Cost','Type','State','Rating']];
    st.stops.forEach((id,i)=>{
      const s=getSite(id); if(!s) return;
      const [lng,lat]=s.geometry.coordinates;
      const p=s.properties;
      rows.push([
        i+1,
        escapeCsv(p.name||''),
        lat,
        lng,
        p.cost === null ? '' : p.cost,
        escapeCsv(p.type||''),
        escapeCsv(p.state||''),
        p.rating || ''
      ]);
    });
    const csv = rows.map(row => row.join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`KampTrail_Trip_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function exportKML(){
    const placemarks = st.stops.map((id,i)=>{
      const s=getSite(id); if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const name=escapeXml(s.properties.name||`Stop ${i+1}`);
      const desc=escapeXml(`Cost: ${s.properties.cost === null ? 'FREE' : '$'+s.properties.cost}, Type: ${s.properties.type||'N/A'}`);
      return `  <Placemark>
    <name>${i+1}: ${name}</name>
    <description>${desc}</description>
    <Point><coordinates>${lng},${lat},0</coordinates></Point>
  </Placemark>`;
    }).join('\n');
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>KampTrail Trip</name>
${placemarks}
</Document>
</kml>`;
    const blob=new Blob([kml],{type:'application/vnd.google-earth.kml+xml'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download=`KampTrail_Trip_${Date.now()}.kml`; a.click();
    URL.revokeObjectURL(url);
  }

  window.KampTrailTrip = {
    init(map){
      st.map = map; load();
      st.el = drawer(); render();
      document.getElementById('trip').onclick = ()=> (st.open?close():open());
      st.el.querySelector('#kt-trip-close').onclick = close;
      st.el.querySelector('#kt-trip-clear').onclick = ()=>{
        if(confirm('Clear trip?')){ st.stops=[]; save(); render(); }
      };
      st.el.querySelector('#kt-trip-export-gpx').onclick = exportGPX;
      st.el.querySelector('#kt-trip-export-csv').onclick = exportCSV;
      st.el.querySelector('#kt-trip-export-kml').onclick = exportKML;
      console.log('✓ Trip planner ready');
    },
    addStop(id){
      if(!st.stops.includes(id)){ st.stops.push(id); save(); render(); open(); }
    },
    toggle(){ st.open?close():open(); }
  };
})();
