// service-worker.js — KampTrail SW (safe with 3rd-party tiles)
// BUMP VERSION to force a fresh install whenever you change shell files.
const VERSION = 'kt-v15';

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
  'filters.js',
  'trip-planner.js',
  'gpx-importer.js',
  'campsite-compare.js'
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

    if (!net.ok) {
      throw new Error(`HTTP ${net.status}: ${net.statusText}`);
    }

    const cache = await caches.open(VERSION);
    // Clone before caching to avoid issues
    try {
      await cache.put('index.html', net.clone());
    } catch (cacheErr) {
      console.warn('[SW] Failed to cache index.html:', cacheErr.message);
    }
    return net;
  } catch (err) {
    clearTimeout(t);

    // Log specific error types for debugging
    if (err.name === 'AbortError') {
      console.warn('[SW] Network request timed out after 4s, using cache');
    } else if (err.message && err.message.includes('fetch')) {
      console.warn('[SW] Network fetch failed:', err.message);
    } else {
      console.warn('[SW] Request failed, using cache:', err.message);
    }

    try {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('index.html');
      if (cached) {
        return cached;
      }
    } catch (cacheErr) {
      console.error('[SW] Failed to retrieve from cache:', cacheErr.message);
    }

    return Response.error();
  }
}

async function cacheFirstTiles(request) {
  try {
    const cache = await caches.open('kt-tiles');
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;

    let res;
    try {
      res = await fetch(request, { mode: 'cors' });
    } catch (fetchErr) {
      console.warn('[SW] Tile fetch failed:', fetchErr.message);
      // Return a placeholder or error response for failed tile
      return new Response('', { status: 503, statusText: 'Tile unavailable' });
    }

    // For cross-origin tiles, the response may be opaque; cache if valid
    if (res && (res.ok || res.type === 'opaque')) {
      try {
        await cache.put(request, res.clone());

        // Trim oldest entries to maintain cache size
        const keys = await cache.keys();
        const LIMIT = 400; // ~a few metro areas worth
        if (keys.length > LIMIT) {
          try {
            await cache.delete(keys[0]);
          } catch (delErr) {
            console.warn('[SW] Failed to delete old tile:', delErr.message);
          }
        }
      } catch (cacheErr) {
        console.warn('[SW] Failed to cache tile:', cacheErr.message);
      }
    } else if (!res) {
      console.error('[SW] Tile response is null');
      return new Response('', { status: 503, statusText: 'Tile unavailable' });
    }

    return res;
  } catch (err) {
    console.error('[SW] Error in cacheFirstTiles:', err.message);
    return new Response('', { status: 500, statusText: 'Service Worker error' });
  }
}

async function staleWhileRevalidate(request) {
  try {
    const cache = await caches.open('kt-static');
    const cached = await cache.match(request, { ignoreSearch: true });

    const fetching = fetch(request).then((res) => {
      if (res && res.ok) {
        try {
          cache.put(request, res.clone());
        } catch (cacheErr) {
          console.warn('[SW] Failed to cache static asset:', cacheErr.message);
        }
      } else if (res && !res.ok) {
        console.warn(`[SW] Static asset fetch returned ${res.status} for ${request.url}`);
      }
      return res;
    }).catch((fetchErr) => {
      console.warn('[SW] Static asset fetch failed:', fetchErr.message);
      return cached;
    });

    return cached || fetching;
  } catch (err) {
    console.error('[SW] Error in staleWhileRevalidate:', err.message);
    // Try to fetch directly as fallback
    try {
      return await fetch(request);
    } catch (fetchErr) {
      return Response.error();
    }
  }
}

// Allow page to force an update (index shows a toast)
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
