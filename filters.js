/**
 * filters.js - Advanced filter system for KampTrail
 *
 * Features:
 * - Cost, type, rig size, road difficulty, amenities, rating filters
 * - Mobile-friendly bottom sheet on small screens
 * - Persistent filter state in localStorage
 * - Real-time filter count badge
 */

(function() {
  'use strict';

  const state = {
    filters: {
      cost: 'all',
      type: 'all',
      rigSize: 'all',
      roadDifficulty: 'all',
      amenities: [],
      minRating: 0
    },
    map: null,
    panel: null,
    resultCount: 0
  };

  // Load filters from localStorage
  function loadSavedFilters() {
    try {
      const saved = localStorage.getItem('kt_filters');
      if (saved) {
        state.filters = Object.assign(state.filters, JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Could not load saved filters:', e);
    }
  }

  // Save filters to localStorage
  function saveFilters() {
    try {
      localStorage.setItem('kt_filters', JSON.stringify(state.filters));
    } catch (e) {
      console.warn('Could not save filters:', e);
    }
  }

  // Count active filters
  function countActiveFilters() {
    let count = 0;
    if (state.filters.cost !== 'all') count++;
    if (state.filters.type !== 'all') count++;
    if (state.filters.rigSize !== 'all') count++;
    if (state.filters.roadDifficulty !== 'all') count++;
    if (state.filters.amenities.length > 0) count++;
    if (state.filters.minRating > 0) count++;
    return count;
  }

  // Build filter panel HTML
  function buildFilterPanel() {
    const panel = document.createElement('div');
    panel.className = 'kt-filter-panel';
    panel.id = 'kt-filter-panel';

    panel.innerHTML = `
      <div class="kt-filter-header">
        <h3>Filters <span class="kt-filter-badge" id="kt-filter-count">0</span></h3>
        <button class="kt-filter-toggle" id="kt-filter-toggle" aria-label="Toggle filters">
          <span class="arrow">▼</span>
        </button>
        <button class="kt-filter-reset" id="kt-filter-reset">Reset all</button>
      </div>

      <div class="kt-filter-body">
        <!-- Cost Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">💰 Cost</label>
          <div class="kt-filter-options">
            <label class="kt-filter-radio">
              <input type="radio" name="cost" value="all" checked>
              <span>All</span>
            </label>
            <label class="kt-filter-radio">
              <input type="radio" name="cost" value="free">
              <span>Free only</span>
            </label>
            <label class="kt-filter-radio">
              <input type="radio" name="cost" value="paid">
              <span>Paid only</span>
            </label>
          </div>
        </div>

        <!-- Type Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">🏕️ Site Type</label>
          <select class="kt-filter-select" id="filter-type">
            <option value="all">All types</option>
            <option value="dispersed">Dispersed / Boondocking</option>
            <option value="established">Established campground</option>
            <option value="parking">Overnight parking</option>
            <option value="other">Other</option>
          </select>
        </div>

        <!-- Rig Size Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">🚐 Rig Size</label>
          <select class="kt-filter-select" id="filter-rig">
            <option value="all">Any size</option>
            <option value="van">Van / Small RV</option>
            <option value="small_trailer">Small trailer</option>
            <option value="trailer">Standard trailer</option>
            <option value="big_rig">Big rig (40ft+)</option>
            <option value="tent">Tent camping</option>
          </select>
        </div>

        <!-- Road Difficulty Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">🛣️ Road Difficulty</label>
          <select class="kt-filter-select" id="filter-road">
            <option value="all">Any road condition</option>
            <option value="easy">Easy (paved/gravel)</option>
            <option value="moderate">Moderate (dirt road)</option>
            <option value="4wd">4WD required</option>
          </select>
        </div>

        <!-- Amenities Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">🚽 Amenities (select all that apply)</label>
          <div class="kt-filter-checkboxes">
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="toilet" data-amenity>
              <span>Toilet</span>
            </label>
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="water" data-amenity>
              <span>Water</span>
            </label>
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="dump" data-amenity>
              <span>Dump station</span>
            </label>
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="fire_ring" data-amenity>
              <span>Fire ring</span>
            </label>
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="picnic_table" data-amenity>
              <span>Picnic table</span>
            </label>
            <label class="kt-filter-checkbox">
              <input type="checkbox" value="shade" data-amenity>
              <span>Shade</span>
            </label>
          </div>
        </div>

        <!-- Rating Filter -->
        <div class="kt-filter-group">
          <label class="kt-filter-label">⭐ Minimum Rating</label>
          <div class="kt-filter-rating">
            <input type="range" id="filter-rating" min="0" max="5" step="0.5" value="0">
            <output id="filter-rating-value">Any rating</output>
          </div>
        </div>

        <!-- Result Count -->
        <div class="kt-filter-results">
          <span id="kt-filter-result-count">Loading...</span>
        </div>
      </div>
    `;

    return panel;
  }

  // Update filter badge count
  function updateFilterBadge() {
    const count = countActiveFilters();
    const badge = document.getElementById('kt-filter-count');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  // Update result count display
  function updateResultCount(count) {
    state.resultCount = count;
    const el = document.getElementById('kt-filter-result-count');
    if (el) {
      el.textContent = `Showing ${count.toLocaleString()} campsite${count !== 1 ? 's' : ''}`;
    }
  }

  // Apply current filters
  function applyFilters() {
    // Update global filter state for data-loader
    window.kamptrailFilters = state.filters;

    // Trigger data reload if KampTrailData is loaded
    if (window.KampTrailData && state.map) {
      window.KampTrailData.updateFilters(state.filters, state.map);

      // Update result count
      const filtered = window.KampTrailData.getAllCampsites().filter(site => {
        // Mirror logic from data-loader.js
        const p = site.properties;
        if (state.filters.cost === 'free' && (p.cost === null || p.cost > 0)) return false;
        if (state.filters.cost === 'paid' && p.cost === 0) return false;
        if (state.filters.type !== 'all' && p.type !== state.filters.type) return false;
        if (state.filters.rigSize !== 'all' && !p.rig_friendly.includes(state.filters.rigSize)) return false;
        if (state.filters.roadDifficulty !== 'all' && p.road_difficulty !== state.filters.roadDifficulty) return false;
        if (state.filters.amenities.length > 0) {
          const hasAll = state.filters.amenities.every(a => p.amenities.includes(a));
          if (!hasAll) return false;
        }
        if (state.filters.minRating > 0 && (p.rating === null || p.rating < state.filters.minRating)) return false;
        return true;
      });
      updateResultCount(filtered.length);
    }

    saveFilters();
    updateFilterBadge();
  }

  // Setup event listeners
  function setupEventListeners() {
    const panel = state.panel;

    // Toggle panel (mobile)
    const toggle = document.getElementById('kt-filter-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        panel.classList.toggle('expanded');
        const arrow = toggle.querySelector('.arrow');
        if (arrow) {
          arrow.textContent = panel.classList.contains('expanded') ? '▲' : '▼';
        }
      });
    }

    // Reset filters
    const reset = document.getElementById('kt-filter-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        state.filters = {
          cost: 'all',
          type: 'all',
          rigSize: 'all',
          roadDifficulty: 'all',
          amenities: [],
          minRating: 0
        };
        restoreFilterUI();
        applyFilters();
      });
    }

    // Cost filter (radio buttons)
    panel.querySelectorAll('input[name="cost"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.filters.cost = e.target.value;
        applyFilters();
      });
    });

    // Type filter
    const typeSelect = document.getElementById('filter-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        state.filters.type = e.target.value;
        applyFilters();
      });
    }

    // Rig size filter
    const rigSelect = document.getElementById('filter-rig');
    if (rigSelect) {
      rigSelect.addEventListener('change', (e) => {
        state.filters.rigSize = e.target.value;
        applyFilters();
      });
    }

    // Road difficulty filter
    const roadSelect = document.getElementById('filter-road');
    if (roadSelect) {
      roadSelect.addEventListener('change', (e) => {
        state.filters.roadDifficulty = e.target.value;
        applyFilters();
      });
    }

    // Amenities checkboxes
    panel.querySelectorAll('input[data-amenity]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const value = e.target.value;
        if (e.target.checked) {
          if (!state.filters.amenities.includes(value)) {
            state.filters.amenities.push(value);
          }
        } else {
          state.filters.amenities = state.filters.amenities.filter(a => a !== value);
        }
        applyFilters();
      });
    });

    // Rating slider
    const ratingSlider = document.getElementById('filter-rating');
    const ratingValue = document.getElementById('filter-rating-value');
    if (ratingSlider && ratingValue) {
      ratingSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        state.filters.minRating = value;
        ratingValue.textContent = value > 0 ? `${value}+ stars` : 'Any rating';
        applyFilters();
      });
    }
  }

  // Restore UI from current filter state
  function restoreFilterUI() {
    const panel = state.panel;

    // Cost
    const costRadio = panel.querySelector(`input[name="cost"][value="${state.filters.cost}"]`);
    if (costRadio) costRadio.checked = true;

    // Type
    const typeSelect = document.getElementById('filter-type');
    if (typeSelect) typeSelect.value = state.filters.type;

    // Rig size
    const rigSelect = document.getElementById('filter-rig');
    if (rigSelect) rigSelect.value = state.filters.rigSize;

    // Road
    const roadSelect = document.getElementById('filter-road');
    if (roadSelect) roadSelect.value = state.filters.roadDifficulty;

    // Amenities
    panel.querySelectorAll('input[data-amenity]').forEach(checkbox => {
      checkbox.checked = state.filters.amenities.includes(checkbox.value);
    });

    // Rating
    const ratingSlider = document.getElementById('filter-rating');
    const ratingValue = document.getElementById('filter-rating-value');
    if (ratingSlider) {
      ratingSlider.value = state.filters.minRating;
      if (ratingValue) {
        ratingValue.textContent = state.filters.minRating > 0 
          ? `${state.filters.minRating}+ stars` 
          : 'Any rating';
      }
    }

    updateFilterBadge();
  }

  // Add styles to page
  function injectStyles() {
    if (document.getElementById('kt-filter-styles')) return;

    const style = document.createElement('style');
    style.id = 'kt-filter-styles';
    style.textContent = `
      .kt-filter-panel {
        position: absolute;
        top: 70px;
        left: 12px;
        width: 320px;
        max-width: calc(100vw - 24px);
        background: rgba(15, 27, 36, 0.98);
        border: 1px solid #284356;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,.4);
        z-index: 1001;
        max-height: calc(100vh - 150px);
        display: flex;
        flex-direction: column;
      }

      .kt-filter-header {
        padding: 12px;
        border-bottom: 1px solid #284356;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .kt-filter-header h3 {
        margin: 0;
        font-size: 15px;
        color: #cfe3f2;
        flex: 1;
      }

      .kt-filter-badge {
        display: inline-block;
        background: #e17055;
        color: #fff;
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 10px;
        font-weight: bold;
        margin-left: 6px;
      }

      .kt-filter-toggle {
        display: none;
        background: transparent;
        border: none;
        color: #9fd0ff;
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
      }

      .kt-filter-reset {
        background: #173243;
        border: 1px solid #284356;
        color: #9fd0ff;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
      }

      .kt-filter-reset:hover {
        background: #1f3d52;
      }

      .kt-filter-body {
        padding: 12px;
        overflow-y: auto;
        flex: 1;
      }

      .kt-filter-group {
        margin-bottom: 16px;
      }

      .kt-filter-label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: #9fd0ff;
        margin-bottom: 8px;
      }

      .kt-filter-options {
        display: flex;
        gap: 10px;
      }

      .kt-filter-radio {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 13px;
        color: #cfe3f2;
      }

      .kt-filter-radio input[type="radio"] {
        accent-color: #86b7ff;
      }

      .kt-filter-select {
        width: 100%;
        padding: 8px;
        background: #0b141b;
        border: 1px solid #284356;
        border-radius: 6px;
        color: #cfe3f2;
        font-size: 13px;
      }

      .kt-filter-select:focus {
        outline: 2px solid #86b7ff;
        outline-offset: 2px;
      }

      .kt-filter-checkboxes {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .kt-filter-checkbox {
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 12px;
        color: #cfe3f2;
      }

      .kt-filter-checkbox input[type="checkbox"] {
        accent-color: #86b7ff;
      }

      .kt-filter-rating {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .kt-filter-rating input[type="range"] {
        width: 100%;
        accent-color: #86b7ff;
      }

      .kt-filter-rating output {
        font-size: 13px;
        color: #feca57;
        font-weight: 600;
      }

      .kt-filter-results {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid #284356;
        text-align: center;
        font-size: 13px;
        color: #9fd0ff;
        font-weight: 600;
      }

      /* Mobile styles */
      @media (max-width: 768px) {
        .kt-filter-panel {
          position: fixed;
          top: auto;
          bottom: 0;
          left: 0;
          right: 0;
          width: 100%;
          max-width: 100%;
          border-radius: 16px 16px 0 0;
          max-height: 70vh;
          transform: translateY(calc(100% - 52px));
          transition: transform 0.3s ease;
        }

        .kt-filter-panel.expanded {
          transform: translateY(0);
        }

        .kt-filter-toggle {
          display: block;
        }

        .kt-filter-header {
          cursor: pointer;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Public API
  window.KampTrailFilters = {
    init(map) {
      state.map = map;

      // Load saved filters
      loadSavedFilters();

      // Inject styles
      injectStyles();

      // Build and add panel
      state.panel = buildFilterPanel();
      map._container.appendChild(state.panel);
      L.DomEvent.disableClickPropagation(state.panel);

      // Setup listeners
      setupEventListeners();

      // Restore UI from saved state
      restoreFilterUI();

      // Apply initial filters
      applyFilters();

      console.log('✅ KampTrail Filters initialized');
    },

    getFilters() {
      return Object.assign({}, state.filters);
    },

    setFilter(key, value) {
      if (key in state.filters) {
        state.filters[key] = value;
        restoreFilterUI();
        applyFilters();
      }
    },

    resetFilters() {
      state.filters = {
        cost: 'all',
        type: 'all',
        rigSize: 'all',
        roadDifficulty: 'all',
        amenities: [],
        minRating: 0
      };
      restoreFilterUI();
      applyFilters();
    }
  };
})();
