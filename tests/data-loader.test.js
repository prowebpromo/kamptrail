const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(fetcher, overrides={}) {
  const events=[], cluster={layers:[],addLayers(items){this.layers.push(...items);},removeLayer(item){this.layers=this.layers.filter(x=>x!==item);}};
  const bounds={getSouth:()=>42.9,getNorth:()=>43.1,getWest:()=>-75.2,getEast:()=>-75,contains:([lat,lng])=>lat>=42.9&&lat<=43.1&&lng>=-75.2&&lng<=-75};
  const map={getBounds:()=>bounds,addLayer(){},removeLayer(){},hasLayer(){return false;},getZoom:()=>10,on(){},setView(){},closePopup(){}};
  const context={console:{warn(){},log(){}},fetch:fetcher,setTimeout,clearTimeout,AbortController,URL,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail;}},document:{addEventListener(){}},dispatchEvent:e=>events.push(e),L:{markerClusterGroup:()=>cluster,divIcon:o=>o,marker:(coords,opts)=>({coords,opts,bindPopup(html){this.html=html;return this;},setPopupContent(html){this.html=html;return this;},openPopup(){this.opened=true;return this;}})}};
  Object.assign(context,overrides);
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('data-quality.js','utf8'),context);
  vm.runInContext(fs.readFileSync('data-loader.js','utf8'),context);
  return {api:context.KampTrailData,context,map,bounds,cluster,events};
}
const feature=(props={})=>({type:'Feature',geometry:{type:'Point',coordinates:[-75.1,43]},properties:{name:'Campsite',...props}});
const response=data=>({ok:true,json:async()=>data});

test('transient state failure is visible and explicit retry succeeds',async()=>{
  let attempts=0;
  const h=harness(async url=>{
    if(url.endsWith('index.json')||url.endsWith('ridb-sites.json'))return response({});
    attempts++;
    return attempts===1?{ok:false,status:503}:response({type:'FeatureCollection',features:[feature({id:'NY-1',facility_id:123})]});
  });
  await h.api.init(h.map);
  assert.equal(h.api.getLoadedStates().length,0);
  assert.equal(h.api.getLoadStatus().failedStates[0].state,'NY');
  await h.api.refresh();
  assert.equal(h.api.getLoadStatus().failedStates.length,0);assert.equal(h.api.getAllCampsites().length,1);
  assert.equal(h.api.getCampsiteById('NY-1').properties.id,'ridb:123');assert.ok(h.events.some(e=>e.type==='kamptrail:dataupdated'));
});
test('same-state concurrent loads share one request and markers escape untrusted content',async()=>{
  let requests=0;
  const h=harness(async url=>{
    if(url.endsWith('index.json'))return response({});
    requests++;
    await new Promise(r=>setTimeout(r,5));
    return response({type:'FeatureCollection',features:[feature({name:'<img src=x onerror=alert(1)>',osm_id:1,tourism:'camp_site'})]});
  });
  await Promise.all([h.api.loadStates(['NY']),h.api.loadStates(['NY'])]);
  assert.equal(requests,1);
  await h.api.init(h.map);
  assert.equal(h.cluster.layers.length,1);
  const html=h.cluster.layers[0].html;
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('Fee not verified'));assert.ok(!html.includes('>FREE<'));
});
test('malformed feature coordinates are excluded and invalid collection stays retryable',async()=>{
  let valid=false;
  const h=harness(async url=>url.endsWith('index.json')?response({}):response(valid?{type:'FeatureCollection',features:[feature({osm_id:1,tourism:'camp_site'}),{...feature(),geometry:{type:'Point',coordinates:[null,43]}}]}:{features:[]}));
  await h.api.init(h.map);assert.equal(h.api.getLoadStatus().failedStates.length,1);
  valid=true;await h.api.refresh();assert.equal(h.api.getAllCampsites().length,1);
});
test('visible sites honor fee filter and viewport; filters survive data loading',async()=>{
  const h=harness(async url=>url.endsWith('index.json')?response({}):response({type:'FeatureCollection',features:[feature({name:'Free camp',osm_id:1,tourism:'camp_site',fee:'no'}),{...feature({name:'Paid camp',osm_id:2,tourism:'camp_site',fee:'yes'}),geometry:{type:'Point',coordinates:[-75.15,43.05]}}]}));
  h.context.kamptrailFilters={cost:'paid'};
  await h.api.init(h.map);
  assert.equal(h.api.getVisibleCampsites().length,1);assert.equal(h.api.getVisibleCampsites()[0].properties.fee_status,'paid');
  assert.equal(h.cluster.layers.length,1);
});
test('world-wrapped map still loads the geographic state',()=>{
  const h=harness(async()=>response({}));
  h.bounds.getWest=()=>284.8;h.bounds.getEast=()=>285;
  assert.ok(h.api.getVisibleStates(h.map).includes('NY'));
});

