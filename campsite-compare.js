// campsite-compare.js - Compare multiple campsites side-by-side
(function() {
  'use strict';

  const state = {
    compareList: [],
    drawer: null,
    map: null
  };

  function loadCompareList() {
    try {
      const stored = localStorage.getItem('kt_compare_list');
      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        console.warn('⚠️ Compare list in localStorage is not an array, resetting');
        return [];
      }

      return parsed;
    } catch (err) {
      console.error('⚠️ Failed to load compare list from localStorage:', err.message);
      return [];
    }
  }

  function saveCompareList() {
    try {
      if (!Array.isArray(state.compareList)) {
        console.error('⚠️ Compare list is not an array, cannot save');
        return;
      }

      localStorage.setItem('kt_compare_list', JSON.stringify(state.compareList));
    } catch (err) {
      console.error('⚠️ Failed to save compare list:', err.message);

      // Check if it's a quota exceeded error
      if (err.name === 'QuotaExceededError') {
        window.showToast && window.showToast('Storage quota exceeded. Could not save comparison.', 'error');
      } else {
        window.showToast && window.showToast('Failed to save comparison list', 'error');
      }
    }
  }

  function addToCompare(campsiteId) {
    if (!campsiteId) return;

    if (state.compareList.includes(campsiteId)) {
      window.showToast && window.showToast('Campsite already in comparison', 'info');
      return;
    }

    if (state.compareList.length >= 4) {
      window.showToast && window.showToast('Maximum 4 campsites can be compared', 'error');
      return;
    }

    state.compareList.push(campsiteId);
    saveCompareList();
    updateCompareButton();
    window.showToast && window.showToast('Added to comparison', 'success', 2000);

    console.log('📊 Compare list:', state.compareList);
  }

  function removeFromCompare(campsiteId) {
    const index = state.compareList.indexOf(campsiteId);
    if (index > -1) {
      state.compareList.splice(index, 1);
      saveCompareList();
      updateCompareButton();
      renderComparisonPanel();
    }
  }

  function clearCompareList() {
    state.compareList = [];
    saveCompareList();
    updateCompareButton();
    renderComparisonPanel();
    window.showToast && window.showToast('Comparison cleared', 'info');
  }

  function updateCompareButton() {
    const btn = document.getElementById('compare-btn');
    const badge = document.getElementById('compare-count');

    if (btn && badge) {
      badge.textContent = `(${state.compareList.length})`;

      if (state.compareList.length > 0) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }

  function formatCost(cost) {
    if (cost === 0 || cost === null || cost === undefined) {
      return '<span style="color:#4CAF50;font-weight:bold;">FREE</span>';
    }
    return `<span style="color:#2196F3;font-weight:bold;">$${cost}/night</span>`;
  }

  function formatRating(rating) {
    if (!rating || rating === 0) {
      return '<span style="color:#999;">No ratings</span>';
    }
    const stars = '⭐'.repeat(Math.round(rating));
    return `<span>${stars} (${rating})</span>`;
  }

  function formatAmenities(amenities) {
    if (!amenities || amenities.length === 0) {
      return '<span style="color:#999;">None listed</span>';
    }
    const esc = window.escapeHtml || ((t) => t);
    return amenities.map(a => `<span class="kt-badge">${esc(a)}</span>`).join(' ');
  }

  function formatRigFriendly(rigFriendly) {
    if (!rigFriendly || rigFriendly.length === 0) {
      return '<span style="color:#999;">Not specified</span>';
    }
    const esc = window.escapeHtml || ((t) => t);
    return rigFriendly.map(r => `<span class="kt-badge">${esc(r)}</span>`).join(' ');
  }

  function renderComparisonPanel() {
    if (!state.drawer) {
      console.warn('⚠️ Drawer not initialized in renderComparisonPanel');
      return;
    }

    try {
      if (!window.KampTrailData || typeof window.KampTrailData.getCampsiteById !== 'function') {
        console.error('⚠️ KampTrailData not available');
        state.drawer.innerHTML = `
          <div style="padding:20px;text-align:center;">
            <h2 style="margin:0 0 16px 0;font-size:18px;color:var(--c-text);">🔍 Campsite Comparison</h2>
            <p style="color:#999;font-size:14px;margin:16px 0;">
              Data loader not available. Please refresh the page.
            </p>
            <div style="margin-top:24px;">
              <button onclick="KampTrailCompare.close()" class="btn">Close</button>
            </div>
          </div>
        `;
        return;
      }

      const campsites = state.compareList
        .map(id => {
          try {
            return window.KampTrailData.getCampsiteById(id);
          } catch (err) {
            console.warn(`⚠️ Error getting campsite ${id}:`, err.message);
            return null;
          }
        })
        .filter(Boolean);

    if (campsites.length === 0) {
      state.drawer.innerHTML = `
        <div style="padding:20px;text-align:center;">
          <h2 style="margin:0 0 16px 0;font-size:18px;color:var(--c-text);">🔍 Campsite Comparison</h2>
          <p style="color:#999;font-size:14px;margin:16px 0;">
            No campsites selected for comparison.<br>
            Add campsites from the map to compare them side-by-side.
          </p>
          <div style="margin-top:24px;display:flex;gap:8px;justify-content:center;">
            <button onclick="KampTrailCompare.close()" class="btn">Close</button>
          </div>
        </div>
      `;
      return;
    }

    const esc = window.escapeHtml || ((t) => t);

    // Build comparison table
    let html = `
      <div style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h2 style="margin:0;font-size:18px;color:var(--c-text);">🔍 Compare Campsites</h2>
          <div style="display:flex;gap:8px;">
            <button onclick="KampTrailCompare.clearAll()" class="btn" style="font-size:12px;padding:4px 10px;">Clear All</button>
            <button onclick="KampTrailCompare.close()" class="btn" style="font-size:12px;padding:4px 10px;">Close</button>
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:var(--c-panel);border-bottom:2px solid var(--c-border);">
                <th style="padding:10px;text-align:left;font-weight:bold;color:var(--c-text);min-width:120px;">Property</th>
    `;

    campsites.forEach((site, idx) => {
      html += `<th style="padding:10px;text-align:left;font-weight:bold;color:var(--c-text);min-width:200px;">Site ${idx + 1}</th>`;
    });

    html += `
              </tr>
            </thead>
            <tbody>
    `;

    // Name row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Name</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${esc(site.properties.name || 'Unnamed')}</td>`;
    });
    html += `</tr>`;

    // Cost row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Cost</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${formatCost(site.properties.cost)}</td>`;
    });
    html += `</tr>`;

    // Type row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Type</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${esc(site.properties.type || 'Unknown')}</td>`;
    });
    html += `</tr>`;

    // Rating row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Rating</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${formatRating(site.properties.rating)}</td>`;
    });
    html += `</tr>`;

    // Road difficulty row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Road</td>`;
    campsites.forEach(site => {
      const road = esc(site.properties.road_difficulty || 'Not specified');
      html += `<td style="padding:10px;">${road}</td>`;
    });
    html += `</tr>`;

    // Amenities row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Amenities</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${formatAmenities(site.properties.amenities)}</td>`;
    });
    html += `</tr>`;

    // Rig friendly row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">Rig Types</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${formatRigFriendly(site.properties.rig_friendly)}</td>`;
    });
    html += `</tr>`;

    // State row
    html += `<tr style="border-bottom:1px solid var(--c-border);"><td style="padding:10px;font-weight:bold;">State</td>`;
    campsites.forEach(site => {
      html += `<td style="padding:10px;">${esc(site.properties.state || 'Unknown')}</td>`;
    });
    html += `</tr>`;

    // Actions row
    html += `<tr><td style="padding:10px;font-weight:bold;">Actions</td>`;
    campsites.forEach(site => {
      try {
        if (!site.geometry || !Array.isArray(site.geometry.coordinates) ||
            site.geometry.coordinates.length < 2) {
          console.warn('⚠️ Invalid geometry for campsite in comparison');
          html += `<td style="padding:10px;"><div style="color:#999;">Invalid location</div></td>`;
          return;
        }

        const [lon, lat] = site.geometry.coordinates;

        // Validate coordinates
        if (typeof lat !== 'number' || typeof lon !== 'number' ||
            isNaN(lat) || isNaN(lon) ||
            lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          console.warn(`⚠️ Invalid coordinates in comparison: [${lon}, ${lat}]`);
          html += `<td style="padding:10px;"><div style="color:#999;">Invalid coordinates</div></td>`;
          return;
        }

        const safeId = esc(site.properties.id || '');
        html += `
          <td style="padding:10px;">
            <div style="display:flex;flex-direction:column;gap:6px;">
              <button onclick="KampTrailCompare.zoomTo(${lat}, ${lon})" class="btn" style="font-size:11px;padding:4px 8px;">📍 View on Map</button>
              <button onclick="KampTrailData.addToTrip('${safeId}')" class="btn" style="font-size:11px;padding:4px 8px;">➕ Add to Trip</button>
              <button onclick="KampTrailCompare.remove('${safeId}')" class="btn" style="font-size:11px;padding:4px 8px;">❌ Remove</button>
            </div>
          </td>
        `;
      } catch (siteErr) {
        console.error('⚠️ Error rendering actions for campsite:', siteErr.message);
        html += `<td style="padding:10px;"><div style="color:#999;">Error</div></td>`;
      }
    });
    html += `</tr>`;

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

      state.drawer.innerHTML = html;
    } catch (err) {
      console.error('⚠️ Error rendering comparison panel:', err.message);
      state.drawer.innerHTML = `
        <div style="padding:20px;text-align:center;">
          <h2 style="margin:0 0 16px 0;font-size:18px;color:var(--c-text);">🔍 Campsite Comparison</h2>
          <p style="color:#ff6b6b;font-size:14px;margin:16px 0;">
            Error loading comparison panel: ${err.message || 'Unknown error'}
          </p>
          <div style="margin-top:24px;display:flex;gap:8px;justify-content:center;">
            <button onclick="KampTrailCompare.clearAll()" class="btn">Clear All</button>
            <button onclick="KampTrailCompare.close()" class="btn">Close</button>
          </div>
        </div>
      `;
    }
  }

  function toggleDrawer() {
    if (!state.drawer) return;

    const isOpen = state.drawer.classList.contains('open');

    if (isOpen) {
      state.drawer.classList.remove('open');
    } else {
      renderComparisonPanel();
      state.drawer.classList.add('open');
    }
  }

  function closeDrawer() {
    if (state.drawer) {
      state.drawer.classList.remove('open');
    }
  }

  function zoomTo(lat, lon) {
    try {
      // Validate coordinates
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        console.error('⚠️ Invalid coordinate types in zoomTo');
        window.showToast && window.showToast('Invalid coordinates', 'error');
        return;
      }

      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        console.error(`⚠️ Coordinates out of range in zoomTo: lat=${lat}, lon=${lon}`);
        window.showToast && window.showToast('Coordinates out of valid range', 'error');
        return;
      }

      if (!state.map || typeof state.map.setView !== 'function') {
        console.error('⚠️ Map not available in zoomTo');
        window.showToast && window.showToast('Map not initialized', 'error');
        return;
      }

      state.map.setView([lat, lon], 14);
      closeDrawer();
    } catch (err) {
      console.error('⚠️ Error in zoomTo:', err.message);
      window.showToast && window.showToast('Error zooming to location', 'error');
    }
  }

  window.KampTrailCompare = {
    init(map) {
      console.log('📊 Initializing Campsite Comparison...');

      state.map = map;
      state.compareList = loadCompareList();

      // Create comparison button in header
      const compareBtn = document.createElement('button');
      compareBtn.id = 'compare-btn';
      compareBtn.className = 'btn';
      compareBtn.setAttribute('aria-label', 'Compare campsites');
      compareBtn.innerHTML = '⚖️ Compare <span id="compare-count">(0)</span>';

      compareBtn.addEventListener('click', toggleDrawer);

      const actions = document.querySelector('.actions');
      if (actions) {
        // Insert after filters button
        const filtersBtn = document.getElementById('filters');
        if (filtersBtn && filtersBtn.nextSibling) {
          actions.insertBefore(compareBtn, filtersBtn.nextSibling);
        } else {
          actions.appendChild(compareBtn);
        }
      }

      // Create drawer
      state.drawer = document.createElement('div');
      state.drawer.id = 'compare-drawer';
      state.drawer.className = 'compare-drawer';
      document.body.appendChild(state.drawer);

      // Add styles
      const style = document.createElement('style');
      style.textContent = `
        .compare-drawer {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(11, 20, 27, 0.95);
          z-index: 2000;
          overflow-y: auto;
          display: none;
        }
        .compare-drawer.open {
          display: block;
        }
        .compare-drawer table {
          color: var(--c-text);
        }
        .compare-drawer th {
          position: sticky;
          top: 0;
          background: var(--c-panel);
          z-index: 10;
        }
        @media (max-width: 768px) {
          .compare-drawer table {
            font-size: 11px;
          }
          .compare-drawer th, .compare-drawer td {
            padding: 6px !important;
            min-width: 120px !important;
          }
        }
      `;
      document.head.appendChild(style);

      updateCompareButton();

      console.log('✅ Campsite Comparison ready');
    },

    addToCompare,
    remove: removeFromCompare,
    clearAll: clearCompareList,
    toggle: toggleDrawer,
    close: closeDrawer,
    zoomTo,

    getCompareList() {
      return [...state.compareList];
    }
  };
})();
