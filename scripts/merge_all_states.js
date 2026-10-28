#!/usr/bin/env node
/**
 * Merge All States - Campsite Data Deduplication
 *
 * Merges Recreation.gov and OpenStreetMap data for all 50 US states
 * Deduplicates based on GPS proximity (500m) and name similarity
 *
 * Usage:
 *   node scripts/merge_all_states.js
 */

const fs = require('fs').promises;
const path = require('path');

const ALL_STATES = [
  'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD',
  'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
  'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

const { CampsiteMerger, saveMergedData, loadStateSources } = require('./merge_campsite_data');

async function mergeState(stateCode, merger, directories = {}) {
  const campsitesDir = directories.campsitesDir || path.join(__dirname, '../data/campsites');
  const osmDir = directories.osmDir || path.join(__dirname, '../data/opencampingmap');

  const { datasets } = await loadStateSources(stateCode, merger, { campsitesDir, osmDir });
  const beforeCount = datasets.reduce((count, dataset) => count + dataset.features.length, 0);
  if (!datasets.length) return null;

  // Merge and deduplicate
  const result = await merger.mergeDatasets(datasets);

  const merged = {
    type: 'FeatureCollection',
    features: result.features,
    duplicatesRemoved: result.duplicatesRemoved,
    invalidRemoved: result.invalidRemoved
  };

  // Save merged data
  const outputFile = path.join(campsitesDir, `${stateCode}_merged.geojson`);
  await saveMergedData(outputFile, merged);

  return {
    state: stateCode,
    before: beforeCount,
    after: result.features.length,
    duplicates: result.duplicatesRemoved,
    saved: outputFile
  };
}

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('KAMPTRAIL - MERGE ALL STATES');
  console.log('Merging Recreation.gov + OpenStreetMap data for all 50 states');
  console.log('='.repeat(70) + '\n');

  const merger = new CampsiteMerger();
  const results = [];
  let totalBefore = 0;
  let totalAfter = 0;
  let totalDuplicates = 0;

  for (const state of ALL_STATES) {
    console.log(`\n[${state}] Processing...`);

    const result = await mergeState(state, merger);

    if (result) {
      results.push(result);
      totalBefore += result.before;
      totalAfter += result.after;
      totalDuplicates += result.duplicates;

      const reduction = ((result.duplicates / result.before) * 100).toFixed(1);
      console.log(`  ✅ Merged: ${result.before} → ${result.after} sites (${result.duplicates} duplicates removed, ${reduction}% reduction)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`States processed: ${results.length}/50`);
  console.log(`Total campsites before: ${totalBefore.toLocaleString()}`);
  console.log(`Total campsites after: ${totalAfter.toLocaleString()}`);
  console.log(`Duplicates removed: ${totalDuplicates.toLocaleString()}`);
  console.log(`Overall reduction: ${((totalDuplicates / totalBefore) * 100).toFixed(1)}%`);
  console.log('='.repeat(70) + '\n');

  console.log('✅ All states merged successfully!\n');
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { CampsiteMerger, mergeState };
