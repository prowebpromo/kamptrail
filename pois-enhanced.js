/**
 * KampTrail Enhanced POI Module
 * Fetches and displays nearby points of interest (gas, water, food, etc.)
 */
(function () {
  'use strict';

  const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
  const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
  const SEARCH_RADIUS = 25000; // 25km in meters

  const POI_TYPES = {
    gas: { icon: '⛽', color: '#e17055', query: 'node["amenity"="fuel"]' },
    grocery: { icon: '🛒', color: '#00b894', query: 'node["shop"="supermarket"]' },
    hospital: { icon: '🏥', color: '#ff6b6b', query: 'node["amenity"="hospital"]' },
    pharmacy: { icon: '💊', color: '#6c5ce7', query: 'node["amenity"="pharmacy"]' },
    restaurant: { icon: '🍴', color: '#fdcb6e', query: 'node["amenity"="restaurant"]' },
    atm: { icon: '💳', color: '#74b9ff', query: 'node["amenity"="atm"]' },
    water: { icon: '💧', color: '#0984e3', query: 'node["amenity"="drinking_water"]' },
    camping: { icon: '⛺', color: '#55efc4', query: 'node["tourism"="camp_site"]' }
  };

  const state = {
    map: null,
    markers: {},
    cache: new Map(),
    activeTypes: new Set(['gas', 'grocery', 'hospital']),
    panel: null
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
   * Fetch POIs from Overpass API
   */
  async function fetchPOIs(lat, lng, types) {
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${types.join(',')}`;
    const cached = state.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      // Build Overpass query
      const queries = types.map(type => POI_TYPES[type]?.query).filter(Boolean);
      if (queries.length === 0) return [];

      const query = `
        [out:json][timeout:10];
        (
          ${queries.map(q => `${q}(around:${SEARCH_RADIUS},${lat},${lng});`).join('\n')}
        );
        out body 100;
      `;

      const response = await fetch(OVERPASS_API, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`
      });

      if (!response.ok) throw new Error('Overpass API failed');

      const data = await response.json();
      const pois = data.elements || [];

      // Cache the result
      state.cache.set(cacheKey, {
        data: pois,
        timestamp: Date.now()
      });

      return pois;
    } catch (err) {
      console.error('POI fetch failed:', err);
      return [];
    }
  }

  /**
   * Get POI type from tags
   */
  function getPOIType(tags) {
    if (tags.amenity === 'fuel') return 'gas';
    if (tags.shop === 'supermarket') return 'grocery';
    if (tags.amenity === 'hospital') return 'hospital';
    if (tags.amenity === 'pharmacy') return 'pharmacy';
    if (tags.amenity === 'restaurant') return 'restaurant';
    if (tags.amenity === 'atm') return 'atm';
    if (tags.amenity === 'drinking_water') return 'water';
    if (tags.tourism === 'camp_site') return 'camping';
    return 'other';
  }

  /**
   * Create POI marker icon
   */
  function createPOIIcon(type) {
    const config = POI_TYPES[type] || { icon: '📍', color: '#95a5a6' };
    return L.divIcon({
      html: `<div style="background:${config.color};color:#fff;border-radius:50%;width:24px;height:24px;display:grid;place-items:center;font-size:14px;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);">${config.icon}</div>`,
      className: 'poi-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  /**
   * Add POI markers to map
   */
  function addPOIMarkers(pois) {
    // Clear existing markers
    Object.values(state.markers).forEach(marker => marker.remove());
    state.markers = {};

    pois.forEach(poi => {
      if (!poi.lat || !poi.lon) return;

      const type = getPOIType(poi.tags || {});
      if (!state.activeTypes.has(type)) return;

      const name = poi.tags?.name || poi.tags?.brand || `${type} POI`;
      const marker = L.marker([poi.lat, poi.lon], {
        icon: createPOIIcon(type)
      });

      const config = POI_TYPES[type];
      marker.bindPopup(`
        <div style="min-width:150px;">
          <div style="font-size:14px;font-weight:bold;margin-bottom:6px;">${config.icon} ${name}</div>
          <div style="font-size:12px;color:#666;">Type: ${type}</div>
          ${poi.tags?.['addr:street'] ? `<div style="font-size:11px;color:#888;margin-top:4px;">${poi.tags['addr:street']}</div>` : ''}
          <button onclick="window.open('https://maps.google.com/?q=${poi.lat},${poi.lon}')" style="width:100%;margin-top:8px;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Navigate
          </button>
        </div>
      `);

      marker.addTo(state.map);
      state.markers[poi.id] = marker;
    });
  }

  /**
   * Get nearby POIs for a location and return HTML
   */
  async function getNearbyPOIsHTML(lat, lng) {
    const types = Array.from(state.activeTypes);
    const pois = await fetchPOIs(lat, lng, types);

    if (pois.length === 0) {
      return '<div style="padding:8px;color:#999;font-size:12px">No nearby POIs found</div>';
    }

    // Calculate distances and sort
    const poisWithDistance = pois.map(poi => ({
      ...poi,
      distance: calculateDistance(lat, lng, poi.lat, poi.lon),
      type: getPOIType(poi.tags || {})
    })).sort((a, b) => a.distance - b.distance);

    // Group by type
    const byType = {};
    poisWithDistance.forEach(poi => {
      if (!byType[poi.type]) byType[poi.type] = [];
      byType[poi.type].push(poi);
    });

    let html = '<div style="border-top:1px solid rgba(255,255,255,.1);margin-top:8px;padding-top:8px">';
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:6px">📍 Nearby POIs</div>';

    Object.entries(byType).forEach(([type, items]) => {
      if (items.length === 0) return;

      const config = POI_TYPES[type];
      const nearest = items[0];
      const name = nearest.tags?.name || nearest.tags?.brand || type;

      html += `
        <div style="font-size:11px;padding:4px 0;display:flex;align-items:center;gap:6px;">
          <span style="font-size:14px">${config.icon}</span>
          <span style="flex:1">${name}</span>
          <span style="color:#9fd0ff">${nearest.distance.toFixed(1)} km</span>
        </div>
      `;
    });

    html += '</div>';
    return html;
  }

  /**
   * Create POI control panel
   */
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'poi-panel';
    panel.style.cssText = `
      position: fixed;
      top: 70px;
      left: 12px;
      width: 280px;
      max-height: calc(100vh - 180px);
      background: var(--c-panel, #0f1b24);
      border: 1px solid var(--c-border, #22313f);
      border-radius: 12px;
      padding: 16px;
      display: none;
      z-index: 1001;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
    `;

    let checkboxHTML = '';
    Object.entries(POI_TYPES).forEach(([key, config]) => {
      const checked = state.activeTypes.has(key) ? 'checked' : '';
      checkboxHTML += `
        <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-radius:6px;transition:background .2s;">
          <input type="checkbox" value="${key}" ${checked} style="cursor:pointer;">
          <span style="font-size:16px">${config.icon}</span>
          <span style="flex:1;font-size:13px;text-transform:capitalize;">${key}</span>
        </label>
      `;
    });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:15px">📍 POI Settings</h3>
        <button id="close-poi-panel" style="background:none;border:none;color:var(--c-text);cursor:pointer;font-size:20px;padding:0;line-height:1">&times;</button>
      </div>

      <div style="margin-bottom:12px;padding:10px;background:rgba(134,183,255,.1);border-radius:8px;font-size:12px;line-height:1.4">
        Select POI types to display on the map
      </div>

      <div id="poi-checkboxes" style="display:flex;flex-direction:column;gap:4px">
        ${checkboxHTML}
      </div>

      <div style="margin-top:12px">
        <button id="load-nearby-pois" class="btn" style="width:100%">Load Nearby POIs</button>
      </div>
    `;

    document.body.appendChild(panel);
    state.panel = panel;

    // Event listeners
    panel.querySelector('#close-poi-panel').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    panel.querySelectorAll('#poi-checkboxes input').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const type = e.target.value;
        if (e.target.checked) {
          state.activeTypes.add(type);
        } else {
          state.activeTypes.delete(type);
        }

        // Re-filter markers
        Object.entries(state.markers).forEach(([id, marker]) => {
          const type = getPOIType(marker.options.tags || {});
          if (state.activeTypes.has(type)) {
            marker.addTo(state.map);
          } else {
            marker.remove();
          }
        });
      });
    });

    panel.querySelector('#load-nearby-pois').addEventListener('click', async () => {
      const center = state.map.getCenter();
      const types = Array.from(state.activeTypes);

      showToast && showToast('Loading nearby POIs...', 'info', 2000);

      const pois = await fetchPOIs(center.lat, center.lng, types);
      addPOIMarkers(pois);

      showToast && showToast(`Loaded ${pois.length} POIs`, 'success');
    });

    return panel;
  }

  /**
   * Toggle panel visibility
   */
  function togglePanel() {
    if (!state.panel) createPanel();
    const isVisible = state.panel.style.display !== 'none';
    state.panel.style.display = isVisible ? 'none' : 'block';
  }

  /**
   * Initialize POI module
   */
  function init(mapInstance) {
    state.map = mapInstance;

    // Create panel
    createPanel();

    // Add button to header
    const header = document.querySelector('header .actions');
    if (header) {
      const btn = document.createElement('button');
      btn.id = 'poi-btn';
      btn.className = 'btn';
      btn.innerHTML = '📍 POIs';
      btn.setAttribute('aria-label', 'Points of interest');
      btn.addEventListener('click', togglePanel);

      // Insert after filters button
      const filtersBtn = document.getElementById('filters');
      if (filtersBtn) {
        header.insertBefore(btn, filtersBtn.nextSibling);
      } else {
        header.appendChild(btn);
      }
    }

    console.log('[Enhanced POIs] Initialized');
  }

  // Export
  window.KampTrailPOI = {
    init,
    togglePanel,
    getNearbyPOIsHTML,
    fetchPOIs
  };
})();
