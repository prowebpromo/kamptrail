const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function worker(fetcher=async()=>new Response('shell asset')) {
  let time=Date.UTC(2026,0,1), skipCount=0;
  const Clock=class extends Date { static now(){return time;} };
  const advance=(callback,ms)=>setImmediate(()=>{time+=ms;callback();});
  const handlers={},stores=new Map();
  const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const s=stores.get(name);return {async match(request){return s.get(typeof request==='string'?request:request.url)?.clone();},async put(request,response){s.set(typeof request==='string'?request:request.url,response.clone());},async keys(){return [...s.keys()].map(key=>new Request(key));},async delete(request){return s.delete(typeof request==='string'?request:request.url);},async addAll(){}};},async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);}};
  const context={URL,Response,Request,AbortSignal,Date:Clock,setTimeout:advance,caches,fetch:fetcher,self:{registration:{scope:'https://example.test/kamptrail/'},location:{origin:'https://example.test'},addEventListener:(event,handler)=>handlers[event]=handler,skipWaiting:async()=>{skipCount++;},clients:{claim:async()=>{}}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('service-worker.js','utf8'),context);
  return {handlers,stores,caches,now:()=>time,skipCount:()=>skipCount};
}
const good={type:'FeatureCollection',features:[]};

test('historical identity registry bypasses generic caches for exact-byte page validation',()=>{
  const w=worker();let intercepted=false;
  w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/campsites/withdrawn.json'),respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false);
});
test('2.40 upgrade retires the shipped 2.39 shell while keeping saved campsite data',async()=>{
  const w=worker(),prefix='kamptrail:https://example.test/kamptrail/:';
  const previous=await w.caches.open(prefix+'kt-v73');
  await previous.put('https://example.test/kamptrail/app.js',new Response('stale 2.39.1 runtime'));
  await w.caches.open(prefix+'data-v1');
  let installed;w.handlers.install({waitUntil:p=>installed=p});await installed;
  let activated;w.handlers.activate({waitUntil:p=>activated=p});await activated;
  assert.equal(w.stores.has(prefix+'kt-v73'),false,'The shipped cache must be retired, not reused');
  assert.equal(w.stores.has(prefix+'data-v1'),true,'Visited campsite data survives the upgrade');
});
test('optional RIDB amenity evidence bypasses generic caches for page validation',()=>{
  const w=worker();let intercepted=false;
  w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/campsites/ridb-amenities.json'),respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false);
});
test('optional Forest Service site evidence bypasses generic caches for page validation',()=>{
  const w=worker();let intercepted=false;
  w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/campsites/usfs-site-amenities.json'),respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false);
});
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
test('the current release installs a fresh shell and retires its preceding generation while retaining visited data',async()=>{
  const w=worker(),prefix='kamptrail:https://example.test/kamptrail/:';
  const current=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '(kt-v(\d+))'/);assert.ok(current,'Worker declares a numbered shell generation');
  const previous='kt-v'+(Number(current[2])-1);assert.ok(Number(current[2])>42,'This release advances beyond the shipped 2.15.1 shell');
  await w.caches.open(prefix+previous);await w.caches.open(prefix+'data-v1');
  let installed;w.handlers.install({waitUntil:p=>installed=p});await installed;
  assert.equal(w.stores.has(prefix+current[1]),true);
  let activated;w.handlers.activate({waitUntil:p=>activated=p});await activated;
  assert.equal(w.stores.has(prefix+previous),false);
  assert.equal(w.stores.has(prefix+current[1]),true);
  assert.equal(w.stores.has(prefix+'data-v1'),true);
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
test('saved USGS Topo tiles are served from the offline tile cache without network',async()=>{
  let fetched=0;const w=worker(async()=>{fetched++;throw new Error('offline');});
  const url='https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/12/701/1588';
  const cache=await w.caches.open('kamptrail:https://example.test/kamptrail/:tiles-v1');await cache.put(url,new Response('jpeg',{headers:{'content-type':'image/jpeg'}}));
  let answer;w.handlers.fetch({request:new Request(url),respondWith:p=>answer=p});
  assert.equal(await (await answer).text(),'jpeg');assert.equal(fetched,0);
  let miss;w.handlers.fetch({request:new Request(url.replace('/1588','/1589')),respondWith:p=>miss=p});
  assert.equal((await miss).status,504);
});
test('activation keeps saved offline map tiles',async()=>{
  const w=worker();await w.caches.open('kamptrail:https://example.test/kamptrail/:tiles-v1');
  let done;w.handlers.activate({waitUntil:p=>done=p});await done;
  assert.equal(w.stores.has('kamptrail:https://example.test/kamptrail/:tiles-v1'),true);
});

test('private management and removed community photos cannot be replayed from offline caches',()=>{
  const w=worker();
  for(const url of ['https://example.test/kamptrail/api/community.php','https://example.test/kamptrail/api/photo.php?id=1','https://example.test/kamptrail/api/admin.php']){
    let intercepted=false;
    w.handlers.fetch({request:{method:'GET',url,mode:'navigate'},respondWith:()=>{intercepted=true;}});
    assert.equal(intercepted,false,url);
  }
});

test('worker upgrades retain calculated road routes for offline use',async()=>{
 const w=worker();const name='kamptrail:https://example.test/kamptrail/:routes-v1';await w.caches.open(name);let done;w.handlers.activate({waitUntil:p=>done=p});await done;assert.equal(w.stores.has(name),true);
});

test('worker upgrades retain saved Forest Service road views',async()=>{
  const w=worker();await w.caches.open('kamptrail:https://example.test/kamptrail/:mvum-v1');
  let done;w.handlers.activate({waitUntil:p=>done=p});await done;
  assert.equal(w.stores.has('kamptrail:https://example.test/kamptrail/:mvum-v1'),true);
});

test('worker upgrades retain only the separate published camper aggregate cache',async()=>{
 const w=worker();const name='kamptrail:https://example.test/kamptrail/:camper-discovery-v1';await w.caches.open(name);let done;w.handlers.activate({waitUntil:p=>done=p});await done;assert.equal(w.stores.has(name),true);
});

test('worker preserves validated terrain cache and leaves terrain responses to the validating loader',async()=>{
 const w=worker(),name='kamptrail:https://example.test/kamptrail/:elevation-v1';await w.caches.open(name);let done;w.handlers.activate({waitUntil:p=>done=p});await done;assert.equal(w.stores.has(name),true);
 for(const tail of ['index.json','snapshots/'+ 'a'.repeat(24)+'/NY.json']){let intercepted=false;w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/campsites/elevation/'+tail),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);}
});

test('new service snapshots bypass generic caching and validated service cache survives an app upgrade',async()=>{
 const w=worker(),name='kamptrail:https://example.test/kamptrail/:services-v2';await w.caches.open(name);let done;w.handlers.activate({waitUntil:p=>done=p});await done;assert.equal(w.stores.has(name),true);
 for(const path of ['index.json','snapshots/'+ 'a'.repeat(24)+'/n40w112.json','unexpected.json']){
  let intercepted=false;w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/services/'+path),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false,path);
 }
});

test('official rest-area facts are not pinned in the generic shell cache',()=>{
 const w=worker();let intercepted=false;w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/rest-areas/TX.json'),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
});

test('height-tag pilot bypasses generic caching and its validated offline snapshot survives upgrades',async()=>{
 const w=worker(),name='kamptrail:https://example.test/kamptrail/:clearance-v1';await w.caches.open(name);let done;w.handlers.activate({waitUntil:p=>done=p});await done;assert.equal(w.stores.has(name),true);
 let intercepted=false;w.handlers.fetch({request:new Request('https://example.test/kamptrail/data/clearances/RI.json'),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false);
});

test('visiting the how-to page never replaces the cached offline app shell',async()=>{
 let online=true;const w=worker(async request=>{if(!online)throw new Error('offline');return new Response(request.url.endsWith('how-to.html')?'<p>how-to</p>':'<p>app</p>',{status:200});});
 const current=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '(kt-v\d+)'/);assert.ok(current,'Worker declares its shell identity');
 const shell='kamptrail:https://example.test/kamptrail/:'+current[1];
 async function navigate(url){let result;w.handlers.fetch({request:{method:'GET',url,mode:'navigate'},respondWith:p=>result=p});return (await result).text();}
 assert.equal(await navigate('https://example.test/kamptrail/'),'<p>app</p>');
 assert.equal(await navigate('https://example.test/kamptrail/how-to.html'),'<p>how-to</p>');
 assert.equal(await (await (await w.caches.open(shell)).match('index.html')).text(),'<p>app</p>');
 online=false;
 assert.equal(await navigate('https://example.test/kamptrail/'),'<p>app</p>');
});

test('saved app navigation retains dated land care guidance when offline',async()=>{
  const w=worker(async()=>{throw new Error('offline');});
  const shell=fs.readFileSync('index.html','utf8');
  const shellVersion=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '([^']+)'/)[1];
  const cache=await w.caches.open('kamptrail:https://example.test/kamptrail/:'+shellVersion);
  await cache.put('index.html',new Response(shell,{headers:{'Content-Type':'text/html'}}));
  let answer;
  w.handlers.fetch({request:{url:'https://example.test/kamptrail/',method:'GET',mode:'navigate'},respondWith:p=>answer=p});
  const saved=await(await answer).text();
  assert.ok(saved.includes('id="kt-camping-care"'));
  assert.ok(saved.includes('Current local orders and posted rules control.'));
  assert.ok(saved.includes('datetime="2026-10-30"'));
  assert.ok(saved.includes('https://www.blm.gov/programs/recreation/camping'));
});

