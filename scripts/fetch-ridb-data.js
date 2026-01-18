#!/usr/bin/env node
/**
 * RIDB Data Fetcher for KampTrail
 *
 * Fetches real campsite data from the Recreation Information Database (RIDB) API
 * and generates state-based GeoJSON files.
 *
 * Setup:
 * 1. Get a free API key from https://ridb.recreation.gov/docs
 * 2. Set environment variable: export RIDB_API_KEY="your-key-here"
 * 3. Run: node scripts/fetch-ridb-data.js
 *
 * API Documentation: https://ridb.recreation.gov/docs
 * Rate Limit: 50 requests/minute
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RIDB_API_KEY = process.env.RIDB_API_KEY;
const BASE_URL = 'https://ridb.recreation.gov/api/v1';
const OUTPUT_DIR = path.join(__dirname, '../data/campsites');
const RATE_LIMIT_DELAY = 1200; // ms between requests (50 req/min = 1 req per 1.2s)

// State codes for all 50 US states
const STATES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming'
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
  // Extract coordinates (RIDB uses FacilityLatitude/Longitude fields)
  const lat = parseFloat(campsite.FacilityLatitude);
  const lon = parseFloat(campsite.FacilityLongitude);

  // Skip if no valid coordinates
  if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
    return null;
  }

  // Determine campsite type
  let type = 'established';
  const siteName = (campsite.CampsiteName || '').toLowerCase();
  if (siteName.includes('dispersed')) type = 'dispersed';
  else if (siteName.includes('backcountry') || siteName.includes('primitive')) type = 'backcountry';

  // Extract amenities from campsite attributes
  const amenities = [];
  if (campsite.CampsiteAccessible) amenities.push('accessible');

  // Determine cost (use 0 if not specified)
  const cost = campsite.CampsiteReservable ? null : 0; // Reservable sites usually have fees

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
      rating: null, // RIDB doesn't provide ratings
      reviews_count: 0,
      amenities: amenities,
      rig_friendly: campsite.CampsiteType === 'RV' ? ['RV', 'trailer'] : [],
      road_difficulty: null, // Not available in RIDB
      max_length: campsite.MaxVehicleLength ? parseInt(campsite.MaxVehicleLength) : null,
      reservable: campsite.CampsiteReservable || false,
      state: stateCode,
      source: 'RIDB',
      ridb_facility_id: campsite.FacilityID,
      ridb_campsite_id: campsite.CampsiteID
    }
  };
}

async function fetchAllCampsitesForState(stateCode) {
  const allFeatures = [];
  let facilityOffset = 0;
  const facilityLimit = 50;
  let moreFacilities = true;

  console.log(`\n🏕️  Processing ${STATES[stateCode]} (${stateCode})...`);

  while (moreFacilities) {
    try {
      const response = await fetchFacilitiesByState(stateCode, facilityOffset, facilityLimit);
      const facilities = response.RECDATA || [];

      if (facilities.length === 0) {
        moreFacilities = false;
        break;
      }

      // For each facility, fetch its campsites
      for (const facility of facilities) {
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

            // Check if there are more pages
            if (campsites.length < campsiteLimit) {
              moreCampsites = false;
            }
          } catch (err) {
            console.error(`  ❌ Error fetching campsites for facility ${facility.FacilityID}:`, err.message);
            moreCampsites = false;
          }
        }
      }

      facilityOffset += facilityLimit;

      // Check if there are more pages
      if (facilities.length < facilityLimit) {
        moreFacilities = false;
      }
    } catch (err) {
      console.error(`❌ Error fetching facilities for ${stateCode}:`, err.message);
      moreFacilities = false;
    }
  }

  console.log(`✅ Found ${allFeatures.length} campsites in ${STATES[stateCode]}`);
  return allFeatures;
}

async function generateStateFiles() {
  if (!RIDB_API_KEY) {
    console.error('❌ RIDB_API_KEY environment variable not set!');
    console.error('Get your free API key from: https://ridb.recreation.gov/docs');
    console.error('Then run: export RIDB_API_KEY="your-key-here"');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const totalStats = {
    states: 0,
    totalSites: 0
  };

  // Process each state
  for (const [code, name] of Object.entries(STATES)) {
    try {
      const features = await fetchAllCampsitesForState(code);

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
      } else {
        console.log(`⚠️  No campsites found for ${name}, skipping file generation\n`);
      }
    } catch (err) {
      console.error(`❌ Failed to process ${name}:`, err.message, '\n');
    }
  }

  // Generate index.json
  const index = {
    generated: new Date().toISOString(),
    total_sites: totalStats.totalSites,
    states: Object.keys(STATES).map(code => ({
      state: code,
      count: 0 // TODO: calculate actual count per state
    })),
    source: 'RIDB',
    version: '2.0'
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify(index, null, 2)
  );

  console.log('\n✅ Data fetch complete!');
  console.log(`📊 Total: ${totalStats.totalSites} campsites across ${totalStats.states} states`);
  console.log(`📁 Files saved to: ${OUTPUT_DIR}`);
}

// Run the script
if (require.main === module) {
  generateStateFiles().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { generateStateFiles };
