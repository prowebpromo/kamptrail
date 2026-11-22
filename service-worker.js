// Versioned local assets, persistent visited data, and saved USGS Topo tiles chosen by the visitor.
const VERSION = 'kt-v95';
const TOPO_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/';
const PREFIX = `kamptrail:${self.registration.scope}:`;
const SHELL_CACHE = `${PREFIX}${VERSION}`;
const LOCALE_CACHE = `${PREFIX}locales-v1`;
const DATA_CACHE = `${PREFIX}data-v1`;
const TILE_CACHE = `${PREFIX}tiles-v1`;
const MVUM_CACHE = `${PREFIX}mvum-v1`;
const CAMPER_CACHE = `${PREFIX}camper-discovery-v1`;
const ELEVATION_CACHE = `${PREFIX}elevation-v1`;
const SERVICES_CACHE = `${PREFIX}services-v2`;
const ROUTE_CACHE = `${PREFIX}routes-v1`;
const PACKED_CACHE = `${PREFIX}fcc-packed-v1`;
const COVERAGE_CACHE = `${PREFIX}fcc-tiles-v1`;
const CLEARANCE_CACHE = `${PREFIX}clearance-v1`;
const SHELL = [
  './','index.html','provider-config.json','locale.js','shell.js','consent-analytics.js','consent-controls.js','analytics-bootstrap.js','analytics-settings.js','beta.js','map-loader.js','app.js','app.css','data/places-us.json','manifest.json','brand-mark.svg','apple-touch-icon.png','favicon-32.png','icon-192.png','icon-512.png','icon-maskable-192.png','icon-maskable-512.png','og.png',
  'vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png','vendor/leaflet/images/marker-icon-2x.png','vendor/leaflet/images/marker-shadow.png','vendor/leaflet/images/layers.png','vendor/leaflet/images/layers-2x.png',
  'vendor/markercluster/leaflet.markercluster.js','vendor/markercluster/MarkerCluster.css','vendor/markercluster/MarkerCluster.Default.css',
  'listing-history.js','data-loader.js','data-quality.js','forecast.js','services.js','filters.js','trip-planner.js','routes.js','spot-info.js','share.js','carrier-coverage.js','layers.js','mvum.js','offline-maps.js','contributions.js','feedback.js','install.js','safety.js','how-to.html','updates.html','tools.html','guides.html','plan.html','about.html','record-overrides.js','resources.css','terms.html','safety.html','privacy.html','legal.css','community.js','permissions.js','rest-areas.js','clearances.js','rig-profile.js','route-elevation.js','route-clearance.js','community-discovery.js','environment.js'
];
// Cold visits also fetch the visible page. Pace all shell requests and pause both
// workers together if the hosting service asks us to retry later.
async function fetchShell(requests) {
  const responses = new Array(requests.length);
  const holdCache = PREFIX+'shell-cooldown', holdKey = new Request(new URL('.shell-cooldown',self.registration.scope));
  let cursor = 0, nextStart = 0, failure;
  if ((await caches.keys()).includes(holdCache)) {
    const stored = await (await caches.open(holdCache)).match(holdKey);
    nextStart = Number(await stored?.text()) || 0;
    if (nextStart-Date.now()>30000) throw Error('Hosting service shell cooldown is still in effect');
  }
  async function waitToStart() {
    while (!failure) {
      const delay = nextStart - Date.now();
      if (delay <= 0) {
        nextStart = Date.now() + 150;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(delay,1000)));
    }
    throw failure;
  }
  async function download(request) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitToStart();
      const response = await fetch(request);
      if (response.ok && response.status !== 206 && !response.headers.get('Vary')?.split(',').some(v=>v.trim()==='*')) {
        // Keep the original response (URL, headers, redirect semantics) and wait
        // for its body to finish before giving the worker another download.
        const complete = response.clone();
        await response.arrayBuffer();
        return complete;
      }
      const retry = response.headers.get('Retry-After');
      const throttled = response.status === 429 || (response.status === 503 && retry !== null);
      if (throttled) {
        const retryMs = retry === null ? NaN : /^\d+$/.test(retry.trim()) ? Number(retry)*1000
          : /[a-z]/i.test(retry) ? Date.parse(retry)-Date.now() : NaN;
        const delay = Number.isFinite(retryMs) ? Math.max(0,retryMs) : 8000;
        nextStart = Math.max(nextStart, Date.now()+delay);
        if (delay > 30000 || attempt > 0) {
          failure ||= Error('Required shell asset returned HTTP '+response.status);
          // The browser may try installation again on another visit. Carry the
          // deadline across attempts independently of the visitor's active shell.
          const hold = await caches.open(holdCache);
          await hold.put(holdKey,new Response(String(nextStart)));
        } else {
          await response.body?.cancel();
          continue;
        }
      }
      // A longer cooldown (or a second denial) ends this install rather than
      // issuing another request before the service allows it.
      failure ||= Error('Required shell asset returned HTTP '+response.status);
      await response.body?.cancel();
      throw failure;
    }
  }
  async function worker() {
    try {
      while (!failure && cursor < requests.length) {
        const i = cursor++;
        responses[i] = await download(requests[i]);
      }
    } catch (err) { failure ||= err; }
  }
  await Promise.all([worker(),worker()]);
  if (failure) throw failure;
  return responses;
}
async function installShell() {
  const requests = SHELL.map(url=>new Request(new URL(url,self.registration.scope),{cache:'reload'}));
  const responses = await fetchShell(requests);
  const existing = (await caches.keys()).includes(SHELL_CACHE);
  const cache = await caches.open(SHELL_CACHE), changed = [];
  try {
    for (let i=0; i<requests.length; i++) {
      const previous = existing ? await cache.match(requests[i]) : null;
      await cache.put(requests[i],responses[i]);
      if (existing) changed.push([requests[i],previous]);
    }
  } catch (err) {
    if (!existing) await caches.delete(SHELL_CACHE);
    else {
      for (const [request,previous] of changed) {
        if (previous) await cache.put(request,previous);
        else await cache.delete(request);
      }
    }
    throw err;
  }
  // A first visit can select coverage before the new worker controls the page.
  // Warm the optional reader for offline viewing, then retry on ordinary use.
  try {
    await cache.add(new Request(new URL('vendor/fcc-pmtiles/reader.js',self.registration.scope),
      {cache:'reload',signal:AbortSignal.timeout(4000)}));
  } catch { /* The reader is optional for the shell upgrade. */ }
  await self.skipWaiting();
}
self.addEventListener('install',event=>event.waitUntil(installShell()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX) && key!==SHELL_CACHE && key!==LOCALE_CACHE && key!==DATA_CACHE && key!==TILE_CACHE && key!==ROUTE_CACHE && key!==MVUM_CACHE && key!==CAMPER_CACHE && key!==ELEVATION_CACHE && key!==SERVICES_CACHE && key!==COVERAGE_CACHE && key!==PACKED_CACHE && key!==CLEARANCE_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Moderation status and photos must never outlive a removal in an offline cache.
  if(url.origin===self.location.origin && url.pathname.includes('/api/'))return;
  // The page revalidates the FCC catalogue. Only versioned, same-origin raster tiles may be saved.
  const coverageRoot = new URL('data/fcc-coverage/', self.registration.scope).href;
  if (url.href.startsWith(coverageRoot)) {
    const relative = url.href.slice(coverageRoot.length);
    if (request.method === 'GET' && /^[a-z0-9][a-z0-9-]{0,63}\/(?:verizon|att|t-mobile)\/[A-Z]{2}(?:-[A-Za-z0-9]+)?\/\d{1,2}\/\d+\/\d+\.png$/.test(relative)) {
      event.respondWith(coverageTile(request));
    }
    return;
  }
  // Official rest-area source evidence is revalidated by its loader, never shell-pinned.
  if(url.href.startsWith(new URL('data/rest-areas/',self.registration.scope).href))return;
  // Only the height-tag loader caches its validated, explicitly dated pilot.
  if(url.href.startsWith(new URL('data/clearances/',self.registration.scope).href))return;
  // The page validates hashes/schema and manages stable last-good terrain snapshots.
  // Never let generic shell caching pin a manifest or cache an unvalidated sidecar.
  if(url.href.startsWith(new URL('data/campsites/elevation/',self.registration.scope).href))return;
  // Only the services module may cache validated spatial data; legacy v1 remains compatible.
  if(url.href.startsWith(new URL('data/services/',self.registration.scope).href) && url.href!==new URL('data/services/services.json',self.registration.scope).href)return;
  // Catalogue identity must accompany fresh weather, never a stale shell response.
  if(url.href===new URL('data/campsites/coordinate-index.json',self.registration.scope).href)return;
  // Only the page loader may persist validated optional campsite amenity evidence.
  if(url.href===new URL('data/campsites/ridb-amenities.json',self.registration.scope).href)return;
  // Forest Service site-record evidence is also persisted only after the page validates it.
  if(url.href===new URL('data/campsites/usfs-site-amenities.json',self.registration.scope).href)return;
  // The page alone validates and persists historical identities with their exact-byte digest.
  if(url.href===new URL('data/campsites/withdrawn.json',self.registration.scope).href)return;
  // Saved offline map areas: USGS Topo tiles the visitor chose to save. Cache first, network otherwise. Nothing is added here automatically.
  if(request.method==='GET' && request.url.startsWith(TOPO_TILES)) {event.respondWith(savedTile(request));return;}
  if(request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope))return;
  if(/\/locale-(?:es|fr)\.js$/.test(url.pathname)){event.respondWith(optionalLocale(request));return;}
  if(request.mode==='navigate') {event.respondWith(navigation(request));return;}
  if(url.pathname.endsWith('.geojson') || url.pathname.endsWith('/data/campsites/index.json') || url.pathname.endsWith('/data/campsites/search-index.json') || url.pathname.endsWith('/data/campsites/identity-hosts.json') || url.pathname.endsWith('/data/campsites/ridb-sites.json') || url.pathname.endsWith('/data/campsites/agency/index.json') || url.pathname.endsWith('/data/services/services.json') || url.pathname.endsWith('/data/health.json')) {
    event.respondWith(visitedData(request,event));return;
  }
  if(/\.(js|css|png|svg|webp|jpg|jpeg|ico|json)$/.test(url.pathname))event.respondWith(asset(request));
});
let coverageWrites = Promise.resolve();
async function coverageTile(request) {
  let cache;
  try {
    cache = await caches.open(COVERAGE_CACHE);
    const saved = await cache.match(request);
    if (saved) return saved;
  } catch {}
  let response;
  try { response = await fetch(request); } catch { return new Response('', {status:503}); }
  if (!response.ok) return response;
  const maxBytes = 320 * 1024;
  if (!/^image\/png(?:;|$)/i.test(response.headers.get('Content-Type') || '') ||
      Number(response.headers.get('Content-Length')) > maxBytes) return new Response('', {status:502});
  const bytes = await response.arrayBuffer();
  const view = new DataView(bytes);
  if (bytes.byteLength < 33 || bytes.byteLength > maxBytes ||
      view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== 256 || view.getUint32(20) !== 256) {
    return new Response('', {status:502});
  }
  const tile = new Response(bytes, {headers:{'Content-Type':'image/png'}});
  if (cache) {
    // Tile loads finish concurrently. Serialize eviction so the limit also holds during rapid pans.
    coverageWrites = coverageWrites.then(async () => {
      await cache.put(request, tile.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 256)).map(key => cache.delete(key)));
    }).catch(() => {});
    await coverageWrites;
  }
  return tile;
}
async function optionalLocale(request){
  const cache=await caches.open(LOCALE_CACHE),saved=await cache.match(request);
  if(saved)return saved;
  const response=await fetch(request);
  if(response.ok){await cache.put(request,response.clone());const keys=await cache.keys();for(const key of keys.slice(0,Math.max(0,keys.length-4)))await cache.delete(key);}
  return response;
}
async function savedTile(request) {
  try { const cache=await caches.open(TILE_CACHE),hit=await cache.match(request.url); if(hit)return hit; } catch {}
  try { return await fetch(request); } catch { return new Response('',{status:504,statusText:'Map tile not saved offline'}); }
}
async function navigation(request) {
  const cache=await caches.open(SHELL_CACHE);
  // Only the app shell may refresh the cached offline shell. Other pages (how-to.html) pass through.
  const path=new URL(request.url).pathname,scope=new URL(self.registration.scope).pathname;
  // Keep legal documents paired with this shell generation, including offline navigation.
  const legalPage=['terms.html','safety.html','privacy.html'].find(page=>path===`${scope}${page}`);
  if(legalPage){
    const saved=await cache.match(legalPage);
    if(saved)return saved;
    try {
      const response=await fetch(request);
      if(response.ok){await cache.put(legalPage,response.clone());return response;}
    } catch {}
    return new Response('This KampTrail document is unavailable offline. Reconnect to read it.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
  if(path!==scope && path!==`${scope}index.html`){
    try { return await fetch(request); } catch { return await cache.match(request,{ignoreSearch:true}) || await cache.match('index.html') || new Response('KampTrail is unavailable offline. Open it once with a connection.',{status:503,headers:{'Content-Type':'text/plain'}}); }
  }
  try {
    const response=await fetch(request);
    if(response.ok)await cache.put('index.html',response.clone());
    if(response.ok)return response;
    return await cache.match('index.html') || response;
  } catch {
    return await cache.match('index.html') || new Response('KampTrail is unavailable offline. Open it once with a connection.',{status:503,headers:{'Content-Type':'text/plain'}});
  }
}
async function asset(request) {
  const cache=await caches.open(SHELL_CACHE),cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;
  try {
    const response=await fetch(request);
    if(response.ok)await cache.put(request,response.clone());
    return response;
  } catch {return new Response('',{status:503,statusText:'Unavailable offline'});}
}
async function visitedData(request,event) {
  const cache=await caches.open(DATA_CACHE),cached=await cache.match(request,{ignoreSearch:true});
  try {
    const response=await fetch(request,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Dataset unavailable');
    const data=await response.clone().json();
    const path=new URL(request.url).pathname;
    const valid=path.endsWith('.geojson') ? data?.type==='FeatureCollection' && Array.isArray(data.features)
      : path.endsWith('search-index.json') ? data?.version===1 && Array.isArray(data.sites)
      : path.endsWith('identity-hosts.json') ? data?.version===1 && !!data.hosts && typeof data.hosts==='object' && !Array.isArray(data.hosts)
      : path.endsWith('agency/index.json') ? data?.version===1 && Array.isArray(data.states)
      : path.endsWith('ridb-sites.json') ? [1,2].includes(data?.version) && data.facilities && typeof data.facilities==='object'
      : path.endsWith('services.json') ? data?.version===1 && Array.isArray(data.items)
      : path.endsWith('health.json') ? data?.version===1 && data.sources && typeof data.sources==='object'
      : Array.isArray(data?.states) && Number.isFinite(data.total_sites);
    if(!valid)throw new Error('Invalid dataset');
    await cache.put(request,response.clone());
    return response;
  } catch {
    return cached || new Response(JSON.stringify({error:'This area has not been saved offline.'}),{status:503,headers:{'Content-Type':'application/json'}});
  }
}
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
