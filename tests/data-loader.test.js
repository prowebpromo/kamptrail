const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function harness(fetcher, overrides={}) {
  const events=[], cluster={layers:[],addLayers(items){this.layers.push(...items);},removeLayer(item){this.layers=this.layers.filter(x=>x!==item);}};
  const bounds={getSouth:()=>42.9,getNorth:()=>43.1,getWest:()=>-75.2,getEast:()=>-75,contains:([lat,lng])=>lat>=42.9&&lat<=43.1&&lng>=-75.2&&lng<=-75};
  const map={getBounds:()=>bounds,addLayer(){},on(){},setView(){}};
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
  assert.equal(h.api.focusCampsite(id),true);assert.equal(moved,true);
});
