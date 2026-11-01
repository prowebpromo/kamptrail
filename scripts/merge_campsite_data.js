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
// Amenity-type OSM tags and survey dates describe the element that carries them.
// A merge never moves them onto the retained record (R8, 2.31.0).
const AMENITY_TAG = /^(?:toilets?|drinking_water|water|water_point|water_tap|water_hookup|water_supply|water_source|hot_water|shower|showers|sanitary_dump_station|waste|waste_disposal|waste_basket|bin|power|power_supply|socket|electric_hookup|electricity|sewer|sewer_hookup|hookups?|internet_access|wifi|washing_machine|dryer|laundry|laundry_service|kitchen|bbq|grill|fireplace|firepit|fire_pit|fire|openfire|campfire|firewood|wood_available|picnic_table|picnic_site|shelter|swimming_pool|sauna|playground|amenity(?:_[0-9]+)?|camp_site:fire|camp_site:water|check_date)(?::|$)/;
const amenityTag = k => AMENITY_TAG.test(k);
const feeAccessTag = k => /(^|:)(fee|charge)(:|$)/.test(k) || /^access(:|$)/.test(k);
const osmTag = k => feeAccessTag(k) || amenityTag(k);
const ownedOsmField = k => osmTag(k) || ['osm_id','osm_type','fee_status','cost','fee_text','fee_source','fee_source_record_id','fee_checked','fee_evidence','fee_evidence_records','fee_conflict'].includes(k);

// Retain observations on their source element. A proximity match grants no
// ownership of a member's tags, including when the retained record is RIDB.
function memberEvidence(primary, secondary) {
  const records = new Map();
  for (const p of [primary, secondary]) for (const r of Array.isArray(p.member_evidence) ? p.member_evidence : []) {
    if (r && /^osm:(node|way|relation|unknown):/.test(r.source_record_id) && r.fields && typeof r.fields === 'object') records.set(r.source_record_id, r);
  }
  if (osmIdentity(secondary) && secondary.id !== primary.id) {
    const fields = Object.fromEntries(Object.keys(secondary).filter(k => osmTag(k) && secondary[k] != null && secondary[k] !== '').map(k => [k, secondary[k]]));
    if (Object.keys(fields).length && !records.has(secondary.id)) {
      const match = secondary.id.match(/^osm:(node|way|relation):([0-9]+)$/);
      records.set(secondary.id, {source_record_id: secondary.id, source: 'OpenStreetMap contributors', fields,
        retrieved_at: secondary.source_retrieved_at || null, source_updated_at: secondary.osm_timestamp || null,
        source_url: match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null});
    }
  }
  // Source snapshots fail visibly rather than silently dropping provenance.
  if (records.size > 128) throw new Error('Too many OSM member evidence records; identity review required');
  return [...records.values()];
}

// Classification ownership (tourism-type-admission candidate). tourism=* classifies the element that carries
// it. A distinct absorbed record never lends it to the retained record. It stays on that member's attributed
// evidence. A description copied from another record is marked with that record's id.
const CLASSIFICATION_TAG = k => k === 'tourism';
function ownClassification(merged, primary, secondary) {
  if (secondary.id === primary.id) return;
  for (const key of Object.keys(merged)) if (CLASSIFICATION_TAG(key)) {
    if (Object.hasOwn(primary, key)) { merged[key] = primary[key]; continue; }
    delete merged[key];
    if (osmIdentity(secondary) && secondary[key] != null && secondary[key] !== '') {
      const list = Array.isArray(merged.member_evidence) ? merged.member_evidence : [];
      let record = list.find(r => r.source_record_id === secondary.id);
      if (!record) {
        const match = secondary.id.match(/^osm:(node|way|relation):([0-9]+)$/);
        record = {source_record_id: secondary.id, source: 'OpenStreetMap contributors', fields: {},
          retrieved_at: secondary.source_retrieved_at || null, source_updated_at: secondary.osm_timestamp || null,
          source_url: match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null};
        list.push(record);
      }
      record.fields = {...record.fields, [key]: secondary[key]};
      merged.member_evidence = list;
    }
  }
  // A description copied from a different record is that record's wording. It is marked so it never
  // classifies the retained listing. The text itself is unchanged.
  const own = primary.description_source_record_id || null;
  if (merged.description && merged.description !== (primary.description || '') && merged.description === secondary.description) {
    merged.description_source_record_id = secondary.description_source_record_id || secondary.id;
  } else if (own) merged.description_source_record_id = own;
  else delete merged.description_source_record_id;
}

// Name tokens that distinguish separate campgrounds when they are the only difference between two names.
// Positional words that name separate campgrounds when they are the only difference between two names
// (Upper and Lower Grays Meadow, North and South Deer Lake, Old and New Shady Rest).
const DISTINGUISHING_TOKENS = new Set(['upper', 'lower', 'middle', 'inner', 'outer', 'north', 'south', 'east', 'west',
  'ne', 'nw', 'se', 'sw', 'northeast', 'northwest', 'southeast', 'southwest', 'old', 'new', 'little', 'big']);
