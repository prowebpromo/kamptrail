'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const History=require('../listing-history');
function validateHistoryRelease(directory){
  const raw=fs.readFileSync(path.join(directory,'withdrawn.json'));
  if(raw.length>8*1024*1024)throw Error('Historical listing registry exceeds release bound');
  const history=History.validateHistory(JSON.parse(raw));
  if(!raw.equals(Buffer.from(History.serializeHistory(history))))throw Error('Historical registry must use canonical release bytes');
  const sha256=crypto.createHash('sha256').update(History.serializeHistory(history)).digest('hex');
  let search,stateIndex;
  for(const name of ['index.json','search-index.json','identity-hosts.json']){
    const index=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
    if(index.history_sha256!==sha256)throw Error('Catalogue/history mismatch: '+name);
    if(name==='search-index.json')search=index;
    if(name==='index.json')stateIndex=index;
  }
  const paths=fs.readdirSync(directory).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n));
  const agency=path.join(directory,'agency');
  if(fs.existsSync(agency))paths.push(...fs.readdirSync(agency).filter(n=>/^[A-Z]{2}\.geojson$/.test(n)).map(n=>'agency/'+n));
  for(const index of [stateIndex,search]){
    if(!index.source_sha256||Object.keys(index.source_sha256).length!==paths.length)throw Error('Incomplete current source fingerprint map');
    for(const name of paths){
      const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,name))).digest('hex');
      if(index.source_sha256['data/campsites/'+name]!==digest)throw Error('Current source fingerprint mismatch: '+name);
    }
  }
  const reserved=History.reservedIds(history);
  if(!Array.isArray(search.sites)||search.sites.some(row=>[row.id,...(row.legacy_ids||[])].some(id=>reserved.has(id))))throw Error('Historical identity appears in current release');
  return {raw,history,sha256};
}
module.exports={validateHistoryRelease};
