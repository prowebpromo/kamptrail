/* trip-planner.js – multi-trip management + GPX export */
(function(){
  'use strict';
  const st = {
    map:null,
    open:false,
    trips: [], // Array of {id, name, stops: []}
    currentTripId: null,
    el:null
  };

  function save(){
    localStorage.setItem('kt_trips', JSON.stringify(st.trips));
    localStorage.setItem('kt_current_trip', st.currentTripId);
  }

  function load(){
    try{
      st.trips = JSON.parse(localStorage.getItem('kt_trips')||'[]');
      st.currentTripId = localStorage.getItem('kt_current_trip');

      // Ensure we have at least one trip
      if (st.trips.length === 0) {
        createNewTrip('My Trip');
      }

      // Ensure current trip exists
      if (!st.currentTripId || !st.trips.find(t => t.id === st.currentTripId)) {
        st.currentTripId = st.trips[0].id;
      }
    } catch {
      st.trips = [];
      createNewTrip('My Trip');
    }
  }

  function createNewTrip(name) {
    const trip = {
      id: Date.now().toString(),
      name: name || `Trip ${st.trips.length + 1}`,
      stops: []
    };
    st.trips.push(trip);
    st.currentTripId = trip.id;
    save();
    return trip;
  }

  function getCurrentTrip() {
    return st.trips.find(t => t.id === st.currentTripId) || st.trips[0];
  }

  function getSite(id){ return (window.KampTrailData && window.KampTrailData.getCampsiteById(id)) || null; }

  function render(){
    const trip = getCurrentTrip();
    if (!trip) return;

    // Update header badge
    const badge = document.getElementById('trip-count');
    if(badge) badge.textContent = `(${trip.stops.length})`;

    // Render trip selector
    const selector = st.el.querySelector('#kt-trip-selector');
    selector.innerHTML = `
      <select id="kt-trip-select" style="flex:1;background:#0b141b;border:1px solid #284356;color:#cfe3f2;border-radius:6px;padding:6px;font-size:13px;">
        ${st.trips.map(t => `<option value="${t.id}" ${t.id === st.currentTripId ? 'selected' : ''}>${t.name} (${t.stops.length})</option>`).join('')}
      </select>
      <button id="kt-trip-new" title="New trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#4CAF50;border-radius:6px;cursor:pointer;font-size:13px;">+</button>
      <button id="kt-trip-rename" title="Rename trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:13px;">✏️</button>
      ${st.trips.length > 1 ? `<button id="kt-trip-delete" title="Delete trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:13px;">🗑️</button>` : ''}
    `;

    // Wire trip selector events
    const selectEl = st.el.querySelector('#kt-trip-select');
    selectEl.addEventListener('change', (e) => {
      st.currentTripId = e.target.value;
      save();
      render();
    });

    st.el.querySelector('#kt-trip-new').onclick = () => {
      const name = prompt('Trip name:', `Trip ${st.trips.length + 1}`);
      if (name) {
        createNewTrip(name);
        render();
      }
    };

    st.el.querySelector('#kt-trip-rename').onclick = () => {
      const name = prompt('Rename trip:', trip.name);
      if (name) {
        trip.name = name;
        save();
        render();
      }
    };

    const delBtn = st.el.querySelector('#kt-trip-delete');
    if (delBtn) {
      delBtn.onclick = () => {
        if (confirm(`Delete "${trip.name}"?`)) {
          st.trips = st.trips.filter(t => t.id !== trip.id);
          if (st.trips.length === 0) {
            createNewTrip('My Trip');
          } else {
            st.currentTripId = st.trips[0].id;
          }
          save();
          render();
        }
      };
    }

    // Render stops
    const list = st.el.querySelector('#kt-trip-list');
    if(!trip.stops.length){
      list.innerHTML='<div style="opacity:.7;text-align:center;padding:20px">No stops yet</div>';
      return;
    }

    list.innerHTML = trip.stops.map((id,i)=>{
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
      const idx=+e.currentTarget.dataset.i; const s=getSite(trip.stops[idx]);
      if(s){ const [lng,lat]=s.geometry.coordinates; st.map.setView([lat,lng], 12); }
    });
    list.querySelectorAll('.kt-trip-del').forEach(b=>b.onclick=(e)=>{
      const idx=+e.currentTarget.dataset.i; trip.stops.splice(idx,1); save(); render();
    });
  }

  function drawer(){
    const d=document.createElement('div');
    d.style.position='fixed'; d.style.top='60px'; d.style.right='-380px'; d.style.width='360px';
    d.style.maxWidth='calc(100vw - 24px)'; d.style.height='calc(100vh - 80px)';
    d.style.background='rgba(15,27,36,.98)'; d.style.border='1px solid #284356';
    d.style.borderRadius='12px 0 0 12px';
    d.style.boxShadow='-4px 0 20px rgba(0,0,0,.4)'; d.style.zIndex=1002;
    d.style.transition='right .25s ease';
    d.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:#cfe3f2;">🧭 Trip Planner</div>
        <button id="kt-trip-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer;margin-left:auto">✕</button>
      </div>
      <div id="kt-trip-selector" style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;gap:6px;"></div>
      <div id="kt-trip-list" style="padding:12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 170px)"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:flex;gap:8px">
        <button id="kt-trip-export" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer">💾 Export GPX</button>
        <button id="kt-trip-clear" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear Stops</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  function open(){ st.open=true; st.el.style.right='0'; }
  function close(){ st.open=false; st.el.style.right='-380px'; }

  function exportGPX(){
    const trip = getCurrentTrip();
    if (!trip) return;

    const wpts = trip.stops.map((id,i)=>{
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
    const filename = trip.name.replace(/[^a-zA-Z0-9]/g, '_');
    a.href=url; a.download=`KampTrail_${filename}_${Date.now()}.gpx`; a.click();
    URL.revokeObjectURL(url);
  }

  window.KampTrailTrip = {
    init(map){
      st.map = map; load();
      st.el = drawer(); render();
      document.getElementById('trip').onclick = ()=> (st.open?close():open());
      st.el.querySelector('#kt-trip-close').onclick = close;
      st.el.querySelector('#kt-trip-clear').onclick = ()=>{
        const trip = getCurrentTrip();
        if(trip && confirm('Clear all stops from this trip?')){
          trip.stops=[]; save(); render();
        }
      };
      st.el.querySelector('#kt-trip-export').onclick = exportGPX;
      console.log('✓ Multi-trip planner ready');
    },
    addStop(id){
      const trip = getCurrentTrip();
      if(trip && !trip.stops.includes(id)){
        trip.stops.push(id); save(); render(); open();
      }
    },
    toggle(){ st.open?close():open(); }
  };
})();
