/* overlays/overlays-advanced.js
   Requires: Leaflet + leaflet.markercluster + Esri Leaflet (https://unpkg.com/esri-leaflet@3)
*/
(function () {
  const state = {
    groups: {},          // Esri overlays
    cache: {},           // bbox fetch cache
    campsGroup: null,
    poiGroup: null,
    hazardGroup: null,
    cellGroup: null,
    config: null
  };

  const defaults = {
    padusUrl: 'https://services1.arcgis.com/0MSEUqKaxRlEPj5g/ArcGIS/rest/services/PADUS2_1_FederalManagementAgencies/MapServer',
    blmSmaUrl: 'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_Cached_with_PriUnk/MapServer',
    usfsAdminUrl: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Forest_Administrative_Boundaries/FeatureServer/0',
    overpass: 'https://overpass-api.de/api/interpreter',
    openCellIdUrl: 'https://api.opencellid.org/towers',
    openCellIdToken: '',
    maxPoi: 4000,
    maxCamps: 6000
  };

  // ---------- utils ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const el = (t,c)=>{const n=document.createElement(t); if(c) n.className=c; return n;};
  const deb = (fn,ms)=>{let t; return (...a)=>{clearTimeout(t); t=setTimeout(()=>fn(...a),ms);};};
  const bbox = (map) => { const b=map.getBounds(); return {s:b.getSouth(),w:b.getWest(),n:b.getNorth(),e:b.getEast()}; };
  const clusterGroup = ()=>L.markerClusterGroup({chunkedLoading:true, spiderfyOnMaxZoom:false});
  const has = (map,layer)=> !!layer && map.hasLayer(layer);

  // Robust toggle binder: clicking row OR checkbox toggles and runs handlers
  function bindToggle(id, {on, off}) {
    const cb  = $(id);
    if (!cb) return;
    const row = cb.closest('.kt2-row') || cb.parentElement;

    const run = () => (cb.checked ? on?.() : off?.());

    cb.addEventListener('change', (e) => { e.stopPropagation(); run(); });

    // Clicking the row/label also toggles checkbox
    row.addEventListener('click', (e) => {
      // ignore clicks on actual inputs to avoid double-change
      if (e.target.tagName === 'INPUT') return;
      cb.checked = !cb.checked;
      run();
    });
  }

  // ---------- UI ----------
  function buildPanel(map){
    const panel = el('div','kt2-panel');
    panel.style.pointerEvents = 'auto'; // make sure clicks are accepted
    panel.innerHTML = `
      <h4>Layers & Data</h4>
      <div class="kt2-row"><input id="kt2-padus" type="checkbox"> <label for="kt2-padus">PAD-US (protected/public lands)</label> <span class="kt2-badge">overlay</span></div>
      <div class="kt2-row"><input id="kt2-blm" type="checkbox"> <label for="kt2-blm">BLM Surface Mgmt Agency</label> <span class="kt2-badge">overlay</span></div>
      <div class="kt2-row"><input id="kt2-usfs" type="checkbox"> <label for="kt2-usfs">USFS Admin boundaries</label> <span class="kt2-badge">overlay</span></div>
      <hr style="border-color:#284356;opacity:.5;">
      <div class="kt2-row"><input id="kt2-camps" type="checkbox" checked> <label for="kt2-camps">Free camps (OSM)</label> <span class="kt2-badge">live</span></div>
      <div class="kt2-row"><input id="kt2-poi" type="checkbox" checked> <label for="kt2-poi">Dump / Water / Propane (OSM)</label> <span class="kt2-badge">live</span></div>
      <div class="kt2-row"><input id="kt2-haz" type="checkbox"> <label for="kt2-haz">Low clearance (maxheight)</label> <span class="kt2-badge">live</span></div>
      <div class="kt2-row"><input id="kt2-cell" type="checkbox"> <label for="kt2-cell">Cell towers (OpenCelliD)</label> <span class="kt2-badge">live</span></div>
      <div class="kt2-note">OSM & US Gov data. Add API keys/tiles in <code>overlays-advanced.js</code> if needed.</div>`;
    map._container.appendChild(panel);
    // Stop panning/zoom when clicking panel, but keep clicks active inside
    L.DomEvent.disableClickPropagation(panel);
  }

  function buildLegend(map){
    const legend = el('div','kt2-legend');
    legend.innerHTML = `<strong>Legend</strong><br>
      <span class="chip">Free camp</span>
      <span class="chip">Dump</span>
      <span class="chip">Water</span>
      <span class="chip">Propane</span>
      <span class="chip" style="border-color:#ff6b6b;color:#ff9b9b;">Maxheight</span>`;
    map._container.appendChild(legend);
    L.DomEvent.disableClickPropagation(legend);
  }

  // ---------- Esri overlays ----------
  function setupEsri(map){
    if (!L.esri) {
      console.error('Esri Leaflet not loaded');
      return;
    }
    const padus = L.esri.dynamicMapLayer({ url: state.config.padusUrl, opacity: .45 });
    const blm   = L.esri.tiledMapLayer({    url: state.config.blmSmaUrl,  opacity: .45 });
    const usfs  = L.esri.featureLayer({     url: state.config.usfsAdminUrl, style: { color: '#33ff99', weight: 1, fill: false } });

    state.groups.padus = padus;
    state.groups.blm   = blm;
    state.groups.usfs  = usfs;

    // Use robust binder so clicking label/row works too
    bindToggle('#kt2-padus', {
      on:  () => { if (!has(map,padus)) map.addLayer(padus); },
      off: () => { if (has(map,padus))  map.removeLayer(padus); }
    });
    bindToggle('#kt2-blm', {
      on:  () => { if (!has(map,blm)) map.addLayer(blm); },
      off: () => { if (has(map,blm))  map.removeLayer(blm); }
    });
    bindToggle('#kt2-usfs', {
      on:  () => { if (!has(map,usfs)) map.addLayer(usfs); },
      off: () => { if (has(map,usfs))  map.removeLayer(usfs); }
    });
  }

  // ---------- Overpass ----------
  async function overpass(q){
    const url = state.config.overpass + '?data=' + encodeURIComponent(q);
    for (let i=0;i<3;i++){
      try {
        const r = await fetch(url, { cache:'no-store' });
        if (!r.ok) throw new Error('HTTP '+r.status);
        return await r.json();
      } catch(e){
        await new Promise(res=>setTimeout(res, 800*(i+1)));
      }
    }
    console.warn('Overpass failed 3x');
    return { elements: [] };
  }

  const qCamps = b => `[out:json][timeout:25];
    ( node["tourism"="camp_site"]["fee"="no"](${b.s},${b.w},${b.n},${b.e});
      node["tourism"="camp_site"]["camp_site"~"basic|backcountry"](${b.s},${b.w},${b.n},${b.e});
    ); out center;`;

  const qPois = b => `[out:json][timeout:25];
    ( node["amenity"="sanitary_dump_station"](${b.s},${b.w},${b.n},${b.e});
      node["amenity"="drinking_water"](${b.s},${b.w},${b.n},${b.e});
      node["amenity"="fuel"]["fuel:propane"~"yes|1"](${b.s},${b.w},${b.n},${b.e});
    ); out center;`;

  const qHaz = b => `[out:json][timeout:25];
    ( way["maxheight"](${b.s},${b.w},${b.n},${b.e});
      node["maxheight"](${b.s},${b.w},${b.n},${b.e});
    ); out center;`;

  const ensure = (name, clustered=true) => state[name] || (state[name] = (clustered ? clusterGroup() : L.layerGroup()));

  async function loadCamps(map){
    const b=bbox(map); const key='camps:'+Object.values(b).join(',');
    if (state.cache[key]) return; state.cache[key]=true;
    const data=await overpass(qCamps(b));
    const grp=ensure('campsGroup',true);
    data.elements.slice(0,defaults.maxCamps).forEach(n=>{
      const name=(n.tags&&(n.tags.name||'Free camp'))||'Free camp';
      L.marker([n.lat,n.lon],{title:name})
       .bindPopup(`<strong>${name}</strong><br>OSM: tourism=camp_site`)
       .addTo(grp);
    });
    if(!has(map,grp)) map.addLayer(grp);
  }
  async function loadPois(map){
    const b=bbox(map); const key='poi:'+Object.values(b).join(',');
    if (state.cache[key]) return; state.cache[key]=true;
    const data=await overpass(qPois(b));
    const grp=ensure('poiGroup',true);
    data.elements.slice(0,defaults.maxPoi).forEach(n=>{
      const type=n.tags.amenity||'poi'; const name=n.tags.name||type;
      L.marker([n.lat,n.lon],{title:name})
       .bindPopup(`<strong>${name}</strong><br>${type}`)
       .addTo(grp);
    });
    if(!has(map,grp)) map.addLayer(grp);
  }
  async function loadHazards(map){
    const b=bbox(map); const key='haz:'+Object.values(b).join(',');
    if (state.cache[key]) return; state.cache[key]=true;
    const data=await overpass(qHaz(b));
    const grp=ensure('hazardGroup',false);
    data.elements.forEach(e=>{
      const lat=e.lat||(e.center&&e.center.lat);
      const lon=e.lon||(e.center&&e.center.lon);
      if(lat&&lon) L.circleMarker([lat,lon],{radius:5,color:'#ff6b6b'})
        .bindPopup(`Max height: ${e.tags.maxheight}`)
        .addTo(grp);
    });
    if(!has(map,grp)) map.addLayer(grp);
  }

  async function loadTowers(map){
    if(!state.config.openCellIdToken){
      alert('Add openCellIdToken in KampTrailAdvanced.init to enable towers.'); $('#kt2-cell').checked=false; return;
    }
    const b=bbox(map);
    const url=`${defaults.openCellIdUrl}?token=${encodeURIComponent(state.config.openCellIdToken)}&bbox=${b.s},${b.w},${b.n},${b.e}&format=json`;
    const r=await fetch(url); if(!r.ok){ alert('OpenCelliD request failed'); $('#kt2-cell').checked=false; return; }
    const data=await r.json();
    const grp=ensure('cellGroup',true);
    (data.cells||[]).forEach(c=>{
      L.circleMarker([c.lat,c.lon],{radius:4,color:'#74c0fc'})
       .bindPopup(`Tower<br>Radio:${c.radio||''} MCC:${c.mcc||''} MNC:${c.mnc||''}`)
       .addTo(grp);
    });
    if(!has(map,grp)) map.addLayer(grp);
  }

  function removeAndClear(map, name){
    const grp=state[name]; if(!grp) return;
    if (has(map,grp)) map.removeLayer(grp);
    if (grp.clearLayers) grp.clearLayers();
  }

  function applyInitial(map){
    // honor current checkbox states at load
    if ($('#kt2-padus').checked) map.addLayer(state.groups.padus);
    if ($('#kt2-blm').checked)   map.addLayer(state.groups.blm);
    if ($('#kt2-usfs').checked)  map.addLayer(state.groups.usfs);
    if ($('#kt2-camps').checked) loadCamps(map);
    if ($('#kt2-poi').checked)   loadPois(map);
    if ($('#kt2-haz').checked)   loadHazards(map);
    if ($('#kt2-cell').checked)  loadTowers(map);
  }

  // ---------- public ----------
  window.KampTrailAdvanced = {
    init(map, cfg){
      state.config = Object.assign({}, defaults, cfg||{});
      buildPanel(map);
      buildLegend(map);
      setupEsri(map);

      // live layers
      bindToggle('#kt2-camps', { on: ()=>loadCamps(map),  off: ()=>removeAndClear(map,'campsGroup')  });
      bindToggle('#kt2-poi',   { on: ()=>loadPois(map),   off: ()=>removeAndClear(map,'poiGroup')    });
      bindToggle('#kt2-haz',   { on: ()=>loadHazards(map),off: ()=>removeAndClear(map,'hazardGroup') });
      bindToggle('#kt2-cell',  { on: ()=>loadTowers(map), off: ()=>removeAndClear(map,'cellGroup')   });

      applyInitial(map);

      map.on('moveend', deb(()=>{
        if ($('#kt2-camps').checked) loadCamps(map);
        if ($('#kt2-poi').checked)   loadPois(map);
        if ($('#kt2-haz').checked)   loadHazards(map);
        if ($('#kt2-cell').checked)  loadTowers(map);
      }, 350));
    }
  };
})();
