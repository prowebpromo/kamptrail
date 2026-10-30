'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto,createHash}=require('node:crypto');
const Q=require('../data-quality.js'),F=require('../forecast.js'),{coordinateIndex}=require('../scripts/build-search-index.js');
const now=Date.parse('2026-10-29T12:00:00Z'),iso=n=>new Date(n).toISOString().replace('.000Z','Z'),snapshot='a'.repeat(24),catalogue='b'.repeat(64);
const feature=(id='zero',state='NY',coordinates=[-75,43])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{id,state,forecastStates:[state],name:id,amenities:[],rig_friendly:[],fee_status:'unknown',type:'established'}});
function fixture(codes=['NY'],snapshotID=snapshot){
 const times=Array.from({length:60},(_,i)=>iso(now+(i+1)*3600000));
 const m={version:1,snapshot_id:snapshotID,catalogue_sha256:catalogue,generated_at:iso(now-5*60000),expires_at:iso(now+2*3600000),source:{name:'NOAA/NWS NDFD',files:[{region:'conus',url:'https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.conus/VP.001-003/ds.temp.bin',etag:'opaque',sha256:'e'.repeat(64),last_modified:iso(now-15*60000),bytes:100}]},regions:{conus:{times,grid_sha256:'c'.repeat(64),max_step_seconds:3600,reference_times:[iso(now)]}},states:{},coverage:{total:6,grid_known:5,unknown:1}};
 const record=t=>({coordinate_key:Q.coordinateKey([-75,43]),status:'known',region:'conus',grid_lat:43,grid_lng:-75,grid_distance_m:0,temperatures_c:Array(60).fill(t)});
 const records={zero:record(0),negative:record(-10),hot:record(10),partial:record(0),missing:{coordinate_key:Q.coordinateKey([-75,43]),status:'unknown',reason:'missing grid'},later:record(0)};records.partial.temperatures_c[2]=null;records.later.temperatures_c[24]=5;
 const raw={};for(const code of codes){const state={version:1,snapshot_id:snapshotID,state:code,generated_at:m.generated_at,expires_at:m.expires_at,records};raw[code]=JSON.stringify(state);m.states[code]={asset:`forecast-v1-${snapshotID}-${code}.json.gz`,sha256:'d'.repeat(64),json_sha256:createHash('sha256').update(raw[code]).digest('hex'),bytes:200,json_bytes:Buffer.byteLength(raw[code]),count:6};}
 return{m,raw,records};
}
function client(data=fixture(),customFetch){
 let elapsed=0;const listeners={},timers=new Map(),calls=[];let nextTimer=0;
 const env={DataQuality:Q,performance:{now:()=>elapsed},navigator:{onLine:true},crypto:webcrypto,AbortController,TextEncoder,TextDecoder,CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:elapsed+delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),dispatchEvent:event=>{for(const fn of listeners[event.type]||[])fn(event);}};
 env.fetch=async url=>{calls.push(url);if(customFetch)return customFetch(url);if(url.includes('coordinate-index'))return new Response(JSON.stringify({version:1,sha256:catalogue,count:6}));if(url.includes('kind=index'))return new Response(JSON.stringify({ok:true,server_now:iso(now+elapsed),manifest:data.m}));const code=new URL(url,'https://example.test/').searchParams.get('state');return new Response(data.raw[code]);};
 const api=F.create(env);return{api,env,calls,timers,event:type=>env.dispatchEvent({type}),advance:n=>{elapsed+=n;},fire:()=>{for(const[id,t]of [...timers])if(t.at<=elapsed){timers.delete(id);t.fn();}}};
}
test('inclusive zero and negative bounds, canonical Fahrenheit conversion and invalid ranges',()=>{
 assert.equal(F.range({forecastMinC:0,forecastMaxC:0}).active,true);assert.equal(F.toC(32,'F'),0);assert.equal(F.toC(-4,'F'),-20);assert.equal(F.fromC(-20,'F'),-4);
 for(const f of [{forecastMinC:''},{forecastMinC:'0'},{forecastMinC:NaN},{forecastMinC:1,forecastMaxC:0},{forecastHours:72},{forecastMaxC:71}])assert.equal(F.range(f).valid,false);
 assert.equal(F.range({forecastMinC:-100,forecastMaxC:70,forecastHours:48}).valid,true);
});
test('strict UTC, impossible dates and manifest source freshness are validated',()=>{
 const {m}=fixture();assert.equal(F.validManifest(m,catalogue,now),true);
 for(const date of ['2026-02-30T12:00:00Z','2026-10-29','2026-10-29T12:00:00-04:00','2026-10-29T25:00:00Z'])assert.ok(Number.isNaN(F.utc(date)));
 for(const mutate of [m=>m.catalogue_sha256='0'.repeat(64),m=>m.expires_at=iso(now),m=>m.source.files[0].last_modified=iso(now-4*3600000),m=>m.states.ZZ=m.states.NY,m=>m.regions.conus.times[3]=iso(now+10*3600000),m=>m.regions.conus.max_step_seconds=21600,m=>m.states.NY.json_bytes=9*1024*1024]){const copy=structuredClone(m);mutate(copy);assert.equal(F.validManifest(copy,catalogue,now),false);}
});
test('forecast-start references can follow publication while source freshness still expires',async()=>{
 const d=fixture();d.m.regions.conus.reference_times=[iso(now+10*60000)];
 assert.equal(F.validManifest(d.m,catalogue,now),true);
 const c=client(d);await c.api.ensureStates(['NY']);assert.equal(c.api.matches(feature(),{forecastMinC:0,forecastMaxC:0}),true);
 c.advance(2*3600000);assert.equal(c.api.matches(feature(),{forecastMinC:0,forecastMaxC:0}),false);
 const bad=structuredClone(d.m);bad.regions.conus.reference_times=[iso(now+61*3600000)];assert.equal(F.validManifest(bad,catalogue,now),false);
 const futureFile=structuredClone(d.m);futureFile.source.files[0].last_modified=iso(now+301000);assert.equal(F.validManifest(futureFile,catalogue,now),false);
});
test('24 and 48 hour windows use all actual published samples, no interpolation, no shortening',()=>{
 const {m,records}=fixture(),r=m.regions.conus;
 assert.equal(F.sampleWindow(records.zero,r,24,now).samples,24);
 assert.equal(F.sampleWindow(records.later,r,24,now).max,0);assert.equal(F.sampleWindow(records.later,r,48,now).max,5);
 assert.equal(F.sampleWindow(records.partial,r,24,now),null);
 // Start is exclusive; ending sample is included, following sample is not borrowed.
 records.zero.temperatures_c[0]=null;assert.equal(F.sampleWindow(records.zero,r,24,now+3600000).samples,24);
 const three={times:Array.from({length:20},(_,i)=>iso(now+(i+1)*3*3600000)),max_step_seconds:10800};
 assert.equal(F.sampleWindow({...records.later,temperatures_c:Array(20).fill(-2)},three,24,now).samples,8);
 assert.equal(F.sampleWindow(records.later,{...r,times:r.times.slice(0,23)},24,now),null);
 const gap={...r,times:r.times.filter((_,i)=>i!==5)};assert.equal(F.sampleWindow(records.later,gap,24,now),null);
});
test('state identity, coordinate key, null temperature and bytes must agree',async()=>{
 const d=fixture(),state=JSON.parse(d.raw.NY);assert.equal(F.validState(state,'NY',d.m,Q),true);state.records.zero.coordinate_key='43,-75';assert.equal(F.validState(state,'NY',d.m,Q),false);
 const c=client(d);await c.api.ensureStates(['NY']);assert.equal(c.api.matches(feature(),{forecastMinC:0,forecastMaxC:0}),true);assert.equal(c.api.matches(feature('negative'),{forecastMinC:-10,forecastMaxC:0}),true);
 assert.equal(c.api.matches(feature('hot'),{forecastMaxC:0}),false);assert.equal(c.api.get(feature('partial')),null);assert.equal(c.api.get(feature('missing')),null);assert.equal(c.api.get(feature('zero','CA')),null);assert.equal(c.api.get(feature('zero','NY',[-75.1,43])),null);
 const corrupt=fixture();corrupt.raw.NY+=' ';const bad=client(corrupt);await bad.api.ensureStates(['NY']);assert.equal(bad.api.get(feature()),null);assert.deepEqual(bad.api.status().unavailable,['NY']);
});
test('server clock ignores device wall clock, expiry and offline/resume invalidate evidence',async()=>{
 const c=client();assert.equal(c.api.matches(feature(),{forecastMaxC:0}),false);await c.api.ensureStates(['NY']);assert.equal(c.api.effectiveNow(),now);
 c.advance(60000);assert.equal(c.api.effectiveNow(),now+60000);assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);
 c.env.navigator.onLine=false;c.event('offline');assert.equal(c.api.matches(feature(),{forecastMaxC:0}),false);assert.equal(c.api.status().online,false);
 const requests=c.calls.length;await c.api.ensureStates(['NY']);assert.equal(c.calls.length,requests);
 c.env.navigator.onLine=true;c.event('online');await c.api.ensureStates(['NY']);assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);
 c.advance(2*3600000);assert.equal(c.api.matches(feature(),{forecastMaxC:0}),false);c.fire();assert.equal(c.api.status().ready,false);
});
test('bounded concurrency uses only supported state API requests', {timeout:5000}, async()=>{
 const d=fixture(['NY','CA','CO','HI']),waiting=[];let count=0,peak=0,started=0,firstPair,secondPair;
 const firstStarted=new Promise(resolve=>{firstPair=resolve;}),secondStarted=new Promise(resolve=>{secondPair=resolve;});
 const c=client(d,async url=>{if(url.includes('coordinate-index'))return new Response(JSON.stringify({version:1,sha256:catalogue,count:6}));if(url.includes('kind=index'))return new Response(JSON.stringify({ok:true,server_now:iso(now),manifest:d.m}));count++;started++;peak=Math.max(peak,count);const gate=new Promise(resolve=>waiting.push(resolve));if(started===2)firstPair();if(started===4)secondPair();await gate;count--;const code=new URL(url,'https://example.test/').searchParams.get('state');return new Response(d.raw[code]);});
 const done=c.api.ensureStates(['NY','CA','CO','HI','ZZ','../NY','NY']);
 await firstStarted;assert.equal(count,2);assert.equal(started,2);for(const resolve of waiting.splice(0))resolve();
 await secondStarted;assert.equal(count,2);assert.equal(started,4);for(const resolve of waiting.splice(0))resolve();
 await done;assert.equal(peak,2);assert.equal(c.calls.filter(u=>u.includes('kind=state')).length,4);assert.equal(c.calls.some(u=>u.includes('weather.gov')),false);
});
test('old snapshot failures cannot poison or delete new snapshot evidence', {timeout:5000}, async()=>{
 const old=fixture(['NY','CA']),next=fixture(['NY','CA'],'f'.repeat(24));let current=old,rejectOld,oldStarted;
 const oldRequestStarted=new Promise(resolve=>{oldStarted=resolve;});
 const c=client(old,async url=>{
  if(url.includes('coordinate-index'))return new Response(JSON.stringify({version:1,sha256:catalogue,count:6}));
  if(url.includes('kind=index'))return new Response(JSON.stringify({ok:true,server_now:iso(now),manifest:current.m}));
  const params=new URL(url,'https://example.test/').searchParams,code=params.get('state');
  if(params.get('snapshot')===old.m.snapshot_id){oldStarted();return new Promise((resolve,reject)=>{rejectOld=reject;});}
  return new Response(next.raw[code]);
 });
 const pendingOld=c.api.ensureStates(['NY']);await oldRequestStarted;current=next;
 // A forced refresh must load the same state's new generation without borrowing A's pending promise.
 await c.api.ensureStates(['NY','CA'],{force:true});assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);
 rejectOld(new Error('Retired snapshot transport failed'));await pendingOld;
 assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);assert.deepEqual(c.api.status().unavailable,[]);assert.equal(c.api.status().loading,false);
 const before=c.calls.length;await c.api.ensureStates(['NY']);assert.equal(c.calls.length,before);assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);
});
test('map and route use identical current evidence and exclude coordinate changes',async()=>{
 const c=client();await c.api.ensureStates(['NY']);global.KampTrailForecast=c.api;
 try{const context={DataQuality:Q,KampTrailForecast:c.api,URL,Set,Map,Math,Number,Date,Array,AbortController,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(fs.readFileSync('routes.js','utf8'),context);
 const route={geometry:{coordinates:[[-75.1,43],[-74.9,43]]},leg_ends:[1]},rows=['zero','negative','hot','partial','missing'].map(id=>({id,name:id,states:['NY'],lng:-75,lat:43,m:{}})),filters={forecastMinC:-10,forecastMaxC:0,forecastHours:24};
 const map=Q.applyFilters(rows.map(row=>context.KampTrailRoutes.indexFeature(row)),filters).map(f=>f.properties.id).sort();const routed=Array.from(context.KampTrailRoutes.find(rows,route,1,filters),x=>x.row.id).sort();assert.deepEqual(routed,map);assert.deepEqual(map,['negative','zero']);
 c.env.navigator.onLine=false;c.event('offline');assert.equal(Q.applyFilters([feature()],filters).length,0);assert.equal(context.KampTrailRoutes.find(rows,route,1,filters).length,0);
 }finally{delete global.KampTrailForecast;}
});
test('coordinate identity hash is stable across mutable metadata and input order',()=>{
 const sites=[{id:'é',lat:-0,lng:-75.12345674,states:['VT','NY'],m:{e:1}},{id:'a',lat:43.00000004,lng:0,states:['NY']}];const a=coordinateIndex(sites),b=coordinateIndex(sites.slice().reverse().map(x=>({...x,m:{f:'paid',e:20}})));assert.deepEqual(a,b);assert.equal(a.count,2);assert.equal(a.sha256,'236c63667cd452add9cfee927381769b18fbef38469ebbc68ea5a3508ac28db1');
 assert.notEqual(coordinateIndex(sites.map(x=>({...x,lat:x.lat+0.000001}))).sha256,a.sha256);assert.notEqual(coordinateIndex(sites.map(x=>({...x,states:['CA']}))).sha256,a.sha256);assert.throws(()=>coordinateIndex([...sites,sites[0]]));
});
test('weather remains outside offline generic caches and search metadata',()=>{
 const sw=fs.readFileSync('service-worker.js','utf8');assert.match(sw,/coordinate-index\.json/);assert.match(sw,/pathname\.includes\('\/api\/'\)\)return/);assert.match(sw,/'forecast\.js'/);
 assert.doesNotMatch(fs.readFileSync('scripts/build-search-index.js','utf8'),/temperatures_c|forecastMinC|forecastMaxC/);
});

