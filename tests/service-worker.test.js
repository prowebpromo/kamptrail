const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function worker(fetcher) {
  const handlers={},stores=new Map();
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const s=stores.get(name);return {async match(request){return s.get(typeof request==='string'?request:request.url)?.clone();},async put(request,response){s.set(typeof request==='string'?request:request.url,response.clone());},async addAll(){}};},async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);}};
  const context={URL,Response,Request,AbortSignal,caches,fetch:fetcher,self:{registration:{scope:'https://example.test/kamptrail/'},location:{origin:'https://example.test'},addEventListener:(event,handler)=>handlers[event]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('service-worker.js','utf8'),context);
  return {handlers,stores,caches};
}
const good={type:'FeatureCollection',features:[]};
test('malformed HTTP 200 does not overwrite a saved valid GeoJSON snapshot',async()=>{
  const w=worker(async()=>new Response('<html>error</html>',{status:200}));
  const name='kamptrail:https://example.test/kamptrail/:data-v1',url='https://example.test/kamptrail/data/campsites/NY_merged.geojson';
  const cache=await w.caches.open(name);await cache.put(url,new Response(JSON.stringify(good)));
  const waits=[];let answer;
  w.handlers.fetch({request:new Request(url),respondWith:p=>answer=p,waitUntil:p=>waits.push(p)});
  assert.deepEqual(await (await answer).json(),good);await Promise.all(waits);
  assert.deepEqual(await (await cache.match(url)).json(),good);
});
test('worker activation deletes only obsolete caches for this app scope',async()=>{
  const w=worker();
  for(const key of ['unrelated-app','kamptrail:https://example.test/other/:old','kamptrail:https://example.test/kamptrail/:old','kamptrail:https://example.test/kamptrail/:data-v1'])await w.caches.open(key);
  let done;w.handlers.activate({waitUntil:p=>done=p});await done;
  assert.equal(w.stores.has('unrelated-app'),true);assert.equal(w.stores.has('kamptrail:https://example.test/other/:old'),true);
  assert.equal(w.stores.has('kamptrail:https://example.test/kamptrail/:old'),false);assert.equal(w.stores.has('kamptrail:https://example.test/kamptrail/:data-v1'),true);
});
test('worker does not intercept external basemap tiles or neighboring apps',()=>{
  const w=worker();let intercepted=false;
  for(const url of ['https://tile.openstreetmap.org/4/3/6.png','https://example.test/other/app.js'])w.handlers.fetch({request:new Request(url),respondWith:()=>intercepted=true});
  assert.equal(intercepted,false);
});

test('a successful online update replaces the saved snapshot immediately',async()=>{
  const fresh={type:'FeatureCollection',features:[],updated:true};
  const w=worker(async()=>new Response(JSON.stringify(fresh)));
  const name='kamptrail:https://example.test/kamptrail/:data-v1',url='https://example.test/kamptrail/data/campsites/NY_merged.geojson';
  const cache=await w.caches.open(name);await cache.put(url,new Response(JSON.stringify(good)));
  let answer;w.handlers.fetch({request:new Request(url),respondWith:p=>answer=p,waitUntil(){}});
  assert.deepEqual(await (await answer).json(),fresh);assert.deepEqual(await (await cache.match(url)).json(),fresh);
});
test('national name search also updates online and remains available offline',async()=>{
  const data={version:1,sites:[{id:'osm:node:1',name:'A campground',states:['NY'],lat:43,lng:-75}]};
  let online=true;const w=worker(async()=>{if(!online)throw new Error('Offline');return new Response(JSON.stringify(data));});
  const url='https://example.test/kamptrail/data/campsites/search-index.json';
  async function request(){let result;w.handlers.fetch({request:new Request(url),respondWith:p=>result=p,waitUntil(){}});return(await result).json();}
  assert.deepEqual(await request(),data);online=false;assert.deepEqual(await request(),data);
});
