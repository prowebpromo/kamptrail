#!/usr/bin/env node
/**
 * RIDB Data Fetcher - FIXED VERSION
 * Uses facility-level data since individual campsites rarely have coordinates
 */

const https = require('https');
const fs = require('fs');

const API_KEY = "9276246f-055a-4601-bbe7-a5ec1b45d654";
const STATES = ['CA', 'CO', 'UT', 'AZ', 'WA', 'OR', 'MT', 'WY'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function apiGet(path) {
  return new Promise((resolve, reject) => {
    https.get(`https://ridb.recreation.gov/api/v1${path}`, {
      headers: { 'apikey': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchState(code) {
  console.log(`\n🏕️  Fetching ${code}...`);
  const features = [];

  try {
    // Fetch facilities (campgrounds) for this state
    await sleep(1500);
    const response = await apiGet(`/facilities?state=${code}&activity=CAMPING&limit=50`);
    const facilities = response.RECDATA || [];

    console.log(`Found ${facilities.length} facilities`);

    for (const facility of facilities) {
      const lat = parseFloat(facility.FacilityLatitude);
      const lon = parseFloat(facility.FacilityLongitude);

      // Skip facilities without coordinates
      if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
        console.log(`  ⚠️  Skipping ${facility.FacilityName} - no coordinates`);
        continue;
      }

      // Determine facility type
      let type = 'established';
      const facilityType = (facility.FacilityTypeDescription || '').toLowerCase();
      if (facilityType.includes('dispersed')) type = 'dispersed';
      else if (facilityType.includes('backcountry')) type = 'backcountry';

      // Create a feature for this campground
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        },
        properties: {
          id: `${code}-${facility.FacilityID}`,
          name: facility.FacilityName,
          facility: facility.FacilityName,
          type: type,
          cost: null, // RIDB doesn't provide reliable cost data
          rating: null,
          reviews_count: 0,
          amenities: [],
          rig_friendly: [],
          road_difficulty: null,
          reservable: facility.Reservable || false,
          state: code,
          source: 'RIDB',
          ridb_id: facility.FacilityID,
          description: facility.FacilityDescription || null
        }
      });

      console.log(`  ✓ ${facility.FacilityName}`);
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }

  console.log(`✅ ${code}: ${features.length} campgrounds`);
  return features;
}

async function main() {
  console.log('🚀 Starting RIDB data fetch (facility-level)...\n');

  if (!fs.existsSync('data')) fs.mkdirSync('data');
  if (!fs.existsSync('data/campsites')) fs.mkdirSync('data/campsites');

  let totalSites = 0;
  const stateStats = [];

  for (const state of STATES) {
    const features = await fetchState(state);

    if (features.length > 0) {
      const geojson = {
        type: 'FeatureCollection',
        features: features
      };

      fs.writeFileSync(
        `data/campsites/${state}.geojson`,
        JSON.stringify(geojson, null, 2)
      );

      console.log(`💾 Saved ${state}.geojson\n`);
      totalSites += features.length;
      stateStats.push({ state: state, count: features.length });
    } else {
      console.log(`⚠️  No data for ${state}\n`);
    }
  }

  // Update index
  const indexData = {
    generated: new Date().toISOString(),
    total_sites: totalSites,
    states: stateStats,
    source: 'RIDB',
    version: '2.0',
    note: 'Facility-level data from Recreation Information Database'
  };

  fs.writeFileSync(
    'data/campsites/index.json',
    JSON.stringify(indexData, null, 2)
  );

  console.log(`\n✅ DONE!`);
  console.log(`📊 Total: ${totalSites} campgrounds across ${stateStats.length} states`);
  console.log(`📁 Files saved to data/campsites/`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