test('known agency closures appear before fee claims without changing free matches',async()=>{
  const statuses=['closed','temporarily closed','unknown','none'];
  const rows=statuses.map((open_status,i)=>feature({name:`Closure ${i} Campground`,osm_id:100+i,tourism:'camp_site',fee:'no',open_status}));
  const h=harness(async url=>url.endsWith('.json')?response({}):response({type:'FeatureCollection',features:rows}));
  h.context.kamptrailFilters={cost:'free'};
  await h.api.init(h.map);
  assert.equal(h.api.getVisibleCampsites().length,4);
  for(const [i,status] of statuses.entries()){
    const html=h.cluster.layers.find(marker=>marker.html.includes(`Closure ${i} Campground`)).html;
    if(i<2){assert.ok(html.includes(`Agency reports: ${status}.`));assert.ok(html.indexOf('kt-closure-notice')<html.indexOf('<strong>Cost:'));assert.ok(html.includes('Confirm reopening with the operator.'));}
    else{assert.ok(!html.includes('kt-closure-notice'));assert.ok(!html.includes('Agency reports: open'));}
  }
});

test('unverified records cannot acquire camping eligibility from an earlier state load',async()=>{
  for(const fee_status of ['unknown','paid'])for(const order of [['ID','OR'],['OR','ID']]){
    const ridb={type:'Feature',geometry:{type:'Point',coordinates:[-117.2177778,44.36611111]},properties:{id:'ridb:255223',facility_id:'255223',name:'Steck Park',schema_version:3,fee_status,cost:null,description:'Reservoir access and boat ramps.'}};
    const osm={type:'Feature',geometry:{type:'Point',coordinates:[-117.2184182,44.3652693]},properties:{id:'osm:way:1059339869',osm_id:1059339869,osm_type:'way',name:'Steck Park',tourism:'camp_site'}};
    const h=harness(async url=>url.endsWith('ridb-sites.json')?response({facilities:{'255223':{f:'paid'}}}):url.endsWith('ID_merged.geojson')?response({type:'FeatureCollection',features:[ridb]}):url.endsWith('OR_merged.geojson')?response({type:'FeatureCollection',features:[osm]}):response({}));
    for(const name of ['getSouth','getNorth','getWest','getEast'])h.bounds[name]=()=>0;
    await h.api.init(h.map);for(const code of order)await h.api.loadStates([code]);
    const rows=h.api.getAllCampsites();assert.equal(rows.length,1);
    const p=rows[0].properties;assert.equal(p.id,'osm:way:1059339869');assert.equal(p.fee_status,'unknown');
    assert.ok(!p.legacy_ids.includes('ridb:255223'));assert.equal(h.api.getCampsiteById('ridb:255223'),undefined);
  }
});

function cacheStorage() {
  const stores=new Map(),writes=[];
  return {stores,writes,async open(name){
    if(!stores.has(name))stores.set(name,new Map());const records=stores.get(name);
    return {async put(url,response){writes.push(url);records.set(url,response.clone());},async match(url){return records.get(url)?.clone();}};
  }};
}
const indexed=()=>new Response(JSON.stringify({states:[{state:'NY',count:1}],total_sites:1}),{headers:{'Content-Type':'application/json'}});
const dataset=()=>new Response(JSON.stringify({type:'FeatureCollection',features:[feature({osm_id:1,tourism:'camp_site'})]}),{headers:{'Content-Type':'application/geo+json'}});

