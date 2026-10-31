#!/usr/bin/env node
'use strict';

// Build campsite-name discovery from the same publishable records as the map.
// No geocoding, name invention, or provider calls occur in this build.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DataQuality = require('../data-quality.js');

function featureIds(feature) {
  const p = feature.properties;
  return [...new Set([p.id, ...(p.legacy_ids || [])].filter(id => id != null && id !== '').map(String))];
}

function buildSearchIndex(collections, quality = DataQuality, siteDetails = null, elevationSnapshots = [], preferredIds = null, previousHosts = null) {
  const input = [];
  const stateById = new Map();
  for (const {state, geojson} of collections) {
    if (!/^[A-Z]{2}$/.test(state)) throw new Error(`Invalid source state: ${state}`);
    if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error(`${state} is not a GeoJSON FeatureCollection`);
    }
    for (const raw of quality.publicationCandidates(geojson.features,{state})) {
      const feature = quality.normalizeFeature(raw, {state});
      if (!feature) continue;
      if(siteDetails)quality.attachSiteDetails(feature,siteDetails);
      input.push(feature);
      for (const id of featureIds(feature)) {
        if (!stateById.has(id)) stateById.set(id, new Set());
        stateById.get(id).add(state);
      }
    }
  }

  const cleaned = quality.cleanAndDedupeGeoJSON({type:'FeatureCollection', features:input}, {...(preferredIds ? {preferredIds} : {}), ...(previousHosts ? {previousHosts} : {})});
  const sites = cleaned.features.map(feature => {
    quality.attachElevation(feature,elevationSnapshots);
    const states = new Set();
    for (const id of featureIds(feature)) {
      for (const state of stateById.get(id) || []) states.add(state);
    }
    if (!states.size) throw new Error(`No source snapshot found for ${feature.properties.id}`);
    const [lng, lat] = feature.geometry.coordinates;
    const p=feature.properties,m={f:p.fee_status,t:p.type};
    if(p.amenities?.length)m.a=p.amenities;
    if(p.rig_friendly?.length)m.r=p.rig_friendly;
    if(p.road_difficulty)m.d=p.road_difficulty;
    if(typeof p.open_status==='string'&&p.open_status.trim()&&p.open_status.trim().toLowerCase()!=='none')m.o=p.open_status.trim().toLowerCase().slice(0,80);
    if(p.rating!==null)m.q=p.rating;
    if(p.rv_sigs?.length)m.g=p.rv_sigs;
    const elevation=quality.elevationInfo(feature);if(elevation)m.e=elevation;
    return {id:p.id,legacy_ids:(p.legacy_ids||[]).filter(id=>id!==p.id),name:p.name,states:[...states].sort(),lat,lng,m};
  });
  sites.sort((a,b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en'));
  return {version:1, filter_version:1, community_version:1, elevation_version:1, sites};
}

function readElevationSnapshots(directory){
  const root=path.join(directory,'elevation'),file=path.join(root,'index.json');
  if(!fs.existsSync(file))return [];
  const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!DataQuality.validElevationManifest(manifest))throw new Error('Invalid elevation manifest');
  return Object.entries(manifest.states).map(([code,entry])=>{
    // Manifest validation restricts the relative path to snapshots/<id>/<state>.json.
    const bytes=fs.readFileSync(path.join(root,entry.url));
    if(bytes.length>24000000||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Elevation snapshot checksum mismatch: '+code);
    const d=JSON.parse(bytes.toString('utf8'));
    if(!DataQuality.validElevationState(d,code,manifest.snapshot_id)||Object.keys(d.records).length!==entry.count)throw new Error('Invalid elevation snapshot: '+code);
    return d;
  });
}

// Hash only stable coordinate identity; fee and terrain enrichment cannot rotate weather.
function coordinateIndex(sites) {
  const seen=new Set();
  const rows=sites.map(row=>{
    const key=DataQuality.coordinateKey([row.lng,row.lat]);
    if(typeof row.id!=='string'||!row.id||seen.has(row.id)||!key||!Array.isArray(row.states)||!row.states.length)throw new Error('Invalid coordinate catalogue row');
    seen.add(row.id);return[row.id,key,[...new Set(row.states)].sort()];
  }).sort((a,b)=>Buffer.compare(Buffer.from(a[0],'utf8'),Buffer.from(b[0],'utf8')));
  return{version:1,sha256:crypto.createHash('sha256').update(JSON.stringify(rows),'utf8').digest('hex'),count:rows.length};
}

// Canonical IDs in the committed index. Records keyed by them (reviews, saved stops) must keep resolving.
function publishedIds(directory) {
  const file = path.join(directory, 'search-index.json');
  if (!fs.existsSync(file)) return null;
  const sites = JSON.parse(fs.readFileSync(file, 'utf8')).sites;
  return Array.isArray(sites) ? new Set(sites.map(site => site.id)) : null;
}

// Alias to canonical ID in the committed index, so an alias stays with its listing across rebuilds.
function publishedHosts(directory) {
  const file = path.join(directory, 'search-index.json');
  if (!fs.existsSync(file)) return null;
  const sites = JSON.parse(fs.readFileSync(file, 'utf8')).sites, hosts = new Map();
  if (Array.isArray(sites)) for (const site of sites) for (const alias of site.legacy_ids || []) hosts.set(alias, site.id);
  return hosts;
}

function buildFromDirectory(directory) {
  const files = fs.readdirSync(directory).filter(name => /^[A-Z]{2}_merged\.geojson$/.test(name)).sort();
  if (files.length !== 50) {
    throw new Error(`Expected 50 saved state snapshots; found ${files.length}. Search index was not replaced.`);
  }
  const detailsFile=path.join(directory,'ridb-sites.json');
  const siteDetails=fs.existsSync(detailsFile)?JSON.parse(fs.readFileSync(detailsFile,'utf8')).facilities:null;
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
  }),DataQuality,siteDetails,readElevationSnapshots(directory),publishedIds(directory),publishedHosts(directory));
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
    const identity=path.join(directory,'coordinate-index.json');
    fs.writeFileSync(identity+'.tmp',JSON.stringify(coordinateIndex(result.sites))+'\n');
    fs.renameSync(identity+'.tmp',identity);
    console.log(`Indexed ${result.sites.length.toLocaleString('en-US')} publishable campsites from 50 state snapshots and agency records (${fs.statSync(output).size.toLocaleString('en-US')} bytes).`);
  } catch (error) {
    console.error(`Campsite search index build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {buildSearchIndex, buildFromDirectory, readElevationSnapshots, coordinateIndex, publishedIds, publishedHosts};
