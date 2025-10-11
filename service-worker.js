// service-worker.js — KampTrail SW (vanilla)
const VERSION = 'kt-v3';

// IMPORTANT for GitHub Pages: use RELATIVE paths
const SHELL = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'og.png', 'overlays/overlays-advanced.css', 'overlays/overlays-advanced.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const isTile = (url) => url.origin === 'https://tile.openstreetmap.org';

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // HTML: NetworkFirst with 4s timeout + cached fallback
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      try {
        const net = await fetch(request, { signal: controller.signal });
        clearTimeout(t);
        const cache = await caches.open(VERSION);
        cache.put(request, net.clone());
        return net;
      } catch (err) {
        clearTimeout(t);
        const cache = await caches.open(VERSION);
        return (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Map tiles: CacheFirst with size cap
  if (isTile(url)) {
    e.respondWith((async () => {
      const cache = await caches.open('kt-tiles');
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request, { mode: 'cors' });
      if (res.ok) {
        await cache.put(request, res.clone());
        const keys = await cache.keys();
        const LIMIT = 400; // ~few metro areas
        if (keys.length > LIMIT) await cache.delete(keys[0]);
      }
      return res;
    })());
    return;
  }

  // Static assets (same-origin): Stale-While-Revalidate
  if (url.origin === self.location.origin && /\.(?:js|css|png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open('kt-static');
      const cached = await cache.match(request);
      const fetcher = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetcher;
    })());
    return;
  }

  // Optional: cache same-origin data files if you add /data/* later
  if (url.origin === self.location.origin && /\/data\/(places|pois)\/.+\.geojson$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open('kt-data');
      const cached = await cache.match(request);
      const fetcher = fetch(request).then(res => { if(res.ok) cache.put(request, res.clone()); return res; }).catch(()=>cached);
      return cached || fetcher;
    })());
    return;
  }
});

// Allow page to force an update (your index shows a toast)
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