test('legal navigation returns each versioned document offline without replacing the app shell',async()=>{
  let fetched=0;const w=worker(async()=>{fetched++;throw Error('offline');});
  const version=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '([^']+)'/)[1];
  const cache=await w.caches.open('kamptrail:https://example.test/kamptrail/:'+version);
  await cache.put('index.html',new Response('APP'));
  for(const page of ['terms.html','safety.html','privacy.html']){
    await cache.put(page,new Response('DOCUMENT '+page));let result;
    w.handlers.fetch({request:{url:'https://example.test/kamptrail/'+page+'?test=1',method:'GET',mode:'navigate'},respondWith:p=>result=p});
    assert.equal(await(await result).text(),'DOCUMENT '+page);
  }
  assert.equal(fetched,0,'cached legal copy remains paired with installed shell');
  assert.equal(await(await cache.match('index.html')).text(),'APP');
});
test('uncached legal navigation fails explicitly on network errors or non-OK responses, never with app HTML',async()=>{
  for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response('upstream error',{status:500})]){
    const w=worker(fetcher),version=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '([^']+)'/)[1];
    const cache=await w.caches.open('kamptrail:https://example.test/kamptrail/:'+version);await cache.put('index.html',new Response('APP'));
    for(const page of ['terms.html','safety.html','privacy.html']){let result;w.handlers.fetch({request:{url:'https://example.test/kamptrail/'+page,method:'GET',mode:'navigate'},respondWith:p=>result=p});const response=await result;assert.equal(response.status,503);assert.notEqual(await response.text(),'APP');}
    assert.equal(await(await cache.match('index.html')).text(),'APP');
  }
});
test('missing or stale safety module stops app initialization through the version handshake',()=>{
  const source=fs.readFileSync('app.js','utf8'),line=source.split('\n').find(line=>line.includes('.some(module=>module?.version'));
  assert.ok(line.includes('window.KampTrailSafety'));
  const expression=line.match(/\[window\.KampTrailSafety,[\s\S]*\]\.some\(module=>module\?\.version!=='([^']+)'\)/)[0];
  const names=[...expression.matchAll(/window\.([A-Za-z0-9]+)/g)].map(m=>m[1]);const current=JSON.parse(fs.readFileSync('package.json','utf8')).version;
  const window=Object.fromEntries(names.map(name=>[name,{version:current}]));assert.equal(vm.runInNewContext(expression,{window}),false);
  delete window.KampTrailSafety;assert.equal(vm.runInNewContext(expression,{window}),true);window.KampTrailSafety={version:'old'};assert.equal(vm.runInNewContext(expression,{window}),true);
  assert.match(source.slice(source.indexOf(line),source.indexOf('const dataDialog')),/return;/);
});

