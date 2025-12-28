/**
 * KampTrail Offline Maps Module
 * Allows users to download map tiles for offline use
 */
(function () {
  'use strict';

  const CACHE_NAME = 'kt-offline-maps';
  const MAX_ZOOM = 13; // Max zoom level to download (prevents excessive downloads)

  const state = {
    map: null,
    downloading: false,
    downloadedRegions: [],
    currentDownload: null,
    panel: null
  };

  /**
   * Calculate the number of tiles needed for a bounding box
   */
  function calculateTileCount(bounds, minZoom, maxZoom) {
    let count = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
      const nw = latLngToTile(bounds.getNorthWest().lat, bounds.getNorthWest().lng, z);
      const se = latLngToTile(bounds.getSouthEast().lat, bounds.getSouthEast().lng, z);
      const width = Math.abs(se.x - nw.x) + 1;
      const height = Math.abs(se.y - nw.y) + 1;
      count += width * height;
    }
    return count;
  }

  /**
   * Convert lat/lng to tile coordinates
   */
  function latLngToTile(lat, lng, zoom) {
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
    const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    return { x, z: zoom, y };
  }

  /**
   * Generate tile URLs for a bounding box
   */
  function getTileUrls(bounds, minZoom, maxZoom, urlTemplate) {
    const urls = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const nw = latLngToTile(bounds.getNorthWest().lat, bounds.getNorthWest().lng, z);
      const se = latLngToTile(bounds.getSouthEast().lat, bounds.getSouthEast().lng, z);

      for (let x = Math.min(nw.x, se.x); x <= Math.max(nw.x, se.x); x++) {
        for (let y = Math.min(nw.y, se.y); y <= Math.max(nw.y, se.y); y++) {
          const url = urlTemplate
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y);
          urls.push(url);
        }
      }
    }
    return urls;
  }

  /**
   * Download tiles to cache
   */
  async function downloadTiles(bounds, minZoom, maxZoom, onProgress) {
    const urlTemplate = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const urls = getTileUrls(bounds, minZoom, maxZoom, urlTemplate);

    const cache = await caches.open(CACHE_NAME);
    let downloaded = 0;
    const total = urls.length;

    // Download in batches to avoid overwhelming the server
    const batchSize = 10;
    for (let i = 0; i < urls.length; i += batchSize) {
      if (!state.downloading) break; // User cancelled

      const batch = urls.slice(i, i + batchSize);
      await Promise.all(batch.map(async (url) => {
        try {
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(url, response.clone());
          }
          downloaded++;
          if (onProgress) onProgress(downloaded, total);
        } catch (err) {
          console.warn('Failed to download tile:', url, err);
          downloaded++;
          if (onProgress) onProgress(downloaded, total);
        }
      }));

      // Small delay between batches to be polite to the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return downloaded;
  }

  /**
   * Get size of cached tiles
   */
  async function getCacheSize() {
    if (!('storage' in navigator && 'estimate' in navigator.storage)) {
      return { usage: 0, quota: 0 };
    }
    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: Math.round((estimate.usage || 0) / 1024 / 1024), // MB
        quota: Math.round((estimate.quota || 0) / 1024 / 1024)  // MB
      };
    } catch {
      return { usage: 0, quota: 0 };
    }
  }

  /**
   * Clear offline map cache
   */
  async function clearCache() {
    try {
      await caches.delete(CACHE_NAME);
      state.downloadedRegions = [];
      localStorage.removeItem('kt_offline_regions');
      return true;
    } catch (err) {
      console.error('Failed to clear cache:', err);
      return false;
    }
  }

  /**
   * Create the offline maps panel UI
   */
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'offline-maps-panel';
    panel.style.cssText = `
      position: fixed;
      top: 70px;
      right: 12px;
      width: 320px;
      max-height: calc(100vh - 180px);
      background: var(--c-panel, #0f1b24);
      border: 1px solid var(--c-border, #22313f);
      border-radius: 12px;
      padding: 16px;
      display: none;
      z-index: 1001;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,.3);
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:15px">📥 Offline Maps</h3>
        <button id="close-offline-panel" style="background:none;border:none;color:var(--c-text);cursor:pointer;font-size:20px;padding:0;line-height:1">&times;</button>
      </div>

      <div style="margin-bottom:16px;padding:10px;background:rgba(134,183,255,.1);border-radius:8px;font-size:13px;line-height:1.4">
        Download map tiles for the current view to use offline. Higher zoom levels require more storage.
      </div>

      <div style="margin-bottom:12px">
        <label style="display:block;font-size:13px;margin-bottom:6px">Download current view:</label>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button id="download-current" class="btn" style="flex:1">Download</button>
        </div>
        <div style="font-size:12px;color:var(--c-sub)">
          Zoom: <span id="current-zoom">-</span> |
          Tiles: <span id="tile-estimate">-</span>
        </div>
      </div>

      <div id="download-progress" style="display:none;margin-bottom:12px">
        <div style="background:rgba(134,183,255,.2);border-radius:8px;height:24px;overflow:hidden;position:relative">
          <div id="progress-bar" style="background:var(--c-accent);height:100%;width:0;transition:width .2s"></div>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600" id="progress-text">0%</div>
        </div>
        <button id="cancel-download" class="btn" style="width:100%;margin-top:8px">Cancel</button>
      </div>

      <div style="margin-bottom:12px">
        <div style="font-size:13px;margin-bottom:6px">Storage:</div>
        <div style="font-size:12px;color:var(--c-sub)">
          <span id="cache-usage">-</span> MB used of <span id="cache-quota">-</span> MB
        </div>
      </div>

      <div>
        <button id="clear-offline-cache" class="btn" style="width:100%;background:#3d1a1a;border-color:#ff6b6b">Clear All Offline Maps</button>
      </div>
    `;

    document.body.appendChild(panel);
    state.panel = panel;

    // Event listeners
    panel.querySelector('#close-offline-panel').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    panel.querySelector('#download-current').addEventListener('click', startDownload);
    panel.querySelector('#cancel-download').addEventListener('click', cancelDownload);
    panel.querySelector('#clear-offline-cache').addEventListener('click', async () => {
      if (confirm('Clear all offline map tiles? This cannot be undone.')) {
        const success = await clearCache();
        if (success) {
          showToast && showToast('Offline maps cleared', 'success');
          updateCacheInfo();
        } else {
          showToast && showToast('Failed to clear cache', 'error');
        }
      }
    });

    return panel;
  }

  /**
   * Update tile estimate and cache info
   */
  async function updatePanelInfo() {
    if (!state.panel) return;

    const zoom = state.map.getZoom();
    const bounds = state.map.getBounds();

    // Update current zoom
    document.getElementById('current-zoom').textContent = zoom;

    // Estimate tiles (download from current zoom to max)
    const minZoom = Math.max(zoom, 8); // Don't go below zoom 8
    const maxZoom = Math.min(zoom + 2, MAX_ZOOM); // Download 2 zoom levels ahead
    const tileCount = calculateTileCount(bounds, minZoom, maxZoom);
    document.getElementById('tile-estimate').textContent = tileCount.toLocaleString();

    // Update cache info
    await updateCacheInfo();
  }

  /**
   * Update cache size info
   */
  async function updateCacheInfo() {
    const { usage, quota } = await getCacheSize();
    const usageEl = document.getElementById('cache-usage');
    const quotaEl = document.getElementById('cache-quota');
    if (usageEl) usageEl.textContent = usage;
    if (quotaEl) quotaEl.textContent = quota;
  }

  /**
   * Start downloading tiles
   */
  async function startDownload() {
    if (state.downloading) return;

    const zoom = state.map.getZoom();
    const bounds = state.map.getBounds();
    const minZoom = Math.max(zoom, 8);
    const maxZoom = Math.min(zoom + 2, MAX_ZOOM);

    state.downloading = true;
    state.currentDownload = { bounds, minZoom, maxZoom };

    // Show progress
    const progressDiv = document.getElementById('download-progress');
    const downloadBtn = document.getElementById('download-current');
    if (progressDiv) progressDiv.style.display = 'block';
    if (downloadBtn) downloadBtn.disabled = true;

    try {
      await downloadTiles(bounds, minZoom, maxZoom, (downloaded, total) => {
        const percent = Math.round((downloaded / total) * 100);
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-text');
        if (bar) bar.style.width = percent + '%';
        if (text) text.textContent = `${percent}% (${downloaded}/${total})`;
      });

      if (state.downloading) { // Not cancelled
        showToast && showToast(`Downloaded ${getTileCount()} tiles`, 'success');

        // Save region info
        state.downloadedRegions.push({
          bounds: {
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
          },
          minZoom,
          maxZoom,
          date: new Date().toISOString()
        });
        localStorage.setItem('kt_offline_regions', JSON.stringify(state.downloadedRegions));
      }
    } catch (err) {
      console.error('Download failed:', err);
      showToast && showToast('Download failed', 'error');
    } finally {
      state.downloading = false;
      state.currentDownload = null;
      if (progressDiv) progressDiv.style.display = 'none';
      if (downloadBtn) downloadBtn.disabled = false;
      await updateCacheInfo();
    }
  }

  function getTileCount() {
    if (!state.currentDownload) return 0;
    const { bounds, minZoom, maxZoom } = state.currentDownload;
    return calculateTileCount(L.latLngBounds(
      L.latLng(bounds.getSouth(), bounds.getWest()),
      L.latLng(bounds.getNorth(), bounds.getEast())
    ), minZoom, maxZoom);
  }

  /**
   * Cancel current download
   */
  function cancelDownload() {
    state.downloading = false;
    showToast && showToast('Download cancelled', 'info');
  }

  /**
   * Toggle panel visibility
   */
  function togglePanel() {
    if (!state.panel) createPanel();
    const isVisible = state.panel.style.display !== 'none';
    state.panel.style.display = isVisible ? 'none' : 'block';

    if (!isVisible) {
      updatePanelInfo();
    }
  }

  /**
   * Initialize the offline maps module
   */
  function init(mapInstance) {
    state.map = mapInstance;

    // Load saved regions
    try {
      const saved = localStorage.getItem('kt_offline_regions');
      if (saved) state.downloadedRegions = JSON.parse(saved);
    } catch {}

    // Create panel
    createPanel();

    // Add button to header
    const header = document.querySelector('header .actions');
    if (header) {
      const btn = document.createElement('button');
      btn.id = 'offline-maps-btn';
      btn.className = 'btn';
      btn.innerHTML = '📥 Offline';
      btn.setAttribute('aria-label', 'Offline maps');
      btn.addEventListener('click', togglePanel);

      // Insert before "Near me" button
      const nearBtn = document.getElementById('near');
      if (nearBtn) {
        header.insertBefore(btn, nearBtn);
      } else {
        header.appendChild(btn);
      }
    }

    // Update info when map moves
    state.map.on('moveend', () => {
      if (state.panel && state.panel.style.display !== 'none') {
        updatePanelInfo();
      }
    });

    console.log('[Offline Maps] Initialized');
  }

  // Export
  window.KampTrailOffline = {
    init,
    togglePanel,
    clearCache,
    getCacheSize
  };
})();
