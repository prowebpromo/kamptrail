#!/usr/bin/env node
/**
 * Merge All States - Campsite Data Deduplication
 *
 * Merges Recreation.gov and OpenStreetMap data for all 50 US states
 * Deduplicates based on GPS proximity (500m) and name similarity
 *
 * Usage:
 *   node scripts/merge_all_states.js
 */

const fs = require('fs').promises;
const path = require('path');

const ALL_STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD',
  'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
  'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

class CampsiteMerger {
  constructor() {
    this.DISTANCE_THRESHOLD_METERS = 500; // 500m threshold
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

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

  areDuplicates(site1, site2) {
    const [lon1, lat1] = site1.geometry.coordinates;
    const [lon2, lat2] = site2.geometry.coordinates;

    const distance = this.calculateDistance(lat1, lon1, lat2, lon2);

    if (distance < this.DISTANCE_THRESHOLD_METERS) {
      const name1 = site1.properties.name || site1.properties.Name || '';
      const name2 = site2.properties.name || site2.properties.Name || '';
      const nameSimilarity = this.stringSimilarity(name1, name2);

      if (distance < 100 || nameSimilarity > 0.6) {
        return true;
      }
    }

    return false;
  }

  mergeProperties(primary, secondary) {
    // Normalize names
    const name = primary.name || primary.Name || secondary.name || secondary.Name;

    return {
      name: name,
      rating: primary.rating || secondary.rating || null,
      reviews_count: Math.max(primary.reviews_count || 0, secondary.reviews_count || 0),
      cost: primary.cost || secondary.cost || 0,
      amenities: [...new Set([...(primary.amenities || []), ...(secondary.amenities || [])])],
      rig_friendly: [...new Set([...(primary.rig_friendly || []), ...(secondary.rig_friendly || [])])],
      type: primary.type || secondary.type || 'established',
      sources: [...new Set([
        ...(primary.sources || [primary.source]),
        ...(secondary.sources || [secondary.source])
      ])].filter(Boolean),
      description: (primary.description?.length > secondary.description?.length)
        ? primary.description
        : secondary.description,
      // Keep OSM-specific fields
      ...(secondary.tourism && { tourism: secondary.tourism }),
      ...(secondary.osm_id && { osm_id: secondary.osm_id })
    };
  }

  async mergeDatasets(datasets) {
    let allFeatures = [];
    let duplicatesRemoved = 0;

    datasets.forEach(dataset => {
      if (dataset && dataset.features) {
        allFeatures = allFeatures.concat(dataset.features);
      }
    });

    const uniqueFeatures = [];

    for (const feature of allFeatures) {
      let isDuplicate = false;

      for (let i = 0; i < uniqueFeatures.length; i++) {
        if (this.areDuplicates(feature, uniqueFeatures[i])) {
          isDuplicate = true;
          duplicatesRemoved++;

          const merged = { ...uniqueFeatures[i] };
          merged.properties = this.mergeProperties(
            uniqueFeatures[i].properties,
            feature.properties
          );

          uniqueFeatures[i] = merged;
          break;
        }
      }

      if (!isDuplicate) {
        if (!feature.properties.sources) {
          feature.properties.sources = [feature.properties.source || 'unknown'].filter(Boolean);
        }
        uniqueFeatures.push(feature);
      }
    }

    return {
      duplicatesRemoved,
      features: uniqueFeatures
    };
  }

  async loadGeoJSON(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }
}

async function mergeState(stateCode, merger) {
  const campsitesDir = path.join(__dirname, '../data/campsites');
  const osmDir = path.join(__dirname, '../data/opencampingmap');

  // Load Recreation.gov data
  const recgovPath = path.join(campsitesDir, `${stateCode}.geojson`);
  const recgovData = await merger.loadGeoJSON(recgovPath);

  // Load OpenStreetMap data
  const osmPath = path.join(osmDir, `${stateCode}.geojson`);
  const osmData = await merger.loadGeoJSON(osmPath);

  if (!recgovData && !osmData) {
    console.log(`  ⚠️  No data found for ${stateCode}`);
    return null;
  }

  const datasets = [];
  let beforeCount = 0;

  if (recgovData && recgovData.features) {
    datasets.push(recgovData);
    beforeCount += recgovData.features.length;
    console.log(`  ✓ Recreation.gov: ${recgovData.features.length} sites`);
  }

  if (osmData && osmData.features) {
    datasets.push(osmData);
    beforeCount += osmData.features.length;
    console.log(`  ✓ OpenStreetMap: ${osmData.features.length} sites`);
  }

  if (datasets.length === 0) {
    return null;
  }

  // Merge and deduplicate
  const result = await merger.mergeDatasets(datasets);

  const merged = {
    type: 'FeatureCollection',
    features: result.features
  };

  // Save merged data
  const outputFile = path.join(campsitesDir, `${stateCode}_merged.geojson`);
  await fs.writeFile(outputFile, JSON.stringify(merged, null, 2));

  return {
    state: stateCode,
    before: beforeCount,
    after: result.features.length,
    duplicates: result.duplicatesRemoved,
    saved: outputFile
  };
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('KAMPTRAIL - MERGE ALL STATES');
  console.log('Merging Recreation.gov + OpenStreetMap data for all 50 states');
  console.log('='.repeat(70) + '\n');

  const merger = new CampsiteMerger();
  const results = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let totalDuplicates = 0;

  for (const state of ALL_STATES) {
    console.log(`\n[${state}] Processing...`);

    const result = await mergeState(state, merger);

    if (result) {
      results.push(result);
      totalBefore += result.before;
      totalAfter += result.after;
      totalDuplicates += result.duplicates;

      const reduction = ((result.duplicates / result.before) * 100).toFixed(1);
      console.log(`  ✅ Merged: ${result.before} → ${result.after} sites (${result.duplicates} duplicates removed, ${reduction}% reduction)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`States processed: ${results.length}/50`);
  console.log(`Total campsites before: ${totalBefore.toLocaleString()}`);
  console.log(`Total campsites after: ${totalAfter.toLocaleString()}`);
  console.log(`Duplicates removed: ${totalDuplicates.toLocaleString()}`);
  console.log(`Overall reduction: ${((totalDuplicates / totalBefore) * 100).toFixed(1)}%`);
  console.log('='.repeat(70) + '\n');

  console.log('✅ All states merged successfully!\n');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { CampsiteMerger };
