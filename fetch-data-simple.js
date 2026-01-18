#!/usr/bin/env node
/**
 * Simple RIDB Data Fetcher - Standalone Version
 * Just run: node fetch-data-simple.js
 */

const https = require('https');
const fs = require('fs');

// SET YOUR API KEY HERE
const API_KEY = "9276246f-055a-4601-bbe7-a5ec1b45d654";

const STATES = ['CA', 'CO', 'UT', 'AZ', 'WA', 'OR', 'MT', 'WY'];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://ridb.recreation.gov/api/v1${path}`;
    https.get(url, {
      headers: { 'apikey': API_KEY }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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
    await sleep(1500);
    const response = await apiGet(`/facilities?state=${code}&activity=CAMPING&limit=50`);
    const facilities = response.RECDATA || [];

    console.log(`Found ${facilities.length} facilities`);

    for (const facility of facilities.slice(0, 5)) { // Limit to 5 facilities per state
      if (!facility.FacilityLatitude || !facility.FacilityLongitude) continue;

      await sleep(1500);
      const campsiteResponse = await apiGet(`/facilities/${facility.FacilityID}/campsites?limit=50`);
      const campsites = campsiteResponse.RECDATA || [];

      console.log(`  ${facility.FacilityName}: ${campsites.length} sites`);

      for (const site of campsites) {
        const lat = parseFloat(site.FacilityLatitude);
        const lon = parseFloat(site.FacilityLongitude);

        if (!lat || !lon) continue;

        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat]
          },
          properties: {
            id: `${code}-${site.CampsiteID}`,
            name: site.CampsiteName || `${facility.FacilityName} Site`,
            facility: facility.FacilityName,
            type: 'established',
            cost: null,
            rating: null,
            reviews_count: 0,
            amenities: site.CampsiteAccessible ? ['accessible'] : [],
            rig_friendly: [],
            road_difficulty: null,
            state: code,
            source: 'RIDB'
          }
        });
      }
    }
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }

  console.log(`✅ Total: ${features.length} campsites`);
  return features;
}

async function main() {
  console.log('🚀 Starting RIDB data fetch...\n');

  if (!fs.existsSync('data')) fs.mkdirSync('data');
  if (!fs.existsSync('data/campsites')) fs.mkdirSync('data/campsites');

  let totalSites = 0;

  for (const state of STATES) {
    const features = await fetchState(state);

    if (features.length > 0) {
      const geojson = { type: 'FeatureCollection', features };
      fs.writeFileSync(
        `data/campsites/${state}.geojson`,
        JSON.stringify(geojson, null, 2)
      );
      console.log(`💾 Saved ${state}.geojson`);
      totalSites += features.length;
    }
  }

  // Update index
  fs.writeFileSync('data/campsites/index.json', JSON.stringify({
    generated: new Date().toISOString(),
    total_sites: totalSites,
    states: STATES.map(s => ({ state: s, count: 0 })),
    source: 'RIDB',
    version: '2.0'
  }, null, 2));

  console.log(`\n✅ DONE! Fetched ${totalSites} total campsites`);
  console.log('📁 Files saved to data/campsites/');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
