#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

async function main() {
  const dataDir = path.join(__dirname, '../data');
  const campsitesDir = path.join(dataDir, 'campsites');
  const outPath = path.join(dataDir, 'opencampingmap.geojson');
  const poiPath = path.join(dataDir, 'poi_dump_water_propane.geojson');

  const allFeatures = [];

  // 1. Combine all merged state GeoJSON files
  const files = await fs.readdir(campsitesDir);
  for (const file of files) {
    if (file.endsWith('_merged.geojson')) {
      const state = file.replace('_merged.geojson', '');
      console.log(`Processing ${state}...`);
      const content = await fs.readFile(path.join(campsitesDir, file), 'utf8');
      const data = JSON.parse(content);
      allFeatures.push(...data.features);
    }
  }

  // 2. Combine the POI data
  try {
    const poiContent = await fs.readFile(poiPath, 'utf8');
    const poiData = JSON.parse(poiContent);
    allFeatures.push(...poiData.features);
    console.log(`\n✅ Added ${poiData.features.length} POIs.`);
  } catch (err) {
    console.warn(`\n⚠️ Could not add POI data: ${err.message}`);
  }

  const featureCollection = {
    type: 'FeatureCollection',
    features: allFeatures
  };

  await fs.writeFile(outPath, JSON.stringify(featureCollection, null, 2));
  console.log(`\n✅ Created ${outPath} with ${allFeatures.length} total features.`);
}

main().catch(console.error);