// Individually numbered or lettered sites inside one campground (Site 4, Group Site A, Moon Lake #2).
const INDIVIDUAL_SITE_NAME = /\b(?:sites?|campsites?|camp\s+sites?|loop|spot|pad|pitch|post|lean[- ]?to|shelter|backcountry|zone)\b|#\s*\d|\b\d+\s+of\s+\d+\b/i;

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
    // Two different OSM elements whose names differ only by Upper/Lower, a direction, a number or a
    // letter are distinct campgrounds (for example Upper and Lower Grays Meadow). Name similarity
    // must not merge them. Individually numbered sites inside one campground keep today's grouping.
    if (CampsiteMerger.distinctOsmCampgrounds(p1, p2, name1, name2)) return false;
    // Nearby campgrounds can have distinct entrances or sites. Distance alone is not identity.
    return distance < this.DISTANCE_THRESHOLD_METERS
      && !!name1 && !!name2 && this.stringSimilarity(name1, name2) > 0.85;
  }

  static nameTokens(name) {
    return String(name || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9#]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }

  static distinctOsmCampgrounds(p1, p2, name1, name2) {
    const osmKey = p => p.osm_id != null && p.osm_type ? `osm:${p.osm_type}:${p.osm_id}` : null;
    const a = osmKey(p1), b = osmKey(p2);
    if (!a || !b || a === b || !name1 || !name2) return false;
    if (p1.facility_id != null || p2.facility_id != null) return false;
    const t1 = CampsiteMerger.nameTokens(name1), t2 = CampsiteMerger.nameTokens(name2);
    const s1 = new Set(t1), s2 = new Set(t2);
    const diff = [...t1.filter(t => !s2.has(t)), ...t2.filter(t => !s1.has(t))];
    if (!diff.length) return false;
    // Only positional words split records here. A bare number or letter can name a separate campground,
    // a loop of one park or a single site, and names alone cannot tell those apart, so those keep today's grouping.
    if (!diff.every(t => DISTINGUISHING_TOKENS.has(t))) return false;
    return !INDIVIDUAL_SITE_NAME.test(String(name1)) && !INDIVIDUAL_SITE_NAME.test(String(name2));
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
      // A separate record's amenity list stays with that record. Only the same record seen twice unions.
      amenities: [...new Set([...list(primary.amenities), ...(secondary.id === primary.id ? list(secondary.amenities) : [])])],
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
    // Listing type describes the record that carries it. A different absorbed record never lends its type
    // (tourism-type-admission candidate, group B). The same record seen twice still fills a missing type.
    if (secondary.id !== primary.id && merged.type === secondary.type && merged.type !== primary.type) merged.type = null;
    ownClassification(merged, primary, secondary);
    if (osmIdentity(secondary) && primary.id !== secondary.id) {
      const evidence = memberEvidence(primary, secondary);
      for (const key of Object.keys(merged)) if (ownedOsmField(key)) {
        if (Object.hasOwn(primary, key)) merged[key] = primary[key];
        else delete merged[key];
      }
      if (evidence.length) merged.member_evidence = evidence;
      merged.field_provenance.cost = primaryCost !== null ? (primary.field_provenance?.cost || 'source-reported') : 'unknown';
      const feeKeys = ['fee','charge','fee:conditional'];
      if (feeKeys.some(k => primary[k] != null) && feeKeys.some(k => secondary[k] != null)
          && feeKeys.some(k => String(primary[k] ?? '') !== String(secondary[k] ?? ''))) {
        merged.data_conflicts = [...new Set([...merged.data_conflicts, 'member_fee_disagreement'])];
      }
      // Preserve the old first-donor access exclusion without claiming that
      // the recipient itself carries that access tag. This is an admission hold.
      const donor = evidence.find(e => e.fields.access != null && e.fields.access !== '');
      if (primary.access_hold) merged.access_hold = primary.access_hold;
      else if (!primary.access && donor && /^(private|no|military)$/i.test(String(donor.fields.access).trim())) {
        merged.access_hold = {value: String(donor.fields.access).trim().toLowerCase(), source_record_id: donor.source_record_id};
      } else delete merged.access_hold;
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

          // A published listing ID stays the kept record, with its own point, when a record that was
          // previously absorbed elsewhere now matches it. Reviews and saved stops are keyed by that ID.
          const keepIncoming = this.preferredIds?.has(feature.properties.id) && !this.publishedAnyIds?.has(uniqueFeatures[i].properties.id);
          const kept = keepIncoming ? feature : uniqueFeatures[i], absorbed = keepIncoming ? uniqueFeatures[i] : feature;
          const merged = { ...kept };
          merged.properties = this.mergeProperties(kept.properties, absorbed.properties);

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

// Canonical IDs in the committed search index, so a published listing keeps its ID across re-merges.
function publishedIds(campsitesDir, { includeAliases = false } = {}) {
  try {
    const sites = JSON.parse(require('fs').readFileSync(path.join(campsitesDir, 'search-index.json'), 'utf8')).sites;
    if (!Array.isArray(sites)) return null;
    return new Set(sites.flatMap(site => includeAliases ? [site.id, ...(site.legacy_ids || [])] : [site.id]));
  } catch (error) {
    return null;
  }
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
  // Published listing IDs, so a re-merge keeps them canonical (both entry points load sources here).
  if (merger.preferredIds === undefined) merger.preferredIds = publishedIds(campsitesDir);
  if (merger.publishedAnyIds === undefined) merger.publishedAnyIds = publishedIds(campsitesDir, { includeAliases: true });
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

module.exports = { CampsiteMerger, saveMergedData, loadStateSources, publishedIds };
