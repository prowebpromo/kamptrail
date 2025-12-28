/**
 * KampTrail Extended Features
 * Includes: Comparison, Recent Activity, Share, Route Optimization, GPX Import, PDF Export, Bookmarks
 */
(function () {
  'use strict';

  // ========== RECENT ACTIVITY ==========
  const RecentActivity = {
    maxItems: 10,

    track(siteId, siteName) {
      try {
        const recent = JSON.parse(localStorage.getItem('kt_recent') || '[]');

        // Remove if already exists
        const filtered = recent.filter(item => item.id !== siteId);

        // Add to front
        filtered.unshift({
          id: siteId,
          name: siteName,
          timestamp: Date.now()
        });

        // Keep only max items
        const trimmed = filtered.slice(0, this.maxItems);

        localStorage.setItem('kt_recent', JSON.stringify(trimmed));
      } catch (e) {
        console.error('Failed to track activity:', e);
      }
    },

    getRecent() {
      try {
        return JSON.parse(localStorage.getItem('kt_recent') || '[]');
      } catch {
        return [];
      }
    },

    clear() {
      localStorage.removeItem('kt_recent');
    }
  };

  // ========== CAMPSITE COMPARISON ==========
  const Comparison = {
    sites: [],
    maxSites: 3,

    add(siteId) {
      if (this.sites.includes(siteId)) return;
      if (this.sites.length >= this.maxSites) {
        showToast && showToast(`Maximum ${this.maxSites} sites for comparison`, 'error');
        return;
      }
      this.sites.push(siteId);
      this.save();
      this.render();
    },

    remove(siteId) {
      this.sites = this.sites.filter(id => id !== siteId);
      this.save();
      this.render();
    },

    clear() {
      this.sites = [];
      this.save();
      this.render();
    },

    save() {
      try {
        localStorage.setItem('kt_comparison', JSON.stringify(this.sites));
      } catch (e) {
        console.error('Failed to save comparison:', e);
      }
    },

    load() {
      try {
        this.sites = JSON.parse(localStorage.getItem('kt_comparison') || '[]');
      } catch {
        this.sites = [];
      }
    },

    render() {
      const badge = document.getElementById('compare-badge');
      if (badge) {
        badge.textContent = this.sites.length > 0 ? `(${this.sites.length})` : '';
      }
    },

    openPanel() {
      if (this.sites.length === 0) {
        showToast && showToast('Add sites to comparison first', 'info');
        return;
      }

      let html = '<div style="padding:16px;background:var(--c-panel);border-radius:12px;max-width:800px">';
      html += '<h3 style="margin:0 0 12px 0">📊 Campsite Comparison</h3>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
      html += '<tr style="background:rgba(134,183,255,.1)">';
      html += '<th style="padding:8px;text-align:left">Property</th>';

      this.sites.forEach(id => {
        const site = window.KampTrailData?.getCampsiteById(id);
        const name = site ? (site.properties.name || 'Campsite') : 'Unknown';
        html += `<th style="padding:8px">${name}</th>`;
      });

      html += '</tr>';

      // Compare properties
      const properties = ['cost', 'type', 'rating', 'road_difficulty'];
      properties.forEach(prop => {
        html += '<tr>';
        html += `<td style="padding:8px;border-top:1px solid rgba(255,255,255,.1)">${prop}</td>`;

        this.sites.forEach(id => {
          const site = window.KampTrailData?.getCampsiteById(id);
          const value = site ? (site.properties[prop] || 'N/A') : 'N/A';
          html += `<td style="padding:8px;border-top:1px solid rgba(255,255,255,.1);text-align:center">${value}</td>`;
        });

        html += '</tr>';
      });

      html += '</table>';
      html += `<button onclick="KampTrailExtended.clearComparison()" style="margin-top:12px;padding:8px 16px;background:#3d1a1a;color:#ff6b6b;border:1px solid #ff6b6b;border-radius:6px;cursor:pointer">Clear Comparison</button>`;
      html += '</div>';

      // Show in a modal-like toast
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;display:grid;place-items:center;padding:20px';
      modal.innerHTML = html;
      modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
      };
      document.body.appendChild(modal);
    }
  };

  // ========== SHARE FUNCTIONALITY ==========
  const Share = {
    shareSite(siteId) {
      const site = window.KampTrailData?.getCampsiteById(siteId);
      if (!site) return;

      const [lng, lat] = site.geometry.coordinates;
      const name = site.properties.name || 'Campsite';
      const url = `${window.location.origin}${window.location.pathname}#${lat},${lng},12`;
      const text = `Check out ${name} on KampTrail`;

      if (navigator.share) {
        navigator.share({ title: name, text, url })
          .catch(() => this.copyLink(url));
      } else {
        this.copyLink(url);
      }
    },

    shareTrip() {
      const trip = window.KampTrailTrip?.getActiveTrip();
      if (!trip || trip.stops.length === 0) {
        showToast && showToast('No trip to share', 'error');
        return;
      }

      const text = `My ${trip.name} camping trip with ${trip.stops.length} stops`;
      const url = window.location.href;

      if (navigator.share) {
        navigator.share({ title: trip.name, text, url })
          .catch(() => this.copyLink(url));
      } else {
        this.copyLink(url);
      }
    },

    copyLink(url) {
      navigator.clipboard.writeText(url).then(() => {
        showToast && showToast('Link copied to clipboard', 'success');
      }).catch(() => {
        showToast && showToast('Failed to copy link', 'error');
      });
    }
  };

  // ========== GPX IMPORT ==========
  const GPXImport = {
    import() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gpx';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          this.parseGPX(event.target.result);
        };
        reader.readAsText(file);
      };
      input.click();
    },

    parseGPX(gpxText) {
      try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(gpxText, 'text/xml');
        const waypoints = xml.getElementsByTagName('wpt');

        if (waypoints.length === 0) {
          showToast && showToast('No waypoints found in GPX', 'error');
          return;
        }

        // Extract waypoints
        const points = [];
        for (let i = 0; i < waypoints.length; i++) {
          const wpt = waypoints[i];
          const lat = parseFloat(wpt.getAttribute('lat'));
          const lng = parseFloat(wpt.getAttribute('lon'));
          const name = wpt.getElementsByTagName('name')[0]?.textContent || `Point ${i + 1}`;

          points.push({ lat, lng, name });
        }

        showToast && showToast(`Imported ${points.length} waypoints`, 'success');

        // Add markers to map
        points.forEach(point => {
          L.marker([point.lat, point.lng])
            .bindPopup(`<strong>${point.name}</strong><br>Imported from GPX`)
            .addTo(window.kamptrailMap || map);
        });

      } catch (e) {
        console.error('GPX parse error:', e);
        showToast && showToast('Failed to parse GPX file', 'error');
      }
    }
  };

  // ========== PDF EXPORT ==========
  const PDFExport = {
    async exportTrip() {
      const trip = window.KampTrailTrip?.getActiveTrip();
      if (!trip || trip.stops.length === 0) {
        showToast && showToast('No trip to export', 'error');
        return;
      }

      // Create simple text version (real PDF would need jsPDF library)
      let text = `${trip.name}\n`;
      text += `${'='.repeat(trip.name.length)}\n\n`;
      text += `Total Stops: ${trip.stops.length}\n\n`;

      trip.stops.forEach((id, i) => {
        const site = window.KampTrailData?.getCampsiteById(id);
        if (site) {
          const p = site.properties;
          const [lng, lat] = site.geometry.coordinates;
          text += `${i + 1}. ${p.name || 'Campsite'}\n`;
          text += `   Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}\n`;
          text += `   Cost: ${p.cost === 0 ? 'FREE' : `$${p.cost}/night`}\n`;
          text += `   Type: ${p.type || 'Unknown'}\n\n`;
        }
      });

      // Download as text file (PDF would require library)
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${trip.name.replace(/\s+/g, '_')}_Trip.txt`;
      a.click();
      URL.revokeObjectURL(url);

      showToast && showToast('Trip exported as text file', 'success');
    }
  };

  // ========== BOOKMARKED MAP VIEWS ==========
  const Bookmarks = {
    views: [],

    load() {
      try {
        this.views = JSON.parse(localStorage.getItem('kt_bookmarks') || '[]');
      } catch {
        this.views = [];
      }
    },

    save() {
      try {
        localStorage.setItem('kt_bookmarks', JSON.stringify(this.views));
      } catch (e) {
        console.error('Failed to save bookmarks:', e);
      }
    },

    add(map) {
      const name = prompt('Bookmark name:');
      if (!name) return;

      const center = map.getCenter();
      const zoom = map.getZoom();

      this.views.push({
        id: 'bm_' + Date.now(),
        name: name.trim(),
        lat: center.lat,
        lng: center.lng,
        zoom: zoom,
        timestamp: Date.now()
      });

      this.save();
      showToast && showToast('View bookmarked', 'success');
    },

    restore(id, map) {
      const view = this.views.find(v => v.id === id);
      if (view) {
        map.setView([view.lat, view.lng], view.zoom);
        showToast && showToast(`Restored: ${view.name}`, 'success');
      }
    },

    delete(id) {
      this.views = this.views.filter(v => v.id !== id);
      this.save();
    },

    openPanel(map) {
      let html = '<div style="padding:16px;background:var(--c-panel);border-radius:12px;min-width:300px">';
      html += '<h3 style="margin:0 0 12px 0">🔖 Bookmarked Views</h3>';

      if (this.views.length === 0) {
        html += '<p style="opacity:.7">No bookmarks yet</p>';
      } else {
        this.views.forEach(view => {
          html += `
            <div style="padding:8px;border:1px solid #284356;border-radius:6px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
              <div onclick="KampTrailExtended.restoreBookmark('${view.id}')" style="cursor:pointer;flex:1">
                <strong>${view.name}</strong>
                <div style="font-size:11px;opacity:.7">${view.lat.toFixed(4)}, ${view.lng.toFixed(4)} (z${view.zoom})</div>
              </div>
              <button onclick="KampTrailExtended.deleteBookmark('${view.id}')" style="padding:4px 8px;background:#3d1a1a;color:#ff6b6b;border:none;border-radius:4px;cursor:pointer">🗑️</button>
            </div>
          `;
        });
      }

      html += `<button onclick="KampTrailExtended.addBookmark()" style="width:100%;margin-top:8px;padding:8px;background:#173243;color:#86b7ff;border:1px solid #284356;border-radius:6px;cursor:pointer">+ Add Current View</button>`;
      html += '</div>';

      const modal = document.createElement('div');
      modal.id = 'bookmarks-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;display:grid;place-items:center;padding:20px';
      modal.innerHTML = html;
      modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
      };
      document.body.appendChild(modal);
    }
  };

  // ========== ROUTE OPTIMIZATION ==========
  const RouteOptimization = {
    async optimize() {
      const trip = window.KampTrailTrip?.getActiveTrip();
      if (!trip || trip.stops.length < 3) {
        showToast && showToast('Need at least 3 stops to optimize', 'info');
        return;
      }

      showToast && showToast('Optimizing route...', 'info', 3000);

      // Simple nearest neighbor optimization
      const sites = trip.stops.map(id => {
        const site = window.KampTrailData?.getCampsiteById(id);
        if (!site) return null;
        const [lng, lat] = site.geometry.coordinates;
        return { id, lat, lng };
      }).filter(Boolean);

      if (sites.length < 3) return;

      // Start from first site
      const optimized = [sites[0]];
      const remaining = sites.slice(1);

      while (remaining.length > 0) {
        const current = optimized[optimized.length - 1];
        let nearest = null;
        let minDist = Infinity;

        remaining.forEach((site, index) => {
          const dist = this.distance(current.lat, current.lng, site.lat, site.lng);
          if (dist < minDist) {
            minDist = dist;
            nearest = { site, index };
          }
        });

        if (nearest) {
          optimized.push(nearest.site);
          remaining.splice(nearest.index, 1);
        }
      }

      // Update trip
      trip.stops = optimized.map(s => s.id);
      trip.modified = Date.now();

      if (window.KampTrailTrip) {
        // Trigger save and re-render
        localStorage.setItem('kt_trips', JSON.stringify(window.KampTrailTrip.getTrips()));
      }

      showToast && showToast('Route optimized', 'success');
      window.location.reload(); // Refresh to show optimized route
    },

    distance(lat1, lng1, lat2, lng2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }
  };

  // ========== INITIALIZATION ==========
  function init(map) {
    window.kamptrailMap = map;

    Comparison.load();
    Bookmarks.load();

    // Add buttons to UI
    addUIButtons();

    // Track recent activity on popup open
    if (map) {
      map.on('popupopen', (e) => {
        const popup = e.popup;
        const content = popup.getContent();

        // Extract site ID from popup content
        const match = content.match(/popup-([^"]+)/);
        if (match) {
          const siteId = match[1];
          const site = window.KampTrailData?.getCampsiteById(siteId);
          if (site) {
            RecentActivity.track(siteId, site.properties.name || 'Campsite');
          }
        }
      });
    }

    console.log('[Extended Features] Initialized');
  }

  function addUIButtons() {
    // Add menu button for extended features
    const header = document.querySelector('header .actions');
    if (header) {
      const btn = document.createElement('button');
      btn.id = 'extended-menu-btn';
      btn.className = 'btn';
      btn.innerHTML = '⚡ More';
      btn.setAttribute('aria-label', 'More features');
      btn.addEventListener('click', showExtendedMenu);
      header.appendChild(btn);
    }
  }

  function showExtendedMenu() {
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;top:60px;right:12px;background:var(--c-panel);border:1px solid var(--c-border);border-radius:12px;padding:12px;z-index:2001;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,.3)';

    menu.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">Extended Features</div>
      <button onclick="KampTrailExtended.importGPX()" class="btn" style="width:100%;margin-bottom:6px;justify-content:flex-start">📥 Import GPX</button>
      <button onclick="KampTrailExtended.exportPDF()" class="btn" style="width:100%;margin-bottom:6px;justify-content:flex-start">📄 Export Trip as PDF</button>
      <button onclick="KampTrailExtended.optimizeRoute()" class="btn" style="width:100%;margin-bottom:6px;justify-content:flex-start">🔀 Optimize Route</button>
      <button onclick="KampTrailExtended.openBookmarks()" class="btn" style="width:100%;margin-bottom:6px;justify-content:flex-start">🔖 Bookmarks</button>
      <button onclick="KampTrailExtended.shareTrip()" class="btn" style="width:100%;justify-content:flex-start">📤 Share Trip</button>
    `;

    menu.onclick = (e) => e.stopPropagation();
    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      });
    }, 100);
  }

  // Export
  window.KampTrailExtended = {
    init,
    trackActivity: (id, name) => RecentActivity.track(id, name),
    addToComparison: (id) => Comparison.add(id),
    removeFromComparison: (id) => Comparison.remove(id),
    clearComparison: () => Comparison.clear(),
    openComparison: () => Comparison.openPanel(),
    shareSite: (id) => Share.shareSite(id),
    shareTrip: () => Share.shareTrip(),
    importGPX: () => GPXImport.import(),
    exportPDF: () => PDFExport.exportTrip(),
    addBookmark: () => Bookmarks.add(window.kamptrailMap),
    restoreBookmark: (id) => Bookmarks.restore(id, window.kamptrailMap),
    deleteBookmark: (id) => {
      Bookmarks.delete(id);
      document.getElementById('bookmarks-modal')?.remove();
      Bookmarks.openPanel();
    },
    openBookmarks: () => Bookmarks.openPanel(window.kamptrailMap),
    optimizeRoute: () => RouteOptimization.optimize()
  };
})();
