#!/usr/bin/env node
/**
 * RIDB Sample Data Fetcher for KampTrail
 *
 * Fetches data for a sample of popular camping states for testing.
 * Much faster than the full 50-state fetch.
 *
 * Setup:
 * 1. Get a free API key from https://ridb.recreation.gov/docs
 * 2. Set environment variable: export RIDB_API_KEY="your-key-here"
 * 3. Run: node scripts/fetch-ridb-data-sample.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RIDB_API_KEY = process.env.RIDB_API_KEY;
const BASE_URL = 'https://ridb.recreation.gov/api/v1';
const OUTPUT_DIR = path.join(__dirname, '../data/campsites');
const RATE_LIMIT_DELAY = 1200;

// Sample states - popular camping destinations
const SAMPLE_STATES = {
  'CA': 'California',
  'CO': 'Colorado',
  'UT': 'Utah',
  'AZ': 'Arizona',
  'WA': 'Washington',
  'OR': 'Oregon',
  'MT': 'Montana',
  'WY': 'Wyoming'
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'apikey': RIDB_API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchFacilitiesByState(stateCode, offset = 0, limit = 50) {
  const url = `${BASE_URL}/facilities?state=${stateCode}&activity=CAMPING&offset=${offset}&limit=${limit}`;
  console.log(`Fetching facilities for ${stateCode} (offset ${offset})...`);
  await sleep(RATE_LIMIT_DELAY);
  return httpsGet(url);
}

async function fetchCampsitesForFacility(facilityId, offset = 0, limit = 50) {
  const url = `${BASE_URL}/facilities/${facilityId}/campsites?offset=${offset}&limit=${limit}`;
  console.log(`  Fetching campsites for facility ${facilityId} (offset ${offset})...`);
  await sleep(RATE_LIMIT_DELAY);
  return httpsGet(url);
}

function transformCampsiteToGeoJSON(campsite, facilityName, stateCode) {
  const lat = parseFloat(campsite.FacilityLatitude);
  const lon = parseFloat(campsite.FacilityLongitude);

  if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
    return null;
  }

  let type = 'established';
  const siteName = (campsite.CampsiteName || '').toLowerCase();
  if (siteName.includes('dispersed')) type = 'dispersed';
  else if (siteName.includes('backcountry') || siteName.includes('primitive')) type = 'backcountry';

  const amenities = [];
  if (campsite.CampsiteAccessible) amenities.push('accessible');

  const cost = campsite.CampsiteReservable ? null : 0;

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      id: `${stateCode}-RIDB-${campsite.CampsiteID}`,
      name: campsite.CampsiteName || `${facilityName} Site`,
      facility: facilityName,
      type: type,
      cost: cost,
      rating: null,
      reviews_count: 0,
      amenities: amenities,
      rig_friendly: campsite.CampsiteType === 'RV' ? ['RV', 'trailer'] : [],
      road_difficulty: null,
      max_length: campsite.MaxVehicleLength ? parseInt(campsite.MaxVehicleLength) : null,
      reservable: campsite.CampsiteReservable || false,
      state: stateCode,
      source: 'RIDB',
      ridb_facility_id: campsite.FacilityID,
      ridb_campsite_id: campsite.CampsiteID
    }
  };
}

async function fetchAllCampsitesForState(stateCode, maxFacilities = 10) {
  const allFeatures = [];
  let facilityOffset = 0;
  const facilityLimit = 50;
  let facilitiesProcessed = 0;

  console.log(`\n🏕️  Processing ${SAMPLE_STATES[stateCode]} (${stateCode})...`);

  while (facilitiesProcessed < maxFacilities) {
    try {
      const response = await fetchFacilitiesByState(stateCode, facilityOffset, facilityLimit);
      const facilities = response.RECDATA || [];

      if (facilities.length === 0) {
        break;
      }

      for (const facility of facilities) {
        if (facilitiesProcessed >= maxFacilities) break;

        if (!facility.FacilityLatitude || !facility.FacilityLongitude) {
          console.log(`  ⚠️  Skipping ${facility.FacilityName} - no coordinates`);
          continue;
        }

        let campsiteOffset = 0;
        const campsiteLimit = 50;
        let moreCampsites = true;

        while (moreCampsites) {
          try {
            const campsiteResponse = await fetchCampsitesForFacility(
              facility.FacilityID,
              campsiteOffset,
              campsiteLimit
            );
            const campsites = campsiteResponse.RECDATA || [];

            if (campsites.length === 0) {
              moreCampsites = false;
              break;
            }

            for (const campsite of campsites) {
              const feature = transformCampsiteToGeoJSON(
                campsite,
                facility.FacilityName,
                stateCode
              );
              if (feature) {
                allFeatures.push(feature);
              }
            }

            campsiteOffset += campsiteLimit;

            if (campsites.length < campsiteLimit) {
              moreCampsites = false;
            }
          } catch (err) {
            console.error(`  ❌ Error fetching campsites for facility ${facility.FacilityID}:`, err.message);
            moreCampsites = false;
          }
        }

        facilitiesProcessed++;
      }

      facilityOffset += facilityLimit;

      if (facilities.length < facilityLimit) {
        break;
      }
    } catch (err) {
      console.error(`❌ Error fetching facilities for ${stateCode}:`, err.message);
      break;
    }
  }

  console.log(`✅ Found ${allFeatures.length} campsites in ${SAMPLE_STATES[stateCode]}`);
  return allFeatures;
}

async function generateSampleStateFiles() {
  if (!RIDB_API_KEY) {
    console.error('❌ RIDB_API_KEY environment variable not set!');
    console.error('Get your free API key from: https://ridb.recreation.gov/docs');
    console.error('Then run: export RIDB_API_KEY="your-key-here"');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('🚀 Fetching sample data for popular camping states...');
  console.log('📝 Note: Limiting to first 10 facilities per state for faster testing\n');

  const totalStats = {
    states: 0,
    totalSites: 0,
    stateData: []
  };

  for (const [code, name] of Object.entries(SAMPLE_STATES)) {
    try {
      const features = await fetchAllCampsitesForState(code, 10); // Limit to 10 facilities per state

      if (features.length > 0) {
        const geojson = {
          type: 'FeatureCollection',
          features: features
        };

        const outputPath = path.join(OUTPUT_DIR, `${code}.geojson`);
        fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2));
        console.log(`💾 Saved ${code}.geojson (${features.length} sites)\n`);

        totalStats.states++;
        totalStats.totalSites += features.length;
        totalStats.stateData.push({ state: code, count: features.length });
      } else {
        console.log(`⚠️  No campsites found for ${name}, skipping file generation\n`);
      }
    } catch (err) {
      console.error(`❌ Failed to process ${name}:`, err.message, '\n');
    }
  }

  const index = {
    generated: new Date().toISOString(),
    total_sites: totalStats.totalSites,
    states: totalStats.stateData,
    source: 'RIDB-sample',
    version: '2.0',
    note: 'Sample dataset - limited to first 10 facilities per state'
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify(index, null, 2)
  );

  console.log('\n✅ Sample data fetch complete!');
  console.log(`📊 Total: ${totalStats.totalSites} campsites across ${totalStats.states} states`);
  console.log(`📁 Files saved to: ${OUTPUT_DIR}`);
  console.log('\n💡 To fetch complete data for all states, run: node scripts/fetch-ridb-data.js');
}

if (require.main === module) {
  generateSampleStateFiles().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { generateSampleStateFiles };