test('source hashes and references reject missing, duplicate, unordered and out-of-window values',()=>{
 const {m}=fixture();
 for(const change of [
  m=>delete m.source.files[0].sha256,m=>m.source.files[0].sha256='E'.repeat(64),m=>m.source.files[0].etag='bad\nvalidator',
  m=>delete m.regions.conus.reference_times,m=>m.regions.conus.reference_times=[],
  m=>m.regions.conus.reference_times=[iso(now),iso(now)],
  m=>m.regions.conus.reference_times=[iso(now),iso(now-3600000)],
  m=>m.regions.conus.reference_times=[iso(now+60*3600000+1000)],
  m=>m.regions.conus.reference_times=['2026-02-30T12:00:00Z'],
  m=>m.regions.conus.reference_times=Array.from({length:101},(_,i)=>iso(now-(101-i)*3600000)),
  m=>m.coverage={total:7,grid_known:6,unknown:1}
 ]){const invalid=structuredClone(m);change(invalid);assert.equal(F.validManifest(invalid,catalogue,now),false);}
 const valid=structuredClone(m);valid.regions.conus.reference_times=[iso(now-3600000),iso(now)];assert.equal(F.validManifest(valid,catalogue,now),true);
});
test('unknown records cannot smuggle grid evidence or unsafe reason text',()=>{
 const {m,raw}=fixture();for(const extra of [{grid_distance_m:0},{region:'conus'},{grid_lat:43},{temperatures_c:[]},{reason:'bad\nreason'},{reason:'x'.repeat(101)}]){const d=JSON.parse(raw.NY);Object.assign(d.records.missing,extra);assert.equal(F.validState(d,'NY',m,Q),false);}
});
test('null, signed zero and negative Celsius preserve inclusive canonical shared filters',()=>{
 assert.equal(F.toC(null,'C'),null);assert.equal(F.fromC(null,'F'),null);assert.equal(F.range({forecastMinC:-0,forecastMaxC:0}).valid,true);
 const context={URLSearchParams,location:{href:'https://example.test/#site=zero'},navigator:{},DataQuality:Q,KampTrailForecast:F,kamptrailFilters:{forecastMinC:-0,forecastMaxC:0,forecastHours:48,forecastUnit:'F'}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('share.js','utf8'),context);
 const s=context.KampTrailShare,url=s.linkFor({site:'a&b'}),parsed=s.parse(url.slice(url.indexOf('#')));assert.equal(parsed.site,'a&b');assert.equal(parsed.forecast.forecastMinC,0);assert.equal(parsed.forecast.forecastMaxC,0);assert.equal(parsed.forecast.forecastHours,48);
 const negative=s.parse('#site=zero&fmin=-10&fmax=0&fhours=24&funit=C');assert.equal(negative.forecast.forecastMinC,-10);assert.equal(negative.forecast.forecastUnit,'C');
 for(const hash of ['#site=zero&fmin=1&fmax=0','#site=zero&fmin=NaN','#site=zero&fmin=0&fmin=1','#site=zero&fmax=0&fhours=72','#site=zero&fmax=0&fhours=24&fhours=48'])assert.equal(s.parse(hash),null);
});
test('restored-page evidence must refresh its server clock and never reuse an interrupted stale response',async()=>{
 const c=client();await c.api.ensureStates(['NY']);const count=c.calls.length;c.env.dispatchEvent({type:'pageshow',persisted:true});assert.equal(c.api.matches(feature(),{forecastMaxC:0}),false);c.advance(3600000);await c.api.ensureStates(['NY']);assert.equal(c.api.effectiveNow(),now+3600000);assert.ok(c.calls.length>count);assert.equal(c.api.matches(feature('later'),{forecastMaxC:0}),false);
});

