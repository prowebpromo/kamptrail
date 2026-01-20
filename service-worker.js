// service-worker.js — KampTrail SW (safe with 3rd-party tiles)
// BUMP VERSION to force a fresh install whenever you change shell files.
const VERSION = 'kt-v16';

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

// ------- Install: cache app shell -------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL))
  );
});

// ------- Activate: clean old caches -------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Helper: is OSM base tile (we allow caching these only)
const isOsmTile = (url) =>
  url.origin === 'https://tile.openstreetmap.org';

// ------- Fetch strategy matrix -------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) HTML navigation: Network First (4s timeout) with cached fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // 2) OSM base tiles ONLY: Cache First with small cap
  if (isOsmTile(url)) {
    event.respondWith(cacheFirstTiles(request));
    return;
  }

  // 3) Same-origin static assets (JS/CSS/PNG/SVG/WEBP/JPG/ICO): Stale-While-Revalidate
  //    IMPORTANT: skip cross-origin assets to avoid OpaqueResponseBlocking
  const isStatic = /\.(?:js|css|png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname);
  const isSameOrigin = url.origin === self.location.origin;

  if (isStatic && isSameOrigin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Otherwise: do nothing — let the browser handle it (prevents ORB on 3rd-party tiles)
});

// ------- Strategies -------
async function networkFirstHTML(request) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  try {
    const net = await fetch(request, { signal: controller.signal });
    clearTimeout(t);
    const cache = await caches.open(VERSION);
    cache.put('index.html', net.clone()); // keep index fresh
    return net;
  } catch {
    clearTimeout(t);
    const cache = await caches.open(VERSION);
    return (await cache.match('index.html')) || Response.error();
  }
}

async function cacheFirstTiles(request) {
  const cache = await caches.open('kt-tiles');
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;

  const res = await fetch(request, { mode: 'cors' });
  // For cross-origin tiles, the response may be opaque; just cache the entry without reading.
  if (res && res.ok) {
    try { await cache.put(request, res.clone()); } catch {}
    // Trim oldest
    const keys = await cache.keys();
    const LIMIT = 400; // ~a few metro areas worth
    if (keys.length > LIMIT) await cache.delete(keys[0]);
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open('kt-static');
  const cached = await cache.match(request, { ignoreSearch: true });

  const fetching = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);

  return cached || fetching;
}

// Allow page to force an update (index shows a toast)
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
