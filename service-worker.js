// Versioned local assets, persistent visited data, and saved USGS Topo tiles chosen by the visitor.
const VERSION = 'kt-v42';
const TOPO_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/';
const PREFIX = `kamptrail:${self.registration.scope}:`;
const SHELL_CACHE = `${PREFIX}${VERSION}`;
const DATA_CACHE = `${PREFIX}data-v1`;
const TILE_CACHE = `${PREFIX}tiles-v1`;
const MVUM_CACHE = `${PREFIX}mvum-v1`;
const CAMPER_CACHE = `${PREFIX}camper-discovery-v1`;
const ELEVATION_CACHE = `${PREFIX}elevation-v1`;
const SERVICES_CACHE = `${PREFIX}services-v2`;
const ROUTE_CACHE = `${PREFIX}routes-v1`;
const SHELL = [
  './','index.html','app.js','app.css','data/places-us.json','manifest.json','icon-192.png','icon-512.png','og.png',
  'vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png','vendor/leaflet/images/marker-icon-2x.png','vendor/leaflet/images/marker-shadow.png','vendor/leaflet/images/layers.png','vendor/leaflet/images/layers-2x.png',
  'vendor/markercluster/leaflet.markercluster.js','vendor/markercluster/MarkerCluster.css','vendor/markercluster/MarkerCluster.Default.css',
  'data-loader.js','data-quality.js','forecast.js','services.js','filters.js','trip-planner.js','routes.js','spot-info.js','share.js','layers.js','mvum.js','offline-maps.js','contributions.js','community.js','permissions.js','rig-profile.js','route-elevation.js','community-discovery.js','environment.js'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL.map(url=>new Request(new URL(url,self.registration.scope),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX) && key!==SHELL_CACHE && key!==DATA_CACHE && key!==TILE_CACHE && key!==ROUTE_CACHE && key!==MVUM_CACHE && key!==CAMPER_CACHE && key!==ELEVATION_CACHE && key!==SERVICES_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  // Moderation status and photos must never outlive a removal in an offline cache.
  if(url.origin===self.location.origin && url.pathname.includes('/api/'))return;
  // The page validates hashes/schema and manages stable last-good terrain snapshots.
  // Never let generic shell caching pin a manifest or cache an unvalidated sidecar.
  if(url.href.startsWith(new URL('data/campsites/elevation/',self.registration.scope).href))return;
  // Only the services module may cache validated spatial data; legacy v1 remains compatible.
  if(url.href.startsWith(new URL('data/services/',self.registration.scope).href) && url.href!==new URL('data/services/services.json',self.registration.scope).href)return;
  // Catalogue identity must accompany fresh weather, never a stale shell response.
  if(url.href===new URL('data/campsites/coordinate-index.json',self.registration.scope).href)return;
  // Saved offline map areas: USGS Topo tiles the visitor chose to save. Cache first, network otherwise. Nothing is added here automatically.
  if(request.method==='GET' && request.url.startsWith(TOPO_TILES)) {event.respondWith(savedTile(request));return;}
  if(request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope))return;
  if(request.mode==='navigate') {event.respondWith(navigation(request));return;}
  if(url.pathname.endsWith('.geojson') || url.pathname.endsWith('/data/campsites/index.json') || url.pathname.endsWith('/data/campsites/search-index.json') || url.pathname.endsWith('/data/campsites/ridb-sites.json') || url.pathname.endsWith('/data/campsites/agency/index.json') || url.pathname.endsWith('/data/services/services.json') || url.pathname.endsWith('/data/health.json')) {
    event.respondWith(visitedData(request,event));return;
  }
  if(/\.(js|css|png|svg|webp|jpg|jpeg|ico|json)$/.test(url.pathname))event.respondWith(asset(request));
});
async function savedTile(request) {
  try { const cache=await caches.open(TILE_CACHE),hit=await cache.match(request.url); if(hit)return hit; } catch {}
  try { return await fetch(request); } catch { return new Response('',{status:504,statusText:'Map tile not saved offline'}); }
}
async function navigation(request) {
  const cache=await caches.open(SHELL_CACHE);
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
