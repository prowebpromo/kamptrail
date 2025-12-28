// overlays/overlays.js
(function () {
  function tileLayerOrNull(url, opts) {
    if (!url) return null;
    return L.tileLayer(url, Object.assign({ opacity: 0.5, maxZoom: 19 }, opts || {}));
  }
  function loadGeoJSON(url) {
    return fetch(url).then(r => { if (!r.ok) throw new Error('Load failed: ' + url); return r.json(); });
  }
  function withinBounds(feature, bounds) {
    const [lng, lat] = feature.geometry.type === 'Point'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates[0][0][0], feature.geometry.coordinates[0][0][1]];
    return bounds.contains([lat, lng]);
  }
  function icon(color, glyph) {
    return L.divIcon({
      className: 'kt-poi',
      html: `<div style="background:${color};color:#fff;border-radius:50%;width:20px;height:20px;display:grid;place-items:center;font-size:12px;">${glyph||''}</div>`,
      iconSize: [20,20],
      iconAnchor: [10,10]
    });
  }
  const poiIcon = {
    dump: icon('#6c5ce7','D'),
    water: icon('#00b894','W'),
    propane: icon('#e17055','P')
  };
  window.KampTrailOverlays = {
    init(map, config) {
      const cfg = Object.assign({
        publicLandsUrl: '',
        cellCoverageUrl: '',
        poiUrl: '/data/poi_dump_water_propane.geojson',
        placesUrl: '/data/sample_places.geojson',
        maxPoiCount: 2000
      }, config || {});
      const controls = L.DomUtil.create('div', 'kt-controls');
      controls.innerHTML = `
        <label><input id="kt-toggle-lands" type="checkbox"> Public lands <span class="kt-badge">overlay</span></label>
        <label><input id="kt-toggle-cell" type="checkbox"> Cell coverage <span class="kt-badge">overlay</span></label>
        <label><input id="kt-toggle-poi" type="checkbox" checked> Dump/Water/Propane <span class="kt-badge">POIs</span></label>
      `;
      map._container.appendChild(controls);
      L.DomEvent.disableClickPropagation(controls);
      const legend = L.DomUtil.create('div', 'kt-legend');
      legend.innerHTML = `
        <strong>Legend</strong><br>
        <span class="kt-badge">D</span> Dump&nbsp;&nbsp;
        <span class="kt-badge">W</span> Water&nbsp;&nbsp;
        <span class="kt-badge">P</span> Propane
      `;
      map._container.appendChild(legend);
      L.DomEvent.disableClickPropagation(legend);
      const publicLands = tileLayerOrNull(cfg.publicLandsUrl, { opacity: 0.45 });
      const cellCoverage = tileLayerOrNull(cfg.cellCoverageUrl, { opacity: 0.40 });
      const landsToggle = controls.querySelector('#kt-toggle-lands');
      const cellToggle = controls.querySelector('#kt-toggle-cell');
      const poiToggle = controls.querySelector('#kt-toggle-poi');
      landsToggle.addEventListener('change', () => {
        if (!publicLands) {
          window.showToast && window.showToast('Public lands overlay not configured', 'error', 3000);
          landsToggle.checked = false;
          return;
        }
        landsToggle.checked ? publicLands.addTo(map) : publicLands.remove();
      });
      cellToggle.addEventListener('change', () => {
        if (!cellCoverage) {
          window.showToast && window.showToast('Cell coverage overlay requires paid API - not configured', 'error', 3000);
          cellToggle.checked = false;
          return;
        }
        cellToggle.checked ? cellCoverage.addTo(map) : cellCoverage.remove();
      });
      const poiCluster = L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom: false });
      let poiAdded = false;
      function addPoisOnce(features) {
        if (poiAdded) return;
        const esc = window.escapeHtml || ((t) => t);
        features.slice(0, cfg.maxPoiCount).forEach(f => {
          const [lng, lat] = f.geometry.coordinates;
          const type = (f.properties.type || '').toLowerCase();
          const label = f.properties.name || type.toUpperCase();
          const safeLabel = esc(label);
          const safeType = esc(type);
          const m = L.marker([lat, lng], { icon: poiIcon[type] || icon('#0984e3','•'), title: safeLabel });
          m.bindPopup(`<strong>${safeLabel}</strong><br>${safeType}`);
          poiCluster.addLayer(m);
        });
        map.addLayer(poiCluster);
        poiAdded = true;
      }
      loadGeoJSON(cfg.poiUrl).then(gj => addPoisOnce(gj.features)).catch(()=>{});
      poiToggle.addEventListener('change', () => {
        if (poiToggle.checked) map.addLayer(poiCluster); else map.removeLayer(poiCluster);
      });
      let placesAll = null;
      const placesCluster = L.markerClusterGroup({ chunkedLoading: true, spiderfyOnMaxZoom:false });
      function refreshPlaces() {
        if (!placesAll) return;
        placesCluster.clearLayers();
        const b = map.getBounds();
        const subset = placesAll.features.filter(f => withinBounds(f, b));
        const esc = window.escapeHtml || ((t) => t);
        subset.forEach((f) => {
          const [lng, lat] = f.geometry.coordinates;
          const name = f.properties.name || 'Campsite';
          const type = f.properties.type || 'Free';
          const safeName = esc(name);
          const safeType = esc(type);
          const m = L.marker([lat, lng], { title: safeName });
          m.bindPopup(`<strong>${safeName}</strong><br>Type: ${safeType}`);
          placesCluster.addLayer(m);
        });
        if (!map.hasLayer(placesCluster)) map.addLayer(placesCluster);
      }
      loadGeoJSON(cfg.placesUrl).then(gj => { placesAll = gj; refreshPlaces(); }).catch(()=>{});
      map.on('moveend', () => { clearTimeout(map._ktPlaceTimer); map._ktPlaceTimer = setTimeout(refreshPlaces, 200); });
    }
  };
})();