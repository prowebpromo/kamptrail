const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Q=require('../data-quality.js');require('../routes.js');const R=global.KampTrailRoutes;
const {buildSearchIndex,readElevationSnapshots}=require('../scripts/build-search-index.js');
const snapshot='a'.repeat(24),date='2026-10-29T10:00:00Z';
function feature(id='camp',coordinates=[-75.1,43]){return Q.normalizeFeature({type:'Feature',geometry:{type:'Point',coordinates},properties:{id,name:'Real Campground '+id,type:'established'}});}
function record(m,coordinates=[-75.1,43]){return{status:m===null?'unknown':'known',elevation_m:m,coordinate_key:Q.coordinateKey(coordinates),retrieved_at:date,sample_coordinates:m===null?null:{lng:coordinates[0],lat:coordinates[1]},source:{url:Q.ELEVATION_SOURCE,sample_url:Q.ELEVATION_SOURCE+'/getSamples',units:'metres',interpolation:'RSP_BilinearInterpolation',horizontal_crs:'EPSG:4326'}};}
function state(records){return{version:1,snapshot_id:snapshot,state:'NY',records,sources:{}};}
function manifest(d){const raw=JSON.stringify(d);return{version:1,snapshot_id:snapshot,generated_at:date,source:{url:Q.ELEVATION_SOURCE,units:'metres',interpolation:'RSP_BilinearInterpolation'},states:{NY:{url:`snapshots/${snapshot}/NY.json`,sha256:crypto.createHash('sha256').update(raw).digest('hex'),count:Object.keys(d.records).length}}};}
test('inclusive elevation bounds keep zero/negative values and never promote missing or invalid evidence',()=>{
 const sites=[[-20,'below'],[0,'zero'],[304.8,'high'],[null,'unknown']].map(([m,id])=>{const f=feature(id);Q.attachElevation(f,[state({[id]:record(m)})]);return f;});
 assert.deepEqual(Q.applyFilters(sites,{elevationMin:-20,elevationMax:0}).map(f=>f.properties.id),['below','zero']);
 assert.deepEqual(Q.applyFilters(sites,{elevationMin:0,elevationMax:0}).map(f=>f.properties.id),['zero']);
 assert.deepEqual(Q.applyFilters(sites,{elevationMin:Q.elevationToMetres(1000,'ft')}).map(f=>f.properties.id),['high']);
 assert.equal(Q.elevationToMetres(-100,'ft'),-30.48);assert.equal(Q.elevationFromMetres(304.8,'ft'),1000);
 for(const bounds of [{elevationMin:1,elevationMax:0},{elevationMin:NaN},{elevationMax:'0'}])assert.equal(Q.applyFilters(sites,bounds).length,0);
 const bad=feature('bad');bad.properties.elevation={m:0,k:'43.0000000,-75.2000000',d:date};assert.equal(Q.applyFilters([bad],{elevationMax:1000}).length,0);
 assert.equal(Q.applyFilters(sites,{}).length,4);
});
test('sidecar validation rejects foreign sources, malformed known samples, and mutable/traversal paths',()=>{
 const d=state({camp:record(0)}),m=manifest(d);assert.equal(Q.validElevationManifest(m),true);assert.equal(Q.validElevationState(d,'NY',snapshot),true);
 for(const url of ['NY.json','../NY.json','https://example.test/NY.json',`snapshots/${snapshot}/CA.json`])assert.equal(Q.validElevationManifest({...m,states:{NY:{...m.states.NY,url}}}),false);
 for(const replacement of [{elevation_m:-9999},{elevation_m:null},{sample_coordinates:{lat:44,lng:-75.1}},{source:{...d.records.camp.source,url:'https://example.test'}},{coordinate_key:'NaN,NaN'}])assert.equal(Q.validElevationState(state({camp:{...d.records.camp,...replacement}}),'NY',snapshot),false);
 assert.equal(Q.coordinateKey([-0,-0]),'0.0000000,0.0000000');
});
test('final coordinate identity and same predicate govern rebuilt route and map elevation results',()=>{
 const f=feature(),d=state({camp:record(0)});Q.attachElevation(f,[d]);
 const index=buildSearchIndex([{state:'NY',geojson:{type:'FeatureCollection',features:[f]}}],Q,null,[d]);assert.equal(index.elevation_version,1);assert.equal(index.sites[0].m.e.m,0);
 const filters={elevationMin:0,elevationMax:0},route={geometry:{coordinates:[[-75.2,43],[-75,43]]},leg_ends:[1]};
 assert.equal(Q.applyFilters([f],filters).length,1);assert.equal(R.find(index.sites,route,5,filters).length,1);
 const moved={...index.sites[0],lng:-75.15};assert.equal(R.find([moved],route,5,filters).length,0);
 const alias=feature('new');alias.properties.legacy_ids=['camp'];Q.attachElevation(alias,[d]);assert.equal(Q.elevationInfo(alias).m,0);
 const mismatch=feature('camp',[-75.15,43]);Q.attachElevation(mismatch,[d]);assert.equal(Q.elevationInfo(mismatch),null);
});
test('build reader verifies immutable bytes before accepting state samples',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kt-elevation-'));
 try{const d=state({camp:record(-20)}),m=manifest(d),root=path.join(dir,'elevation');fs.mkdirSync(path.join(root,'snapshots',snapshot),{recursive:true});fs.writeFileSync(path.join(root,'index.json'),JSON.stringify(m));const file=path.join(root,m.states.NY.url);fs.writeFileSync(file,JSON.stringify(d));assert.equal(readElevationSnapshots(dir)[0].records.camp.elevation_m,-20);fs.appendFileSync(file,' ');assert.throws(()=>readElevationSnapshots(dir),/checksum/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('shared location links retain valid canonical metre bounds and reject invalid/duplicate bounds',()=>{
 const context={URLSearchParams,location:{href:'https://example.test/#site=camp'},navigator:{},DataQuality:Q,kamptrailFilters:{elevationMin:0,elevationMax:304.8,elevationUnit:'ft'}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('share.js','utf8'),context);
 const S=context.KampTrailShare,url=S.linkFor({site:'a&b'}),p=S.parse(url.slice(url.indexOf('#')));assert.equal(p.site,'a&b');assert.equal(p.elevation.elevationMin,0);assert.equal(p.elevation.elevationMax,304.8);assert.equal(p.elevation.elevationUnit,'ft');
 for(const hash of ['#site=camp&emin=2&emax=1','#site=camp&emin=NaN','#site=camp&emin=0&emin=1'])assert.equal(S.parse(hash),null);
 assert.equal(S.parse('#site=old').site,'old');
});

test('terrain manifests and records require real UTC instants and an existing state code',()=>{
 const d=state({camp:record(0)}),m=manifest(d);
 for(const code of ['DC','PR','GU','ZZ','ny']){
  assert.equal(Q.validElevationManifest({...m,states:{[code]:{...m.states.NY,url:`snapshots/${snapshot}/${code}.json`}}}),false,code);
  assert.equal(Q.validElevationState({...d,state:code},code,snapshot),false,code);
 }
 for(const timestamp of ['2026-10-29T10:00:00','2026-02-30T10:00:00Z','2026-10-29T24:00:00Z','2026-10-29T10:00:00-04:00','2026-10-29','not a date']){
  assert.equal(Q.validElevationManifest({...m,generated_at:timestamp}),false,timestamp);
  assert.equal(Q.validElevationState(state({camp:{...record(0),retrieved_at:timestamp}}),'NY',snapshot),false,timestamp);
  const f=feature();f.properties.elevation={m:0,k:Q.coordinateKey(f.geometry.coordinates),d:timestamp};assert.equal(Q.elevationInfo(f),null,timestamp);
 }
 for(const timestamp of ['2026-10-29T10:00:00.123456Z','2026-10-29T10:00:00+00:00'])assert.equal(Q.validElevationState(state({camp:{...record(0),retrieved_at:timestamp}}),'NY',snapshot),true);
 const movedAlias=feature('new',[-75.2,43]);movedAlias.properties.legacy_ids=['camp'];Q.attachElevation(movedAlias,[d]);assert.equal(Q.elevationInfo(movedAlias),null);
});