test('only versioned valid FCC tiles are cached and retained for offline use', async () => {
  const base='https://example.test/kamptrail/data/fcc-coverage/';
  const bytes=Buffer.alloc(33); [0x89504e47,0x0d0a1a0a,13,0x49484452,256,256].forEach((n,i)=>bytes.writeUInt32BE(n,i*4));
  let online=true, calls=0;
  const w=worker(async request=>{
    ++calls;
    if(!online)throw Error('offline');
    if(request.url.endsWith('/9.png'))return new Response('upstream error',{status:404});
    return new Response(bytes,{headers:{'Content-Type':request.url.endsWith('/7.png')?'text/html':'image/png'}});
  });
  const request=path=>{let response;w.handlers.fetch({request:new Request(base+path),respondWith:value=>response=value});return response;};
  assert.equal(request('manifest.json'),undefined);
  assert.equal(request('private/file.zip'),undefined);
  const tile='2024-06-30-r1/att/RI/8/3/4.png';
  assert.equal((await request(tile)).status,200);
  assert.equal((await request(tile.replace('/4.png','/7.png'))).status,502);
  assert.equal((await request(tile.replace('/4.png','/9.png'))).status,404);
  online=false;
  assert.deepEqual(Buffer.from(await (await request(tile)).arrayBuffer()),bytes);
  assert.equal(calls,3);
  assert.equal((await request(tile.replace('/4.png','/9.png'))).status,503);
});

