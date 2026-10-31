/* Basemaps, public land, RV services, and "check this spot". All public, keyless sources. */
(function () {
  'use strict';
  const t = (key, params) => (typeof window !== 'undefined' ? window.KampTrailI18n : globalThis.KampTrailI18n)?.t(key, params) ?? String(key).replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name) => Object.hasOwn(params || {}, name) ? String(params[name]) : token);
  const STORE = 'kt_layers_v1';
  const st = {map: null, base: null, overlays: {}, services: null, serviceSequence: 0, serviceAbort: null, serviceStatus: null, serviceControls: null, includeRestricted: false, landLegend: null, popupOpenAtDown: false};
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const directions = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
  function readPrefs() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
  function writePrefs(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch {} }

  function basemaps() {
    let errors = 0;
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'});
    osm.on('tileerror', () => { if (++errors === 3 && navigator.onLine) window.showToast?.(t("Map imagery is temporarily unavailable. Campsite search, lists, and saved stops still work."), 'error'); });
    return {
      Standard: osm,
      Topo: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map'}),
      Satellite: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {maxNativeZoom: 16, maxZoom: 19, attribution: 'USGS The National Map: orthoimagery'})
    };
  }
  function landLayer() {
    const saved=Number(readPrefs().landOpacity),opacity=Number.isFinite(saved)&&saved>=0.1&&saved<=1?saved:0.55;
    return L.tileLayer(`${KampTrailSpot.SMA_URL}/tile/{z}/{y}/{x}`, {opacity, maxNativeZoom: 16, maxZoom: 19, attribution: 'BLM Surface Management Agency', className: 'kt-land-tiles'});
  }
  function legendControl() {
    const c = L.control({position: matchMedia('(max-width:760px)').matches ? 'topleft' : 'bottomleft'});
    c.onAdd = () => {
      const el = L.DomUtil.create('div', 'kt-land-legend');
      el.setAttribute('role', 'note');
      el.innerHTML = `<strong>${t("Public land")}</strong><span><i style="background:#fee679"></i>BLM</span><span><i style="background:#ccebc5"></i>${t("Forest Service")}</span><span><i style="background:#cabddc"></i>${t("National Park")}</span><small>${t("Tap the map to check who manages a spot.")}</small>`;
      const label=document.createElement('label');label.textContent=t("Public land opacity");
      const slider=document.createElement('input');slider.type='range';slider.min='10';slider.max='100';slider.step='5';slider.value=String(Math.round((st.overlays['Public land (BLM, USFS, NPS)']?.options.opacity||0.55)*100));
      slider.oninput=()=>{const opacity=Number(slider.value)/100;st.overlays['Public land (BLM, USFS, NPS)']?.setOpacity(opacity);const prefs=readPrefs();prefs.landOpacity=opacity;writePrefs(prefs);};label.append(slider);el.append(label);
      L.DomEvent.disableClickPropagation(el);
      return el;
    };
    return c;
  }

  // Services use the same dated, spatially bounded loader as nearby and routes.
  const SERVICE_LAYER = 'Services (7 categories)';
  const SERVICE_ATTRIBUTION='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
  function serviceIcon(kind) {
    const k = KampTrailServices.categories[kind] || KampTrailServices.categories.dump;
    return L.divIcon({className: 'kt-svc-icon', html: `<span style="background:${k.color}">${k.letter}</span>`, iconSize: [24, 24], iconAnchor: [12, 12]});
  }
  function servicePopup(item, manifest) {
    const box=document.createElement('div');box.className='kt-svc-popup';box.dataset.serviceId=item.id;
    const title=document.createElement('h2');title.textContent=item.name||item.categories.map(k=>KampTrailServices.categories[k].label).join(', ');
    const evidence=document.createElement('p');evidence.className='kt-fine';evidence.textContent=KampTrailServices.describe(item,manifest);
    const attribution=document.createElement('p');attribution.className='kt-fine';attribution.textContent=t("Derived from OpenStreetMap contributors (ODbL).");
    const actions=document.createElement('div');actions.className='kt-popup-actions';
    const save=document.createElement('button');save.type='button';save.textContent=t("Save service stop");save.onclick=()=>window.KampTrailTrip?.addStop(item.id,KampTrailServices.feature(item,manifest));
    const [lng,lat]=item.coordinates;
    for(const [label,url] of [[t("Directions"),directions(lat,lng)],[t("View on OSM"),`https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`],[t("ODbL source"),'https://www.openstreetmap.org/copyright']]){const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
    const permission=document.createElement('button');permission.type='button';permission.textContent=t("Overnight permission");permission.onclick=()=>window.KampTrailPermissions?.open({kind:'service',id:item.id,name:item.name,coordinates:item.coordinates});
    actions.prepend(save,permission);box.append(title,evidence,attribution,actions);return box;
  }
  function serviceControl() {
    const control=L.control({position:'topright'});
    control.onAdd=()=>{
      const box=L.DomUtil.create('div','kt-services-control');box.hidden=true;st.serviceControls=box;
      const fields=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=t("Service categories");fields.append(legend);
      for(const [key,meta] of Object.entries(KampTrailServices.categories)){
        const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=KampTrailServices.getCategories().includes(key);
        input.onchange=()=>KampTrailServices.setCategories([...fields.querySelectorAll('input:checked')].map(n=>n.value));label.append(input,meta.label);fields.append(label);
      }
      const actions=document.createElement('div');actions.className='kt-services-actions';
      for(const [label,values] of [[t("All"),Object.keys(KampTrailServices.categories)],[t("Clear"),[]]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-label',t('{label} service categories',{label}));button.onclick=()=>KampTrailServices.setCategories(values);actions.append(button);}
      const restricted=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.onchange=()=>{st.includeRestricted=check.checked;loadServices();};restricted.append(check,t("Include no/private access (restricted)"));
      const status=document.createElement('p');status.className='kt-services-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');st.serviceStatus=status;
      const retry=document.createElement('button');retry.type='button';retry.textContent=t("Retry service areas");retry.onclick=()=>loadServices(true);
      const attribution=document.createElement('p');attribution.className='kt-fine';attribution.textContent=t("Service locations derived from OpenStreetMap contributors (ODbL).");
      box.append(fields,actions,restricted,status,attribution,retry);L.DomEvent.disableClickPropagation(box);L.DomEvent.disableScrollPropagation(box);
      window.addEventListener('kamptrail:servicescategories',()=>{for(const input of fields.querySelectorAll('input'))input.checked=KampTrailServices.getCategories().includes(input.value);loadServices();});
      return box;
    };return control;
  }
  async function loadServices(force=false) {
    const sequence=++st.serviceSequence;st.serviceAbort?.abort();st.serviceAbort=new AbortController();
    if(!st.map||!st.services)return;
    const enabled=st.map.hasLayer(st.services);if(st.serviceControls)st.serviceControls.hidden=!enabled;
    st.services.clearLayers();
    if(!enabled)return;
    if(st.map.getZoom()<10){st.serviceStatus.textContent=t('Zoom to level 10 or closer to load services. Coverage depends on imported sources; missing areas are unknown.');return;}
    const b=st.map.getBounds();st.serviceStatus.textContent=t('Loading dated service areas…');
    try{
      const result=await KampTrailServices.loadBounds({south:Math.max(-90,b.getSouth()),west:b.getWest(),north:Math.min(90,b.getNorth()),east:b.getEast()},{categories:KampTrailServices.getCategories(),includeRestricted:st.includeRestricted,signal:st.serviceAbort.signal,force,onProgress:p=>{if(sequence===st.serviceSequence)st.serviceStatus.textContent=t("Loading service areas {0}/{1}…", {"0":(p.loaded),"1":(p.total)});}});
      if(sequence!==st.serviceSequence)return;
      const selected=KampTrailServices.getCategories();
      const markers=result.items.map(item=>{const kind=item.categories.find(k=>selected.includes(k));const marker=L.marker([item.coordinates[1],item.coordinates[0]],{icon:serviceIcon(kind),title:item.name||KampTrailServices.categories[kind].label,keyboard:true});marker.ktServiceId=item.id;marker.bindPopup(()=>servicePopup(item,result.manifest));return marker;});
      st.services.addLayers?st.services.addLayers(markers):markers.forEach(marker=>st.services.addLayer(marker));st.serviceStatus.textContent=result.message;
      return result;
    }catch(error){if(sequence===st.serviceSequence&&error.name!=='AbortError')st.serviceStatus.textContent=t("Service coverage unavailable. Missing areas are unknown. Reconnect and retry.");}
  }

  // ---- Check this spot ----
  function openSpot(latlng) {
    const lat = latlng.lat, lng = ((latlng.lng + 540) % 360) - 180;
    const box = document.createElement('div');
    box.className = 'kt-spot-popup';
    const h = document.createElement('h3'); h.textContent = t("This spot");
    const gps = document.createElement('div'); gps.className = 'kt-muted'; gps.textContent = `GPS ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const land = document.createElement('div'); land.className = 'kt-spot-land';
    const wx = document.createElement('div'); wx.className = 'kt-spot-wx';
    const actions = document.createElement('div'); actions.className = 'kt-popup-actions';
    const btn = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn; return b; };
    // Disable rather than remove: removing the clicked node makes Leaflet treat the click as a map click and close the popup.
    const wxBtn = btn(t("Forecast + elevation"), () => { wxBtn.disabled = true; KampTrailSpot.renderForecast(wx, lat, lng); });
    const save = btn(t("Save stop"), () => {
      window.KampTrailTrip?.addStop(`spot:${lat.toFixed(5)},${lng.toFixed(5)}`, {type: 'Feature', geometry: {type: 'Point', coordinates: [lng, lat]}, properties: {id: `spot:${lat.toFixed(5)},${lng.toFixed(5)}`, name: t("Spot {0}, {1}", {"0":(lat.toFixed(4)),"1":(lng.toFixed(4))}), type: 'spot', fee_status: 'unknown', amenities: [], rig_friendly: []}});
    });
    const alerts = btn(t("Weather alerts"), () => KampTrailEnvironment.openAlerts(lat, lng));
    const context = btn(t("Fire and smoke nearby"), () => KampTrailEnvironment.showNear(lat, lng));
    const share = btn(t("Share"), () => window.KampTrailShare?.share({spot: [lat, lng]}, t("This spot")));
    const dir = document.createElement('a'); dir.href = directions(lat, lng); dir.target = '_blank'; dir.rel = 'noopener noreferrer'; dir.textContent = t("Directions");
    const permission=btn(t("Overnight permission"),()=>window.KampTrailPermissions?.open({kind:'spot',id:`spot:${lat.toFixed(5)},${lng.toFixed(5)}`,name:t("This spot"),coordinates:[lng,lat]}));
    const care = btn(t('Camping care'), () => KampTrailSpot.openCampingCare());
    actions.append(wxBtn, alerts, context, permission, care, save, share, dir);
    const suggest = document.createElement('p'); suggest.className = 'kt-fine';
    const sug = btn(t("Suggest a campsite here"), () => window.KampTrailContrib ? KampTrailContrib.open({kind: 'new_place', lat, lng}) : window.KampTrailShare && window.open(KampTrailShare.issueUrl('new', {lat, lng}), '_blank', 'noopener'));
    sug.className = 'kt-linkbtn';
    suggest.append(sug, t(" No account needed."));
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
    const roads = KampTrailMVUM.init(map);
    const environment = KampTrailEnvironment.init(map);
    const restAreas = window.KampTrailRestAreas?.init(map);
    const clearances = window.KampTrailClearances?.init(map);
    st.services = L.markerClusterGroup ? L.markerClusterGroup({maxClusterRadius: 40, showCoverageOnHover: false, chunkedLoading: false, iconCreateFunction: c => L.divIcon({className: 'kt-svc-cluster', html: `<span>${c.getChildCount()}</span>`, iconSize: [28, 28]})}) : L.layerGroup();
    st.overlays = {'Public land (BLM, USFS, NPS)': land, [SERVICE_LAYER]: st.services, ...(restAreas?{'Official rest areas (Texas pilot)':restAreas}:{}), ...(clearances?{'Reported height tags (Rhode Island pilot)':clearances}:{}), 'USFS motor vehicle roads': roads, ...environment};
    st.landLegend = legendControl();
    serviceControl().addTo(map);
    let serviceTimer;
    map.on('moveend',()=>{st.serviceAbort?.abort();++st.serviceSequence;clearTimeout(serviceTimer);serviceTimer=setTimeout(()=>loadServices(),180);});
    const control = L.control.layers(Object.fromEntries(Object.entries(bases).map(([name,layer])=>[t(name),layer])), Object.fromEntries(Object.entries(st.overlays).map(([name,layer])=>[t(name),layer])), {position: 'topright', collapsed: true}).addTo(map);
    const container = control.getContainer();
    // Visual and keyboard order agree; hiding later panels never moves this picker.
    const corner = container.parentNode;
    if (corner && corner.firstChild !== container) corner.insertBefore(container, corner.firstChild);
    container.setAttribute('aria-label', t("Map layers"));
    const toggle = container.querySelector('.leaflet-control-layers-toggle');
    if (toggle) { toggle.setAttribute('aria-label', t("Map layers")); toggle.title = t("Map layers"); toggle.setAttribute('role', 'button'); }
    map.on('baselayerchange', e => { st.base = Object.keys(bases).find(name=>bases[name]===e.layer) || st.base; const p = readPrefs(); p.base = st.base; writePrefs(p); });
    map.on('overlayadd overlayremove', e => {
      const on = e.type === 'overlayadd';
      const p = readPrefs(); p.overlays = p.overlays || {}; p.overlays[Object.keys(st.overlays).find(name=>st.overlays[name]===e.layer) || e.name] = on; writePrefs(p);
      if (e.layer === land) { on ? st.landLegend.addTo(map) : st.landLegend.remove(); }
      if (e.layer === st.services) {
        if(on)map.attributionControl?.addAttribution(SERVICE_ATTRIBUTION);else map.attributionControl?.removeAttribution(SERVICE_ATTRIBUTION);
        loadServices();
      }
    });
    if(prefs.overlays?.['RV services (dump, water, propane)']&&prefs.overlays[SERVICE_LAYER]===undefined)prefs.overlays[SERVICE_LAYER]=true;
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
  window.KampTrailLayers = {version: '2.22.0', init, openSpot, loadServices, showServices:()=>{if(st.map&&!st.map.hasLayer(st.services))st.services.addTo(st.map);return loadServices();}, serviceIds:()=>st.services?.getLayers().map(m=>m.ktServiceId)||[], showLand: () => { const l = st.overlays['Public land (BLM, USFS, NPS)']; if (st.map && l && !st.map.hasLayer(l)) l.addTo(st.map); }, isOn: name => !!(st.map && st.overlays[name] && st.map.hasLayer(st.overlays[name])), getBase: () => st.base};
})();
