'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const Q=require('../../data-quality'),History=require('../../listing-history');
const root=path.resolve(__dirname,'../..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
let baseline,current;
function assemble(collections,index,sidecars,history=null){
  const input=[],preferredIds=new Set(index.map(row=>row.id)),previousHosts=new Map();
  for(const row of index)for(const id of row.legacy_ids)previousHosts.set(id,row.id);
  const attach=feature=>{Q.attachSiteDetails(feature,sidecars.siteDetails);Q.attachRIDBAmenities(feature,sidecars.ridbAmenities);Q.attachUSFSSiteAmenities(feature,sidecars.usfsAmenities);};
  for(const {state,geojson} of collections){
    const raw=history?geojson.features.map(f=>History.filterActiveFeature(f,history)).filter(Boolean):geojson.features;
    for(const item of Q.publicationCandidates(raw,{state})){const feature=Q.normalizeFeature(item,{state});if(feature){attach(feature);input.push(feature);}}
  }
  const features=Q.cleanAndDedupeGeoJSON({features:input},{preferredIds,previousHosts}).features;features.forEach(attach);
  return new Map(features.map(feature=>[feature.properties.id,feature.properties]));
}
function frozenOwnership(){
  if(baseline)return baseline;
  const bytes=fs.readFileSync(path.join(root,'tests/fixtures/ownership-source-baseline.json.gz'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'67e33cd220438ac0d714d5e431ba21e73e04216fbd36c934f963c46007bc2e6a');
  const source=JSON.parse(zlib.gunzipSync(bytes));
  assert.equal(source.baseline_ref,'1c1ac3a3b5f742c829370fbcfa6f1cb7291afdc3');assert.equal(source.index.sites.length,510);
  baseline={...source,by:assemble(source.collections,source.index.sites,source)};return baseline;
}
function currentOwnership(){
  if(current)return current;
  const original=frozenOwnership(),index=read('data/campsites/search-index.json').sites,history=read('data/campsites/withdrawn.json');
  const fixtureIds=new Set(original.index.sites.map(row=>row.id)),wanted=new Set(index.filter(row=>fixtureIds.has(row.id)).flatMap(row=>[row.id,...row.legacy_ids]));
  const collections=[];
  for(const name of fs.readdirSync(path.join(root,'data/campsites')).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort()){
    const state=name.slice(0,2),features=read('data/campsites/'+name).features,agency=path.join(root,'data/campsites/agency/'+state+'.geojson');
    if(fs.existsSync(agency))features.push(...JSON.parse(fs.readFileSync(agency,'utf8')).features);
    collections.push({state,geojson:{features:features.filter(f=>wanted.has(String(f.properties.id))),type:'FeatureCollection'}});
  }
  const sidecars={siteDetails:read('data/campsites/ridb-sites.json').facilities,ridbAmenities:read('data/campsites/ridb-amenities.json'),usfsAmenities:read('data/campsites/usfs-site-amenities.json')};
  const ownOSM=new Map();
  for(const name of fs.readdirSync(path.join(root,'data/opencampingmap')).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)))for(const feature of read('data/opencampingmap/'+name).features)if(fixtureIds.has(feature.properties.id))ownOSM.set(feature.properties.id,feature.properties);
  const ownSources=new Map();for(const {geojson} of collections)for(const feature of geojson.features){const id=feature.properties.id;if(!ownSources.has(id))ownSources.set(id,[]);ownSources.get(id).push(feature.properties);}
  current={index,indexBy:new Map(index.map(row=>[row.id,row])),history,historyBy:History.historyMap(history),...sidecars,ownOSM,ownSources,by:assemble(collections,index,sidecars,history)};return current;
}
const firstReleaseHistorical=new Set(['osm:node:1060578769','osm:node:1596375040','osm:node:1922410822','osm:node:2332493731']);
function assertHistorical(id,context=currentOwnership()){
  const prior=frozenOwnership().index.sites.find(row=>row.id===id),row=context.historyBy.get(id);assert.ok(row,'Missing current and historical fixture ID '+id);
  History.validateHistory({version:1,listings:[row]});assert.equal(row.id,prior.id);
  for(const alias of prior.legacy_ids)assert.ok(row.legacy_ids.includes(alias),id+' lost its original published alias '+alias);
  // These first-release archives are immutable. A later archive may legitimately
  // use a newer own-source name, point or additional aliases; its host stays fixed.
  if(firstReleaseHistorical.has(id)){assert.equal(row.name,prior.name);assert.equal(row.lat,prior.lat);assert.equal(row.lng,prior.lng);assert.deepEqual(row.legacy_ids,prior.legacy_ids);assert.deepEqual(row.states,prior.states);}
  const reserved=new Set([row.id,...row.legacy_ids]);
  for(const active of context.index)for(const member of [active.id,...active.legacy_ids])assert.equal(reserved.has(member),false,id+' leaked into active identity membership');
  assert.equal(context.by.has(id),false,id+' is still a current feature');
  const feature=History.historicalFeature(row),p=feature.properties;
  for(const key of ['camping_classification','fee_status','cost','amenities','rig_friendly','osm_amenity_tags','osm_rig_tags'])assert.equal(Object.hasOwn(p,key),false,id+' revived '+key);
  for(const filters of [{amenities:['toilet']},{amenities:['water']},{rigSize:'tent'},{rigSize:'trailer'},{rigSize:'rv'}])assert.equal(Q.applyFilters([feature],filters).length,0,id+' historical filter membership');
  assert.ok(row.source_dates.some(date=>date.source_record_id===id),id+' own source date/explicit unknown missing');
  for(const date of row.source_dates)for(const key of ['retrieved_at','updated_at'])if(date[key]!==null){assert.ok(Date.parse(date[key])<=Date.parse(row.archived_at),id+' source date after archive');assert.notEqual(date[key],row.archived_at,id+' archive time passed off as source evidence');}
  for(const source of row.source_urls)assert.ok(reserved.has(source.source_record_id),id+' URL belongs to another listing');
  if(firstReleaseHistorical.has(id)){
    const oldRecords=frozenOwnership().collections.flatMap(c=>c.geojson.features).filter(f=>f.properties.id===id);
    for(const record of oldRecords){const retrieved=record.properties.source_retrieved_at||record.properties.retrieved_at;if(retrieved)assert.ok(row.source_dates.some(date=>date.source_record_id===id&&date.retrieved_at===retrieved),id+' original retrieval date changed');}
  }
}
function assertOwnOsmTags(p,field,context=currentOwnership()){
  if(!p[field])return;
  const own=context.ownOSM.get(p.id);assert.ok(own,p.id+' has OSM evidence without its own source record');
  for(const [key,value] of Object.entries(p[field]))assert.equal(value,own[key],p.id+' borrowed '+key);
}
module.exports={frozenOwnership,currentOwnership,assertHistorical,assertOwnOsmTags};
