// service-worker.js — KampTrail SW (SAFE MODE)
// Goal: never break map tiles or cross-origin requests.
// Bump VERSION any time you change cached files.
const VERSION = 'kt-v17-safe';

const SHELL = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'og.png',
  'overlays/overlays-advanced.css',
  'overlays/overlays-advanced.js',
  'overlays/overlays.css',
  'overlays/overlays.js',
  'data-loader.js',
  'data-quality.js',
  'filters.js',
  'trip-planner.js',
  'gpx-importer.js',
  'campsite-compare.js',
  'google-places-service.js'
];

// --- INSTALL: cache app shell ---
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

// --- ACTIVATE: remove old caches ---
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== VERSION ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// --- FETCH: SAFE ROUTING ---
// Key rule: Never intercept cross-origin requests (OSM tiles, Mapbox, Google, etc.)
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  const isSameOrigin = url.origin === self.location.origin;

  // 1) HTML navigation: network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // 2) Never touch cross-origin requests
  if (!isSameOrigin) {
    return; // browser handles it (prevents ORB, tile failures, etc.)
  }

  // 3) Same-origin static assets: stale-while-revalidate
  const isStatic = /\.(?:js|css|png|svg|webp|jpg|jpeg|ico|json|geojson)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 4) Everything else same-origin: just pass through
  // (No respondWith = no chance to break anything)
});

// --- Strategies ---
async function networkFirstHTML(request) {
  const cache = await caches.open(VERSION);

  try {
    const net = await fetch(request);
    if (net && net.ok) {
      cache.put('index.html', net.clone());
    }
    return net;
  } catch (err) {
    const cached = await cache.match('index.html');
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// Allow page to force SW update
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
