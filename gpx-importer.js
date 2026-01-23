// gpx-importer.js - Import GPX files and display routes/waypoints
(function() {
  'use strict';

  const state = {
    gpxLayer: null,
    importedWaypoints: [],
    importedTracks: []
  };

  function parseGPX(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // Check for parsing errors
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid GPX file format');
    }

    const waypoints = [];
    const tracks = [];

    // Extract waypoints
    const wptElements = doc.getElementsByTagName('wpt');
    for (let i = 0; i < wptElements.length; i++) {
      const wpt = wptElements[i];
      const lat = parseFloat(wpt.getAttribute('lat'));
      const lon = parseFloat(wpt.getAttribute('lon'));

      // Validate coordinates
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        console.warn(`Invalid waypoint coordinates: lat=${lat}, lon=${lon}`);
        continue;
      }

      const name = wpt.getElementsByTagName('name')[0]?.textContent || `Waypoint ${i + 1}`;
      const desc = wpt.getElementsByTagName('desc')[0]?.textContent || '';
      const type = wpt.getElementsByTagName('type')[0]?.textContent || 'waypoint';

      waypoints.push({ lat, lon, name, desc, type });
    }

    // Extract tracks
    const trkElements = doc.getElementsByTagName('trk');
    for (let i = 0; i < trkElements.length; i++) {
      const trk = trkElements[i];
      const trackName = trk.getElementsByTagName('name')[0]?.textContent || `Track ${i + 1}`;
      const points = [];

      const trkpts = trk.getElementsByTagName('trkpt');
      for (let j = 0; j < trkpts.length; j++) {
        const pt = trkpts[j];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));

        // Validate coordinates
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          console.warn(`Invalid track point coordinates: lat=${lat}, lon=${lon}`);
          continue;
        }

        points.push([lat, lon]);
      }

      if (points.length > 0) {
        tracks.push({ name: trackName, points });
      }
    }

    // Extract routes
    const rteElements = doc.getElementsByTagName('rte');
    for (let i = 0; i < rteElements.length; i++) {
      const rte = rteElements[i];
      const routeName = rte.getElementsByTagName('name')[0]?.textContent || `Route ${i + 1}`;
      const points = [];

      const rtepts = rte.getElementsByTagName('rtept');
      for (let j = 0; j < rtepts.length; j++) {
        const pt = rtepts[j];
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));

        // Validate coordinates
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          console.warn(`Invalid route point coordinates: lat=${lat}, lon=${lon}`);
          continue;
        }

        points.push([lat, lon]);
      }

      if (points.length > 0) {
        tracks.push({ name: routeName, points });
      }
    }

    return { waypoints, tracks };
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
          <button onclick="window.open('https://maps.google.com/?q=${safeLat},${safeLon}')"
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
      map.fitBounds(state.gpxLayer.getBounds(), { padding: [50, 50] });
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

  function findNearestCampsite(lat, lon) {
    if (!window.KampTrailData) {
      window.showToast && window.showToast('Data loader not available', 'error');
      return;
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
        map.setView([nLat, nLon], 14);

        // Find and open the campsite popup
        setTimeout(() => {
          const esc = window.escapeHtml || ((t) => t);
          const siteName = esc(nearest.properties.name || 'Unknown');
          const msg = `Found nearest campsite: ${siteName} (${minDistance.toFixed(2)} km away)`;
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
      gpxBtn.innerHTML = '📥 Import GPX';

      gpxBtn.addEventListener('click', () => {
        fileInput.click();
      });

      // Add button to header actions
      const actions = document.querySelector('.actions');
      if (actions) {
        actions.insertBefore(gpxBtn, actions.firstChild);
      }

      console.log('✅ GPX Importer ready');
    },

    findNearestCampsite,
    clearGPXData,

    getImportedData() {
      return {
        waypoints: state.importedWaypoints,
        tracks: state.importedTracks
      };
    }
  };
})();
