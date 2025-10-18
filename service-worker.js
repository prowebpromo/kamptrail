// service-worker.js — KampTrail SW
const VERSION = 'kt-v7';
const SHELL = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'og.png',
  'overlays/overlays-advanced.css',
  'overlays/overlays-advanced.js',
  'data-loader.js',
  'filters.js',
  'trip-planner.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const isTile = (url) => url.origin === 'https://tile.openstreetmap.org';

self.addEventListener('fetch', (e) => {
  const { request } = e;

  // HTML pages: NetworkFirst with 4s timeout + cached fallback
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
      } catch {
        clearTimeout(t);
        const cache = await caches.open(VERSION);
        return (await cache.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // OSM tiles: CacheFirst with size cap
  if (isTile(new URL(request.url))) {
    e.respondWith((async () => {
      const cache = await caches.open('kt-tiles');
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request, { mode: 'cors' });
      if (res.ok) {
        await cache.put(request, res.clone());
        const keys = await cache.keys();
        if (keys.length > 400) await cache.delete(keys[0]); // trim oldest
      }
      return res;
    })());
    return;
  }

  // Static assets: Stale-While-Revalidate
  if (/\.(?:js|css|png|svg|webp|jpg|jpeg|ico)$/.test(request.url)) {
    e.respondWith((async () => {
      const cache = await caches.open('kt-static');
      const cached = await cache.match(request);
      const fetcher = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetcher;
    })());
  }
});

// Allow page to force an update (index shows a toast)
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
