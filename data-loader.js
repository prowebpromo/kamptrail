/* data-loader.js - FULL REPLACEMENT - FIXED VERSION
   Fixes:
   1) Duplicate campsites across merged sources (stable siteKey dedupe)
   2) Stray placeholder / junk records (bad names, 0,0 coords, missing geometry)
   3) Robust state file loading (tries multiple merged paths, falls back cleanly)
   4) Filter logic fixes (FREE includes null/0, PAID is > 0)
   5) Safer property normalization (name/type/cost/rating/amenities/rig)
*/

(function () {
  "use strict";

  const state = {
    allCampsites: [],
    loadedStates: new Set(),
    loading: new Set(),

    // Strong dedupe across all loads (not just per-state)
    loadedSiteKeys: new Set(),

    index: null,
    clusterGroup: null,
    config: {},
  };

  const STATE_BOUNDS = {
    AL: { s: 30.2, w: -88.5, n: 35.0, e: -84.9 },
    AK: { s: 51.2, w: -179.1, n: 71.4, e: -129.9 },
    AZ: { s: 31.3, w: -114.8, n: 37.0, e: -109.0 },
    AR: { s: 33.0, w: -94.6, n: 36.5, e: -89.6 },
    CA: { s: 32.5, w: -124.4, n: 42.0, e: -114.1 },
    CO: { s: 37.0, w: -109.1, n: 41.0, e: -102.0 },
    CT: { s: 41.0, w: -73.7, n: 42.1, e: -71.8 },
    DE: { s: 38.5, w: -75.8, n: 39.8, e: -75.0 },
    FL: { s: 24.5, w: -87.6, n: 31.0, e: -79.9 },
    GA: { s: 30.4, w: -85.6, n: 35.0, e: -80.8 },
    HI: { s: 18.9, w: -160.2, n: 22.2, e: -154.8 },
    ID: { s: 42.0, w: -117.2, n: 49.0, e: -111.0 },
    IL: { s: 37.0, w: -91.5, n: 42.5, e: -87.5 },
    IN: { s: 37.8, w: -88.1, n: 41.8, e: -84.8 },
    IA: { s: 40.4, w: -96.6, n: 43.5, e: -90.1 },
    KS: { s: 37.0, w: -102.1, n: 40.0, e: -94.6 },
    KY: { s: 36.5, w: -89.6, n: 39.1, e: -81.9 },
    LA: { s: 29.0, w: -94.0, n: 33.0, e: -89.0 },
    ME: { s: 43.1, w: -71.1, n: 47.5, e: -66.9 },
    MD: { s: 37.9, w: -79.5, n: 39.7, e: -75.0 },
    MA: { s: 41.2, w: -73.5, n: 42.9, e: -69.9 },
    MI: { s: 41.7, w: -90.4, n: 48.3, e: -82.4 },
    MN: { s: 43.5, w: -97.2, n: 49.4, e: -89.5 },
    MS: { s: 30.2, w: -91.7, n: 35.0, e: -88.1 },
    MO: { s: 36.0, w: -95.8, n: 40.6, e: -89.1 },
    MT: { s: 45.0, w: -116.1, n: 49.0, e: -104.0 },
    NE: { s: 40.0, w: -104.1, n: 43.0, e: -95.3 },
    NV: { s: 35.0, w: -120.0, n: 42.0, e: -114.0 },
    NH: { s: 42.7, w: -72.6, n: 45.3, e: -70.6 },
    NJ: { s: 38.9, w: -75.6, n: 41.4, e: -73.9 },
    NM: { s: 31.3, w: -109.1, n: 37.0, e: -103.0 },
    NY: { s: 40.5, w: -79.8, n: 45.0, e: -71.9 },
    NC: { s: 33.8, w: -84.3, n: 36.6, e: -75.5 },
    ND: { s: 45.9, w: -104.1, n: 49.0, e: -96.6 },
    OH: { s: 38.4, w: -84.8, n: 42.3, e: -80.5 },
    OK: { s: 33.6, w: -103.0, n: 37.0, e: -94.4 },
    OR: { s: 42.0, w: -124.6, n: 46.3, e: -116.5 },
    PA: { s: 39.7, w: -80.5, n: 42.3, e: -74.7 },
    RI: { s: 41.1, w: -71.9, n: 42.0, e: -71.1 },
    SC: { s: 32.0, w: -83.4, n: 35.2, e: -78.5 },
    SD: { s: 42.5, w: -104.1, n: 45.9, e: -96.4 },
    TN: { s: 35.0, w: -90.3, n: 36.7, e: -81.6 },
    TX: { s: 25.8, w: -106.6, n: 36.5, e: -93.5 },
    UT: { s: 37.0, w: -114.1, n: 42.0, e: -109.0 },
    VT: { s: 42.7, w: -73.4, n: 45.0, e: -71.5 },
    VA: { s: 36.5, w: -83.7, n: 39.5, e: -75.2 },
    WA: { s: 45.5, w: -124.8, n: 49.0, e: -116.9 },
    WV: { s: 37.2, w: -82.6, n: 40.6, e: -77.7 },
    WI: { s: 42.5, w: -92.9, n: 47.1, e: -86.2 },
    WY: { s: 41.0, w: -111.1, n: 45.0, e: -104.1 },
  };

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function boundsIntersect(b1, b2) {
    return !(b1.e < b2.w || b1.w > b2.e || b1.n < b2.s || b1.s > b2.n);
  }

  function getVisibleStates(map) {
    const bounds = map.getBounds();
    const viewport = {
      s: bounds.getSouth(),
      w: bounds.getWest(),
      n: bounds.getNorth(),
      e: bounds.getEast(),
    };

    const visible = [];
    for (const [stateCode, bbox] of Object.entries(STATE_BOUNDS)) {
      if (boundsIntersect(viewport, bbox)) visible.push(stateCode);
    }

    console.log(
      `🗺️ Viewport: lat ${viewport.s.toFixed(2)} to ${viewport.n.toFixed(
        2
      )}, lng ${viewport.w.toFixed(2)} to ${viewport.e.toFixed(2)}`
    );
    console.log(`🗺️ Visible states detected: ${visible.join(", ") || "NONE"}`);

    return visible;
  }

  function safeNum(v) {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
  }

  function normalizeName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[\u2019']/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksPlaceholderName(name) {
    const n = normalizeName(name);
    if (!n) return true;
    if (n.length < 3) return true;

    const badFragments = [
      "placeholder",
      "sample",
      "test",
      "demo",
      "lorem",
      "ipsum",
      "fixme",
      "todo",
      "tbd",
      "coming soon",
      "unknown site",
      "unnamed site",
    ];

    for (const frag of badFragments) {
      if (n.includes(frag)) return true;
    }

    // generic junk
    if (n === "campsite" || n === "camp" || n === "site") return true;

    return false;
  }

  function hasValidPointGeometry(feature) {
    if (!feature || !feature.geometry) return false;
    const g = feature.geometry;
    if (g.type !== "Point") return false;
    if (!Array.isArray(g.coordinates) || g.coordinates.length < 2) return false;

    const lon = safeNum(g.coordinates[0]);
    const lat = safeNum(g.coordinates[1]);
    if (lat === null || lon === null) return false;

    // reject null island and out-of-range
    if (lat === 0 && lon === 0) return false;
    if (lat < -90 || lat > 90) return false;
    if (lon < -180 || lon > 180) return false;

    return true;
  }

  function normalizeProperties(feature, stateCode) {
    feature.properties = feature.properties || {};
    const p = feature.properties;

    // Normalize name
    p.name =
      p.name ||
      p.title ||
      p.site_name ||
      p.location_name ||
      p.camp_name ||
      "Unnamed Site";

    // Normalize type
    p.type = p.type || p.category || p.kind || "campsite";

    // Normalize cost (null/undefined treated as FREE in UI)
    if (p.cost === "" || p.cost === "null") p.cost = null;
    const costNum = safeNum(p.cost);
    if (costNum !== null) p.cost = costNum;

    // Normalize rating
    const ratingNum = safeNum(p.rating);
    if (ratingNum !== null) p.rating = ratingNum;

    // Normalize reviews count
    if (p.reviews_count == null && p.review_count != null) p.reviews_count = p.review_count;
    const rc = safeNum(p.reviews_count);
    if (rc !== null) p.reviews_count = rc;

    // Normalize amenities array
    if (!Array.isArray(p.amenities)) {
      if (typeof p.amenities === "string" && p.amenities.trim()) {
        p.amenities = p.amenities.split(",").map((x) => x.trim()).filter(Boolean);
      } else {
        p.amenities = [];
      }
    }

    // Normalize rig friendly array
    if (!Array.isArray(p.rig_friendly)) {
      if (typeof p.rig_friendly === "string" && p.rig_friendly.trim()) {
        p.rig_friendly = p.rig_friendly.split(",").map((x) => x.trim()).filter(Boolean);
      } else {
        p.rig_friendly = [];
      }
    }

    // Normalize road difficulty
    if (p.road_difficulty == null && p.roadDifficulty != null) p.road_difficulty = p.roadDifficulty;

    // Track state
    p.state = p.state || stateCode;

    // Normalize source(s)
    // Some merged files might use `sources`, others `source`
    if (!Array.isArray(p.sources)) {
      if (typeof p.sources === "string" && p.sources.trim()) {
        p.sources = p.sources.split(",").map((x) => x.trim()).filter(Boolean);
      } else if (p.source) {
        p.sources = [String(p.source)];
      } else {
        p.sources = ["unknown"];
      }
    }

    if (!p.source) {
      p.source = p.sources[0] || "unknown";
    }

    return feature;
  }

  // Stable global key that survives cross-source merges + missing IDs
  function computeSiteKey(feature) {
    if (!feature || !feature.properties || !hasValidPointGeometry(feature)) return null;

    const p = feature.properties;
    const coords = feature.geometry.coordinates;
    const lon = safeNum(coords[0]);
    const lat = safeNum(coords[1]);
    if (lat === null || lon === null) return null;

    // Highest priority: explicit id from data
    // But many datasets reuse ids across sources, so include source-ish too if possible
    const rawId = p.id || p.site_id || p.source_id || p.ridb_id || p.recgov_id || p.osm_id || p.osmId;
    const src = normalizeName(p.source || (p.sources && p.sources[0]) || "unknown");

    if (rawId) {
      return `${src}:${String(rawId).trim()}`;
    }

    // Fallback: name + rounded coords
    const name = normalizeName(p.name || "");
    const latR = lat.toFixed(5);
    const lonR = lon.toFixed(5);
    return `geo:${name}|${latR}|${lonR}`;
  }

  function isJunkFeature(feature) {
    if (!hasValidPointGeometry(feature)) return true;
    const name = feature?.properties?.name || "";
    if (looksPlaceholderName(name)) return true;
    return false;
  }

  async function loadIndex() {
    try {
      const response = await fetch("data/campsites/index.json");
      if (!response.ok) throw new Error("Index not found");
      state.index = await response.json();
      console.log("📊 Loaded campsite index:", state.index.total_sites, "sites");
      return state.index;
    } catch (err) {
      console.warn("⚠️ Could not load campsite index:", err.message);
      return null;
    }
  }

  async function fetchGeoJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const data = await response.json();
    if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error(`Invalid GeoJSON FeatureCollection at ${url}`);
    }
    return data;
  }

  // Tries multiple possible merged file paths safely (prevents broken loads)
  async function fetchStateMergedGeoJSON(stateCode) {
    // Preferred order:
    // 1) data/merged/{STATE}.geojson
    // 2) data/campsites/{STATE}_merged.geojson
    // 3) {STATE}_merged.geojson (repo root)  <-- your repo shows some of these exist
    // 4) data/campsites/{STATE}.geojson (last resort)
    const candidates = [
      `data/merged/${stateCode}.geojson`,
      `data/campsites/${stateCode}_merged.geojson`,
      `${stateCode}_merged.geojson`,
      `data/campsites/${stateCode}.geojson`,
    ];

    let lastErr = null;

    for (const url of candidates) {
      try {
        const data = await fetchGeoJSON(url);
        console.log(`📦 Using data file: ${url}`);
        return { url, data };
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error(`No campsite data found for ${stateCode}`);
  }

  function summarizeSources(features) {
    const counts = {};
    for (const f of features) {
      const p = f.properties || {};
      const sources = Array.isArray(p.sources) && p.sources.length ? p.sources : [p.source || "unknown"];
      for (const s of sources) {
        const key = String(s || "unknown");
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  }

  async function loadStateData(stateCode) {
    if (state.loadedStates.has(stateCode) || state.loading.has(stateCode)) return;

    state.loading.add(stateCode);
    console.log(`📥 Loading ${stateCode} campsites...`);

    try {
      const { data } = await fetchStateMergedGeoJSON(stateCode);

      let incoming = Array.isArray(data.features) ? data.features : [];
      if (!incoming.length) {
        console.warn(`⚠️ No features found for ${stateCode}`);
        state.loadedStates.add(stateCode);
        return [];
      }

      // Normalize + junk filter
      const cleaned = [];
      let junkCount = 0;

      for (const f of incoming) {
        if (!f) continue;
        normalizeProperties(f, stateCode);

        if (isJunkFeature(f)) {
          junkCount++;
          continue;
        }
        cleaned.push(f);
      }

      // Dedupe via stable global siteKey
      const unique = [];
      let dupCount = 0;

      for (const f of cleaned) {
        const key = computeSiteKey(f);
        if (!key) {
          // If it somehow has no usable key, keep it but it may duplicate
          unique.push(f);
          continue;
        }
        if (state.loadedSiteKeys.has(key)) {
          dupCount++;
          continue;
        }
        state.loadedSiteKeys.add(key);

        // Ensure there's a stable id for downstream usage
        if (!f.properties.id) f.properties.id = key;

        unique.push(f);
      }

      state.allCampsites.push(...unique);
      state.loadedStates.add(stateCode);

      const srcInfo = summarizeSources(unique);
      console.log(
        `✅ ${stateCode} loaded: ${unique.length} added (junk removed: ${junkCount}, duplicates skipped: ${dupCount})`
      );
      if (srcInfo) console.log(`🔎 Sources (${stateCode}): ${srcInfo}`);
      console.log(`📌 Total campsites in memory: ${state.allCampsites.length}`);

      return unique;
    } catch (err) {
      console.error(`💥 Error loading data for ${stateCode}:`, err.message);
      state.loadedStates.add(stateCode); // stop retry spam
      return [];
    } finally {
      state.loading.delete(stateCode);
    }
  }

  function applyFilters(sites, filters) {
    if (!filters) return sites;

    return sites.filter((site) => {
      const p = site.properties;
      if (!p) return false;

      // Cost filter:
      // FREE includes cost === 0 OR cost == null/undefined
      // PAID includes cost > 0
      const cost = safeNum(p.cost);
      if (filters.cost === "free") {
        if (!(cost === 0 || cost === null)) return false;
      }
      if (filters.cost === "paid") {
        if (!(cost !== null && cost > 0)) return false;
      }

      if (filters.type && filters.type !== "all") {
        const t = String(p.type || "").toLowerCase();
        if (t !== String(filters.type).toLowerCase()) return false;
      }

      if (filters.rigSize && filters.rigSize !== "all") {
        const rigFriendly = Array.isArray(p.rig_friendly) ? p.rig_friendly : [];
        if (!rigFriendly.includes(filters.rigSize)) return false;
      }

      if (filters.roadDifficulty && filters.roadDifficulty !== "all") {
        const rd = String(p.road_difficulty || "");
        if (rd !== String(filters.roadDifficulty)) return false;
      }

      if (filters.amenities && Array.isArray(filters.amenities) && filters.amenities.length > 0) {
        const siteAmenities = Array.isArray(p.amenities) ? p.amenities : [];
        const hasAll = filters.amenities.every((a) => siteAmenities.includes(a));
        if (!hasAll) return false;
      }

      if (filters.minRating && filters.minRating > 0) {
        const rating = safeNum(p.rating) || 0;
        if (rating < filters.minRating) return false;
      }

      return true;
    });
  }

  function createMarkerIcon(site) {
    const props = site.properties || {};
    const costNum = safeNum(props.cost);
    const isFree = costNum === 0 || costNum === null;

    const color = isFree ? "#4CAF50" : "#2196F3";

    return L.divIcon({
      html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
      className: "custom-marker",
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }

  function createPopup(site) {
    const p = site.properties || {};
    const esc = window.escapeHtml || ((t) => t);

    const costNum = safeNum(p.cost);
    const costText = costNum === 0 || costNum === null ? "FREE" : `$${costNum}/night`;

    let ratingText = "No ratings";
    const ratingNum = safeNum(p.rating);
    if (ratingNum !== null) {
      const stars = "⭐".repeat(Math.max(1, Math.min(5, Math.round(ratingNum))));
      const reviewCount = safeNum(p.reviews_count) || 0;
      ratingText = reviewCount > 0 ? `${stars} (${reviewCount} reviews)` : stars;
    }

    const safeName = esc(p.name || "Unnamed Site");
    const safeJsName = JSON.stringify(p.name || "Campsite");
    const safeType = esc(p.type || "Unknown");
    const safeRoadDiff = p.road_difficulty ? esc(p.road_difficulty) : "";
    const safeAmenities =
      Array.isArray(p.amenities) && p.amenities.length ? p.amenities.map((a) => esc(a)).join(" • ") : "";
    const safeId = esc(p.id || "");

    const rigFriendly = Array.isArray(p.rig_friendly) && p.rig_friendly.length ? p.rig_friendly : [];
    const rigText = rigFriendly.length ? rigFriendly.map((r) => esc(r)).join(", ") : "";

    const lat = site.geometry.coordinates[1];
    const lng = site.geometry.coordinates[0];

    return `
      <div style="min-width:200px;">
        <h3 style="margin:0 0 8px 0;font-size:14px;font-weight:bold;">${safeName}</h3>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">
          <div><strong>Cost:</strong> ${costText}</div>
          <div><strong>Type:</strong> ${safeType}</div>
          ${safeRoadDiff ? `<div><strong>Road:</strong> ${safeRoadDiff}</div>` : ""}
          ${rigText ? `<div><strong>Suitable for:</strong> ${rigText}</div>` : ""}
          <div><strong>Rating:</strong> ${ratingText}</div>
        </div>
        ${safeAmenities ? `
          <div style="font-size:11px;color:#888;margin-bottom:8px;">
            ${safeAmenities}
          </div>
        ` : ""}
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button onclick="KampTrailData.addToTrip('${safeId}')" style="flex:1;padding:4px 8px;background:#4CAF50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Add to Trip
          </button>
          <button onclick="KampTrailCompare.addToCompare('${safeId}')" style="flex:1;padding:4px 8px;background:#ff6b6b;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Compare
          </button>
          <button onclick="window.open('https://maps.google.com/?q=${lat},${lng}')" style="flex:1;padding:4px 8px;background:#2196F3;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
            Navigate
          </button>
        </div>
        <div id="google-places-container-${safeId}" style="margin-top:10px; border-top: 1px solid #eee; padding-top:10px;">
          <button onclick="KampTrailData.loadGoogleData('${safeId}', ${safeJsName}, ${lat}, ${lng})"
            style="width:100%; padding: 6px; background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; cursor:pointer;">
            📷 Show Google Photos & Rating
          </button>
        </div>
      </div>
    `;
  }

  function updateMarkers(map, filters, config) {
    if (!state.clusterGroup) return;

    const filtered = applyFilters(state.allCampsites, filters);
    console.log(`🔍 Filtered: ${filtered.length} of ${state.allCampsites.length} sites`);

    state.clusterGroup.clearLayers();

    for (const site of filtered) {
      if (!hasValidPointGeometry(site)) continue;

      const lng = site.geometry.coordinates[0];
      const lat = site.geometry.coordinates[1];

      const marker = L.marker([lat, lng], {
        icon: createMarkerIcon(site),
      });

      marker.bindPopup(createPopup(site));
      state.clusterGroup.addLayer(marker);
    }

    if (config.onFilterUpdate) {
      config.onFilterUpdate(filtered.length, state.allCampsites.length);
    }
  }

  async function refreshData(map, filters, config) {
    const visibleStates = getVisibleStates(map);
    const newStates = visibleStates.filter(
      (s) => !state.loadedStates.has(s) && !state.loading.has(s)
    );

    if (newStates.length > 0) {
      console.log("🔄 Loading new states:", newStates.join(", "));
      await Promise.all(newStates.map((s) => loadStateData(s)));
      updateMarkers(map, filters, config);
    }
  }

  window.KampTrailData = {
    async init(map, config = {}) {
      state.config = config;
      console.log("🚀 Initializing KampTrail Data Loader...");

      state.clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function (cluster) {
          const count = cluster.getChildCount();
          let size = "small";
          if (count > 50) size = "large";
          else if (count > 10) size = "medium";

          return L.divIcon({
            html: `<div style="background:#FF6B6B;color:#fff;border-radius:50%;width:40px;height:40px;display:grid;place-items:center;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">${count}</div>`,
            className: `kt-cluster kt-cluster-${size}`,
            iconSize: [40, 40],
          });
        },
      });

      map.addLayer(state.clusterGroup);

      await loadIndex();

      // Visible states
      let initialStates = getVisibleStates(map);

      // Fallback if viewport detection fails
      if (initialStates.length === 0) {
        console.warn("⚠️ No states detected in viewport, loading fallback states...");
        initialStates = ["CA", "CO", "UT", "AZ", "WA", "OR", "MT", "WY"];
      }

      console.log("🚀 Loading initial states:", initialStates.join(", "));

      // Load sequentially (keeps logs readable)
      for (const stateCode of initialStates) {
        await loadStateData(stateCode);
      }

      console.log(`✅ Initial load complete: ${state.allCampsites.length} total sites`);

      updateMarkers(map, this.getDefaultFilters(), state.config);

      map.on(
        "moveend",
        debounce(() => {
          refreshData(map, this.getCurrentFilters(), state.config);
        }, 500)
      );

      map.on(
        "zoomend",
        debounce(() => {
          refreshData(map, this.getCurrentFilters(), state.config);
        }, 500)
      );
    },

    getDefaultFilters() {
      return {
        cost: "all",
        type: "all",
        rigSize: "all",
        roadDifficulty: "all",
        amenities: [],
        minRating: 0,
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
      return state.allCampsites.find((s) => s.properties && s.properties.id === id);
    },

    getLoadedStates() {
      return Array.from(state.loadedStates);
    },

    addToTrip(id) {
      console.log("Adding to trip:", id);
      if (state.config.onTripAdd) state.config.onTripAdd(id);
    },

    toggleFavorite(id) {
      console.log("Toggling favorite:", id);
      if (state.config.onFavoriteToggle) state.config.onFavoriteToggle(id);
    },

    async loadGoogleData(siteId, name, lat, lng) {
      if (!window.KampTrailGoogle) {
        console.error("Google Places Service not available.");
        return;
      }

      const container = document.getElementById(`google-places-container-${siteId}`);
      if (!container) return;

      container.innerHTML = "<em>Loading Google data...</em>";

      const data = await window.KampTrailGoogle.getPlaceDetails(name, lat, lng);

      if (!data) {
        container.innerHTML = "<em>No Google data found for this location.</em>";
        return;
      }
      if (data.error === "QUOTA_EXCEEDED") {
        container.style.display = "none";
        return;
      }

      let photosHtml = "";
      if (data.photos && data.photos.length > 0) {
        photosHtml = `
          <div style="display:flex; overflow-x:auto; gap: 5px; padding-bottom: 5px;">
            ${data.photos
              .slice(0, 5)
              .map(
                (photo) =>
                  `<img src="${photo.url}" style="height: 80px; border-radius: 4px;" alt="Campsite photo">`
              )
              .join("")}
          </div>
        `;
      }

      const ratingHtml = data.rating
        ? `
          <div style="font-size: 12px; margin-top: 5px;">
            <strong>Google Rating:</strong> ${data.rating.toFixed(1)} ⭐ (${data.userRatingCount} reviews)
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              name
            )}" target="_blank" rel="noopener">Read reviews</a>
          </div>
        `
        : "";

      container.innerHTML = `
        ${photosHtml}
        ${ratingHtml}
        <div style="font-size: 10px; text-align: right; color: #888; margin-top: 5px;">
          Powered by Google
        </div>
      `;
    },
  };
})();
