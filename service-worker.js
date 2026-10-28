// Versioned local assets, persistent visited data, and no tile interception.
const VERSION = 'kt-v19-repair';
const PREFIX = `kamptrail:${self.registration.scope}:`;
const SHELL_CACHE = `${PREFIX}${VERSION}`;
const DATA_CACHE = `${PREFIX}data-v1`;
const SHELL = [
  './','index.html','app.js','app.css','data/places-us.json','manifest.json','icon-192.png','icon-512.png','og.png',
  'vendor/leaflet/leaflet.js','vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png','vendor/leaflet/images/marker-icon-2x.png','vendor/leaflet/images/marker-shadow.png','vendor/leaflet/images/layers.png','vendor/leaflet/images/layers-2x.png',
  'vendor/markercluster/leaflet.markercluster.js','vendor/markercluster/MarkerCluster.css','vendor/markercluster/MarkerCluster.Default.css','vendor/esri-leaflet.js',
  'overlays/overlays-advanced.css','overlays/overlays-advanced.js','overlays/overlays.css','overlays/overlays.js',
  'data-loader.js','data-quality.js','filters.js','trip-planner.js','gpx-importer.js','campsite-compare.js','wikimedia-photos-service.js'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL);
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(PREFIX) && key!==SHELL_CACHE && key!==DATA_CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope))return;
  if(request.mode==='navigate') {event.respondWith(navigation(request));return;}
  if(url.pathname.endsWith('.geojson') || url.pathname.endsWith('/data/campsites/index.json')) {
    event.respondWith(visitedData(request,event));return;
  }
  if(/\.(js|css|png|svg|webp|jpg|jpeg|ico|json)$/.test(url.pathname))event.respondWith(asset(request));
});
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
  const update=fetch(request).then(async response=>{
    if(response.ok) {
      try {
        const data=await response.clone().json();
        const valid=request.url.split('?')[0].endsWith('.geojson')
          ? data?.type==='FeatureCollection' && Array.isArray(data.features)
          : data && typeof data==='object' && !Array.isArray(data) && (data.states || Number.isFinite(data.total_sites));
        if(valid)await cache.put(request,response.clone());
      } catch { /* Invalid provider responses never replace a saved snapshot. */ }
    }
    return response;
  }).catch(()=>null);
  if(cached) {event.waitUntil(update);return cached;}
  return await update || new Response(JSON.stringify({error:'This area has not been saved offline.'}),{status:503,headers:{'Content-Type':'application/json'}});
}
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
