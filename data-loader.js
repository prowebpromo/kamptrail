
(function() {
  'use strict';

  // State object to hold all our data and configurations
  const state = {
    allCampsites: [],       // All campsites currently loaded
    loadedStates: new Set(),  // Which states' data have we fetched
    loading: new Set(),         // Which states are currently being fetched
    stateIndex: null,         // GeoJSON index for state boundaries
    clusterGroup: null,       // Leaflet MarkerClusterGroup
    config: {},               // To store init configuration
    loadedCampsiteIds: new Set() // Set to track IDs of all loaded campsites for deduplication
  };

  // Debounce utility
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // Load state boundaries index
  async function loadIndex() {
    try {
      const resp = await fetch('data/states_index.geojson');
      if (!resp.ok) throw new Error(`HTTP error! status: ${resp.status}`);
      state.stateIndex = await resp.json();
      console.log('✅ State index loaded successfully');
    } catch (e) {
      console.error('💥 Failed to load state index:', e.message);
      // Optional: Show a user-facing error
    }
  }

  // Find which states are visible in the current map view
  function getVisibleStates(map) {
    if (!state.stateIndex) return [];

    const bounds = map.getBounds();
    const visible = new Set();

    // Simple bounding box check
    for (const feature of state.stateIndex.features) {
      const stateBounds = L.geoJSON(feature).getBounds();
      if (bounds.intersects(stateBounds)) {
        visible.add(feature.properties.STATE_ABBR);
      }
    }
    
    return Array.from(visible);
  }

  // Load GeoJSON data for a specific state
  async function loadStateData(stateCode) {
    if (state.loading.has(stateCode) || state.loadedStates.has(stateCode)) {
      return;
    }

    state.loading.add(stateCode);

    try {
      const compressedUrl = `data/merged/${stateCode}_merged.geojson.gz`;
      const uncompressedUrl = `data/merged/${stateCode}_merged.geojson`;

      let allNewSites = [];
      let loadedFrom = '';

      // Try fetching compressed data first
      try {
        const response = await fetch(compressedUrl);
        if (!response.ok) throw new Error('Compressed file not found, trying uncompressed.');

        // Check for pako library
        if (typeof pako === 'undefined') {
          console.error('Error: pako.js is not loaded. Cannot decompress gzipped file.');
          throw new Error('pako.js not available.');
        }

        const compressedData = await response.arrayBuffer();
        const decompressedData = pako.inflate(compressedData, { to: 'string' });
        const geojson = JSON.parse(decompressedData);
        allNewSites = geojson.features;
        loadedFrom = 'gzipped';

      } catch (e) {
        console.warn(`Could not load gzipped data for ${stateCode}: ${e.message}. Trying uncompressed...`);

        // Fallback to uncompressed GeoJSON
        try {
          const response = await fetch(uncompressedUrl);
          if (!response.ok) throw new Error(`Uncompressed file for ${stateCode} also not found.`);
          const geojson = await response.json();
          allNewSites = geojson.features;
          loadedFrom = 'json';

        } catch (uncompressedError) {
          console.error(`💥 Failed to load any data for ${stateCode}:`, uncompressedError.message);
          state.loadedStates.add(stateCode); // Mark as loaded to prevent retries
          return [];
        }
      }

      if (allNewSites.length > 0) {
        console.log(`📥 Loaded ${allNewSites.length} sites for ${stateCode} from ${loadedFrom}`);

        // Filter out duplicates by checking if ID already exists
        const uniqueSites = allNewSites.filter(site => {
          const siteId = site.properties.id;
          if (!siteId) return true; // Keep sites without IDs (edge case)
          if (state.loadedCampsiteIds.has(siteId)) {
            return false; // Skip duplicate
          }
          return true; // Keep unique site
        });

        // Add unique sites to the map and track their IDs
        uniqueSites.forEach(site => {
          const siteId = site.properties.id;
          if (siteId) {
            state.loadedCampsiteIds.add(siteId);
          }
        });
        state.allCampsites.push(...uniqueSites);
        state.loadedStates.add(stateCode);

        const duplicateCount = allNewSites.length - uniqueSites.length;
        if (duplicateCount > 0) {
          console.log(`🔍 Filtered out ${duplicateCount} duplicate(s) for ${stateCode}`);
        }
        console.log(`✅ Added ${uniqueSites.length} new sites for ${stateCode} (Total: ${state.allCampsites.length})`);
      } else {
        // If both failed, we still mark as "loaded" to not retry constantly
        state.loadedStates.add(stateCode);
        console.log(`🤷 No new data found for ${stateCode}.`);
      }

      return allNewSites;

    } catch (err) {
      console.error(`💥 Error loading merged data for ${stateCode}:`, err.message);
      // Mark as loaded even if failed to prevent constant retry
      state.loadedStates.add(stateCode);
      return [];
    } finally {
      state.loading.delete(stateCode);
    }
  }

  function applyFilters(sites, filters) {
    if (!filters) return sites;
    
    return sites.filter(site => {
      const p = site.properties;
      if (!p) return false;

      if (filters.cost === 'free' && (p.cost === null || p.cost > 0)) return false;
      if (filters.cost === 'paid' && (p.cost === null || p.cost === 0)) return false;

      if (filters.type !== 'all' && p.type !== filters.type) return false;

      if (filters.rigSize !== 'all') {
        const rigFriendly = p.rig_friendly || [];
        if (!rigFriendly.includes(filters.rigSize)) return false;
      }

      if (filters.roadDifficulty !== 'all' && p.road_difficulty !== filters.roadDifficulty) return false;

      if (filters.amenities && filters.amenities.length > 0) {
        const siteAmenities = p.amenities || [];
        const hasAll = filters.amenities.every(a => siteAmenities.includes(a));
        if (!hasAll) return false;
      }

      if (filters.minRating && filters.minRating > 0) {
        const rating = p.rating || 0;
        if (rating < filters.minRating) return false;
      }

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
    const esc = window.escapeHtml || ((t) => t);
    const costText = p.cost === 0 || p.cost === null || p.cost === undefined ? 'FREE' : `$${p.cost}/night`;
    let ratingText = 'No ratings';
    if (p.rating) {
      const stars = '⭐'.repeat(Math.round(parseFloat(p.rating)));
      const reviewCount = p.reviews_count || 0;
      ratingText = reviewCount > 0 ? `${stars} (${reviewCount} reviews)` : stars;
    }
    const safeName = esc(p.name || 'Unnamed Site');
    const safeType = esc(p.type || 'Unknown');
    const safeRoadDiff = p.road_difficulty ? esc(p.road_difficulty) : '';
    const safeAmenities = p.amenities && p.amenities.length ? p.amenities.map(a => esc(a)).join(' • ') : '';
    const safeId = esc(p.id || '');
    const rigFriendly = p.rig_friendly && p.rig_friendly.length ? p.rig_friendly.map(r => esc(r)).join(', ') : '';

    const googleButtonHtml = `
        <div style="margin-top:10px; border-top: 1px solid #eee; padding-top:10px;">
            <button
              type="button"
              class="google-btn"
              data-campsite-name="${safeName}"
              data-lat="${site.geometry.coordinates[1]}"
              data-lng="${site.geometry.coordinates[0]}"
              style="width:100%; padding: 6px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; cursor:pointer;"
            >
              Show Google Photos & Rating
            </button>
            <div class="google-results-container" style="margin-top: 8px;"></div>
        </div>`;

    return `
      <div style="min-width:200px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">${safeName}</h3>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">
          <div><strong>Cost:</strong> ${costText}</div>
          <div><strong>Type:</strong> ${safeType}</div>
          ${safeRoadDiff ? `<div><strong>Road:</strong> ${safeRoadDiff}</div>` : ''}
          ${rigFriendly ? `<div><strong>Suitable for:</strong> ${rigFriendly}</div>` : ''}
          <div><strong>Rating:</strong> ${ratingText}</div>
        </div>
        ${safeAmenities ? `<div style="font-size:11px;color:#888;margin-bottom:8px;">${safeAmenities}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button onclick="KampTrailData.addToTrip('${safeId}')" style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Add to Trip</button>
          <button onclick="KampTrailCompare.addToCompare('${safeId}')" style="flex:1;padding:4px 8px;background:#ff6b6b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Compare</button>
          <button onclick="window.open('https://maps.google.com/?q=${site.geometry.coordinates[1]},${site.geometry.coordinates[0]}')" style="flex:1;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Navigate</button>
        </div>
        ${googleButtonHtml}
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

    if (config.onFilterUpdate) {
      config.onFilterUpdate(filtered.length, state.allCampsites.length);
    }
  }

  async function refreshData(map, filters, config) {
    const visibleStates = getVisibleStates(map);
    const newStates = visibleStates.filter(s => !state.loadedStates.has(s) && !state.loading.has(s));
    
    if (newStates.length > 0) {
      console.log('🔄 Loading new states:', newStates.join(', '));
      await Promise.all(newStates.map(s => loadStateData(s)));
      updateMarkers(map, filters, config);
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
