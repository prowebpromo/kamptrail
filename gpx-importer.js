// gpx-importer.js - Import GPX files and display routes/waypoints
(function() {
  'use strict';

  const state = {
    gpxLayer: null,
    importedWaypoints: [],
    importedTracks: []
  };

  function parseGPX(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || doc.documentElement?.localName !== 'gpx') throw new Error('Select a valid GPX document');
    const elements = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
    const text = (node, name, fallback = '') => elements(node, name)[0]?.textContent || fallback;
    function coordinates(node) {
      const rawLat = node.getAttribute('lat'), rawLon = node.getAttribute('lon');
      if (!rawLat?.trim() || !rawLon?.trim()) return null;
      const lat = Number(rawLat), lon = Number(rawLon);
      return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
    }
    const waypoints = elements(doc, 'wpt').flatMap((node, index) => {
      const coords = coordinates(node);
      return coords ? [{lat:coords[0],lon:coords[1],name:text(node,'name',`Waypoint ${index + 1}`),desc:text(node,'desc'),type:text(node,'type','waypoint')}] : [];
    });
    const tracks = [];
    elements(doc, 'trk').forEach((track, index) => {
      const name = text(track, 'name', `Track ${index + 1}`);
      const segments = elements(track, 'trkseg');
      segments.forEach((segment, segmentIndex) => {
        const points = elements(segment, 'trkpt').map(coordinates).filter(Boolean);
        if (points.length) tracks.push({name:segments.length > 1 ? `${name} (segment ${segmentIndex + 1})` : name,points});
      });
    });
    elements(doc, 'rte').forEach((route, index) => {
      const points = elements(route, 'rtept').map(coordinates).filter(Boolean);
      if (points.length) tracks.push({name:text(route,'name',`Route ${index + 1}`),points});
    });
    if (!waypoints.length && !tracks.length) throw new Error('This GPX file has no valid waypoints, tracks or routes');
    return {waypoints,tracks};
  }

  function createWaypointMarker(waypoint) {
    const icon = L.divIcon({
      html: `<div style="background:#ff6b6b;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
      className: 'gpx-waypoint-marker',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker([waypoint.lat, waypoint.lon], { icon });

    const esc = window.escapeHtml || ((t) => t);
    const safeName = esc(waypoint.name);
    const safeDesc = esc(waypoint.desc);
    const safeType = esc(waypoint.type);
    const safeLat = waypoint.lat || 0;
    const safeLon = waypoint.lon || 0;

    const popupContent = `
      <div style="min-width:200px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">📍 ${safeName}</h3>
        ${safeDesc ? `<p style="margin:4px 0;font-size:12px;color:#666;">${safeDesc}</p>` : ''}
        <div style="font-size:11px;color:#888;margin:8px 0;">
          GPX Waypoint • ${safeType}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button onclick="KampTrailGPX.findNearestCampsite(${safeLat}, ${safeLon})"
                  style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Find Nearest Campsite
          </button>
          <button onclick="window.open('https://www.openstreetmap.org/directions?from=&to=${safeLat},${safeLon}')"
                  style="flex:1;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Navigate
          </button>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    return marker;
  }

  function displayGPXData(map, gpxData) {
    // Clear previous GPX layer
    if (state.gpxLayer) {
      map.removeLayer(state.gpxLayer);
    }

    state.gpxLayer = L.featureGroup();
    state.importedWaypoints = gpxData.waypoints;
    state.importedTracks = gpxData.tracks;

    // Add waypoints
    gpxData.waypoints.forEach(wpt => {
      const marker = createWaypointMarker(wpt);
      state.gpxLayer.addLayer(marker);
    });

    // Add tracks and routes
    const esc = window.escapeHtml || ((t) => t);
    gpxData.tracks.forEach(track => {
      const polyline = L.polyline(track.points, {
        color: '#ff6b6b',
        weight: 3,
        opacity: 0.7,
        dashArray: '5, 10'
      });

      const safeTrackName = esc(track.name);
      polyline.bindPopup(`
        <div style="min-width:150px;">
          <h3 style="margin:0;font-size:14px;font-weight:bold;">🛤️ ${safeTrackName}</h3>
          <div style="font-size:11px;color:#888;margin-top:4px;">
            ${track.points.length} points
          </div>
        </div>
      `);

      state.gpxLayer.addLayer(polyline);
    });

    state.gpxLayer.addTo(map);

    // Fit map to GPX bounds
    if (state.gpxLayer.getLayers().length > 0) {
      map.fitBounds(state.gpxLayer.getBounds(), { padding: [50, 50], maxZoom: 15 });
    }

    return {
      waypointCount: gpxData.waypoints.length,
      trackCount: gpxData.tracks.length
    };
  }

  function handleFileSelect(map, file) {
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      window.showToast && window.showToast('Please select a valid GPX file', 'error');
      return;
    }

    window.setLoading && window.setLoading(true);

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const gpxData = parseGPX(e.target.result);
        const stats = displayGPXData(map, gpxData);

        window.setLoading && window.setLoading(false);

        const msg = `✅ Loaded ${stats.waypointCount} waypoint(s) and ${stats.trackCount} track(s)`;
        window.showToast && window.showToast(msg, 'success', 5000);

        console.log('📥 GPX Import:', gpxData);
      } catch (err) {
        window.setLoading && window.setLoading(false);
        window.showToast && window.showToast('Error parsing GPX: ' + err.message, 'error');
        console.error('GPX Parse Error:', err);
      }
    };

    reader.onerror = () => {
      window.setLoading && window.setLoading(false);
      window.showToast && window.showToast('Error reading file', 'error');
    };

    reader.readAsText(file);
  }

  async function findNearestCampsite(lat, lon) {
    if (!window.KampTrailData) {
      window.showToast && window.showToast('Data loader not available', 'error');
      return;
    }

    const map = window.kamptrailMap;
    if (map) {
      map.setView([lat, lon], 10);
      await window.KampTrailData.loadStates?.(window.KampTrailData.getVisibleStates?.(map) || []);
    }
    const campsites = window.KampTrailData.getAllCampsites();
    if (campsites.length === 0) {
      window.showToast && window.showToast('No campsites loaded yet', 'error');
      return;
    }

    // Calculate distance using Haversine formula
    function getDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Earth radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    }

    let nearest = null;
    let minDistance = Infinity;

    campsites.forEach(site => {
      const [sLon, sLat] = site.geometry.coordinates;
      const distance = getDistance(lat, lon, sLat, sLon);

      if (distance < minDistance) {
        minDistance = distance;
        nearest = site;
      }
    });

    if (nearest) {
      const [nLon, nLat] = nearest.geometry.coordinates;
      const map = window.kamptrailMap;

      if (map) {
        if (window.KampTrailData.focusCampsite) window.KampTrailData.focusCampsite(nearest.properties.id);
        else map.setView([nLat, nLon], 14);

        // Find and open the campsite popup
        setTimeout(() => {
          const esc = window.escapeHtml || ((t) => t);
          const siteName = nearest.properties.name || 'Unknown';
          const msg = `Nearest campsite in the available data: ${siteName} (${minDistance.toFixed(2)} km away)`;
          window.showToast && window.showToast(msg, 'success', 5000);
        }, 500);
      }
    }
  }

  function clearGPXData(map) {
    if (state.gpxLayer) {
      map.removeLayer(state.gpxLayer);
      state.gpxLayer = null;
      state.importedWaypoints = [];
      state.importedTracks = [];
      window.showToast && window.showToast('GPX data cleared', 'info');
    }
  }

  window.KampTrailGPX = {
    init(map) {
      console.log('📍 Initializing GPX Importer...');

      // Store map reference globally for findNearestCampsite
      window.kamptrailMap = map;

      // Create file input (hidden)
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.gpx';
      fileInput.style.display = 'none';
      fileInput.id = 'gpx-file-input';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          handleFileSelect(map, file);
        }
        // Reset input so same file can be selected again
        fileInput.value = '';
      });

      // Create GPX import button
      const gpxBtn = document.createElement('button');
      gpxBtn.id = 'gpx-import';
      gpxBtn.className = 'btn';
      gpxBtn.setAttribute('aria-label', 'Import GPX file');
      gpxBtn.innerHTML = 'Import GPX';

      gpxBtn.addEventListener('click', () => {
        fileInput.click();
      });

      // Add button to header actions
      const actions = document.querySelector('.actions');
      if (actions) {
        actions.insertBefore(gpxBtn, actions.firstChild);
      }

      const clearBtn = document.createElement('button');
      clearBtn.id = 'gpx-clear'; clearBtn.className = 'btn'; clearBtn.textContent = 'Clear GPX';
      clearBtn.onclick = () => clearGPXData(map);
      if (actions) actions.insertBefore(clearBtn, gpxBtn.nextSibling);
      console.log('✅ GPX Importer ready');
    },

    findNearestCampsite,
    parseGPX,
    clearGPXData,

    getImportedData() {
      return {
        waypoints: state.importedWaypoints,
        tracks: state.importedTracks
      };
    }
  };
})();
