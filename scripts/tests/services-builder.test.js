const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {buildDatabase,writeDatabase,CATEGORIES} = require('../build-services.js');
function row(id='1',type='node',region='UT',coordinates=[-111,40]) { return {id:`osm:${type}:${id}`,osm_type:type,osm_id:id,osm_version:1,edited_at:'2025-01-01T00:00:00Z',coordinates,name:'Service',categories:['fuel'],tags:{amenity:'fuel'},states:[region==='legacy'?'CA':region],source_region:region,...(region==='legacy'?{retrieved_at:'2025-01-01T00:00:00Z'}:{})}; }
function source(items,region='UT') {return {version:2,region,source:{kind:region==='legacy'?'legacy':'geofabrik',url:region==='legacy'?'https://www.openstreetmap.org':`https://download.geofabrik.de/north-america/us/${region==='UT'?'utah':'arizona'}-latest.osm.pbf`,extract_timestamp:region==='legacy'?null:'2025-02-01T00:00:00Z',retrieved_at:region==='legacy'?null:'2025-02-02T00:00:00Z',sha256:'a'.repeat(64),license:'ODbL-1.0',categories:CATEGORIES},items};}
test('exact OSM identities, category union, deterministic hashes and actual shard bytes',()=>{
 const a=row(),b={...row(),categories:['lpg'],tags:{'fuel:lpg':'yes'}},c=row('1','way'),d=row('1','relation');
 const result=buildDatabase([source([a,b,c,d])]);
 assert.equal(result.manifest.total,3);
 assert.deepEqual(JSON.parse(result.shards[0].raw).items.find(x=>x.id==='osm:node:1').categories,['lpg','fuel']);
 const again=buildDatabase([source([d,c,b,a])]);
 assert.equal(result.manifest.snapshot_id,again.manifest.snapshot_id);
 for(const s of result.shards){assert.equal(s.entry.bytes,s.raw.length);assert.equal(s.entry.sha256,crypto.createHash('sha256').update(s.raw).digest('hex'));}
});
test('higher OSM version then newer date wins without losing other states',()=>{
 const old={...row('1','node','legacy'),states:['UT'],osm_version:null,categories:['dump']};
 const ca=row('2','node','legacy');
 const result=buildDatabase([source([old,ca],'legacy'),source([row()])]);
 assert.equal(result.manifest.total,2);
 assert.equal(result.manifest.coverage.find(s=>s.region==='legacy').count,1);
 assert.equal(result.manifest.generated_at,'2025-02-02T00:00:00Z');
});
test('dense cells subdivide and dateline coordinates never create crossing boxes',()=>{
 const items=Array.from({length:1600},(_,i)=>row(String(i+1),'node','UT',[-111+(i%40)/100,40+Math.floor(i/40)/100]));
 items.push(row('2000','node','UT',[180,90]),row('2001','node','UT',[-180,-90]));
 const result=buildDatabase([source(items)]);
 assert.equal(result.manifest.total,1602);assert.ok(result.shards.length>3);
 for(const s of result.shards){assert.ok(s.entry.count<=1500);assert.ok(s.raw.length<=512*1024);assert.ok(s.entry.bbox[0]<s.entry.bbox[2]);}
});
test('invalid source rejected before changing last-good manifest',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'services-test-'));
 try{const valid=buildDatabase([source([row()])]);writeDatabase(valid,directory);const before=fs.readFileSync(path.join(directory,'index.json'));
 const bad=source([{...row(),source_region:'CA'}]);assert.throws(()=>writeDatabase(buildDatabase([bad]),directory),/binding/);
 assert.deepEqual(fs.readFileSync(path.join(directory,'index.json')),before);
 const shard=path.join(directory,valid.shards[0].entry.url);fs.writeFileSync(shard,'corrupt');assert.throws(()=>writeDatabase(valid,directory),/collision/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('metadata fields, bad identities and unsafe URLs fail closed',()=>{
 for(const mutation of [r=>r.id='osm:way:1',r=>r.tags.uid='123',r=>r.name='é'.repeat(61),r=>r.coordinates=[NaN,40]]){const r=row();mutation(r);assert.throws(()=>buildDatabase([source([r])]));}
 const s=source([row()]);s.source.url='https://evil.example/utah-latest.osm.pbf';assert.throws(()=>buildDatabase([s]));
});

test('calendar-invalid UTC dates fail and snapshot retention is bounded',()=>{
 const bad=source([row()]);bad.source.extract_timestamp='2025-02-30T00:00:00Z';assert.throws(()=>buildDatabase([bad]),/calendar/);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'services-retention-'));
 try{for(let i=1;i<=5;i++)writeDatabase(buildDatabase([source([row(String(i))])]),directory);
 assert.equal(fs.readdirSync(path.join(directory,'snapshots')).length,3);
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'index.json')));
 assert.ok(fs.existsSync(path.join(directory,manifest.shards[0].url)));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('later legacy retrieval cannot resurrect state rows absent from accepted full extract',()=>{
 const stale={...row('99','node','legacy'),states:['UT'],osm_version:null,retrieved_at:'2025-03-01T00:00:00Z',categories:['dump']};
 const result=buildDatabase([source([stale,row('2','node','legacy')],'legacy'),source([row('1')])]);
 const ids=result.shards.flatMap(s=>JSON.parse(s.raw).items.map(row=>row.id));
 assert.ok(!ids.includes('osm:node:99'));assert.ok(ids.includes('osm:node:2'));assert.equal(result.manifest.total,2);
});
test('identity winners prefer OSM version then source evidence date, independently of input order',()=>{
 const lower={...row('9','node','legacy'),osm_version:2,name:'lower',retrieved_at:'2025-03-01T00:00:00Z'};
 const higher={...row('9','node','legacy'),osm_version:3,name:'higher',retrieved_at:'2025-01-01T00:00:00Z'};
 const later={...higher,name:'later same version',retrieved_at:'2025-02-01T00:00:00Z'};
 for(const items of [[lower,higher,later],[later,higher,lower]]){
  const result=buildDatabase([source(items,'legacy')]);
  assert.equal(result.manifest.total,1);
  assert.equal(JSON.parse(result.shards[0].raw).items[0].name,'later same version');
 }
});
test('immutable generation manifest is present and cannot be silently changed',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'services-manifest-'));
 try{const result=buildDatabase([source([row()])]);writeDatabase(result,directory);
 const target=path.join(directory,'snapshots',result.manifest.snapshot_id,'manifest.json');
 assert.deepEqual(fs.readFileSync(target),result.raw);
 fs.writeFileSync(target,'{}');assert.throws(()=>writeDatabase(result,directory),/Immutable manifest collision/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
