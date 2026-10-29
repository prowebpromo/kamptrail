/* Basemaps, public land, RV services, and "check this spot". All public, keyless sources. */
(function () {
  'use strict';
  const STORE = 'kt_layers_v1';
  const st = {map: null, base: null, overlays: {}, services: null, servicesLoaded: null, landLegend: null, popupOpenAtDown: false};
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const directions = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
  function readPrefs() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function writePrefs(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch {} }

  function basemaps() {
    let errors = 0;
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'});
    osm.on('tileerror', () => { if (++errors === 3 && navigator.onLine) window.showToast?.('Map imagery is temporarily unavailable. Campsite search, lists, and saved stops still work.', 'error'); });
    return {
      Standard: osm,
      Topo: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map'}),
      Satellite: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map: orthoimagery'})
    };
  }
  function landLayer() {
    return L.tileLayer(`${KampTrailSpot.SMA_URL}/tile/{z}/{y}/{x}`, {opacity: 0.55, maxNativeZoom: 16, maxZoom: 19, attribution: 'BLM Surface Management Agency', className: 'kt-land-tiles'});
  }
  function legendControl() {
    const c = L.control({position: matchMedia('(max-width:760px)').matches ? 'topleft' : 'bottomleft'});
    c.onAdd = () => {
      const el = L.DomUtil.create('div', 'kt-land-legend');
      el.setAttribute('role', 'note');
      el.innerHTML = '<strong>Public land</strong><span><i style="background:#fee679"></i>BLM</span><span><i style="background:#ccebc5"></i>Forest Service</span><span><i style="background:#cabddc"></i>National Park</span><small>Tap the map to check who manages a spot.</small>';
      L.DomEvent.disableClickPropagation(el);
      return el;
    };
    return c;
  }

  // ---- RV services: dump stations and propane (OSM) ----
  const KINDS = {d: {label: 'RV dump station', letter: 'D', color: '#6b3fa0'}, w: {label: 'Water fill point', letter: 'W', color: '#1f6fb2'}, p: {label: 'Propane', letter: 'P', color: '#c25b12'}};
  function serviceIcon(kind) {
    const k = KINDS[kind] || KINDS.d;
    return L.divIcon({className: 'kt-svc-icon', html: `<span style="background:${k.color}">${k.letter}</span>`, iconSize: [20, 20], iconAnchor: [10, 10]});
  }
  function servicePopup(row) {
    const [lng, lat, kind, name, extra = {}] = row;
    const label = (KINDS[kind] || KINDS.d).label;
    const osmView = extra.t && extra.o ? `https://www.openstreetmap.org/${extra.t}/${encodeURIComponent(extra.o)}` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
    return `<div class="kt-svc-popup"><h3>${esc(name || label)}</h3><div><strong>${label}</strong></div>
      ${extra.op ? `<div>Operator: ${esc(extra.op)}</div>` : ''}${extra.f ? `<div>Fee reported: ${esc(extra.f)}</div>` : ''}${extra.a ? `<div>Access reported: ${esc(extra.a)}</div>` : ''}${kind === 'w' ? `<div>Drinking water: ${extra.dw === 'yes' ? 'tagged yes' : extra.dw === 'no' ? 'tagged no (non-potable)' : 'not stated'}</div>` : ''}
      <div class="kt-muted">GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      <p class="kt-fine">From OpenStreetMap contributors. Hours, fees, and whether it is open are not verified. Call ahead.</p>
      <div class="kt-popup-actions"><a href="${directions(lat, lng)}" target="_blank" rel="noopener noreferrer">Directions</a> <a href="${osmView}" target="_blank" rel="noopener noreferrer">View on OSM</a></div></div>`;
  }
  function loadServices() {
    if (st.servicesLoaded) return st.servicesLoaded;
    st.servicesLoaded = fetch('data/services/services.json').then(r => { if (!r.ok) throw new Error('Services unavailable'); return r.json(); }).then(data => {
      const group = st.services;
      const markers = (data.items || []).filter(r => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1])).map(row => {
        const m = L.marker([row[1], row[0]], {icon: serviceIcon(row[2]), title: row[3] || (KINDS[row[2]] || KINDS.d).label, keyboard: false});
        m.bindPopup(() => servicePopup(row));
        m.ktKind = row[2];
        return m;
      });
      group.addLayers ? group.addLayers(markers) : markers.forEach(m => group.addLayer(m));
      return markers.length;
    }).catch(err => { st.servicesLoaded = null; window.showToast?.('RV services could not load. Try again when connected.', 'error'); throw err; });
    return st.servicesLoaded;
  }

  // ---- Check this spot ----
  function openSpot(latlng) {
    const lat = latlng.lat, lng = ((latlng.lng + 540) % 360) - 180;
    const box = document.createElement('div');
    box.className = 'kt-spot-popup';
    const h = document.createElement('h3'); h.textContent = 'This spot';
    const gps = document.createElement('div'); gps.className = 'kt-muted'; gps.textContent = `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const land = document.createElement('div'); land.className = 'kt-spot-land';
    const wx = document.createElement('div'); wx.className = 'kt-spot-wx';
    const actions = document.createElement('div'); actions.className = 'kt-popup-actions';
    const btn = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn; return b; };
    // Disable rather than remove: removing the clicked node makes Leaflet treat the click as a map click and close the popup.
    const wxBtn = btn('Forecast + elevation', () => { wxBtn.disabled = true; KampTrailSpot.renderForecast(wx, lat, lng); });
    const save = btn('Save stop', () => {
      window.KampTrailTrip?.addStop(`spot:${lat.toFixed(5)},${lng.toFixed(5)}`, {type: 'Feature', geometry: {type: 'Point', coordinates: [lng, lat]}, properties: {id: `spot:${lat.toFixed(5)},${lng.toFixed(5)}`, name: `Spot ${lat.toFixed(4)}, ${lng.toFixed(4)}`, type: 'spot', fee_status: 'unknown', amenities: [], rig_friendly: []}});
    });
    const share = btn('Share', () => window.KampTrailShare?.share({spot: [lat, lng]}, 'This spot'));
    const dir = document.createElement('a'); dir.href = directions(lat, lng); dir.target = '_blank'; dir.rel = 'noopener noreferrer'; dir.textContent = 'Directions';
    actions.append(wxBtn, save, share, dir);
    const suggest = document.createElement('p'); suggest.className = 'kt-fine';
    const sug = btn('Suggest a campsite here', () => window.KampTrailContrib ? KampTrailContrib.open({kind: 'new_place', lat, lng}) : window.KampTrailShare && window.open(KampTrailShare.issueUrl('new', {lat, lng}), '_blank', 'noopener'));
    sug.className = 'kt-linkbtn';
    suggest.append(sug, ' No account needed.');
    box.append(h, gps, land, wx, actions, suggest);
    L.popup({maxWidth: 320, className: 'kt-spot'}).setLatLng([lat, latlng.lng]).setContent(box).openOn(st.map);
    KampTrailSpot.renderLand(land, lat, lng);
  }

  function init(map) {
    st.map = map;
    const prefs = readPrefs();
    const bases = basemaps();
    st.base = bases[prefs.base] ? prefs.base : 'Standard';
    bases[st.base].addTo(map);
    const land = landLayer();
    st.services = L.markerClusterGroup ? L.markerClusterGroup({maxClusterRadius: 40, showCoverageOnHover: false, chunkedLoading: true, iconCreateFunction: c => L.divIcon({className: 'kt-svc-cluster', html: `<span>${c.getChildCount()}</span>`, iconSize: [28, 28]})}) : L.layerGroup();
    st.overlays = {'Public land (BLM, USFS, NPS)': land, 'RV services (dump, water, propane)': st.services};
    st.landLegend = legendControl();
    const control = L.control.layers(bases, st.overlays, {position: 'topright', collapsed: true}).addTo(map);
    const container = control.getContainer();
    container.setAttribute('aria-label', 'Map layers');
    const toggle = container.querySelector('.leaflet-control-layers-toggle');
    if (toggle) { toggle.setAttribute('aria-label', 'Map layers'); toggle.title = 'Map layers'; toggle.setAttribute('role', 'button'); }
    map.on('baselayerchange', e => { st.base = e.name; const p = readPrefs(); p.base = e.name; writePrefs(p); });
    map.on('overlayadd overlayremove', e => {
      const on = e.type === 'overlayadd';
      const p = readPrefs(); p.overlays = p.overlays || {}; p.overlays[e.name] = on; writePrefs(p);
      if (e.layer === land) { on ? st.landLegend.addTo(map) : st.landLegend.remove(); }
      if (e.layer === st.services && on) loadServices().catch(() => {});
    });
    Object.entries(prefs.overlays || {}).forEach(([name, on]) => { if (on && st.overlays[name]) st.overlays[name].addTo(map); });
    // Spot check: long-press or right-click anywhere. Single tap also works while public land is shown.
    map.on('mousedown touchstart', () => { st.popupOpenAtDown = !!map._popup && map.hasLayer(map._popup); });
    map.on('contextmenu', e => openSpot(e.latlng));
    map.on('click', e => {
      if (!map.hasLayer(land) || st.popupOpenAtDown) return;
      if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.leaflet-marker-icon,.leaflet-popup,.leaflet-control')) return;
      openSpot(e.latlng);
    });
  }
  window.KampTrailLayers = {version: '2.6.0', init, openSpot, loadServices, showLand: () => { const l = st.overlays['Public land (BLM, USFS, NPS)']; if (st.map && l && !st.map.hasLayer(l)) l.addTo(st.map); }, isOn: name => !!(st.map && st.overlays[name] && st.map.hasLayer(st.overlays[name])), getBase: () => st.base};
})();
