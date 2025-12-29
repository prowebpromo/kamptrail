#!/usr/bin/env node
/**
 * Convert Axiom CSV/JSON output to KampTrail GeoJSON format
 *
 * Usage:
 *   node convert_axiom_to_geojson.js --input axiom-data.csv --state CA
 *   node convert_axiom_to_geojson.js --input axiom-data.json --state CA
 */

const fs = require('fs');
const path = require('path');

function parseCSV(csvContent) {
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    data.push(row);
  }

  return data;
}

function extractCoordinates(text) {
  // Try to find lat/lon in various formats
  const patterns = [
    /(-?\d+\.\d+),\s*(-?\d+\.\d+)/,  // "37.123, -119.456"
    /lat[itude]*[:\s]+(-?\d+\.\d+).*lon[gitude]*[:\s]+(-?\d+\.\d+)/i,
    /(\d+\.\d+)°?\s*[NS].*(\d+\.\d+)°?\s*[EW]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let lat = parseFloat(match[1]);
      let lon = parseFloat(match[2]);

      // Ensure proper sign (US coordinates)
      if (lon > 0) lon = -lon;

      return { lat, lon };
    }
  }

  return null;
}

function extractPrice(text) {
  const match = text.match(/\$(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function extractRating(text) {
  const match = text.match(/(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}

function extractReviewCount(text) {
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}

function parseAmenities(text) {
  const amenities = [];
  const amenityMap = {
    'toilet': 'toilets',
    'restroom': 'toilets',
    'water': 'water',
    'shower': 'showers',
    'electric': 'electricity',
    'dump': 'dump_station',
    'wifi': 'wifi',
    'fire': 'fire_rings',
    'picnic': 'picnic_tables',
    'trash': 'trash'
  };

  const lowerText = text.toLowerCase();
  for (const [keyword, amenity] of Object.entries(amenityMap)) {
    if (lowerText.includes(keyword)) {
      amenities.push(amenity);
    }
  }

  return [...new Set(amenities)];
}

function convertToGeoJSON(axiomData, stateCode, source = 'axiom') {
  const features = [];
  let siteCounter = 1;

  for (const row of axiomData) {
    // Try to find coordinates in various fields
    let coords = null;
    const coordFields = ['coordinates', 'location', 'gps', 'latlon', 'position', 'description'];

    for (const field of coordFields) {
      if (row[field]) {
        coords = extractCoordinates(row[field]);
        if (coords) break;
      }
    }

    // Skip if no coordinates found
    if (!coords) {
      console.log(`⚠️  Skipping "${row.name || row.Name || 'unknown'}" - no coordinates found`);
      continue;
    }

    // Extract data from various possible field names
    const name = row.name || row.Name || row.title || row.Title || `${stateCode} Campground ${siteCounter}`;
    const description = row.description || row.Description || row.details || '';
    const priceText = row.price || row.Price || row.cost || row.fee || '';
    const ratingText = row.rating || row.Rating || row.stars || '';
    const reviewsText = row.reviews || row.Reviews || row['review count'] || '';
    const amenitiesText = row.amenities || row.Amenities || description;

    const feature = {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [coords.lon, coords.lat]
      },
      properties: {
        id: `${stateCode}-AXIOM-${String(siteCounter).padStart(3, '0')}`,
        name: name,
        type: 'established',
        cost: extractPrice(priceText),
        rating: extractRating(ratingText),
        reviews_count: extractReviewCount(reviewsText),
        amenities: parseAmenities(amenitiesText),
        rig_friendly: [],
        road_difficulty: 'paved',
        state: stateCode,
        source: source,
        description: description.substring(0, 200)
      }
    };

    features.push(feature);
    siteCounter++;
  }

  return {
    type: 'FeatureCollection',
    features: features
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputArg = args.find(a => a.startsWith('--input='));
  const stateArg = args.find(a => a.startsWith('--state='));
  const sourceArg = args.find(a => a.startsWith('--source='));

  if (!inputArg || !stateArg) {
    console.error('Usage: node convert_axiom_to_geojson.js --input=file.csv --state=CA [--source=recreation.gov]');
    process.exit(1);
  }

  const inputFile = inputArg.split('=')[1];
  const stateCode = stateArg.split('=')[1].toUpperCase();
  const source = sourceArg ? sourceArg.split('=')[1] : 'axiom';

  console.log(`\n📥 Converting Axiom data to GeoJSON...`);
  console.log(`   Input: ${inputFile}`);
  console.log(`   State: ${stateCode}`);
  console.log(`   Source: ${source}\n`);

  // Read input file
  const content = fs.readFileSync(inputFile, 'utf8');

  // Parse based on file type
  let data;
  if (inputFile.endsWith('.json')) {
    data = JSON.parse(content);
    // Handle both array and object with data property
    if (!Array.isArray(data)) {
      data = data.data || data.results || [data];
    }
  } else if (inputFile.endsWith('.csv')) {
    data = parseCSV(content);
  } else {
    console.error('❌ Unsupported file type. Use .csv or .json');
    process.exit(1);
  }

  console.log(`   Found ${data.length} rows\n`);

  // Convert to GeoJSON
  const geojson = convertToGeoJSON(data, stateCode, source);

  // Save output
  const outputDir = path.join(__dirname, '../data/campsites');
  fs.mkdirSync(outputDir, { recursive: true });

  const suffix = source !== 'axiom' ? `_${source.replace(/[^a-z]/gi, '')}` : '';
  const outputFile = path.join(outputDir, `${stateCode}${suffix}.geojson`);

  fs.writeFileSync(outputFile, JSON.stringify(geojson, null, 2));

  console.log(`✅ Success!`);
  console.log(`   Created ${geojson.features.length} valid campsites`);
  console.log(`   Output: ${outputFile}\n`);

  // Show sample
  if (geojson.features.length > 0) {
    console.log('📋 Sample campsite:');
    console.log(JSON.stringify(geojson.features[0], null, 2));
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}

module.exports = { convertToGeoJSON };