test('first online visit caches raw validated data before any worker controls it; offline reload restores it',async()=>{
  const caches=cacheStorage(),location={href:'https://example.test/kamptrail/'};
  const first=harness(async url=>url.endsWith('index.json')?indexed():dataset(),{caches,location});
  await first.api.init(first.map);
  const key='kamptrail:https://example.test/kamptrail/:data-v1';
  assert.ok(caches.stores.has(key));assert.equal(caches.writes.length,2);
  const raw=await caches.stores.get(key).get('https://example.test/kamptrail/data/campsites/NY_merged.geojson').clone().json();
  assert.equal(raw.features[0].properties.id,undefined); // Original source response, not normalized runtime data.
  const offline=harness(async()=>{throw new TypeError('Offline');},{caches,location});
  await offline.api.init(offline.map);
  assert.equal(offline.api.getAllCampsites().length,1);assert.equal(offline.api.getLoadStatus().failedStates.length,0);
});
test('invalid and failed responses never enter the persistent cache',async()=>{
  for(const invalid of [new Response(JSON.stringify({features:[]})),new Response('Unavailable',{status:503})]) {
    const caches=cacheStorage(),location={href:'https://example.test/kamptrail/index.html'};
    const h=harness(async url=>url.endsWith('index.json')?indexed():invalid.clone(),{caches,location});
    await h.api.init(h.map);
    assert.equal(h.api.getLoadStatus().failedStates.length,1);
    assert.ok(!caches.writes.some(url=>url.endsWith('NY_merged.geojson')));
  }
});
test('unavailable Cache API storage does not prevent successful online loading',async()=>{
  const h=harness(async url=>url.endsWith('index.json')?indexed():dataset(),{location:{href:'https://example.test/kamptrail/'},caches:{async open(){throw new Error('Storage blocked');}}});
  await h.api.init(h.map);assert.equal(h.api.getAllCampsites().length,1);assert.equal(h.api.getLoadStatus().failedStates.length,0);
});
test('focus on a filter-hidden site explains the problem instead of silently panning',async()=>{
  const messages=[];
  const h=harness(async url=>url.endsWith('index.json')?response({}):response({type:'FeatureCollection',features:[feature({osm_id:1,tourism:'camp_site',fee:'yes'})]}),{showToast:message=>messages.push(message)});
  await h.api.init(h.map);const id=h.api.getAllCampsites()[0].properties.id;
  h.api.updateFilters({cost:'free'});let moved=false;h.map.setView=()=>moved=true;
  assert.equal(h.api.focusCampsite(id),false);assert.equal(moved,false);assert.ok(messages[0].includes('hidden by your filters'));
  h.context.KampTrailFilters={reset:()=>h.api.updateFilters(h.api.getDefaultFilters())};
  assert.equal(h.api.focusCampsite(id,{preserveFilters:true}),false);assert.equal(h.api.getCurrentFilters().cost,'free');
  let closed=0;h.map.closePopup=()=>closed++;
  assert.equal(h.api.focusCampsite(id),true);assert.equal(moved,true);assert.equal(closed,1);
});
test('zoomed-out view requests no state listings and reports an overview',async()=>{
  const urls=[];
  const h=harness(async url=>{urls.push(url);if(url.endsWith('campsites/index.json'))return response({states:[{state:'NY',count:120},{state:'VT',count:30}],total_sites:150});return response({type:'FeatureCollection',features:[feature({id:'NY-1',facility_id:9})]});},{});
  h.context.location={href:'https://example.test/kamptrail/'};
  h.map.getZoom=()=>4;
  h.context.L.layerGroup=()=>({layers:[],addLayer(m){this.layers.push(m);}});
  const marker=h.context.L.marker;h.context.L.marker=(c,o)=>Object.assign(marker(c,o),{on(){}});
  await h.api.init(h.map);
  assert.equal(urls.some(u=>/_merged\.geojson/.test(u)),false);
  assert.equal(urls.some(u=>u.includes('/elevation/')),false);
  const status=h.api.getLoadStatus();
  assert.equal(status.overview,true);assert.equal(status.catalogueTotal,150);
  assert.equal(h.api.getVisibleCampsites().length,0);
  h.map.getZoom=()=>10;
  await h.api.refresh();
  assert.ok(urls.some(u=>/NY_merged\.geojson/.test(u)));
  assert.ok(urls.some(u=>u.endsWith('/elevation/index.json')));
});

