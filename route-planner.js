/**
 * KampTrail Route Planner
 * Calculates and displays driving routes between trip stops using OSRM
 */
(function () {
  'use strict';

  const OSRM_API = 'https://router.project-osrm.org/route/v1/driving';

  const state = {
    map: null,
    routeLayer: null,
    showRoute: false
  };

  /**
   * Fetch route from OSRM API
   */
  async function fetchRoute(coordinates) {
    if (coordinates.length < 2) return null;

    try {
      // Format: lng,lat;lng,lat;...
      const coords = coordinates.map(c => `${c[0]},${c[1]}`).join(';');
      const url = `${OSRM_API}/${coords}?overview=full&geometries=geojson`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('OSRM API failed');

      const data = await response.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('No route found');
      }

      return data.routes[0];
    } catch (err) {
      console.error('Route fetch failed:', err);
      return null;
    }
  }

  /**
   * Draw route on map
   */
  async function drawRoute(stops) {
    // Clear existing route
    if (state.routeLayer) {
      state.map.removeLayer(state.routeLayer);
      state.routeLayer = null;
    }

    if (!stops || stops.length < 2 || !state.showRoute) return;

    // Get coordinates for stops
    const coordinates = stops.map(id => {
      const site = window.KampTrailData?.getCampsiteById(id);
      if (!site) return null;
      return site.geometry.coordinates; // [lng, lat]
    }).filter(Boolean);

    if (coordinates.length < 2) return;

    // Fetch route
    showToast && showToast('Calculating route...', 'info', 2000);
    const route = await fetchRoute(coordinates);

    if (!route) {
      showToast && showToast('Failed to calculate route', 'error');
      return;
    }

    // Convert route geometry to Leaflet format [lat, lng]
    const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

    // Create route polyline
    state.routeLayer = L.polyline(coords, {
      color: '#86b7ff',
      weight: 4,
      opacity: 0.7,
      smoothFactor: 1
    }).addTo(state.map);

    // Add markers at waypoints
    coordinates.forEach((coord, i) => {
      L.circleMarker([coord[1], coord[0]], {
        radius: 6,
        fillColor: '#86b7ff',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1
      }).bindPopup(`Stop ${i + 1}`).addTo(state.routeLayer);
    });

    // Format route info
    const distanceKm = (route.distance / 1000).toFixed(1);
    const distanceMi = (distanceKm * 0.621371).toFixed(1);
    const durationHours = Math.floor(route.duration / 3600);
    const durationMins = Math.round((route.duration % 3600) / 60);

    showToast && showToast(
      `Route: ${distanceKm} km (${distanceMi} mi) • ${durationHours}h ${durationMins}m`,
      'success',
      5000
    );
  }

  /**
   * Toggle route visibility
   */
  function toggleRoute() {
    state.showRoute = !state.showRoute;

    // Update button state
    const btn = document.getElementById('route-btn');
    if (btn) {
      btn.classList.toggle('active', state.showRoute);
    }

    // Redraw or clear route
    if (window.KampTrailTrip) {
      const activeTrip = window.KampTrailTrip.getActiveTrip();
      if (activeTrip && activeTrip.stops) {
        drawRoute(activeTrip.stops);
      }
    }
  }

  /**
   * Update route when trip changes
   */
  function onTripChange() {
    if (!state.showRoute) return;

    if (window.KampTrailTrip) {
      const activeTrip = window.KampTrailTrip.getActiveTrip();
      if (activeTrip && activeTrip.stops) {
        drawRoute(activeTrip.stops);
      }
    }
  }

  /**
   * Initialize route planner
   */
  function init(mapInstance) {
    state.map = mapInstance;

    // Add button to header
    const header = document.querySelector('header .actions');
    if (header) {
      const btn = document.createElement('button');
      btn.id = 'route-btn';
      btn.className = 'btn';
      btn.innerHTML = '🗺️ Route';
      btn.setAttribute('aria-label', 'Show route');
      btn.addEventListener('click', toggleRoute);

      // Insert after trip button
      const tripBtn = document.getElementById('trip');
      if (tripBtn) {
        header.insertBefore(btn, tripBtn.nextSibling);
      } else {
        header.appendChild(btn);
      }
    }

    // Listen for trip changes
    // We'll expose this globally so trip-manager can call it
    window.KampTrailRoute_onTripChange = onTripChange;

    console.log('[Route Planner] Initialized');
  }

  // Export
  window.KampTrailRoute = {
    init,
    toggleRoute,
    drawRoute,
    onTripChange
  };
})();
