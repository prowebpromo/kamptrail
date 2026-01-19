#!/usr/bin/env node
/**
 * OpenStreetMap Campsite Fetcher
 * Fetches real campsite data from OpenStreetMap via Overpass API
 * No API key needed!
 */

const https = require('https');
const fs = require('fs');

const STATES = {
  'CA': 'US-CA', 'CO': 'US-CO', 'UT': 'US-UT', 'AZ': 'US-AZ',
  'WA': 'US-WA', 'OR': 'US-OR', 'MT': 'US-MT', 'WY': 'US-WY',
  'TX': 'US-TX', 'FL': 'US-FL', 'NY': 'US-NY', 'NC': 'US-NC'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function overpassQuery(stateISO) {
  const query = `
[out:json][timeout:60];
area["ISO3166-2"="${stateISO}"]->.searchArea;
(
  node["tourism"="camp_site"](area.searchArea);
  way["tourism"="camp_site"](area.searchArea);
  node["tourism"="caravan_site"](area.searchArea);
  way["tourism"="caravan_site"](area.searchArea);
);
out center tags;
`;

  return new Promise((resolve, reject) => {
    const postData = query;
    const options = {
      hostname: 'overpass-api.de',
      port: 443,
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
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
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function osmToGeoJSON(osmElement, stateCode) {
  const tags = osmElement.tags || {};

  // Get coordinates
  let lat, lon;
  if (osmElement.type === 'node') {
    lat = osmElement.lat;
    lon = osmElement.lon;
  } else if (osmElement.center) {
    lat = osmElement.center.lat;
    lon = osmElement.center.lon;
  } else {
    return null;
  }

  if (!lat || !lon) return null;

  // Determine type
  let type = 'established';
  if (tags.backcountry === 'yes' || tags.informal === 'yes') {
    type = 'backcountry';
  } else if (tags.tents === 'yes' && !tags.caravans) {
    type = 'backcountry';
  }

  // Extract amenities
  const amenities = [];
  if (tags.toilets === 'yes') amenities.push('toilets');
  if (tags.drinking_water === 'yes' || tags.water === 'yes') amenities.push('water');
  if (tags.shower === 'yes' || tags.showers === 'yes') amenities.push('showers');
  if (tags.electricity === 'yes') amenities.push('electricity');
  if (tags.bbq === 'yes' || tags.fireplace === 'yes') amenities.push('fire_rings');

  // RV friendly
  const rigFriendly = [];
  if (tags.caravans === 'yes') rigFriendly.push('RV', 'trailer');
  if (tags.motorhome === 'yes') rigFriendly.push('motorhome');
  if (tags.tents === 'yes') rigFriendly.push('tent');

  // Cost
  let cost = null;
  if (tags.fee === 'no') cost = 0;
  else if (tags.fee === 'yes') cost = null; // Unknown amount

  // Name
  const name = tags.name ||
               tags['name:en'] ||
               `Campsite near ${tags.addr_city || tags.addr_county || stateCode}`;

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      id: `${stateCode}-OSM-${osmElement.id}`,
      name: name,
      facility: name,
      type: type,
      cost: cost,
      rating: null,
      reviews_count: 0,
      amenities: amenities,
      rig_friendly: rigFriendly,
      road_difficulty: null,
      state: stateCode,
      source: 'OpenStreetMap',
      osm_id: osmElement.id,
      osm_type: osmElement.type,
      website: tags.website || tags['contact:website'] || null,
      phone: tags.phone || tags['contact:phone'] || null
    }
  };
}

async function fetchStateOSM(stateCode, stateISO) {
  console.log(`\n🏕️  Fetching ${stateCode} from OpenStreetMap...`);

  try {
    await sleep(2000); // Rate limiting for Overpass API
    const data = await overpassQuery(stateISO);
    const elements = data.elements || [];

    console.log(`   Found ${elements.length} OSM campsite elements`);

    const features = [];
    for (const element of elements) {
      const feature = osmToGeoJSON(element, stateCode);
      if (feature) {
        features.push(feature);
      }
    }

    console.log(`   ✓ Converted ${features.length} valid campsites`);
    return features;

  } catch (err) {
    console.error(`   ❌ Error: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('🚀 Fetching real campsite data from OpenStreetMap...\n');
  console.log('📝 Note: This uses the free Overpass API (no key needed)\n');

  if (!fs.existsSync('data/campsites')) {
    fs.mkdirSync('data/campsites', { recursive: true });
  }

  let totalSites = 0;
  const stateStats = [];

  for (const [stateCode, stateISO] of Object.entries(STATES)) {
    const features = await fetchStateOSM(stateCode, stateISO);

    if (features.length > 0) {
      const geojson = {
        type: 'FeatureCollection',
        features: features
      };

      fs.writeFileSync(
        `data/campsites/${stateCode}.geojson`,
        JSON.stringify(geojson, null, 2)
      );

      console.log(`   💾 Saved ${stateCode}.geojson\n`);
      totalSites += features.length;
      stateStats.push({ state: stateCode, count: features.length });
    }
  }

  // Update index
  const indexData = {
    generated: new Date().toISOString(),
    total_sites: totalSites,
    states: stateStats,
    source: 'OpenStreetMap',
    version: '2.0',
    note: 'Real campsite data from OpenStreetMap contributors'
  };

  fs.writeFileSync(
    'data/campsites/index.json',
    JSON.stringify(indexData, null, 2)
  );

  console.log(`\n✅ SUCCESS!`);
  console.log(`📊 Fetched ${totalSites} real campsites across ${stateStats.length} states`);
  console.log(`📁 Files saved to data/campsites/`);
  console.log(`\nTop states by campsite count:`);
  stateStats.sort((a, b) => b.count - a.count).slice(0, 5).forEach(s => {
    console.log(`   ${s.state}: ${s.count} sites`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