test('retired request cleanup preserves the current generation pending request', {timeout:5000}, async()=>{
 const old=fixture(),next=fixture(['NY'],'f'.repeat(24));let current=old,rejectOld,releaseNext,markOld,markNext;
 const oldStarted=new Promise(resolve=>{markOld=resolve;}),nextStarted=new Promise(resolve=>{markNext=resolve;});
 const c=client(old,async url=>{
  if(url.includes('coordinate-index'))return new Response(JSON.stringify({version:1,sha256:catalogue,count:6}));
  if(url.includes('kind=index'))return new Response(JSON.stringify({ok:true,server_now:iso(now),manifest:current.m}));
  if(new URL(url,'https://example.test/').searchParams.get('snapshot')===old.m.snapshot_id){markOld();return new Promise((resolve,reject)=>{rejectOld=reject;});}
  markNext();await new Promise(resolve=>{releaseNext=resolve;});return new Response(next.raw.NY);
 });
 const a=c.api.ensureStates(['NY']);await oldStarted;current=next;const b=c.api.ensureStates(['NY'],{force:true});await nextStarted;
 rejectOld(new Error('Retired snapshot unavailable'));await a;assert.equal(c.api.status().loading,true);assert.deepEqual(c.api.status().unavailable,[]);
 const duplicate=c.api.ensureStates(['NY']);releaseNext();await Promise.all([b,duplicate]);assert.equal(c.calls.filter(u=>u.includes('kind=state')).length,2);assert.equal(c.api.status().loading,false);assert.equal(c.api.matches(feature(),{forecastMaxC:0}),true);
});
