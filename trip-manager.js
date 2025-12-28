/**
 * KampTrail Multi-Trip Manager
 * Supports multiple named trips with distance calculations
 */
(function(){
  'use strict';

  const st = {
    map: null,
    open: false,
    trips: {}, // { tripId: { name, stops[], created, modified } }
    activeTrip: null,
    el: null
  };

  /**
   * Calculate distance between two points in km
   */
  function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate total trip distance
   */
  function calculateTripDistance(stops) {
    if (stops.length < 2) return 0;

    let total = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = getSite(stops[i]);
      const s2 = getSite(stops[i + 1]);
      if (!s1 || !s2) continue;

      const [lng1, lat1] = s1.geometry.coordinates;
      const [lng2, lat2] = s2.geometry.coordinates;
      total += calculateDistance(lat1, lng1, lat2, lng2);
    }

    return total;
  }

  function save(){
    try {
      localStorage.setItem('kt_trips', JSON.stringify(st.trips));
      localStorage.setItem('kt_active_trip', st.activeTrip);
    } catch(e) {
      console.error('Failed to save trips:', e);
    }
  }

  function load(){
    try {
      // Load multi-trip data
      const tripsData = localStorage.getItem('kt_trips');
      if (tripsData) {
        st.trips = JSON.parse(tripsData);
      }

      // Migrate legacy single trip if exists
      const legacyTrip = localStorage.getItem('kt_trip');
      if (legacyTrip && Object.keys(st.trips).length === 0) {
        const stops = JSON.parse(legacyTrip);
        if (stops.length > 0) {
          const id = 'trip_' + Date.now();
          st.trips[id] = {
            name: 'My Trip',
            stops: stops,
            created: Date.now(),
            modified: Date.now()
          };
          st.activeTrip = id;
          save();
          localStorage.removeItem('kt_trip'); // Remove legacy
        }
      }

      // Load active trip
      st.activeTrip = localStorage.getItem('kt_active_trip');

      // Create default trip if none exist
      if (Object.keys(st.trips).length === 0) {
        const id = 'trip_' + Date.now();
        st.trips[id] = {
          name: 'My Trip',
          stops: [],
          created: Date.now(),
          modified: Date.now()
        };
        st.activeTrip = id;
        save();
      }

      // Ensure active trip exists
      if (!st.trips[st.activeTrip]) {
        st.activeTrip = Object.keys(st.trips)[0];
        save();
      }
    } catch(e) {
      console.error('Failed to load trips:', e);
      st.trips = {};
      const id = 'trip_' + Date.now();
      st.trips[id] = {
        name: 'My Trip',
        stops: [],
        created: Date.now(),
        modified: Date.now()
      };
      st.activeTrip = id;
    }
  }

  function getSite(id){
    return (window.KampTrailData && window.KampTrailData.getCampsiteById(id)) || null;
  }

  function getActiveTrip() {
    return st.trips[st.activeTrip] || { name: '', stops: [] };
  }

  function getTotalStops() {
    return Object.values(st.trips).reduce((sum, trip) => sum + trip.stops.length, 0);
  }

  function render(){
    // Update header badge with total stops across all trips
    const badge = document.getElementById('trip-count');
    if(badge) badge.textContent = `(${getTotalStops()})`;

    renderTripSelector();
    renderStops();

    // Trigger route update if route planner is loaded
    if (window.KampTrailRoute_onTripChange) {
      window.KampTrailRoute_onTripChange();
    }
  }

  function renderTripSelector() {
    const selector = st.el.querySelector('#kt-trip-selector');
    if (!selector) return;

    const tripsList = Object.entries(st.trips).map(([id, trip]) => {
      const active = id === st.activeTrip ? 'selected' : '';
      const stopCount = trip.stops.length;
      return `<option value="${id}" ${active}>${trip.name} (${stopCount})</option>`;
    }).join('');

    selector.innerHTML = `
      <select id="trip-select" style="flex:1;background:#0b141b;border:1px solid #284356;color:#cfe3f2;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px">
        ${tripsList}
      </select>
      <button id="new-trip-btn" title="New Trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#86b7ff;border-radius:6px;cursor:pointer;font-size:13px">+</button>
      <button id="rename-trip-btn" title="Rename Trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:13px">✏️</button>
      <button id="delete-trip-btn" title="Delete Trip" style="padding:6px 10px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:13px">🗑️</button>
    `;

    // Event listeners
    selector.querySelector('#trip-select').onchange = (e) => {
      st.activeTrip = e.target.value;
      save();
      render();
    };

    selector.querySelector('#new-trip-btn').onclick = () => {
      const name = prompt('Trip name:', 'New Trip');
      if (!name) return;

      const id = 'trip_' + Date.now();
      st.trips[id] = {
        name: name.trim(),
        stops: [],
        created: Date.now(),
        modified: Date.now()
      };
      st.activeTrip = id;
      save();
      render();
    };

    selector.querySelector('#rename-trip-btn').onclick = () => {
      const trip = getActiveTrip();
      const name = prompt('Rename trip:', trip.name);
      if (!name) return;

      trip.name = name.trim();
      trip.modified = Date.now();
      save();
      render();
    };

    selector.querySelector('#delete-trip-btn').onclick = () => {
      if (Object.keys(st.trips).length === 1) {
        alert('Cannot delete the last trip');
        return;
      }

      if (!confirm(`Delete trip "${getActiveTrip().name}"?`)) return;

      delete st.trips[st.activeTrip];
      st.activeTrip = Object.keys(st.trips)[0];
      save();
      render();
    };
  }

  function renderStops(){
    const trip = getActiveTrip();
    const list = st.el.querySelector('#kt-trip-list');

    if(!trip.stops.length){
      list.innerHTML='<div style="opacity:.7;text-align:center;padding:20px">No stops yet</div>';
      return;
    }

    // Calculate trip statistics
    const distance = calculateTripDistance(trip.stops);
    const distanceText = distance > 0 ? `${distance.toFixed(1)} km (${(distance * 0.621371).toFixed(1)} mi)` : 'N/A';

    let html = `
      <div style="padding:10px;background:rgba(134,183,255,.1);border-radius:8px;margin-bottom:12px;font-size:12px">
        <div><strong>Total Distance:</strong> ${distanceText}</div>
        <div><strong>Stops:</strong> ${trip.stops.length}</div>
      </div>
    `;

    html += trip.stops.map((id,i)=>{
      const s=getSite(id);
      if(!s) return '';

      const [lng,lat]=s.geometry.coordinates;
      const n=s.properties.name||'Campsite';

      // Calculate distance to next stop
      let distToNext = '';
      if (i < trip.stops.length - 1) {
        const nextSite = getSite(trip.stops[i + 1]);
        if (nextSite) {
          const [lng2, lat2] = nextSite.geometry.coordinates;
          const dist = calculateDistance(lat, lng, lat2, lng2);
          distToNext = `<div style="font-size:11px;color:#86b7ff;margin-top:2px">→ ${dist.toFixed(1)} km to next</div>`;
        }
      }

      return `<div style="display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;border:1px solid #284356;border-radius:8px;padding:8px;background:#0b141b;">
        <div style="background:#86b7ff;color:#001;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:700">${i+1}</div>
        <div style="min-width:0">
          <div style="font-weight:600;color:#cfe3f2">${n}</div>
          <div style="opacity:.7;font-size:12px">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
          ${distToNext}
        </div>
        <div style="display:flex;gap:6px">
          <button data-i="${i}" class="kt-trip-zoom" title="Zoom" style="padding:6px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:6px;cursor:pointer;font-size:11px">📍</button>
          <button data-i="${i}" class="kt-trip-del" title="Remove" style="padding:6px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:6px;cursor:pointer;font-size:11px">🗑️</button>
        </div>
      </div>`;
    }).join('');

    list.innerHTML = html;

    list.querySelectorAll('.kt-trip-zoom').forEach(b=>b.onclick=(e)=>{
      const idx=+e.currentTarget.dataset.i;
      const s=getSite(trip.stops[idx]);
      if(s){
        const [lng,lat]=s.geometry.coordinates;
        st.map.setView([lat,lng], 12);
      }
    });

    list.querySelectorAll('.kt-trip-del').forEach(b=>b.onclick=(e)=>{
      const idx=+e.currentTarget.dataset.i;
      trip.stops.splice(idx,1);
      trip.modified = Date.now();
      save();
      render();
    });
  }

  function drawer(){
    const d=document.createElement('div');
    d.style.position='fixed';
    d.style.top='60px';
    d.style.right='-360px';
    d.style.width='340px';
    d.style.maxWidth='calc(100vw - 24px)';
    d.style.height='calc(100vh - 80px)';
    d.style.background='rgba(15,27,36,.98)';
    d.style.border='1px solid #284356';
    d.style.borderRadius='12px 0 0 12px';
    d.style.boxShadow='-4px 0 20px rgba(0,0,0,.4)';
    d.style.zIndex=1002;
    d.style.transition='right .25s ease';
    d.innerHTML=`
      <div style="padding:10px 12px;border-bottom:1px solid #284356;display:flex;align-items:center;gap:8px">
        <div style="font-weight:700;color:#cfe3f2;flex:1">Trip Manager</div>
        <button id="kt-trip-close" style="background:transparent;border:none;color:#9fd0ff;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="kt-trip-selector" style="padding:12px;border-bottom:1px solid #284356;display:flex;gap:6px;align-items:center"></div>
      <div id="kt-trip-list" style="padding:12px;display:grid;gap:8px;overflow:auto;height:calc(100% - 160px)"></div>
      <div style="padding:12px;border-top:1px solid #284356;display:flex;gap:8px">
        <button id="kt-trip-export" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#9fd0ff;border-radius:8px;cursor:pointer">💾 Export GPX</button>
        <button id="kt-trip-clear" style="flex:1;padding:8px;border:1px solid #284356;background:#173243;color:#ff6b6b;border-radius:8px;cursor:pointer">Clear Stops</button>
      </div>`;
    document.body.appendChild(d);
    return d;
  }

  function open(){ st.open=true; st.el.style.right='0'; }
  function close(){ st.open=false; st.el.style.right='-360px'; }

  function exportGPX(){
    const trip = getActiveTrip();
    const wpts = trip.stops.map((id,i)=>{
      const s=getSite(id);
      if(!s) return '';
      const [lng,lat]=s.geometry.coordinates;
      const name=(s.properties.name||`Stop ${i+1}`).replace(/[<&>"]/g,'');
      return `  <wpt lat="${lat}" lon="${lng}"><name>${i+1}: ${name}</name></wpt>`;
    }).join('\n');

    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="KampTrail" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
</gpx>`;

    const blob=new Blob([gpx],{type:'application/gpx+xml'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`KampTrail_${trip.name.replace(/\s+/g,'_')}_${Date.now()}.gpx`;
    a.click();
    URL.revokeObjectURL(url);

    showToast && showToast('Trip exported as GPX', 'success');
  }

  window.KampTrailTrip = {
    init(map){
      st.map = map;
      load();
      st.el = drawer();
      render();

      document.getElementById('trip').onclick = ()=> (st.open?close():open());
      st.el.querySelector('#kt-trip-close').onclick = close;
      st.el.querySelector('#kt-trip-clear').onclick = ()=>{
        const trip = getActiveTrip();
        if(confirm(`Clear all stops from "${trip.name}"?`)){
          trip.stops=[];
          trip.modified = Date.now();
          save();
          render();
        }
      };
      st.el.querySelector('#kt-trip-export').onclick = exportGPX;

      console.log('✓ Multi-trip manager ready');
    },

    addStop(id){
      const trip = getActiveTrip();
      if(!trip.stops.includes(id)){
        trip.stops.push(id);
        trip.modified = Date.now();
        save();
        render();
        open();
      }
    },

    toggle(){ st.open?close():open(); },

    getTrips() { return st.trips; },
    getActiveTrip() { return getActiveTrip(); }
  };
})();
