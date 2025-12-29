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

  /**
   * Check if two campsites are likely the same location
   */
  areDuplicates(site1, site2) {
    const [lon1, lat1] = site1.geometry.coordinates;
    const [lon2, lat2] = site2.geometry.coordinates;

    const distance = this.calculateDistance(lat1, lon1, lat2, lon2);

    // If within threshold distance
    if (distance < this.DISTANCE_THRESHOLD_METERS) {
      // Check name similarity for confirmation
      const nameSimilarity = this.stringSimilarity(
        site1.properties.name,
        site2.properties.name
      );

      // If very close and names are similar, definitely duplicates
      if (distance < 100 || nameSimilarity > 0.6) {
        return true;
      }
    }

    return false;
  }

  /**
   * Merge properties from multiple sources, preferring more complete data
   */
  mergeProperties(primary, secondary) {
    return {
      ...primary,
      // Prefer non-null/non-zero values from either source
      rating: primary.rating || secondary.rating || null,
      reviews_count: Math.max(primary.reviews_count || 0, secondary.reviews_count || 0),
      cost: primary.cost || secondary.cost || 0,
      // Merge arrays (unique values)
      amenities: [...new Set([...(primary.amenities || []), ...(secondary.amenities || [])])],
      rig_friendly: [...new Set([...(primary.rig_friendly || []), ...(secondary.rig_friendly || [])])],
      // Prefer more specific type
      type: primary.type !== 'established' ? primary.type : secondary.type,
      // Keep track of sources
      sources: [...new Set([
        ...(primary.sources || [primary.source]),
        ...(secondary.sources || [secondary.source])
      ])].filter(Boolean),
      // Prefer longer description
      description: (primary.description?.length > secondary.description?.length)
        ? primary.description
        : secondary.description
    };
  }

  /**
   * Merge multiple GeoJSON datasets
   */
  async mergeDatasets(datasets) {
    console.log(`\n📊 Merging ${datasets.length} datasets...`);

    let allFeatures = [];
    let duplicatesRemoved = 0;

    // Combine all features
    datasets.forEach(dataset => {
      if (dataset && dataset.features) {
        allFeatures = allFeatures.concat(dataset.features);
      }
    });

    console.log(`  Total features before deduplication: ${allFeatures.length}`);

    // Deduplicate
    const uniqueFeatures = [];

    for (const feature of allFeatures) {
      // Check if this feature is a duplicate of any existing unique feature
      let isDuplicate = false;
      let mergedFeature = null;

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
      features: uniqueFeatures
    };
  }

  /**
   * Load GeoJSON file
   */
  async loadGeoJSON(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.log(`  ⚠️  Could not load ${path.basename(filePath)}: ${err.message}`);
      return null;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const stateArg = args.find(a => a.startsWith('--state='));

  if (!stateArg) {
    console.error('❌ Usage: node merge_campsite_data.js --state=CA');
    process.exit(1);
  }

  const stateCode = stateArg.split('=')[1].toUpperCase();
  const dataDir = path.join(__dirname, '../data/campsites');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Merging campsite data for ${stateCode}`);
  console.log(`${'='.repeat(60)}`);

  const merger = new CampsiteMerger();

  // Load all available data sources for this state
  const sources = [
    { name: 'Recreation.gov', file: `${stateCode}.geojson` },
    { name: 'Campendium', file: `${stateCode}_campendium.geojson` },
    { name: 'iOverlander', file: `${stateCode}_ioverlander.geojson` }
  ];

  const datasets = [];

  for (const source of sources) {
    const filePath = path.join(dataDir, source.file);
    console.log(`\n📂 Loading ${source.name}...`);

    const data = await merger.loadGeoJSON(filePath);
    if (data && data.features && data.features.length > 0) {
      console.log(`  ✅ Loaded ${data.features.length} campsites`);
      datasets.push(data);
    }
  }

  if (datasets.length === 0) {
    console.error('\n❌ No data sources found to merge!');
    process.exit(1);
  }

  // Merge datasets
  const merged = await merger.mergeDatasets(datasets);

  // Save merged data
  const outputFile = path.join(dataDir, `${stateCode}_merged.geojson`);
  await fs.writeFile(outputFile, JSON.stringify(merged, null, 2));

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

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { CampsiteMerger };