function install(w) {
  let finished;
  w.handlers.install({waitUntil(promise){finished=promise;}});
  return finished;
}
test('shell install limits concurrency, paces starts and honors shared Retry-After seconds and HTTP dates',async()=>{
  for (const asDate of [false,true]) {
    let active=0, peak=0, resumeAt=0, throttled=false;
    const starts=[];
    const w=worker(async request=>{
      starts.push({url:request.url,time:w.now()});
      active++;peak=Math.max(peak,active);
      // Allow both worker slots to become occupied without a clock-based test delay.
      await new Promise(done=>setImmediate(()=>setImmediate(done)));
      active--;
      if (!throttled) {
        throttled=true;
        resumeAt=asDate ? Math.ceil((w.now()+2500)/1000)*1000 : w.now()+3000;
        return new Response('',{status:429,headers:{'Retry-After':asDate?new Date(resumeAt).toUTCString():'3'}});
      }
      return new Response('validated required file');
    });
    await install(w);
    assert.equal(peak,2);
    const first=starts[0];
    const retry=starts.find((s,i)=>i>0 && s.url===first.url);
    assert.ok(retry && retry.time>=resumeAt,'retry begins after the requested cooldown');
    assert.ok(starts.slice(2).every(s=>s.time>=resumeAt),'other shell work respects the same cooldown');
    for(let i=1;i<starts.length;i++) assert.ok(starts[i].time-starts[i-1].time>=150);
    assert.equal(w.skipCount(),1);
  }
});
test('failed essential fetches preserve the old shell and never expose a partial new shell',async()=>{
  const prefix='kamptrail:https://example.test/kamptrail/:',oldKey=prefix+'previous';
  for (const reply of [()=>new Response('',{status:404}),()=>new Response('',{status:429,headers:{'Retry-After':'90'}}),()=>new Response('',{status:429}),()=>{throw new Error('offline');}]) {
    let failures=0,calls=0;
    const w=worker(async request=>{
      calls++;
      if(request.url.endsWith('locale.js')) { failures++;return reply(); }
      return new Response('required file');
    });
    const old=await w.caches.open(oldKey);
    await old.put('https://example.test/kamptrail/index.html',new Response('saved shell'));
    await assert.rejects(install(w));
    assert.ok(calls<15,'other shell fetches stop when essential warming fails');
    assert.ok(failures<=2,'at most one retry for throttling');
    assert.equal(w.skipCount(),0);
    assert.deepEqual((await w.caches.keys()).filter(k=>k!==prefix+'shell-cooldown'),[oldKey]);
    assert.equal(await (await old.match('https://example.test/kamptrail/index.html')).text(),'saved shell');
  }
});

test('a long Retry-After applies to a later installation attempt without a second request',async()=>{
  let calls=0;
  const w=worker(async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'90'}});});
  await assert.rejects(install(w),/HTTP 429/);
  const before=calls;
  await assert.rejects(install(w),/cooldown is still in effect/);
  assert.equal(calls,before);
  assert.equal(w.skipCount(),0);
});

test('a quota error during shell publication restores the prior contents',async()=>{
  const w=worker(),version=fs.readFileSync('service-worker.js','utf8').match(/const VERSION = '([^']+)'/)[1];
  const key='kamptrail:https://example.test/kamptrail/:'+version;
  const previous=await w.caches.open(key), home='https://example.test/kamptrail/index.html';
  await previous.put(home,new Response('previous complete home'));
  const open=w.caches.open.bind(w.caches);
  w.caches.open=async name=>{
    const cache=await open(name),put=cache.put.bind(cache);
    if(name===key)cache.put=async(req,resp)=>{
      if(req.url.endsWith('/locale.js'))throw Error('quota exhausted');
      return put(req,resp);
    };
    return cache;
  };
  await assert.rejects(install(w),/quota/);
  assert.equal(w.skipCount(),0);
  assert.deepEqual((await previous.keys()).map(req=>req.url),[home]);
  assert.equal(await (await previous.match(home)).text(),'previous complete home');
});
