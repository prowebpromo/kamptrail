#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

async function main() {
  const dataDir = path.join(__dirname, '../data/campsites');
  const outPath = path.join(__dirname, '../data/opencampingmap.geojson');

  const allFeatures = [];
  const files = await fs.readdir(dataDir);

  for (const file of files) {
    if (file.endsWith('_merged.geojson')) {
      const state = file.replace('_merged.geojson', '');
      console.log(`Processing ${state}...`);
      const content = await fs.readFile(path.join(dataDir, file), 'utf8');
      const data = JSON.parse(content);
      allFeatures.push(...data.features);
    }
  }

  const featureCollection = {
    type: 'FeatureCollection',
    features: allFeatures
  };

  await fs.writeFile(outPath, JSON.stringify(featureCollection, null, 2));
  console.log(`\n✅ Created ${outPath} with ${allFeatures.length} total campsites.`);
}

main().catch(console.error);
