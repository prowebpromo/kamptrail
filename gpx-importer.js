// gpx-importer.js - Import GPX files and display routes/waypoints
(function() {
  'use strict';

  const state = {
    gpxLayer: null,
    importedWaypoints: [],
    importedTracks: []
  };

  function parseGPX(xmlText) {
    if (!xmlText || typeof xmlText !== 'string') {
      throw new Error('GPX content must be a non-empty string');
    }

    if (xmlText.trim() === '') {
      throw new Error('GPX file is empty');
    }

    let parser, doc;
    try {
      parser = new DOMParser();
      doc = parser.parseFromString(xmlText, 'text/xml');
    } catch (parseErr) {
      throw new Error(`Failed to parse GPX XML: ${parseErr.message}`);
    }

    // Check for parsing errors
    const parserErrors = doc.getElementsByTagName('parsererror');
    if (parserErrors.length > 0) {
      const errorText = parserErrors[0].textContent || 'Unknown XML parsing error';
      throw new Error(`Invalid GPX file format: ${errorText.substring(0, 100)}`);
    }

    // Verify it's a GPX file
    const gpxRoot = doc.getElementsByTagName('gpx');
    if (gpxRoot.length === 0) {
      throw new Error('Not a valid GPX file: missing <gpx> root element');
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

    const popupContent = `
      <div style="min-width:200px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">📍 ${safeName}</h3>
        ${safeDesc ? `<p style="margin:4px 0;font-size:12px;color:#666;">${safeDesc}</p>` : ''}
        <div style="font-size:11px;color:#888;margin:8px 0;">
          GPX Waypoint • ${safeType}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button onclick="KampTrailGPX.findNearestCampsite(${waypoint.lat}, ${waypoint.lon})"
                  style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Find Nearest Campsite
          </button>
          <button onclick="window.open('https://maps.google.com/?q=${waypoint.lat},${waypoint.lon}')"
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
    try {
      if (!map || typeof map.addLayer !== 'function') {
        throw new Error('Invalid map object');
      }

      if (!gpxData || typeof gpxData !== 'object') {
        throw new Error('Invalid GPX data');
      }

      // Clear previous GPX layer
      if (state.gpxLayer) {
        try {
          map.removeLayer(state.gpxLayer);
        } catch (removeErr) {
          console.warn('⚠️ Could not remove previous GPX layer:', removeErr.message);
        }
      }

      state.gpxLayer = L.featureGroup();
      state.importedWaypoints = Array.isArray(gpxData.waypoints) ? gpxData.waypoints : [];
      state.importedTracks = Array.isArray(gpxData.tracks) ? gpxData.tracks : [];

      // Add waypoints with error handling
      let waypointCount = 0;
      state.importedWaypoints.forEach((wpt, idx) => {
        try {
          if (!wpt || typeof wpt !== 'object') {
            console.warn(`⚠️ Invalid waypoint at index ${idx}`);
            return;
          }

          const marker = createWaypointMarker(wpt);
          if (marker) {
            state.gpxLayer.addLayer(marker);
            waypointCount++;
          }
        } catch (wptErr) {
          console.warn(`⚠️ Error adding waypoint ${idx}:`, wptErr.message);
        }
      });

      // Add tracks and routes with error handling
      const esc = window.escapeHtml || ((t) => String(t || ''));
      let trackCount = 0;
      state.importedTracks.forEach((track, idx) => {
        try {
          if (!track || !Array.isArray(track.points) || track.points.length === 0) {
            console.warn(`⚠️ Invalid track at index ${idx}`);
            return;
          }

          // Validate track points
          const validPoints = track.points.filter(pt => {
            return Array.isArray(pt) && pt.length >= 2 &&
                   typeof pt[0] === 'number' && typeof pt[1] === 'number' &&
                   !isNaN(pt[0]) && !isNaN(pt[1]);
          });

          if (validPoints.length === 0) {
            console.warn(`⚠️ Track ${idx} has no valid points`);
            return;
          }

          const polyline = L.polyline(validPoints, {
            color: '#ff6b6b',
            weight: 3,
            opacity: 0.7,
            dashArray: '5, 10'
          });

          const safeTrackName = esc(track.name || `Track ${idx + 1}`);
          polyline.bindPopup(`
            <div style="min-width:150px;">
              <h3 style="margin:0;font-size:14px;font-weight:bold;">🛤️ ${safeTrackName}</h3>
              <div style="font-size:11px;color:#888;margin-top:4px;">
                ${validPoints.length} points
              </div>
            </div>
          `);

          state.gpxLayer.addLayer(polyline);
          trackCount++;
        } catch (trackErr) {
          console.warn(`⚠️ Error adding track ${idx}:`, trackErr.message);
        }
      });

      state.gpxLayer.addTo(map);

      // Fit map to GPX bounds with validation
      if (state.gpxLayer.getLayers().length > 0) {
        try {
          const bounds = state.gpxLayer.getBounds();
          if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
          } else {
            console.warn('⚠️ Invalid bounds for GPX data, skipping fitBounds');
          }
        } catch (boundsErr) {
          console.warn('⚠️ Error fitting map to GPX bounds:', boundsErr.message);
        }
      }

      return {
        waypointCount,
        trackCount
      };
    } catch (err) {
      console.error('⚠️ Error displaying GPX data:', err.message);
      throw err;
    }
  }

  function handleFileSelect(map, file) {
    if (!file) {
      console.error('⚠️ No file provided to handleFileSelect');
      window.showToast && window.showToast('No file selected', 'error');
      return;
    }

    // Validate file type
    if (!file.name || !file.name.toLowerCase().endsWith('.gpx')) {
      window.showToast && window.showToast('Please select a valid GPX file (*.gpx)', 'error');
      console.warn('⚠️ Invalid file type:', file.name);
      return;
    }

    // Check file size (limit to 10MB)
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_FILE_SIZE) {
      window.showToast && window.showToast(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`, 'error');
      console.warn(`⚠️ File too large: ${file.size} bytes`);
      return;
    }

    if (file.size === 0) {
      window.showToast && window.showToast('File is empty', 'error');
      console.warn('⚠️ Empty file');
      return;
    }

    if (!map || typeof map.fitBounds !== 'function') {
      console.error('⚠️ Invalid map object in handleFileSelect');
      window.showToast && window.showToast('Map not initialized', 'error');
      return;
    }

    window.setLoading && window.setLoading(true);

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        if (!e.target || !e.target.result) {
          throw new Error('Failed to read file content');
        }

        const gpxData = parseGPX(e.target.result);

        if (!gpxData.waypoints && !gpxData.tracks) {
          throw new Error('No valid GPX data found in file');
        }

        if (gpxData.waypoints.length === 0 && gpxData.tracks.length === 0) {
          window.setLoading && window.setLoading(false);
          window.showToast && window.showToast('GPX file contains no waypoints or tracks', 'info');
          console.warn('⚠️ Empty GPX file (no data)');
          return;
        }

        const stats = displayGPXData(map, gpxData);

        window.setLoading && window.setLoading(false);

        const msg = `✅ Loaded ${stats.waypointCount} waypoint(s) and ${stats.trackCount} track(s)`;
        window.showToast && window.showToast(msg, 'success', 5000);

        console.log('📥 GPX Import successful:', {
          waypoints: stats.waypointCount,
          tracks: stats.trackCount,
          fileName: file.name
        });
      } catch (err) {
        window.setLoading && window.setLoading(false);
        const errorMsg = err.message || 'Unknown error parsing GPX file';
        window.showToast && window.showToast(`Error parsing GPX: ${errorMsg}`, 'error', 8000);
        console.error('⚠️ GPX Parse Error:', err);
      }
    };

    reader.onerror = (err) => {
      window.setLoading && window.setLoading(false);
      const errorMsg = err.target && err.target.error ? err.target.error.message : 'Unknown file read error';
      window.showToast && window.showToast(`Error reading file: ${errorMsg}`, 'error');
      console.error('⚠️ FileReader Error:', err);
    };

    try {
      reader.readAsText(file);
    } catch (readErr) {
      window.setLoading && window.setLoading(false);
      window.showToast && window.showToast('Failed to read file', 'error');
      console.error('⚠️ Failed to initiate file read:', readErr);
    }
  }

  function findNearestCampsite(lat, lon) {
    try {
      // Validate input coordinates
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        console.error('⚠️ Invalid coordinates provided to findNearestCampsite');
        window.showToast && window.showToast('Invalid coordinates', 'error');
        return;
      }

      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        console.error(`⚠️ Coordinates out of range: lat=${lat}, lon=${lon}`);
        window.showToast && window.showToast('Coordinates out of valid range', 'error');
        return;
      }

      if (!window.KampTrailData || typeof window.KampTrailData.getAllCampsites !== 'function') {
        console.error('⚠️ Data loader not available');
        window.showToast && window.showToast('Campsite data not loaded', 'error');
        return;
      }

      const campsites = window.KampTrailData.getAllCampsites();
      if (!Array.isArray(campsites) || campsites.length === 0) {
        console.warn('⚠️ No campsites available');
        window.showToast && window.showToast('No campsites loaded. Pan the map to load campsite data.', 'info', 5000);
        return;
      }

      // Calculate distance using Haversine formula
      function getDistance(lat1, lon1, lat2, lon2) {
        if (typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
            typeof lat2 !== 'number' || typeof lon2 !== 'number') {
          return Infinity;
        }

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
        try {
          if (!site || !site.geometry || !Array.isArray(site.geometry.coordinates)) {
            return;
          }

          const [sLon, sLat] = site.geometry.coordinates;

          if (typeof sLat !== 'number' || typeof sLon !== 'number' ||
              isNaN(sLat) || isNaN(sLon)) {
            return;
          }

          const distance = getDistance(lat, lon, sLat, sLon);

          if (distance < minDistance && distance !== Infinity) {
            minDistance = distance;
            nearest = site;
          }
        } catch (siteErr) {
          console.warn('⚠️ Error processing site in findNearestCampsite:', siteErr.message);
        }
      });

      if (!nearest) {
        console.warn('⚠️ No valid nearest campsite found');
        window.showToast && window.showToast('Could not find nearby campsite', 'error');
        return;
      }

      const [nLon, nLat] = nearest.geometry.coordinates;
      const map = window.kamptrailMap;

      if (!map || typeof map.setView !== 'function') {
        console.error('⚠️ Map not available');
        window.showToast && window.showToast('Map not initialized', 'error');
        return;
      }

      map.setView([nLat, nLon], 14);

      // Show success message
      setTimeout(() => {
        const esc = window.escapeHtml || ((t) => String(t || ''));
        const siteName = nearest.properties && nearest.properties.name
          ? esc(nearest.properties.name)
          : 'Unknown';
        const msg = `Found nearest campsite: ${siteName} (${minDistance.toFixed(2)} km away)`;
        window.showToast && window.showToast(msg, 'success', 5000);
      }, 500);
    } catch (err) {
      console.error('⚠️ Error in findNearestCampsite:', err.message);
      window.showToast && window.showToast('Error finding nearest campsite', 'error');
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
