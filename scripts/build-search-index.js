#!/usr/bin/env node
'use strict';

// Build campsite-name discovery from the same publishable records as the map.
// No geocoding, name invention, or provider calls occur in this build.
const fs = require('node:fs');
const path = require('node:path');
const DataQuality = require('../data-quality.js');

function featureIds(feature) {
  const p = feature.properties;
  return [...new Set([p.id, ...(p.legacy_ids || [])].filter(id => id != null && id !== '').map(String))];
}

function buildSearchIndex(collections, quality = DataQuality) {
  const input = [];
  const stateById = new Map();
  for (const {state, geojson} of collections) {
    if (!/^[A-Z]{2}$/.test(state)) throw new Error(`Invalid source state: ${state}`);
    if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`${state} is not a GeoJSON FeatureCollection`);
    }
    for (const raw of geojson.features) {
      const feature = quality.normalizeFeature(raw, {state});
      if (!feature) continue;
      input.push(feature);
      for (const id of featureIds(feature)) {
        if (!stateById.has(id)) stateById.set(id, new Set());
        stateById.get(id).add(state);
      }
    }
  }

  const cleaned = quality.cleanAndDedupeGeoJSON({type:'FeatureCollection', features:input});
  const sites = cleaned.features.map(feature => {
    const states = new Set();
    for (const id of featureIds(feature)) {
      for (const state of stateById.get(id) || []) states.add(state);
    }
    if (!states.size) throw new Error(`No source snapshot found for ${feature.properties.id}`);
    const [lng, lat] = feature.geometry.coordinates;
    return {id:feature.properties.id, name:feature.properties.name, states:[...states].sort(), lat, lng};
  });
  sites.sort((a,b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  return {version:1, sites};
}

function buildFromDirectory(directory) {
  const files = fs.readdirSync(directory).filter(name => /^[A-Z]{2}_merged\.geojson$/.test(name)).sort();
  if (files.length !== 50) {
    throw new Error(`Expected 50 saved state snapshots; found ${files.length}. Search index was not replaced.`);
  }
  // Agency records (USFS, BLM) load beside each state snapshot, so search must index them too.
  return buildSearchIndex(files.map(name => {
    const state = name.slice(0,2);
    const geojson = JSON.parse(fs.readFileSync(path.join(directory,name), 'utf8'));
    const agencyFile = path.join(directory, 'agency', `${state}.geojson`);
    if (fs.existsSync(agencyFile)) {
      const agency = JSON.parse(fs.readFileSync(agencyFile, 'utf8'));
      if (agency?.type === 'FeatureCollection' && Array.isArray(agency.features)) geojson.features = [...geojson.features, ...agency.features];
    }
    return {state, geojson};
  }));
}

if (require.main === module) {
  const directory = path.resolve(__dirname, '../data/campsites');
  try {
    const result = buildFromDirectory(directory);
    if (!result.sites.length) throw new Error('No publishable campsites found. Search index was not replaced.');
    const output = path.join(directory, 'search-index.json');
    const temporary = output + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(result) + '\n');
    fs.renameSync(temporary, output);
    console.log(`Indexed ${result.sites.length.toLocaleString('en-US')} publishable campsites from 50 state snapshots and agency records (${fs.statSync(output).size.toLocaleString('en-US')} bytes).`);
  } catch (error) {
    console.error(`Campsite search index build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {buildSearchIndex, buildFromDirectory};
