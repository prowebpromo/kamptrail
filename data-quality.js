/* data-quality.js
   Runtime cleanup + dedupe for campsite GeoJSON

   Fixes:
   - Duplicate campsites across sources (same name + nearby coords)
   - Placeholder junk data ("Sample", "Test", "Lorem", missing names)
   - Invalid coordinates (0,0 / null / non-numeric)
   - Normalizes properties so filters behave consistently

   Drop-in usage:
   const cleaned = DataQuality.cleanAndDedupeGeoJSON(geojson, { radiusMeters: 250 });
*/

(function (global) {
  const DEFAULTS = {
    radiusMeters: 250,        // good default for “same campground” duplicates
    nameSimilarity: 0.82,     // fuzzy match threshold
    keepBest: true,
  };

  function isNum(n) {
    return typeof n === "number" && Number.isFinite(n);
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

  function looksPlaceholder(name) {
    const n = normalizeName(name);
    if (!n) return true;

    // obvious junk / placeholder strings
    const bad = [
      "sample", "test", "placeholder", "lorem", "ipsum", "demo",
      "fake", "unknown campsite", "tbd", "coming soon"
    ];

    for (const b of bad) {
      if (n.includes(b)) return true;
    }

    // ultra-short garbage
    if (n.length < 3) return true;

    return false;
  }

  // Haversine in meters
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (v) => (v * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Simple Jaro-ish similarity for names (fast + good enough)
  function nameSimilarity(a, b) {
    a = normalizeName(a);
    b = normalizeName(b);
    if (!a || !b) return 0;
    if (a === b) return 1;

    // token overlap score
    const ta = new Set(a.split(" "));
    const tb = new Set(b.split(" "));
    let common = 0;

    for (const t of ta) if (tb.has(t)) common++;

    const denom = Math.max(ta.size, tb.size);
    if (!denom) return 0;

    return common / denom;
  }

  function getLatLng(feature) {
    if (!feature || !feature.geometry) return null;

    const g = feature.geometry;

    // Point only
    if (g.type !== "Point" || !Array.isArray(g.coordinates)) return null;

    const [lon, lat] = g.coordinates;

    if (!isNum(lat) || !isNum(lon)) return null;

    // kill (0,0) and out-of-range
    if (lat === 0 && lon === 0) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return { lat, lon };
  }

  function normalizeProps(feature, sourceFallback) {
    const p = feature.properties || {};
    const name = p.name || p.title || p.site_name || p.location_name || "";

    const source =
      p.source ||
      p.provider ||
      p.dataset ||
      sourceFallback ||
      "unknown";

    // Normalize to consistent keys for filters/UI
    feature.properties = {
      ...p,
      name,
      source,
      category: p.category || p.type || p.kind || "campsite",
    };

    return feature;
  }

  function scoreFeature(feature) {
    // “best” record wins inside a duplicate group.
    // You can tune this later, but this works now.
    const p = feature.properties || {};
    let score = 0;

    // prefer records that actually have a name and description
    if (p.name && String(p.name).trim().length > 3) score += 3;
    if (p.description && String(p.description).trim().length > 10) score += 2;

    // prefer ones with rating / reviews / phone / website
    if (p.rating) score += 2;
    if (p.reviews || p.review_count) score += 2;
    if (p.phone) score += 1;
    if (p.website || p.url) score += 1;

    // prefer Recreation.gov or official-ish sources over anonymous
    const s = normalizeName(p.source);
    if (s.includes("recreation") || s.includes("ridb") || s.includes("rec.gov")) score += 2;

    // prefer OSM OpenCampingMap slightly less than official
    if (s.includes("opencampingmap") || s.includes("ocm") || s.includes("osm")) score += 1;

    return score;
  }

  function mergeProperties(best, other) {
    // merge missing fields into the best record without nuking good values
    const bp = best.properties || {};
    const op = other.properties || {};

    for (const k of Object.keys(op)) {
      if (bp[k] == null || bp[k] === "" || bp[k] === 0) {
        bp[k] = op[k];
      }
    }

    // Keep “sources list” for transparency
    const sources = new Set(
      String(bp._sources || bp.source || "unknown")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );

    sources.add(String(op.source || "unknown").trim());

    bp._sources = Array.from(sources).join(", ");

    best.properties = bp;
    return best;
  }

  function cleanAndDedupeGeoJSON(inputGeoJSON, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };

    if (!inputGeoJSON || !Array.isArray(inputGeoJSON.features)) {
      return inputGeoJSON;
    }

    const cleaned = [];

    for (const f of inputGeoJSON.features) {
      if (!f) continue;

      normalizeProps(f, cfg.source || "unknown");

      const ll = getLatLng(f);
      if (!ll) continue;

      const nm = f.properties?.name || "";

      // Strip placeholder + junk
      if (looksPlaceholder(nm)) continue;

      cleaned.push(f);
    }

    // Deduplicate: greedy clustering by proximity + name similarity
    const deduped = [];
    const used = new Array(cleaned.length).fill(false);

    for (let i = 0; i < cleaned.length; i++) {
      if (used[i]) continue;

      const a = cleaned[i];
      const aLL = getLatLng(a);
      if (!aLL) continue;

      const group = [a];
      used[i] = true;

      for (let j = i + 1; j < cleaned.length; j++) {
        if (used[j]) continue;

        const b = cleaned[j];
        const bLL = getLatLng(b);
        if (!bLL) continue;

        const d = distanceMeters(aLL.lat, aLL.lon, bLL.lat, bLL.lon);
        if (d > cfg.radiusMeters) continue;

        const sim = nameSimilarity(a.properties.name, b.properties.name);
        if (sim < cfg.nameSimilarity) continue;

        used[j] = true;
        group.push(b);
      }

      if (group.length === 1) {
        // no dup
        a.properties._dedupe_group_size = 1;
        deduped.push(a);
        continue;
      }

      // choose best record in group, merge properties from others
      let best = group[0];
      let bestScore = scoreFeature(best);

      for (let k = 1; k < group.length; k++) {
        const s = scoreFeature(group[k]);
        if (s > bestScore) {
          best = group[k];
          bestScore = s;
        }
      }

      // merge others into best
      for (const other of group) {
        if (other === best) continue;
        mergeProperties(best, other);
      }

      best.properties._dedupe_group_size = group.length;
      best.properties._deduped = true;

      deduped.push(best);
    }

    return {
      type: "FeatureCollection",
      features: deduped,
    };
  }

  global.DataQuality = {
    cleanAndDedupeGeoJSON,
  };
})(typeof window !== "undefined" ? window : globalThis);
