/* data-loader.js - FIXED VERSION - Forces initial data load */

(function() {
  'use strict';

  const state = {
    allCampsites: [],
    loadedStates: new Set(),
    loading: new Set(),
    index: null,
    clusterGroup: null,
    config: {}
  };

  const STATE_BOUNDS = {
    'AL': { s: 30.2, w: -88.5, n: 35.0, e: -84.9 },
    'AK': { s: 51.2, w: -179.1, n: 71.4, e: -129.9 },
    'AZ': { s: 31.3, w: -114.8, n: 37.0, e: -109.0 },
    'AR': { s: 33.0, w: -94.6, n: 36.5, e: -89.6 },
    'CA': { s: 32.5, w: -124.4, n: 42.0, e: -114.1 },
    'CO': { s: 37.0, w: -109.1, n: 41.0, e: -102.0 },
    'CT': { s: 41.0, w: -73.7, n: 42.1, e: -71.8 },
    'DE': { s: 38.5, w: -75.8, n: 39.8, e: -75.0 },
    'FL': { s: 24.5, w: -87.6, n: 31.0, e: -79.9 },
    'GA': { s: 30.4, w: -85.6, n: 35.0, e: -80.8 },
    'HI': { s: 18.9, w: -160.2, n: 22.2, e: -154.8 },
    'ID': { s: 42.0, w: -117.2, n: 49.0, e: -111.0 },
    'IL': { s: 37.0, w: -91.5, n: 42.5, e: -87.5 },
    'IN': { s: 37.8, w: -88.1, n: 41.8, e: -84.8 },
    'IA': { s: 40.4, w: -96.6, n: 43.5, e: -90.1 },
    'KS': { s: 37.0, w: -102.1, n: 40.0, e: -94.6 },
    'KY': { s: 36.5, w: -89.6, n: 39.1, e: -81.9 },
    'LA': { s: 29.0, w: -94.0, n: 33.0, e: -89.0 },
    'ME': { s: 43.1, w: -71.1, n: 47.5, e: -66.9 },
    'MD': { s: 37.9, w: -79.5, n: 39.7, e: -75.0 },
    'MA': { s: 41.2, w: -73.5, n: 42.9, e: -69.9 },
    'MI': { s: 41.7, w: -90.4, n: 48.3, e: -82.4 },
    'MN': { s: 43.5, w: -97.2, n: 49.4, e: -89.5 },
    'MS': { s: 30.2, w: -91.7, n: 35.0, e: -88.1 },
    'MO': { s: 36.0, w: -95.8, n: 40.6, e: -89.1 },
    'MT': { s: 45.0, w: -116.1, n: 49.0, e: -104.0 },
    'NE': { s: 40.0, w: -104.1, n: 43.0, e: -95.3 },
    'NV': { s: 35.0, w: -120.0, n: 42.0, e: -114.0 },
    'NH': { s: 42.7, w: -72.6, n: 45.3, e: -70.6 },
    'NJ': { s: 38.9, w: -75.6, n: 41.4, e: -73.9 },
    'NM': { s: 31.3, w: -109.1, n: 37.0, e: -103.0 },
    'NY': { s: 40.5, w: -79.8, n: 45.0, e: -71.9 },
    'NC': { s: 33.8, w: -84.3, n: 36.6, e: -75.5 },
    'ND': { s: 45.9, w: -104.1, n: 49.0, e: -96.6 },
    'OH': { s: 38.4, w: -84.8, n: 42.3, e: -80.5 },
    'OK': { s: 33.6, w: -103.0, n: 37.0, e: -94.4 },
    'OR': { s: 42.0, w: -124.6, n: 46.3, e: -116.5 },
    'PA': { s: 39.7, w: -80.5, n: 42.3, e: -74.7 },
    'RI': { s: 41.1, w: -71.9, n: 42.0, e: -71.1 },
    'SC': { s: 32.0, w: -83.4, n: 35.2, e: -78.5 },
    'SD': { s: 42.5, w: -104.1, n: 45.9, e: -96.4 },
    'TN': { s: 35.0, w: -90.3, n: 36.7, e: -81.6 },
    'TX': { s: 25.8, w: -106.6, n: 36.5, e: -93.5 },
    'UT': { s: 37.0, w: -114.1, n: 42.0, e: -109.0 },
    'VT': { s: 42.7, w: -73.4, n: 45.0, e: -71.5 },
    'VA': { s: 36.5, w: -83.7, n: 39.5, e: -75.2 },
    'WA': { s: 45.5, w: -124.8, n: 49.0, e: -116.9 },
    'WV': { s: 37.2, w: -82.6, n: 40.6, e: -77.7 },
    'WI': { s: 42.5, w: -92.9, n: 47.1, e: -86.2 },
    'WY': { s: 41.0, w: -111.1, n: 45.0, e: -104.1 }
  };

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function boundsIntersect(b1, b2) {
    return !(b1.e < b2.w || b1.w > b2.e || b1.n < b2.s || b1.s > b2.n);
  }

  function getVisibleStates(map) {
    const bounds = map.getBounds();
    const viewport = {
      s: bounds.getSouth(),
      w: bounds.getWest(),
      n: bounds.getNorth(),
      e: bounds.getEast()
    };

    const visible = [];
    for (const [stateCode, bbox] of Object.entries(STATE_BOUNDS)) {
      if (boundsIntersect(viewport, bbox)) {
        visible.push(stateCode);
      }
    }
    
    console.log(`🗺️ Viewport: lat ${viewport.s.toFixed(2)} to ${viewport.n.toFixed(2)}, lng ${viewport.w.toFixed(2)} to ${viewport.e.toFixed(2)}`);
    console.log(`🗺️ Visible states detected: ${visible.join(', ') || 'NONE'}`);
    
    return visible;
  }

  async function loadIndex() {
    try {
      const response = await fetch('data/campsites/index.json');
      if (!response.ok) {
        throw new Error(`Failed to load index: HTTP ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error('Index file is empty');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Invalid JSON in index file: ${parseErr.message}`);
      }

      if (!data || typeof data !== 'object') {
        throw new Error('Index data is not a valid object');
      }

      state.index = data;
      console.log('📊 Loaded campsite index:', data.total_sites || 'unknown', 'sites');
      return state.index;
    } catch (err) {
      console.error('⚠️ Could not load campsite index:', err.message);
      return null;
    }
  }

  async function loadStateData(stateCode, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    if (!stateCode || typeof stateCode !== 'string') {
      console.error('⚠️ Invalid state code:', stateCode);
      return [];
    }

    if (state.loadedStates.has(stateCode) || state.loading.has(stateCode)) {
      return [];
    }

    state.loading.add(stateCode);
    console.log(`📥 Loading ${stateCode} campsites...`);

    try {
      const response = await fetch(`data/campsites/${stateCode}.geojson`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`No campsite data available for ${stateCode}`);
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const text = await response.text();
      if (!text || text.trim() === '') {
        throw new Error(`Empty GeoJSON file for ${stateCode}`);
      }

      let geojson;
      try {
        geojson = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Invalid JSON for ${stateCode}: ${parseErr.message}`);
      }

      if (!geojson || typeof geojson !== 'object') {
        throw new Error(`Invalid GeoJSON structure for ${stateCode}`);
      }

      const features = geojson.features;
      if (!Array.isArray(features)) {
        console.warn(`⚠️ No features array in ${stateCode} GeoJSON, using empty array`);
        state.loadedStates.add(stateCode);
        return [];
      }

      // Validate and filter sites with proper coordinates
      const validSites = features.filter((site, idx) => {
        if (!site || typeof site !== 'object') {
          console.warn(`⚠️ Invalid site object at index ${idx} in ${stateCode}`);
          return false;
        }

        if (!site.geometry || !Array.isArray(site.geometry.coordinates)) {
          console.warn(`⚠️ Missing or invalid coordinates at index ${idx} in ${stateCode}`);
          return false;
        }

        const [lng, lat] = site.geometry.coordinates;
        if (typeof lat !== 'number' || typeof lng !== 'number' ||
            isNaN(lat) || isNaN(lng) ||
            lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          console.warn(`⚠️ Invalid coordinates [${lng}, ${lat}] at index ${idx} in ${stateCode}`);
          return false;
        }

        if (!site.properties || typeof site.properties !== 'object') {
          console.warn(`⚠️ Missing properties at index ${idx} in ${stateCode}`);
          return false;
        }

        return true;
      });

      const invalidCount = features.length - validSites.length;
      if (invalidCount > 0) {
        console.warn(`⚠️ Filtered out ${invalidCount} invalid sites from ${stateCode}`);
      }

      state.allCampsites.push(...validSites);
      state.loadedStates.add(stateCode);

      console.log(`✅ Loaded ${validSites.length} sites from ${stateCode} (Total: ${state.allCampsites.length})`);

      return validSites;
    } catch (err) {
      console.error(`⚠️ Could not load ${stateCode}:`, err.message);

      // Retry on network errors
      if (retryCount < MAX_RETRIES && (
          err.message.includes('fetch') ||
          err.message.includes('network') ||
          err.message.includes('HTTP 5')
      )) {
        console.log(`🔄 Retrying ${stateCode} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
        return loadStateData(stateCode, retryCount + 1);
      }

      return [];
    } finally {
      state.loading.delete(stateCode);
    }
  }

  function applyFilters(sites, filters) {
    if (!Array.isArray(sites)) {
      console.error('⚠️ applyFilters: sites parameter must be an array');
      return [];
    }

    if (!filters || typeof filters !== 'object') {
      return sites;
    }

    try {
      return sites.filter(site => {
        if (!site || typeof site !== 'object') {
          return false;
        }

        const p = site.properties;
        if (!p || typeof p !== 'object') {
          return false;
        }

        // Cost filter with validation
        if (filters.cost === 'free') {
          const cost = typeof p.cost === 'number' ? p.cost : null;
          if (cost === null || cost > 0) return false;
        }
        if (filters.cost === 'paid') {
          const cost = typeof p.cost === 'number' ? p.cost : null;
          if (cost === null || cost === 0) return false;
        }

        // Type filter
        if (filters.type && filters.type !== 'all' && p.type !== filters.type) {
          return false;
        }

        // Rig size filter with array validation
        if (filters.rigSize && filters.rigSize !== 'all') {
          const rigFriendly = Array.isArray(p.rig_friendly) ? p.rig_friendly : [];
          if (!rigFriendly.includes(filters.rigSize)) {
            return false;
          }
        }

        // Road difficulty filter
        if (filters.roadDifficulty && filters.roadDifficulty !== 'all' &&
            p.road_difficulty !== filters.roadDifficulty) {
          return false;
        }

        // Amenities filter with array validation
        if (filters.amenities && Array.isArray(filters.amenities) && filters.amenities.length > 0) {
          const siteAmenities = Array.isArray(p.amenities) ? p.amenities : [];
          const hasAll = filters.amenities.every(a => siteAmenities.includes(a));
          if (!hasAll) {
            return false;
          }
        }

        // Rating filter with number validation
        if (filters.minRating && typeof filters.minRating === 'number' && filters.minRating > 0) {
          const rating = typeof p.rating === 'number' ? p.rating : 0;
          if (rating < filters.minRating) {
            return false;
          }
        }

        return true;
      });
    } catch (err) {
      console.error('⚠️ Error applying filters:', err.message);
      return sites;
    }
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
    try {
      if (!site || typeof site !== 'object') {
        console.error('⚠️ Invalid site object in createPopup');
        return '<div>Error: Invalid campsite data</div>';
      }

      const p = site.properties;
      if (!p || typeof p !== 'object') {
        console.error('⚠️ Missing properties in createPopup');
        return '<div>Error: Missing campsite properties</div>';
      }

      // Validate coordinates
      if (!site.geometry || !Array.isArray(site.geometry.coordinates) ||
          site.geometry.coordinates.length < 2) {
        console.error('⚠️ Invalid coordinates in createPopup');
      }

      const [lng, lat] = site.geometry.coordinates || [0, 0];
      if (typeof lat !== 'number' || typeof lng !== 'number' ||
          isNaN(lat) || isNaN(lng) ||
          lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.warn('⚠️ Invalid coordinate values in popup:', lat, lng);
      }

      const esc = window.escapeHtml || ((t) => String(t || '')); // Fallback with safety

      // Safely format cost
      const cost = typeof p.cost === 'number' ? p.cost : null;
      const costText = cost === 0 || cost === null ? 'FREE' : `$${cost}/night`;

      // Enhanced rating with review count
      let ratingText = 'No ratings';
      if (p.rating && typeof p.rating === 'number') {
        const ratingVal = Math.max(0, Math.min(5, Math.round(p.rating))); // Clamp to 0-5
        const stars = '⭐'.repeat(ratingVal);
        const reviewCount = typeof p.reviews_count === 'number' ? p.reviews_count : 0;
        ratingText = reviewCount > 0 ? `${stars} (${reviewCount} reviews)` : stars;
      }

      const safeName = esc(p.name || 'Unnamed Site');
      const safeType = esc(p.type || 'Unknown');
      const safeRoadDiff = p.road_difficulty ? esc(p.road_difficulty) : '';
      const safeAmenities = Array.isArray(p.amenities) && p.amenities.length > 0
        ? p.amenities.map(a => esc(String(a))).join(' • ')
        : '';
      const safeId = esc(String(p.id || ''));

      // Rig-friendly info
      const rigFriendly = Array.isArray(p.rig_friendly) ? p.rig_friendly : [];
      const rigText = rigFriendly.length > 0
        ? rigFriendly.map(r => esc(String(r))).join(', ')
        : '';

      return `
        <div style="min-width:200px;">
          <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">${safeName}</h3>
          <div style="font-size:12px;color:#666;margin-bottom:8px;">
            <div><strong>Cost:</strong> ${costText}</div>
            <div><strong>Type:</strong> ${safeType}</div>
            ${safeRoadDiff ? `<div><strong>Road:</strong> ${safeRoadDiff}</div>` : ''}
            ${rigText ? `<div><strong>Suitable for:</strong> ${rigText}</div>` : ''}
            <div><strong>Rating:</strong> ${ratingText}</div>
          </div>
          ${safeAmenities ? `
            <div style="font-size:11px;color:#888;margin-bottom:8px;">
              ${safeAmenities}
            </div>
          ` : ''}
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button onclick="KampTrailData.addToTrip('${safeId}')" style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
              Add to Trip
            </button>
            <button onclick="KampTrailCompare.addToCompare('${safeId}')" style="flex:1;padding:4px 8px;background:#ff6b6b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
              Compare
            </button>
            <button onclick="window.open('https://maps.google.com/?q=${lat},${lng}')" style="flex:1;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
              Navigate
            </button>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('⚠️ Error creating popup:', err.message);
      return '<div>Error loading campsite details</div>';
    }
  }

  function updateMarkers(map, filters, config) {
    if (!state.clusterGroup) {
      console.warn('⚠️ Cluster group not initialized');
      return;
    }

    try {
      const filtered = applyFilters(state.allCampsites, filters);
      console.log(`🔍 Filtered: ${filtered.length} of ${state.allCampsites.length} sites`);

      state.clusterGroup.clearLayers();

      let addedCount = 0;
      let skippedCount = 0;

      filtered.forEach((site, idx) => {
        try {
          // Validate site structure
          if (!site || !site.geometry || !Array.isArray(site.geometry.coordinates)) {
            console.warn(`⚠️ Skipping site at index ${idx}: invalid geometry`);
            skippedCount++;
            return;
          }

          const [lng, lat] = site.geometry.coordinates;

          // Validate coordinates
          if (typeof lat !== 'number' || typeof lng !== 'number' ||
              isNaN(lat) || isNaN(lng) ||
              lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.warn(`⚠️ Skipping site at index ${idx}: invalid coordinates [${lng}, ${lat}]`);
            skippedCount++;
            return;
          }

          const marker = L.marker([lat, lng], {
            icon: createMarkerIcon(site)
          });

          marker.bindPopup(createPopup(site));
          state.clusterGroup.addLayer(marker);
          addedCount++;
        } catch (markerErr) {
          console.error(`⚠️ Error creating marker for site ${idx}:`, markerErr.message);
          skippedCount++;
        }
      });

      if (skippedCount > 0) {
        console.warn(`⚠️ Skipped ${skippedCount} invalid markers`);
      }

      if (config && typeof config.onFilterUpdate === 'function') {
        try {
          config.onFilterUpdate(addedCount, state.allCampsites.length);
        } catch (callbackErr) {
          console.error('⚠️ Error in onFilterUpdate callback:', callbackErr.message);
        }
      }
    } catch (err) {
      console.error('⚠️ Error updating markers:', err.message);
    }
  }

  async function refreshData(map, filters, config) {
    try {
      if (!map || typeof map.getBounds !== 'function') {
        console.error('⚠️ Invalid map object in refreshData');
        return;
      }

      const visibleStates = getVisibleStates(map);
      const newStates = visibleStates.filter(s => !state.loadedStates.has(s) && !state.loading.has(s));

      if (newStates.length > 0) {
        console.log('🔄 Loading new states:', newStates.join(', '));

        try {
          // Load all states in parallel, handle failures gracefully
          const results = await Promise.allSettled(newStates.map(s => loadStateData(s)));

          const fulfilled = results.filter(r => r.status === 'fulfilled').length;
          const rejected = results.filter(r => r.status === 'rejected').length;

          if (rejected > 0) {
            console.warn(`⚠️ Failed to load ${rejected} of ${newStates.length} states`);
          }

          if (fulfilled > 0) {
            updateMarkers(map, filters, config);
          }
        } catch (loadErr) {
          console.error('⚠️ Error loading state data:', loadErr.message);
        }
      }
    } catch (err) {
      console.error('⚠️ Error in refreshData:', err.message);
    }
  }

  window.KampTrailData = {
    async init(map, config = {}) {
      state.config = config;
      console.log('🚀 Initializing KampTrail Data Loader...');

      state.clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
          const count = cluster.getChildCount();
          let size = 'small';
          if (count > 50) size = 'large';
          else if (count > 10) size = 'medium';
          
          return L.divIcon({
            html: `<div style="background:#FF6B6B;color:#fff;border-radius:50%;width:40px;height:40px;display:grid;place-items:center;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">${count}</div>`,
            className: `kt-cluster kt-cluster-${size}`,
            iconSize: [40, 40]
          });
        }
      });
      map.addLayer(state.clusterGroup);

      await loadIndex();

      // Get visible states
      let initialStates = getVisibleStates(map);
      
      // FALLBACK: If no states detected, force load popular camping states
      if (initialStates.length === 0) {
        console.warn('⚠️ No states detected in viewport, loading popular states as fallback...');
        initialStates = ['CA', 'CO', 'UT', 'AZ', 'WA', 'OR', 'MT', 'WY'];
      }
      
      console.log('🚀 Loading initial states:', initialStates.join(', '));
      
      // Load states one at a time with progress logging
      for (const stateCode of initialStates) {
        await loadStateData(stateCode);
      }
      
      console.log(`✅ Initial load complete: ${state.allCampsites.length} total sites`);

      updateMarkers(map, this.getDefaultFilters(), state.config);

      map.on('moveend', debounce(() => {
        refreshData(map, this.getCurrentFilters(), state.config);
      }, 500));
      
      // Also trigger on first zoom
      map.on('zoomend', debounce(() => {
        refreshData(map, this.getCurrentFilters(), state.config);
      }, 500));
    },

    getDefaultFilters() {
      return {
        cost: 'all',
        type: 'all',
        rigSize: 'all',
        roadDifficulty: 'all',
        amenities: [],
        minRating: 0
      };
    },

    getCurrentFilters() {
      return window.kamptrailFilters || this.getDefaultFilters();
    },

    updateFilters(filters, map) {
      window.kamptrailFilters = filters;
      updateMarkers(map, filters, state.config);
    },

    getAllCampsites() {
      return state.allCampsites;
    },

    getCampsiteById(id) {
      return state.allCampsites.find(s => s.properties.id === id);
    },

    getLoadedStates() {
      return Array.from(state.loadedStates);
    },

    addToTrip(id) {
      console.log('Adding to trip:', id);
      if (state.config.onTripAdd) state.config.onTripAdd(id);
    },

    toggleFavorite(id) {
      console.log('Toggling favorite:', id);
      if (state.config.onFavoriteToggle) state.config.onFavoriteToggle(id);
    }
  };
})();
