#!/usr/bin/env node
/**
 * Campsite Data Merger
 *
 * Merges campground data from multiple sources (Recreation.gov, Campendium, etc.)
 * and intelligently deduplicates based on GPS proximity and name similarity.
 *
 * Usage:
 *   node scripts/merge_campsite_data.js --state CA
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const osmIdentity = p => /^osm:(?:node|way|relation|unknown):/.test(String(p.id || ''));
const ownedOsmFields = ['fee', 'charge', 'fee:conditional', 'access', 'fee_status', 'cost', 'fee_text', 'fee_source', 'fee_checked', 'fee_evidence'];

// Name/proximity matching is not proof that a second OSM element's tags apply
// to the retained element. Keep those observations available for identity review.
function osmFieldRecords(...properties) {
  const records = new Map();
  for (const p of properties) {
    for (const r of Array.isArray(p.unverified_osm_field_records) ? p.unverified_osm_field_records : []) records.set(JSON.stringify(r), r);
    if (!osmIdentity(p)) continue;
    const fields = Object.fromEntries(ownedOsmFields.filter(k => Object.hasOwn(p, k)).map(k => [k, p[k]]));
    const r = {source_record_id: p.id, fields, retrieved_at: p.source_retrieved_at || null, source_updated_at: p.osm_timestamp || null};
    records.set(JSON.stringify(r), r);
  }
  return [...records.values()];
}

class CampsiteMerger {
  constructor() {
    this.DISTANCE_THRESHOLD_METERS = 500; // Consider campsites within 500m as duplicates
  }

  /**
   * Calculate distance between two GPS coordinates in meters (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Calculate string similarity (0-1) using Levenshtein distance
   */
  stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = String(str1).toLowerCase().trim();
    const s2 = String(str2).toLowerCase().trim();

    if (s1 === s2) return 1.0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  /**
   * Check if two campsites are likely the same location
   */
  validFeature(feature) {
    const coordinates = feature?.geometry?.coordinates;
    return feature?.type === 'Feature' && feature.geometry.type === 'Point'
      && Array.isArray(coordinates) && coordinates.length >= 2
      && coordinates.slice(0, 2).every(value => typeof value === 'number' && Number.isFinite(value))
      && Math.abs(coordinates[0]) <= 180 && Math.abs(coordinates[1]) <= 90
      && feature.properties && typeof feature.properties === 'object';
  }

  stableId(feature) {
    const p = feature.properties;
    if (p.facility_id != null) return `ridb:${p.facility_id}`;
    if (p.osm_id != null) {
      const kind = p.osm_type || (['node', 'way', 'relation'].includes(p.type) ? p.type : 'unknown');
      const suffix = kind === 'unknown' ? ':' + feature.geometry.coordinates.slice(0, 2).map(n => n.toFixed(6)).join(',') : '';
      return `osm:${kind}:${p.osm_id}${suffix}`;
    }
    if (p.id != null && String(p.id).trim()) return String(p.id);
    const value = JSON.stringify([feature.geometry.coordinates, p.name || p.Name || '', p.source || 'unknown']);
    return 'site:' + crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
  }

  areDuplicates(site1, site2) {
    if (!this.validFeature(site1) || !this.validFeature(site2)) return false;
    const [lon1, lat1] = site1.geometry.coordinates;
    const [lon2, lat2] = site2.geometry.coordinates;
    const p1 = site1.properties, p2 = site2.properties;
    if (p1.facility_id != null && String(p1.facility_id) === String(p2.facility_id)) return true;
    if (p1.osm_id != null && String(p1.osm_id) === String(p2.osm_id)
      && p1.osm_type && p1.osm_type === p2.osm_type) return true;
    const distance = this.calculateDistance(lat1, lon1, lat2, lon2);
    const name1 = p1.name || p1.Name || '';
    const name2 = p2.name || p2.Name || '';
    // Nearby campgrounds can have distinct entrances or sites. Distance alone is not identity.
    return distance < this.DISTANCE_THRESHOLD_METERS
      && !!name1 && !!name2 && this.stringSimilarity(name1, name2) > 0.85;
  }

  sanitizeProperties(properties) {
    const p = { ...properties };
    const sources = [...(Array.isArray(p.sources) ? p.sources : []), p.source || ''];
    const legacyRIDB = (p.facility_id != null || sources.some(source => /recreation\.gov|\bridb\b/i.test(String(source))))
      && !(Number(p.schema_version) >= 3);
    if (legacyRIDB) {
      p.legacy_inferred = { ...(p.legacy_inferred || {}), cost: p.cost, amenities: p.amenities,
        rig_friendly: p.rig_friendly, road_difficulty: p.road_difficulty };
      p.cost = null;
      p.fee_status = 'unknown';
      p.amenities = [];
      p.rig_friendly = [];
      p.road_difficulty = null;
      p.rating = null;
      p.reviews_count = 0;
      p.field_provenance = { cost: 'unknown', amenities: 'unknown', rig_friendly: 'unknown', road_difficulty: 'unknown' };
    }
    return p;
  }

  mergeProperties(primary, secondary) {
    primary = this.sanitizeProperties(primary);
    secondary = this.sanitizeProperties(secondary);
    const list = value => Array.isArray(value) ? value : [];
    const number = (value, max = Infinity) => typeof value === 'number'
      && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
    const primaryCost = number(primary.cost), secondaryCost = number(secondary.cost);
    const primaryRating = number(primary.rating, 5), secondaryRating = number(secondary.rating, 5);
    const conflicts = [...list(primary.data_conflicts), ...list(secondary.data_conflicts)];
    if (primaryCost !== null && secondaryCost !== null && primaryCost !== secondaryCost) conflicts.push('cost');
    const merged = {
      ...secondary,
      ...primary,
      name: primary.name || primary.Name || secondary.name || secondary.Name || 'Unnamed campsite',
      rating: primaryRating ?? secondaryRating,
      reviews_count: Math.max(number(primary.reviews_count) ?? 0, number(secondary.reviews_count) ?? 0),
      cost: primaryCost ?? secondaryCost,
      amenities: [...new Set([...list(primary.amenities), ...list(secondary.amenities)])],
      rig_friendly: [...new Set([...list(primary.rig_friendly), ...list(secondary.rig_friendly)])],
      // Missing classifications remain unknown. Do not infer dispersed camping from geometry type.
      type: ['established', 'dispersed', 'backcountry', 'rv_park'].includes(primary.type)
        ? primary.type : (['established', 'dispersed', 'backcountry', 'rv_park'].includes(secondary.type) ? secondary.type : null),
      sources: [...new Set([
        ...list(primary.sources), primary.source,
        ...list(secondary.sources), secondary.source
      ].filter(Boolean))],
      source_ids: [...new Set([
        ...list(primary.source_ids), primary.id,
        ...list(secondary.source_ids), secondary.id
      ].filter(Boolean))],
      data_conflicts: [...new Set(conflicts)],
      field_provenance: {
        ...(secondary.field_provenance || {}), ...(primary.field_provenance || {}),
        cost: primaryCost !== null ? (primary.field_provenance?.cost || 'source-reported')
          : secondaryCost !== null ? (secondary.field_provenance?.cost || 'source-reported') : 'unknown'
      },
      // Legacy RIDB defaults were stripped above. Do not claim a fresh fetch when merging files.
      schema_version: 3,
      description: (primary.description?.length > secondary.description?.length)
        ? primary.description : (secondary.description || primary.description || '')
    };
    if (osmIdentity(primary) && osmIdentity(secondary) && primary.id !== secondary.id) {
      for (const key of ownedOsmFields) {
        if (Object.hasOwn(primary, key)) merged[key] = primary[key];
        else delete merged[key];
      }
      merged.unverified_osm_field_records = osmFieldRecords(primary, secondary);
      merged.field_provenance.cost = primaryCost !== null ? (primary.field_provenance?.cost || 'source-reported') : 'unknown';
      const feeKind = p => /^(?:no|0|false)$/i.test(String(p.fee)) ? 'free' : /^(?:yes|true)$/i.test(String(p.fee)) ? 'paid' : null;
      if (primary.fee_conflict || secondary.fee_conflict || (feeKind(primary) && feeKind(secondary) && feeKind(primary) !== feeKind(secondary))) {
        merged.fee_conflict = true;
        merged.fee_status = 'unknown';
        merged.cost = null;
        merged.fee_text = null;
      }
    }
    return merged;
  }

  /**
   * Merge multiple GeoJSON datasets
   */
  async mergeDatasets(datasets) {
    console.log(`\n📊 Merging ${datasets.length} datasets...`);

    let allFeatures = [];
    let duplicatesRemoved = 0;
    let invalidRemoved = 0;

    // Combine all features
    datasets.forEach(dataset => {
      if (dataset && dataset.features) {
        allFeatures = allFeatures.concat(dataset.features);
      }
    });

    console.log(`  Total features before deduplication: ${allFeatures.length}`);

    // Deduplicate
    const uniqueFeatures = [];

    for (const original of allFeatures) {
      if (!this.validFeature(original)) { invalidRemoved++; continue; }
      const feature = { ...original, geometry: { ...original.geometry }, properties: this.sanitizeProperties(original.properties) };
      if (feature.properties.legacy_inferred) feature.properties.schema_version = 3;
      feature.properties.source_ids = [...new Set([
        ...(Array.isArray(feature.properties.source_ids) ? feature.properties.source_ids : []),
        feature.properties.id
      ].filter(Boolean))];
      feature.properties.id = this.stableId(feature);
      // Check if this feature is a duplicate of any existing unique feature
      let isDuplicate = false;

      for (let i = 0; i < uniqueFeatures.length; i++) {
        if (this.areDuplicates(feature, uniqueFeatures[i])) {
          isDuplicate = true;
          duplicatesRemoved++;

          // Merge properties
          const merged = { ...uniqueFeatures[i] };
          merged.properties = this.mergeProperties(
            uniqueFeatures[i].properties,
            feature.properties
          );

          uniqueFeatures[i] = merged;
          console.log(`  🔗 Merged: ${feature.properties.name}`);
          break;
        }
      }

      if (!isDuplicate) {
        // Ensure sources array exists
        if (!feature.properties.sources) {
          feature.properties.sources = [feature.properties.source].filter(Boolean);
        }
        uniqueFeatures.push(feature);
      }
    }

    console.log(`  Duplicates removed: ${duplicatesRemoved}`);
    console.log(`  ✅ Final unique campsites: ${uniqueFeatures.length}`);

    return {
      type: 'FeatureCollection',
      features: uniqueFeatures,
      duplicatesRemoved,
      invalidRemoved
    };
  }

  /**
   * Load GeoJSON file
   */
  async loadGeoJSON(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) throw new Error('Invalid FeatureCollection');
      return parsed;
    } catch (err) {
      console.log(`  ⚠️  Could not load ${path.basename(filePath)}: ${err.message}`);
      return null;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const stateArg = args.find(a => a.startsWith('--state='));
  const stateValue = stateArg ? stateArg.slice(8) : args[args.indexOf('--state') + 1];

  if (!stateValue || !/^[A-Za-z]{2}$/.test(stateValue)) {
    console.error('❌ Usage: node merge_campsite_data.js --state=CA');
    process.exit(1);
  }

  const stateCode = stateValue.toUpperCase();
  const dataDir = path.join(__dirname, '../data/campsites');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Merging campsite data for ${stateCode}`);
  console.log(`${'='.repeat(60)}`);

  const merger = new CampsiteMerger();

  const { datasets } = await loadStateSources(stateCode, merger, { campsitesDir: dataDir });
  if (datasets.length === 0) throw new Error('No valid data sources found; keeping existing merged data');

  // Merge datasets
  const merged = await merger.mergeDatasets(datasets);

  // Save merged data
  const outputFile = path.join(dataDir, `${stateCode}_merged.geojson`);
  await saveMergedData(outputFile, merged);

  console.log(`\n✅ Merged data saved to: ${outputFile}`);
  console.log(`\n📊 Summary:`);
  console.log(`  Total unique campsites: ${merged.features.length}`);

  // Calculate statistics
  const stats = {
    withRatings: merged.features.filter(f => f.properties.rating).length,
    withReviews: merged.features.filter(f => f.properties.reviews_count > 0).length,
    free: merged.features.filter(f => f.properties.cost === 0).length,
    paid: merged.features.filter(f => f.properties.cost > 0).length,
    sources: {}
  };

  merged.features.forEach(f => {
    (f.properties.sources || []).forEach(src => {
      stats.sources[src] = (stats.sources[src] || 0) + 1;
    });
  });

  console.log(`  With ratings: ${stats.withRatings}`);
  console.log(`  With reviews: ${stats.withReviews}`);
  console.log(`  Free sites: ${stats.free}`);
  console.log(`  Paid sites: ${stats.paid}`);
  console.log(`\n  Data sources:`);
  Object.entries(stats.sources).forEach(([src, count]) => {
    console.log(`    ${src}: ${count}`);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ Merge complete!`);
  console.log(`${'='.repeat(60)}\n`);
}

