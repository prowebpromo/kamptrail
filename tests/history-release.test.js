'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const History=require('../listing-history'),{validateHistoryRelease}=require('../scripts/validate-history-release');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-history-release-'));
  const history={version:1,listings:[{id:'osm:node:1',legacy_ids:['usfs:2'],name:'Original campsite',lat:40,lng:-105,states:['CO'],source_dates:[{source_record_id:'osm:node:1',retrieved_at:'2026-10-29',updated_at:null}],source_urls:[],reason:'source_absent_latest_feed',archived_at:'2026-11-15T12:00:00Z'}]};
  fs.writeFileSync(path.join(dir,'withdrawn.json'),History.serializeHistory(history));
  const sha=crypto.createHash('sha256').update(History.serializeHistory(history)).digest('hex');
  const source='{"type":"FeatureCollection","features":[]}\n';fs.mkdirSync(path.join(dir,'agency'));
  const source_sha256={};for(const name of ['NY_merged.geojson','agency/NY.geojson']){fs.writeFileSync(path.join(dir,name),source);source_sha256['data/campsites/'+name]=crypto.createHash('sha256').update(source).digest('hex');}
  for(const name of ['index.json','search-index.json','identity-hosts.json'])fs.writeFileSync(path.join(dir,name),JSON.stringify({history_sha256:sha,source_sha256,sites:[{id:'osm:node:3',legacy_ids:[]}]}));
  return {dir,history,sha,source_sha256,close:()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('kt-history-release-'));fs.rmSync(dir,{recursive:true,force:true});}};
}
test('release accepts a bound historical registry without current identity overlap',()=>{
  const f=fixture();try{const v=validateHistoryRelease(f.dir);assert.equal(v.sha256,f.sha);assert.deepEqual(v.history,f.history);}finally{f.close();}
});
test('release rejects each mismatched generation and a missing historical registry',()=>{
  for(const name of ['index.json','search-index.json','identity-hosts.json']){const f=fixture();try{fs.writeFileSync(path.join(f.dir,name),JSON.stringify({history_sha256:'0'.repeat(64),sites:[]}));assert.throws(()=>validateHistoryRelease(f.dir),/Catalogue\/history mismatch/);}finally{f.close();}}
  const f=fixture();try{fs.unlinkSync(path.join(f.dir,'withdrawn.json'));assert.throws(()=>validateHistoryRelease(f.dir),/ENOENT/);}finally{f.close();}
});
test('release rejects historical canonical or alias IDs claimed by active records',()=>{
  for(const row of [{id:'osm:node:1'},{id:'usfs:2'},{id:'osm:node:3',legacy_ids:['usfs:2']}]){const f=fixture();try{fs.writeFileSync(path.join(f.dir,'search-index.json'),JSON.stringify({history_sha256:f.sha,source_sha256:f.source_sha256,sites:[row]}));assert.throws(()=>validateHistoryRelease(f.dir),/Historical identity appears/);}finally{f.close();}}
});
test('release rejects state bytes from another generation and noncanonical history bytes',()=>{
  for(const name of ['NY_merged.geojson','agency/NY.geojson']){const f=fixture();try{fs.appendFileSync(path.join(f.dir,name),' ');assert.throws(()=>validateHistoryRelease(f.dir),/Current source fingerprint mismatch/);}finally{f.close();}}
  const f=fixture();try{fs.appendFileSync(path.join(f.dir,'withdrawn.json'),' ');assert.throws(()=>validateHistoryRelease(f.dir),/canonical release bytes/);}finally{f.close();}
});
