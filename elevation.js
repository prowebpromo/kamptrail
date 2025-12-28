/**
 * KampTrail Elevation Module
 * Fetches and displays elevation data for campsite locations
 */
(function () {
  'use strict';

  const ELEVATION_API = 'https://api.open-elevation.com/api/v1/lookup';
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  const elevationCache = new Map();

  /**
   * Fetch elevation for a location
   */
  async function fetchElevation(lat, lng) {
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = elevationCache.get(cacheKey);

    // Return cached data if still fresh
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      const response = await fetch(`${ELEVATION_API}?locations=${lat},${lng}`);
      if (!response.ok) throw new Error('Elevation API failed');

      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        throw new Error('No elevation data');
      }

      const elevation = data.results[0].elevation;

      // Cache the result
      elevationCache.set(cacheKey, {
        data: elevation,
        timestamp: Date.now()
      });

      return elevation;
    } catch (err) {
      console.error('Elevation fetch failed:', err);
      return null;
    }
  }

  /**
   * Format elevation HTML
   */
  function formatElevationHTML(elevation) {
    if (elevation === null || elevation === undefined) {
      return '<div style="padding:4px;color:#999;font-size:12px">Elevation unavailable</div>';
    }

    const meters = Math.round(elevation);
    const feet = Math.round(elevation * 3.28084);

    let html = `
      <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:rgba(134,183,255,.1);border-radius:6px;font-size:12px;margin-top:6px">
        <span style="font-size:14px">⛰️</span>
        <span><strong>${meters} m</strong> (${feet} ft)</span>
      </div>
    `;

    // Add context about elevation
    if (meters > 3000) {
      html += '<div style="font-size:11px;color:#ff6b6b;margin-top:4px">⚠️ High altitude - expect cold temps</div>';
    } else if (meters > 2000) {
      html += '<div style="font-size:11px;color:#fdcb6e;margin-top:4px">ℹ️ Moderate altitude</div>';
    }

    return html;
  }

  /**
   * Get elevation HTML for a location
   */
  async function getElevationHTML(lat, lng) {
    const elevation = await fetchElevation(lat, lng);
    return formatElevationHTML(elevation);
  }

  /**
   * Add elevation to campsite popup
   */
  async function addElevationToPopup(lat, lng, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const elevation = await fetchElevation(lat, lng);
    const html = formatElevationHTML(elevation);

    // Insert after the campsite info, before weather
    const weatherDiv = container.querySelector('[id^="weather-"]');
    if (weatherDiv) {
      weatherDiv.insertAdjacentHTML('beforebegin', html);
    } else {
      container.insertAdjacentHTML('beforeend', html);
    }
  }

  // Export
  window.KampTrailElevation = {
    fetchElevation,
    getElevationHTML,
    addElevationToPopup,
    formatElevationHTML
  };
})();