async function loadStateSources(stateCode, merger, directories = {}) {
  const campsitesDir = directories.campsitesDir || path.join(__dirname, '../data/campsites');
  const osmDir = directories.osmDir || path.join(__dirname, '../data/opencampingmap');
  const definitions = [
    { name: 'Recreation.gov', canonical: 'recreation.gov', files: [
      path.join(campsitesDir, `${stateCode}.geojson`), path.join(campsitesDir, `${stateCode}(1).geojson`)
    ], matches: p => p.facility_id != null || /recreation|\bridb\b/i.test(sourceText(p)) },
    { name: 'OpenStreetMap', canonical: 'openstreetmap', files: [path.join(osmDir, `${stateCode}.geojson`)],
      matches: p => p.osm_id != null || /openstreetmap|opencampingmap|\bosm\b/i.test(sourceText(p)) },
    { name: 'Campendium', canonical: 'campendium', files: [path.join(campsitesDir, `${stateCode}_campendium.geojson`)],
      matches: p => /campendium/i.test(sourceText(p)) },
    { name: 'iOverlander', canonical: 'ioverlander', files: [path.join(campsitesDir, `${stateCode}_ioverlander.geojson`)],
      matches: p => /ioverlander/i.test(sourceText(p)) }
  ];
  function sourceText(properties) {
    return [...(Array.isArray(properties.sources) ? properties.sources : []), properties.source || ''].join(' ');
  }
  const existing = await merger.loadGeoJSON(path.join(campsitesDir, `${stateCode}_merged.geojson`));
  const datasets = [], counts = {};
  for (const source of definitions) {
    let selected = null;
    for (const file of source.files) {
      const loaded = await merger.loadGeoJSON(file);
      if (loaded && loaded.features.some(feature => merger.validFeature(feature))) {
        selected = loaded;
        break;
      }
    }
    const previouslyPresent = existing?.features?.some(feature => source.matches(feature.properties || {}));
    if (!selected && previouslyPresent) {
      throw new Error(`${stateCode}: previous ${source.name} source is missing, invalid or empty; keeping existing merged data`);
    }
    if (!selected) continue;
    const features = selected.features.map(feature => ({ ...feature, properties: {
      ...(feature.properties || {}), source: feature.properties?.source || source.canonical
    } }));
    datasets.push({ ...selected, features });
    counts[source.name] = features.length;
  }
  return { datasets, counts };
}

async function saveMergedData(outputFile, merged) {
  if (!merged?.features?.length) throw new Error('No valid records: keeping the existing dataset unchanged');
  const temporary = `${outputFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(merged, null, 2));
  await fs.rename(temporary, outputFile);
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { CampsiteMerger, saveMergedData, loadStateSources };