function terrainFixture(){
 const crypto=require('node:crypto'),Q=require('../data-quality.js'),snapshot='a'.repeat(24),date='2026-10-29T10:00:00Z';
 const record={status:'known',elevation_m:0,coordinate_key:'43.0000000,-75.1000000',sample_coordinates:{lat:43,lng:-75.1},retrieved_at:date,source:{url:Q.ELEVATION_SOURCE,sample_url:Q.ELEVATION_SOURCE+'/getSamples',units:'metres',interpolation:'RSP_BilinearInterpolation',horizontal_crs:'EPSG:4326'}};
 const sidecar={version:1,snapshot_id:snapshot,state:'NY',records:{known:record},sources:{}},raw=JSON.stringify(sidecar);
 const manifest={version:1,snapshot_id:snapshot,generated_at:date,source:{url:Q.ELEVATION_SOURCE,units:'metres',interpolation:'RSP_BilinearInterpolation'},states:{NY:{url:`snapshots/${snapshot}/NY.json`,sha256:crypto.createHash('sha256').update(raw).digest('hex'),count:1}}};
 return{sidecar,raw,manifest,overrides:{crypto:crypto.webcrypto,TextEncoder,Response,location:{href:'https://example.test/kamptrail/'}}};
}
test('validated terrain survives a newer unavailable manifest and offline reload; moved coordinates remain unknown',async()=>{
 const {raw,manifest,overrides}=terrainFixture(),caches=cacheStorage();let mode='online',moved=false;const urls=[];
 const fetcher=async url=>{urls.push(url);if(mode==='offline')throw new Error('offline');if(url.endsWith('/elevation/index.json'))return new Response(JSON.stringify(mode==='rotated'?{...manifest,snapshot_id:'b'.repeat(24),states:{NY:{...manifest.states.NY,url:`snapshots/${'b'.repeat(24)}/NY.json`}}}:manifest));if(url.includes('/elevation/snapshots/')){if(mode==='rotated')throw new Error('new snapshot unavailable');return new Response(raw);}if(url.endsWith('ridb-sites.json'))return new Response('{"version":1,"facilities":{}}');if(url.endsWith('agency/index.json'))return new Response('{"version":1,"states":[]}');if(url.endsWith('campsites/index.json'))return indexed();return new Response(JSON.stringify({type:'FeatureCollection',features:[{...feature({id:'known'}),geometry:{type:'Point',coordinates:[moved?-75.12:-75.1,43]}}, {...feature({id:'unknown',name:'Unknown Heights Campground'}),geometry:{type:'Point',coordinates:[-75.15,43.05]}}]}));};
 const first=harness(fetcher,{...overrides,caches});await first.api.init(first.map);first.api.updateFilters({elevationMin:0,elevationMax:0});assert.equal(first.api.getVisibleCampsites().length,1);assert.equal(first.api.getElevationStatus().unknown,1);
 assert.ok(urls.indexOf('data/campsites/NY_merged.geojson')<urls.findIndex(u=>u.endsWith('/elevation/index.json')));
 const key='https://example.test/kamptrail/data/campsites/elevation/__saved_NY__';assert.ok(caches.writes.includes(key));
 mode='rotated';const second=harness(fetcher,{...overrides,caches});await second.api.init(second.map);second.api.updateFilters({elevationMax:0});assert.equal(second.api.getVisibleCampsites().length,1);assert.equal(second.api.getElevationStatus().saved,true);
 mode='offline';const offline=harness(fetcher,{...overrides,caches});await offline.api.init(offline.map);offline.api.updateFilters({elevationMin:0});assert.equal(offline.api.getVisibleCampsites().length,1);assert.equal(offline.api.getElevationStatus().saved,true);
 mode='rotated';moved=true;const movedPage=harness(fetcher,{...overrides,caches});await movedPage.api.init(movedPage.map);movedPage.api.updateFilters({elevationMin:0});assert.equal(movedPage.api.getVisibleCampsites().length,0);assert.equal(movedPage.api.getElevationStatus().unknown,2);
});
test('bad terrain checksum never populates a stable cache or turns unknown into a match',async()=>{
 const {raw,manifest,overrides}=terrainFixture(),caches=cacheStorage();
 const h=harness(async url=>{if(url.endsWith('/elevation/index.json'))return new Response(JSON.stringify(manifest));if(url.includes('/elevation/snapshots/'))return new Response(raw+' ');if(url.endsWith('index.json'))return indexed();if(url.endsWith('ridb-sites.json'))return new Response('{"version":1,"facilities":{}}');return new Response(JSON.stringify({type:'FeatureCollection',features:[feature({id:'known'})]}));},{...overrides,caches});
 await h.api.init(h.map);h.api.updateFilters({elevationMin:0});assert.equal(h.api.getVisibleCampsites().length,0);assert.equal(h.api.getElevationStatus().unknown,1);assert.equal(caches.writes.some(u=>u.includes('__saved_NY__')),false);
});

