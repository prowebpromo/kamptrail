// Optional overlays use the same-origin snapshots. Provider failures stay isolated from the map.
(function () {
  'use strict';
  const esc = value => window.escapeHtml ? window.escapeHtml(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const point = f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.slice(0, 2).every(Number.isFinite) && Math.abs(f.geometry.coordinates[0]) <= 180 && Math.abs(f.geometry.coordinates[1]) <= 90;
  const toast = (msg, type = 'info') => window.showToast?.(msg, type, 5000);
  async function loadJSON(url) {
    const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid GeoJSON');
    return data.features.filter(point);
  }
  function icon(color, glyph) {
    return L.divIcon({className:'kt-poi', html:`<span style="background:${color};color:white;border-radius:50%;width:22px;height:22px;display:grid;place-items:center;font-size:12px">${glyph}</span>`, iconSize:[22,22],iconAnchor:[11,11]});
  }
  window.KampTrailOverlays = {
    init(map, config) {
      const cfg = Object.assign({publicLandsUrl:'',openCelliDKey:'',poiUrl:'data/poi_dump_water_propane.geojson',maxPoiCount:10000,maxTowerCount:500}, config);
      const controls = L.DomUtil.create('div', 'kt-controls');
      controls.innerHTML = `<label><input id="kt-toggle-lands" type="checkbox"> Protected land access</label>
        <label><input id="kt-toggle-towers" type="checkbox"> Cell towers (key required)</label>
        <label><input id="kt-toggle-poi" type="checkbox" checked> Dump / water / propane</label>
        <label><input id="kt-toggle-ocm" type="checkbox"> OpenCampingMap</label>
        <small>Access overview, not camping permission.</small>`;
      map.getContainer().appendChild(controls);
      L.DomEvent.disableClickPropagation(controls);
      L.DomEvent.disableScrollPropagation(controls);
      const landsToggle = controls.querySelector('#kt-toggle-lands');
      const towersToggle = controls.querySelector('#kt-toggle-towers');
      const poiToggle = controls.querySelector('#kt-toggle-poi');
      const ocmToggle = controls.querySelector('#kt-toggle-ocm');
      const legend = L.DomUtil.create('div', 'kt-legend');
      legend.innerHTML = `<details class="kt-map-key" open><summary>Map key</summary><div class="kt-key-content">
        <strong>Campground dots</strong><div class="kt-key-line"><i style="background:#258543"></i>Reported free</div><div class="kt-key-line"><i style="background:#2375b9"></i>Paid</div><div class="kt-key-line"><i style="background:#687780"></i>Fee unknown</div>
        <div id="kt-service-legend"><strong>Service markers</strong><div>D: dump · W: water · P: LPG fuel</div><small>Confirm access, water safety and cylinder refill service.</small></div>
        <div id="kt-lands-legend" hidden><strong>PAD-US 3.0 land access</strong><div class="kt-key-line"><b style="background:#80c535"></b>Open</div><div class="kt-key-line"><b style="background:#64b484"></b>Restricted</div><div class="kt-key-line"><b style="background:#fff0c9"></b>Closed</div><small>No fill can mean unknown or unmapped. Includes public and private protected lands. Overview only. Access does not grant camping permission.</small></div>
      </div></details>`;
      if (window.matchMedia?.('(max-width:760px)').matches) legend.querySelector('details').open = false;
      const serviceLegend = legend.querySelector('#kt-service-legend');
      const landsLegend = legend.querySelector('#kt-lands-legend');
      map.getContainer().appendChild(legend);
      L.DomEvent.disableClickPropagation(legend);
      L.DomEvent.disableScrollPropagation(legend);
      let publicLands;
      if (cfg.publicLandsUrl) {
        publicLands = L.tileLayer(cfg.publicLandsUrl,{opacity:.55,minNativeZoom:2,maxNativeZoom:10,maxZoom:19,attribution:'Protected land access: USGS PAD-US 3.0 (2022); camping permission must be confirmed'});
        let errors = 0;
        publicLands.on('tileerror', () => {
          if (++errors === 3) toast('The public lands provider is not responding. Try again later.', 'error');
        });
      } else {
        landsToggle.disabled = true;
        landsToggle.parentElement.title = 'No public lands provider is configured.';
      }
      landsToggle.addEventListener('change', () => {
        landsLegend.hidden = !landsToggle.checked;
        landsToggle.checked ? publicLands?.addTo(map) : publicLands?.remove();
      });
      const poiCluster = L.markerClusterGroup({chunkedLoading:true,spiderfyOnMaxZoom:true});
      const poiIcons = {dump:icon('#6c5ce7','D'),water:icon('#00b894','W'),propane:icon('#e17055','P')};
      let poiLoaded = false, poiLoading = false;
      async function refreshPois() {
        if (!poiToggle.checked) { map.removeLayer(poiCluster); serviceLegend.hidden = true; return; }
        serviceLegend.hidden = false;
        if (!poiLoaded && !poiLoading) {
          poiLoading = true;
          try {
            const features = (await loadJSON(cfg.poiUrl)).filter(f => !(f.properties?.source === 'recreation.gov' && f.properties?.type === 'water') || (f.properties?.schema_version >= 3 && f.properties?.field_provenance?.drinking_water));
            const markers = features.slice(0,cfg.maxPoiCount).map(f => {
              const p = f.properties || {}, [lng,lat] = f.geometry.coordinates;
              const type = String(p.type || '').toLowerCase();
              const name = p.name || type.toUpperCase() || 'Service';
              const serviceLabel = p.service_description || (type === 'propane' ? 'LPG fuel. Cylinder refill service unverified.' : type);
              const restrictions = p.access ? `<br>Access: ${esc(p.access)}` : '';
              const source = p.source ? `<br><small>Source: ${esc(p.source)}</small>` : '';
              const warning = p.source === 'recreation.gov' ? 'Facility data mentions water. Potability and public refill access are unverified.' : 'Confirm current service, public access, fees and water potability with the operator.';
              return L.marker([lat,lng],{icon:poiIcons[type] || icon('#0984e3','•'),title:String(name)})
                .bindPopup(`<strong>${esc(name)}</strong><br>${esc(serviceLabel)}${restrictions}${source}<br><small>${esc(warning)}</small>`);
            });
            poiCluster.addLayers(markers);
            poiLoaded = true;
            if (!features.length) toast('No service locations are available in the current snapshot.');
          } catch (err) { toast(`Service locations could not load (${err.message}). Toggle the layer to retry.`, 'error'); }
          finally { poiLoading = false; }
        }
        if (poiToggle.checked) map.addLayer(poiCluster);
      }
      poiToggle.addEventListener('change',refreshPois);
      refreshPois();

      // State snapshots overlap at borders, so key OSM features rather than markers by file.
      const ocmCluster = L.markerClusterGroup({chunkedLoading:true,spiderfyOnMaxZoom:true});
      const ocmFiles = new Map(), ocmLoading = new Set();
      function renderOcm() {
        if (!ocmToggle.checked) return;
        const bounds = map.getBounds(), seen = new Set(), markers = [];
        for (const features of ocmFiles.values()) for (const f of features) {
          const [lng,lat] = f.geometry.coordinates;
          if (!bounds.contains([lat,lng])) continue;
          const p = f.properties || {};
          const key = p.osm_id != null ? `${p.type || ''}:${p.osm_id}` : `${lng},${lat},${p.name || ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          markers.push(L.marker([lat,lng],{icon:icon('#d18b21','C'),title:String(p.name || 'Community campsite')})
            .bindPopup(`<strong>${esc(p.name || 'Community campsite')}</strong><br><small>OpenStreetMap / OpenCampingMap snapshot. Confirm access, fees and suitability.</small>`));
        }
        ocmCluster.clearLayers();
        ocmCluster.addLayers(markers);
        map.addLayer(ocmCluster);
      }
      async function refreshOcm() {
        if (!ocmToggle.checked) { map.removeLayer(ocmCluster); return; }
        const codes = window.KampTrailData?.getVisibleStates?.(map) || window.KampTrailData?.getLoadedStates?.() || [];
        const missing = codes.filter(code => /^[A-Z]{2}$/.test(code) && !ocmFiles.has(code) && !ocmLoading.has(code));
        for (let offset = 0; offset < missing.length && ocmToggle.checked; offset += 4) {
          await Promise.all(missing.slice(offset,offset+4).map(async code => {
            ocmLoading.add(code);
            try { ocmFiles.set(code,await loadJSON(`data/opencampingmap/${code}.geojson`)); }
            catch (err) { console.warn(`Community campsites for ${code}: ${err.message}`); toast(`Community sites for ${code} could not load. Toggle the layer to retry.`, 'error'); }
            finally { ocmLoading.delete(code); }
          }));
          renderOcm();
        }
        renderOcm();
      }
      ocmToggle.addEventListener('change',refreshOcm);
      window.addEventListener('kamptrail:dataupdated', () => { if (ocmToggle.checked) refreshOcm(); });

      const towers = L.markerClusterGroup({chunkedLoading:true,maxClusterRadius:40});
      const towerAreas = new Set(), towerIds = new Set();
      let towerBusy = false;
      if (!cfg.openCelliDKey) {
        towersToggle.disabled = true;
        towersToggle.parentElement.title = 'A valid OpenCelliD provider key is required. Tower locations are not coverage predictions.';
      }
      async function refreshTowers() {
        if (!towersToggle.checked) { map.removeLayer(towers); return; }
        map.addLayer(towers);
        if (map.getZoom() < 10) { toast('Zoom to level 10 or closer to request cell towers. Tower locations do not show coverage.'); return; }
        if (towerBusy || !cfg.openCelliDKey) return;
        const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
        const area = [sw.lat,sw.lng,ne.lat,ne.lng].map(x=>x.toFixed(3)).join(',');
        if (towerAreas.has(area)) return;
        towerBusy = true;
        try {
          const url = new URL('https://www.opencellid.org/cell/getInArea');
          url.search = new URLSearchParams({key:cfg.openCelliDKey,BBOX:area,format:'json',limit:String(cfg.maxTowerCount)});
          const response = await fetch(url,{signal:AbortSignal.timeout(15000)});
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (!Array.isArray(data.cells)) throw new Error('Invalid provider response');
          towerAreas.add(area);
          const markers = [];
          data.cells.forEach(cell=>{
            const lat=Number(cell.lat),lng=Number(cell.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat)>90 || Math.abs(lng)>180) return;
            const id = [cell.mcc,cell.mnc,cell.lac,cell.cellid,lat,lng].join(':');
            if (towerIds.has(id)) return;
            towerIds.add(id);
            markers.push(L.marker([lat,lng],{icon:icon('#7195e0','T')}).bindPopup(`<strong>${esc(cell.radio || 'Unknown')} cell tower</strong><br>MCC / MNC: ${esc(cell.mcc)} / ${esc(cell.mnc)}<br><small>A tower location does not confirm carrier service at a campsite.</small>`));
          });
          towers.addLayers(markers);
          if (data.cells.length >= cfg.maxTowerCount) toast('Tower results were limited. Zoom in for a smaller area.');
        } catch (err) { toast(`Cell tower data unavailable (${err.message}).`, 'error'); }
        finally { towerBusy=false; }
      }
      towersToggle.addEventListener('change',refreshTowers);
      let timer;
      map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(()=>{refreshOcm();refreshTowers();},350);});
    }
  };
})();
