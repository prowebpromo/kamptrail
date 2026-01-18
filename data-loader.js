/* data-loader.js - Simplified for OpenCampingMap */

(function() {
  'use strict';

  const state = {
    allCampsites: [],
    clusterGroup: null,
    config: {},
    userLocation: null
  };

  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in miles
  }

  function formatDistance(miles) {
    if (miles < 1) {
      return `${(miles * 5280).toFixed(0)} ft`;
    } else if (miles < 10) {
      return `${miles.toFixed(1)} mi`;
    } else {
      return `${miles.toFixed(0)} mi`;
    }
  }

  function applyFilters(sites, filters) {
    if (!filters) return sites;

    return sites.filter(site => {
      const p = site.properties;
      if (!p) return false;

      // Search text filter
      if (filters.searchText && filters.searchText.trim()) {
        const searchLower = filters.searchText.toLowerCase();
        const name = (p.name || '').toLowerCase();
        if (!name.includes(searchLower)) return false;
      }

      if (filters.cost === 'free' && (p.cost === null || p.cost > 0)) return false;
      if (filters.cost === 'paid' && (p.cost === null || p.cost === 0)) return false;
      if (filters.type !== 'all' && p.type !== filters.type) return false;

      return true;
    });
  }

  function createMarkerIcon(site) {
    const props = site.properties;
    const isFree = props.cost === 0 || props.cost === null;
    const color = isFree ? '#4CAF50' : '#2196F3';
    
    return L.divIcon({
      html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
      className: 'custom-marker',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  }

  function createPopup(site) {
    const p = site.properties;
    const costText = p.cost === 0 || p.cost === null ? 'FREE' : `$${p.cost}/night`;

    let distanceHtml = '';
    if (state.userLocation) {
      const [lng, lat] = site.geometry.coordinates;
      const distance = calculateDistance(state.userLocation.lat, state.userLocation.lng, lat, lng);
      distanceHtml = `<div><strong>Distance:</strong> ${formatDistance(distance)}</div>`;
    }

    return `
      <div style="min-width:200px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">${p.name || 'Unnamed Site'}</h3>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">
          ${distanceHtml}
          <div><strong>Cost:</strong> ${costText}</div>
          <div><strong>Type:</strong> ${p.type || 'Unknown'}</div>
        </div>
        ${p.amenities && p.amenities.length ? `
          <div style="font-size:11px;color:#888;margin-bottom:8px;">
            ${p.amenities.join(' • ')}
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button onclick="KampTrailData.addToTrip('${p.id}')" style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Add to Trip
          </button>
          <button onclick="KampTrailData.shareCampsite('${p.id}')" style="flex:1;padding:4px 8px;background:#9b59b6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Share
          </button>
          <button onclick="window.open('https://maps.google.com/?q=${site.geometry.coordinates[1]},${site.geometry.coordinates[0]}')" style="flex:1;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Navigate
          </button>
        </div>
      </div>
    `;
  }

  function updateMarkers(map, filters, config) {
    if (!state.clusterGroup) return;

    const filtered = applyFilters(state.allCampsites, filters);
    console.log(`🔍 Filtered: ${filtered.length} of ${state.allCampsites.length} sites`);

    state.clusterGroup.clearLayers();

    filtered.forEach(site => {
      const [lng, lat] = site.geometry.coordinates;
      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(site)
      });
      
      marker.bindPopup(createPopup(site));
      state.clusterGroup.addLayer(marker);
    });
  }

  window.KampTrailData = {
    async init(map, config = {}) {
      state.config = config;
      state.config._map = map;
      console.log('🚀 Initializing KampTrail Data Loader...');

      state.clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
      });
      map.addLayer(state.clusterGroup);

      try {
        const response = await fetch('data/opencampingmap.geojson');
        if (!response.ok) throw new Error('Failed to load campsite data');
        const geojson = await response.json();
        state.allCampsites = geojson.features || [];
        console.log(`✅ Loaded ${state.allCampsites.length} campsites`);
      } catch (err) {
        console.error('Data loading error:', err);
        return;
      }

      updateMarkers(map, this.getDefaultFilters(), state.config);
    },

    getDefaultFilters() {
      return {
        cost: 'all',
        type: 'all',
        searchText: ''
      };
    },

    getCurrentFilters() {
      return window.kamptrailFilters || this.getDefaultFilters();
    },

    updateFilters(filters, map) {
      window.kamptrailFilters = filters;
      updateMarkers(map, filters, state.config);
    },

    getCampsiteById(id) {
      return state.allCampsites.find(s => s.properties.id === id);
    },

    addToTrip(id) {
      console.log('Adding to trip:', id);
      if (state.config.onTripAdd) state.config.onTripAdd(id);
    },

    setUserLocation(lat, lng) {
      state.userLocation = { lat, lng };
      console.log(`📍 User location set: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      updateMarkers(state.config._map || window.map, this.getCurrentFilters(), state.config);
    },

    async shareCampsite(id) {
        const site = this.getCampsiteById(id);
        if (!site) return;
        const p = site.properties;
        const [lng, lat] = site.geometry.coordinates;
        const text = `Check out this campsite: ${p.name || 'Unnamed'}`;
        try {
            await navigator.share({ title: p.name, text, url: window.location.href });
        } catch (err) {
            console.error('Share failed:', err);
        }
    }
  };
})();
