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
        openCelliDKey: '',
        poiUrl: 'data/poi_dump_water_propane.geojson',
        placesUrl: 'data/sample_places.geojson',
        maxPoiCount: 10000,
        maxTowerCount: 500
      }, config || {});
      const controls = L.DomUtil.create('div', 'kt-controls');
      controls.innerHTML = `
        <label><input id="kt-toggle-lands" type="checkbox" checked> Public lands <span class="kt-badge">overlay</span></label>
        <label><input id="kt-toggle-towers" type="checkbox"> Cell towers <span class="kt-badge">OpenCelliD</span></label>
        <label><input id="kt-toggle-poi" type="checkbox" checked> Dump/Water/Propane <span class="kt-badge">POIs</span></label>
      `;
      map._container.appendChild(controls);
      L.DomEvent.disableClickPropagation(controls);
      const legend = L.DomUtil.create('div', 'kt-legend');
      legend.innerHTML = `
        <strong>Legend</strong><br>
        <span class="kt-badge">D</span> Dump&nbsp;&nbsp;
        <span class="kt-badge">W</span> Water&nbsp;&nbsp;
        <span class="kt-badge">P</span> Propane<br>
        <div style="margin-top:4px;font-size:11px;" id="kt-tower-legend" hidden>
          <span style="color:#e74c3c;">●</span> GSM&nbsp;
          <span style="color:#3498db;">●</span> UMTS&nbsp;
          <span style="color:#2ecc71;">●</span> LTE&nbsp;
          <span style="color:#9b59b6;">●</span> 5G
        </div>
      `;
      map._container.appendChild(legend);
      L.DomEvent.disableClickPropagation(legend);
      const publicLands = tileLayerOrNull(cfg.publicLandsUrl, { opacity: 0.45 });
      const landsToggle = controls.querySelector('#kt-toggle-lands');
      const towersToggle = controls.querySelector('#kt-toggle-towers');
      const poiToggle = controls.querySelector('#kt-toggle-poi');
      const towerLegend = document.getElementById('kt-tower-legend');
      landsToggle.addEventListener('change', () => {
        if (!publicLands) {
          window.showToast && window.showToast('Public lands overlay not configured', 'error', 3000);
          landsToggle.checked = false;
          return;
        }
        landsToggle.checked ? publicLands.addTo(map) : publicLands.remove();
      });
      // Initialize public lands if checkbox is checked on page load
      if (landsToggle.checked && publicLands) {
        publicLands.addTo(map);
      }

      // Cell Tower Overlay (OpenCelliD)
      const towerColors = {
        'GSM': '#e74c3c',
        'UMTS': '#3498db',
        'LTE': '#2ecc71',
        'NR': '#9b59b6',  // 5G
        'CDMA': '#e67e22'
      };
      function towerIcon(radio) {
        const color = towerColors[radio] || '#95a5a6';
        return L.divIcon({
          className: 'kt-tower',
          html: `<div style="background:${color};border:2px solid #fff;border-radius:50%;width:10px;height:10px;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5]
        });
      }
      const towerCluster = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 40
      });
      const towerCache = new Map();
      let towersEnabled = false;

      function fetchCellTowers() {
        if (!towersEnabled || !cfg.openCelliDKey) return;
        const zoom = map.getZoom();
        if (zoom < 8) {
          if (towerCluster.getLayers().length === 0) {
            window.showToast && window.showToast('Zoom in closer to view cell towers', 'info', 3000);
          }
          return;
        }
        const bounds = map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const bbox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;
        const cacheKey = `${Math.floor(sw.lat*100)}_${Math.floor(sw.lng*100)}_${Math.floor(ne.lat*100)}_${Math.floor(ne.lng*100)}`;

        if (towerCache.has(cacheKey)) {
          return;
        }

        const url = `https://www.opencellid.org/cell/getInArea?key=${encodeURIComponent(cfg.openCelliDKey)}&BBOX=${bbox}&format=json&limit=${cfg.maxTowerCount}`;

        fetch(url)
          .then(r => {
            if (!r.ok) throw new Error(`API error: ${r.status}`);
            return r.json();
          })
          .then(data => {
            if (!data || !data.cells || data.cells.length === 0) {
              return;
            }
            towerCache.set(cacheKey, true);
            const esc = window.escapeHtml || ((t) => t);
            data.cells.forEach(cell => {
              const lat = parseFloat(cell.lat);
              const lon = parseFloat(cell.lon);
              if (isNaN(lat) || isNaN(lon)) return;

              const radio = cell.radio || 'Unknown';
              const mcc = cell.mcc || '?';
              const mnc = cell.mnc || '?';
              const range = cell.range ? Math.round(cell.range) + 'm' : 'Unknown';
              const samples = cell.samples || 0;

              const m = L.marker([lat, lon], {
                icon: towerIcon(radio),
                title: `${radio} Tower`
              });

              const popup = `
                <div style="min-width:150px;">
                  <strong>${esc(radio)} Cell Tower</strong><br>
                  <small>
                    MCC/MNC: ${esc(String(mcc))}/${esc(String(mnc))}<br>
                    Range: ${esc(range)}<br>
                    Samples: ${esc(String(samples))}
                  </small>
                </div>
              `;
              m.bindPopup(popup);
              towerCluster.addLayer(m);
            });

            if (data.cells.length >= cfg.maxTowerCount) {
              window.showToast && window.showToast(`Showing ${cfg.maxTowerCount} nearest towers. Zoom in for more detail.`, 'info', 4000);
            }
          })
          .catch(err => {
            console.error('OpenCelliD error:', err);
            if (err.message.includes('403')) {
              window.showToast && window.showToast('OpenCelliD API key invalid or not authorized', 'error', 5000);
            } else {
              window.showToast && window.showToast('Failed to load cell towers', 'error', 3000);
            }
          });
      }

      towersToggle.addEventListener('change', () => {
        if (!cfg.openCelliDKey) {
          window.showToast && window.showToast('OpenCelliD API key required. Get free key at opencellid.org', 'error', 5000);
          towersToggle.checked = false;
          return;
        }
        towersEnabled = towersToggle.checked;
        if (towersEnabled) {
          map.addLayer(towerCluster);
          towerLegend.hidden = false;
          fetchCellTowers();
        } else {
          map.removeLayer(towerCluster);
          towerLegend.hidden = true;
        }
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
      map.on('moveend', () => {
        clearTimeout(map._ktPlaceTimer);
        map._ktPlaceTimer = setTimeout(refreshPlaces, 200);
        clearTimeout(map._ktTowerTimer);
        map._ktTowerTimer = setTimeout(fetchCellTowers, 300);
      });
    }
  };
})();