test('slow optional terrain requests do not delay unfiltered campsite markers',async()=>{
 const {raw,manifest,overrides}=terrainFixture();let release,started;
 const began=new Promise(r=>started=r);
 const h=harness(async url=>{if(url.endsWith('/elevation/index.json'))return new Response(JSON.stringify(manifest));if(url.includes('/elevation/snapshots/')){started();return new Promise(r=>release=()=>r(new Response(raw)));}if(url.endsWith('index.json'))return indexed();if(url.endsWith('ridb-sites.json'))return new Response('{"version":1,"facilities":{}}');return new Response(JSON.stringify({type:'FeatureCollection',features:[feature({id:'known'})]}));},{...overrides,caches:cacheStorage()});
 const pending=h.api.init(h.map);await began;assert.equal(h.cluster.layers.length,1);assert.equal(h.api.getVisibleCampsites().length,1);assert.equal(h.api.getElevationStatus().loading,true);release();await pending;assert.equal(h.context.DataQuality.elevationInfo(h.api.getVisibleCampsites()[0]).m,0);
});

test('cache storage failure still labels validated in-memory terrain as saved on failed refresh',async()=>{
 const {raw,manifest,overrides}=terrainFixture();let offline=false;
 const h=harness(async url=>{if(offline)throw new Error('offline');if(url.endsWith('/elevation/index.json'))return new Response(JSON.stringify(manifest));if(url.includes('/elevation/snapshots/'))return new Response(raw);if(url.endsWith('index.json'))return indexed();if(url.endsWith('ridb-sites.json'))return new Response('{"version":1,"facilities":{}}');return new Response(JSON.stringify({type:'FeatureCollection',features:[feature({id:'known'})]}));},{...overrides,caches:{async open(){throw new Error('Cache Storage unavailable');}}});
 await h.api.init(h.map);h.api.updateFilters({elevationMin:0,elevationMax:0});assert.equal(h.api.getVisibleCampsites().length,1);
 offline=true;await h.api.refresh();assert.equal(h.api.getVisibleCampsites().length,1);assert.equal(h.api.getElevationStatus().saved,true);assert.equal(h.api.getElevationStatus().unavailable.length,0);
});

test('corrupt stable terrain bytes cannot become offline matches',async()=>{
 const {manifest,overrides}=terrainFixture(),caches=cacheStorage();
 const cache=await caches.open('kamptrail:https://example.test/kamptrail/:elevation-v1');
 await cache.put('https://example.test/kamptrail/data/campsites/elevation/__saved_NY__',new Response(JSON.stringify({sha256:manifest.states.NY.sha256,raw:'{}'})));
 const h=harness(async url=>{if(url.includes('/elevation/'))throw new Error('offline');if(url.endsWith('index.json'))return indexed();if(url.endsWith('ridb-sites.json'))return new Response('{"version":1,"facilities":{}}');return new Response(JSON.stringify({type:'FeatureCollection',features:[feature({id:'known'})]}));},{...overrides,caches});
 await h.api.init(h.map);h.api.updateFilters({elevationMin:0});assert.equal(h.api.getVisibleCampsites().length,0);assert.equal(h.api.getElevationStatus().unknown,1);assert.equal(h.api.getElevationStatus().saved,false);
});
