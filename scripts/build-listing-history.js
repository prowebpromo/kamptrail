#!/usr/bin/env node
'use strict';
// Freeze old published identities as dated historical notices, never as current advice.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const History=require('../listing-history');
const DQ=require('../data-quality');
const sourceOf=id=>id.startsWith('osm:')?'osm':id.startsWith('ridb:')?'ridb':id.startsWith('usfs:')?'usfs':/^blm(?:-area)?:/.test(id)?'blm':null;
function recordId(feature){
  const p=feature?.properties||{};
  if(p.facility_id!=null)return `ridb:${p.facility_id}`;
  if(p.osm_id!=null&&p.osm_type)return `osm:${p.osm_type}:${p.osm_id}`;
  return p.id!=null?String(p.id):null;
}
function successfulScopes(health){
  const start=Date.parse(health?.run?.started),result=new Set();
  if(!Number.isFinite(start))return result;
  for(const [source,entry] of Object.entries(health.sources||{}))for(const [state,row] of Object.entries(entry.scopes||{}))
    if(row.outcome==='fresh'&&Date.parse(row.last_attempt)>=start&&Date.parse(row.last_success)>=start)result.add(`${source}:${state}`);
  return result;
}
function ownRecords(records,id){return records.filter(row=>recordId(row.feature)===id);}
function sourceDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z)?$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value.slice(0,10))return null;
  return value;
}
function evidence(rows,id){
  const dates=[],urls=[];
  for(const {feature} of rows){
    const p=feature.properties||{},retrieved=sourceDate(p.source_retrieved_at||p.retrieved_at),updated=sourceDate(p.source_updated_at||p.osm_timestamp||p.LastUpdatedDate);
    const date={source_record_id:id,retrieved_at:retrieved,updated_at:updated};
    if(!dates.some(row=>JSON.stringify(row)===JSON.stringify(date)))dates.push(date);
    const fallback=id.startsWith('osm:')?`https://www.openstreetmap.org/${id.split(':')[1]}/${id.split(':')[2]}`
      :id.startsWith('ridb:')?`https://www.recreation.gov/camping/campgrounds/${id.slice(5)}`:null;
    const value=p.source_url||fallback;
    if(value){let u;try{u=new URL(value);}catch{throw Error('Invalid old source URL '+id);}
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Unsafe old source URL '+id);
      if(!urls.some(row=>row.url===value))urls.push({source_record_id:id,url:value});}
  }
  if(!dates.length)dates.push({source_record_id:id,retrieved_at:null,updated_at:null});
  return {source_dates:dates,source_urls:urls};
}
function buildHistory({previousIndex,currentIndex,priorHistory={version:1,listings:[]},previousRecords=[],currentRecords=[],scopes=new Set(),archivedAt}){
  History.validateHistory(priorHistory);
  if(!Array.isArray(previousIndex?.sites)||!Array.isArray(currentIndex?.sites))throw Error('Invalid history build index');
  const result={version:1,listings:structuredClone(priorHistory.listings)},reserved=History.historyMap(priorHistory);
  const currentCanonicals=new Set(currentIndex.sites.map(row=>row.id));
  for(const site of previousIndex.sites){
    if(reserved.has(site.id)||currentCanonicals.has(site.id))continue;
    const source=sourceOf(site.id),old=ownRecords(previousRecords,site.id),now=ownRecords(currentRecords,site.id);
    if(!source||!old.length)throw Error('Missing original own source evidence for '+site.id);
    const states=[...new Set(old.map(row=>row.state).filter(Boolean))];
    const needed=['usfs','blm'].includes(source)?[`${source}:US`]:states.map(state=>`${source}:${state}`);
    if(!needed.length||needed.some(scope=>!scopes.has(scope)))throw Error('Source refresh not successful for lost listing '+site.id);
    if(now.some(row=>{
      const normalized=DQ.normalizeFeature(row.feature,{state:row.state});
      return normalized&&normalized.properties.camping_classification==='campsite';
    }))throw Error('Current own record remains publishable; fix identity merge instead of archiving '+site.id);
    const provenance={source_dates:[],source_urls:[]};
    for(const id of [site.id,...(site.legacy_ids||[])]){
      const own=evidence(ownRecords(previousRecords,id),id);
      provenance.source_dates.push(...own.source_dates);provenance.source_urls.push(...own.source_urls);
    }
    result.listings.push({id:site.id,legacy_ids:[...(site.legacy_ids||[])],name:site.name,lat:site.lat,lng:site.lng,
      states:[...site.states],...provenance,reason:now.length?'no_longer_in_current_catalogue':'source_absent_latest_feed',archived_at:archivedAt});
  }
  // Never alter/reactivate prior historical rows, even when their source reappears.
  History.validateHistory(result);
  for(const prior of priorHistory.listings)if(JSON.stringify(result.listings.find(row=>row.id===prior.id))!==JSON.stringify(prior))throw Error('Historical listing changed '+prior.id);
  return result;
}
function sourcePaths(names){return names.filter(name=>/^data\/opencampingmap\/[A-Z]{2}\.geojson$/.test(name)||/^data\/campsites\/[A-Z]{2}(?:\(1\))?\.geojson$/.test(name)||/^data\/campsites\/agency\/[A-Z]{2}\.geojson$/.test(name));}
function readRecords(names,read){
  const records=[];
  for(const name of sourcePaths(names)){
    if(name.includes('(1)')&&names.includes(name.replace('(1)','')))continue;
    const data=JSON.parse(read(name));
    if(!Array.isArray(data.features))throw Error('Invalid source collection '+name);
    const state=path.basename(name).slice(0,2);
    for(const feature of data.features)records.push({feature,state});
  }
  return records;
}
function buildFromCheckout({root,baselineRoot=root,baseRef,previousIndexPath,output,archivedAt}){
  if(!/^[A-Za-z0-9_./-]+$/.test(baseRef)||baseRef.startsWith('-'))throw Error('Invalid baseline revision');
  const git=(...args)=>execFileSync('git',args,{cwd:baselineRoot,encoding:'utf8',maxBuffer:64*1024*1024});
  const names=git('ls-tree','-r','--name-only',baseRef,'data/opencampingmap','data/campsites').trim().split('\n');
  const currentNames=[];
  for(const dir of ['data/opencampingmap','data/campsites','data/campsites/agency'])if(fs.existsSync(path.join(root,dir)))for(const name of fs.readdirSync(path.join(root,dir)))currentNames.push(`${dir}/${name}`);
  const historyPath=path.join(root,'data/campsites/withdrawn.json');
  const prior=fs.existsSync(historyPath)?JSON.parse(fs.readFileSync(historyPath,'utf8')):{version:1,listings:[]};
  if(names.includes('data/campsites/withdrawn.json')){
    const committed=History.validateHistory(JSON.parse(git('show',`${baseRef}:data/campsites/withdrawn.json`)));
    const currentHistory=History.historyMap(prior);
    for(const row of committed.listings)if(JSON.stringify(currentHistory.get(row.id))!==JSON.stringify(row))throw Error('Committed historical listing missing or changed '+row.id);
  }
  const previous=JSON.parse(previousIndexPath?fs.readFileSync(previousIndexPath,'utf8'):git('show',`${baseRef}:data/campsites/search-index.json`));
  const current=JSON.parse(fs.readFileSync(path.join(root,'data/campsites/search-index.json'),'utf8'));
  const health=JSON.parse(fs.readFileSync(path.join(root,'data/health.json'),'utf8'));
  const result=buildHistory({previousIndex:previous,currentIndex:current,priorHistory:prior,
    previousRecords:readRecords(names,name=>git('show',`${baseRef}:${name}`)),currentRecords:readRecords(currentNames,name=>fs.readFileSync(path.join(root,name),'utf8')),
    scopes:successfulScopes(health),archivedAt});
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',History.serializeHistory(result));fs.renameSync(output+'.tmp',output);
  return result;
}
if(require.main===module){
  try{
    const args=process.argv.slice(2),opts={root:path.resolve(__dirname,'..'),baseRef:'HEAD',archivedAt:new Date().toISOString()};
    for(let i=0;i<args.length;i+=2){const key={'--root':'root','--baseline-root':'baselineRoot','--base-ref':'baseRef','--previous-index':'previousIndexPath','--output':'output','--archived-at':'archivedAt'}[args[i]];if(!key||!args[i+1])throw Error('Invalid history builder option');opts[key]=args[i+1];}
    opts.root=path.resolve(opts.root);opts.output=path.resolve(opts.output||path.join(opts.root,'data/campsites/withdrawn.json'));
    const result=buildFromCheckout(opts);console.log(`Historical listings: ${result.listings.length}; reserved identities: ${History.reservedIds(result).size}.`);
  }catch(error){console.error('Listing history build failed: '+error.message);process.exitCode=1;}
}
module.exports={buildHistory,buildFromCheckout,successfulScopes,readRecords,recordId};
