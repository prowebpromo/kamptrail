const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('../route-elevation.js');
const route=(coordinates=[[-110,40],[-109,40]],leg_ends=[coordinates.length-1])=>({geometry:{type:'LineString',coordinates},leg_ends});
const date='2026-10-30T12:00:00Z',source={name:'USGS 3DEP',url:'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer',units:'meters',datum:null};
const reply=samples=>({ok:true,version:1,retrieved_at:date,source,samples:samples.map(p=>({...p,status:'value',elevation_m:0,datum:null,source_updated_at:null,retrieved_at:date}))});
function storage(){const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function env(fetch,extra={}){return{crypto:crypto.webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,localStorage:storage(),navigator:{onLine:true},fetch,...extra};}
function response(d){return{ok:true,text:async()=>JSON.stringify(d)};}
test('sampling is bounded on the full original geometry and preserves endpoints and each leg boundary',()=>{
 const coordinates=Array.from({length:150000},(_,i)=>[-125+i/10000,40+Math.sin(i/100)*.01]),r=route(coordinates,[5000,50000,100000,149999]),s=E.sampleRoute(r);
 assert.ok(s.samples.length<=200);assert.ok(s.unique.length<=200);assert.equal(s.samples[0].lon,-125);assert.equal(s.samples.at(-1).lon,coordinates.at(-1)[0]);for(const end of r.leg_ends)assert.ok(s.samples.some(p=>p.lon===+coordinates[end][0].toFixed(7)&&p.lat===+coordinates[end][1].toFixed(7)));assert.ok(s.adaptive);assert.ok(s.spacing_m>1000);
});
test('closed loops retain final occurrence while provider dedup avoids repeated coordinate requests',()=>{
 const s=E.sampleRoute(route([[0,0],[.01,0],[0,0]],[1,2]));assert.equal(s.samples[0].provider_id,s.samples.at(-1).provider_id);assert.ok(s.samples.at(-1).distance_m>2000);assert.ok(s.unique.length<s.samples.length);assert.equal(s.samples.at(-1).leg,2);
 const z=E.sampleRoute(route([[1,2],[1,2],[1,2]],[0,1,2]));assert.equal(z.total_m,0);assert.equal(z.unique.length,1);assert.equal(z.samples.length,3);assert.deepEqual(z.samples.map(p=>p.boundary_legs),[[1],[2],[3]]);
});
test('dateline uses shortest geodesic and interpolated points stay near dateline',()=>{
 const s=E.sampleRoute(route([[179.9,10],[-179.9,10]]));assert.ok(s.total_m>21000&&s.total_m<23000);assert.ok(s.samples.every(p=>Math.abs(p.lon)>179));assert.ok(s.samples.length<30);
});
test('canonical identity covers original bends, leg boundaries, and policy but normalizes negative zero',async()=>{
 const e=env();assert.equal(await E.identity(route([[-0,0],[1,1]]),e),await E.identity(route([[0,-0],[1,1]]),e));assert.notEqual(await E.identity(route([[0,0],[1,1]]),e),await E.identity(route([[0,0],[.1,.8],[1,1]]),e));assert.notEqual(await E.identity(route([[0,0],[1,1],[2,2]],[2]),e),await E.identity(route([[0,0],[1,1],[2,2]],[1,2]),e));
});
test('wire validates ID/coordinate joins, exact batch count, numeric zero and explicit provider no data',()=>{
 const req=[{id:1,lon:-110,lat:40}],d=reply(req);assert.equal(E.validateResponse(d,req),true);for(const sample of [{...d.samples[0],id:2},{...d.samples[0],lon:-111},{...d.samples[0],elevation_m:'0'},{...d.samples[0],elevation_m:-9999},{...d.samples[0],status:'no_data'}])assert.equal(E.validateResponse({...d,samples:[sample]},req),false);
 assert.equal(E.validateResponse({...d,samples:[{...d.samples[0],status:'no_data',elevation_m:null}]},req),true);assert.equal(E.validateResponse({...d,source:{...source,url:'https://usgs.gov.evil.test/'}},req),false);assert.equal(E.validateResponse({...d,samples:[]},req),false);assert.equal(E.validateResponse({...d,retrieved_at:'2026-02-30T12:00:00Z'},req),false);
});
test('loading uses at most four serial bounded private POSTs and unit conversion does not touch the provider',async()=>{
 let calls=0,inflight=0,max=0;const e=env(async(url,options)=>{calls++;inflight++;max=Math.max(max,inflight);assert.equal(url,'api/route-elevation.php');assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body),['samples']);assert.ok(body.samples.length<=50);await Promise.resolve();inflight--;return response(reply(body.samples));});
 const s=E.createSession(e,route([[-150,40],[-50,40]]));await s.ready;assert.equal(calls,0);await s.load();assert.equal(calls,4);assert.equal(max,1);assert.equal(s.state.profile.values[0].elevation_m,0);const before=calls;assert.equal(E.toUnit(304.8,'ft'),1000);assert.equal(E.toUnit(-30.48,'ft'),-100);assert.equal(E.toUnit(null,'ft'),null);assert.equal(calls,before);
});
test('late responses cannot update changed itinerary, cancelled request, or closed profile',async()=>{
 for(const action of ['revision','cancel','close','invalidate']){let resolve,revision=1;const e=env(()=>new Promise(r=>{resolve=r;}));const s=E.createSession(e,route([[0,0],[.001,0]]),{revision:1,getRevision:()=>revision});await s.ready;const task=s.load();while(!resolve)await new Promise(r=>setImmediate(r));if(action==='revision')revision=2;else s[action]();resolve(response(reply(s.state.sampled.unique)));await task;assert.equal(s.state.profile,null,action);assert.equal(E.createStore(e.localStorage).read().length,0);}
});
test('offline exact-route cache is dated and never borrowed for another geometry',async()=>{
 const e=env(async(u,o)=>response(reply(JSON.parse(o.body).samples))),r=route([[0,0],[.001,0]]),s=E.createSession(e,r);await s.ready;await s.load();e.navigator.onLine=false;e.fetch=()=>{throw new Error('Offline cannot fetch');};const same=E.createSession(e,r);await same.ready;assert.equal(same.state.profile.values[0].retrieved_at,date);await same.load();assert.match(same.state.message,/Offline/);const other=E.createSession(e,route([[1,0],[1.001,0]]));await other.ready;assert.equal(other.state.profile,null);await other.load();assert.match(other.state.message,/no saved terrain/);
});
test('clearing saved terrain cancels a pending refresh and a delayed reply cannot recreate persistence',async()=>{
 let pending=null;
 const e=env(async(u,o)=>pending?new Promise(resolve=>{pending.resolve=resolve;pending.signal=o.signal;}):response(reply(JSON.parse(o.body).samples)));
 const r=route([[0,0],[.001,0]]),s=E.createSession(e,r);await s.ready;await s.load();
 const prior=JSON.stringify(s.state.profile);assert.equal(E.createStore(e.localStorage).read().length,1);
 pending={};const task=s.load();while(!pending.resolve)await new Promise(resolve=>setImmediate(resolve));
 s.clear();assert.equal(pending.signal.aborted,true);assert.equal(s.state.busy,false);assert.equal(s.state.saved,false);
 pending.resolve(response(reply(s.state.sampled.unique)));await task;
 assert.equal(JSON.stringify(s.state.profile),prior);assert.equal(E.createStore(e.localStorage).read().length,0);
 assert.match(s.state.message,/Saved terrain profiles cleared/);
 const reopened=E.createSession(e,r);await reopened.ready;assert.equal(reopened.state.profile,null);
});
test('failed or invalid refresh preserves last good profile; no data stays distinct from request failure',async()=>{
 let mode='value';const e=env(async(u,o)=>{const d=reply(JSON.parse(o.body).samples);if(mode==='fail')throw new Error('offline');if(mode==='bad')d.samples[0].elevation_m='oops';if(mode==='unavailable')d.samples.forEach(s=>{s.status='unavailable';s.elevation_m=null;});if(mode==='no_data')d.samples.forEach(s=>{s.status='no_data';s.elevation_m=null;});return response(d);}),s=E.createSession(e,route([[0,0],[.001,0]]));await s.ready;await s.load();const good=JSON.stringify(s.state.profile);for(mode of ['fail','bad','unavailable']){await s.load();assert.equal(JSON.stringify(s.state.profile),good);assert.match(s.state.error,/failed/);}mode='no_data';await s.load();assert.equal(s.state.profile.values[0].status,'no_data');assert.equal(s.state.error,'');assert.equal(s.state.profile.values[0].elevation_m,null);
});
test('cache is schema checked, capped at eight and preserves bytes on quota failure',()=>{
 const memory=storage(),store=E.createStore(memory);const p={version:1,policy:E.POLICY,key:'a'.repeat(64),saved_at:date,values:[{id:0,status:'value',elevation_m:0,datum:null,source_updated_at:null,retrieved_at:date,source}]};for(let i=0;i<10;i++)assert.equal(store.put({...p,key:String(i).repeat(64)}),true);assert.equal(store.read().length,8);assert.equal(store.get('0'.repeat(64)),null);const old=memory.getItem(E.CACHE);assert.equal(store.put({...p,values:[{...p.values[0],elevation_m:Infinity}]}),false);assert.equal(memory.getItem(E.CACHE),old);memory.setItem=()=>{throw new Error('quota');};assert.equal(store.put(p),false);assert.equal(memory.getItem(E.CACHE),old);assert.equal(store.clear(),true);assert.equal(store.read().length,0);
});
test('unavailable provider samples retain dated values and retry only missing coordinates',async()=>{
 let count=0,requested=[];const e=env(async(u,o)=>{const batch=JSON.parse(o.body).samples;requested.push(batch);const d=reply(batch);if(count++===0){d.samples[0].status='no_data';d.samples[0].elevation_m=null;}return response(d);}),s=E.createSession(e,route([[0,0],[.001,0]]));await s.ready;await s.load();assert.equal(s.state.profile.values[0].status,'no_data');await s.load({missing:true});assert.equal(requested[1].length,1);assert.equal(s.state.profile.values[0].status,'value');
});
test('retry with no missing terrain makes no request and does not report a failed refresh',async()=>{
 let calls=0;const e=env(async(u,o)=>{calls++;return response(reply(JSON.parse(o.body).samples));}),s=E.createSession(e,route([[0,0],[.001,0]]));
 await s.ready;await s.load();const prior=JSON.stringify(s.state.profile),before=calls;
 await s.load({missing:true});assert.equal(calls,before);assert.equal(s.state.busy,false);assert.equal(s.state.error,'');
 assert.equal(JSON.stringify(s.state.profile),prior);assert.match(s.state.message,/already available/);
});
