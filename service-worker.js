// service-worker.js — KampTrail SW (safe with 3rd-party tiles)
// BUMP VERSION to force a fresh install whenever you change shell files.
const VERSION = "kt-v17";

// App shell files (same-origin only)
const SHELL = [
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "og.png",
  "overlays/overlays-advanced.css",
  "overlays/overlays-advanced.js",
  "overlays/overlays.css",
  "overlays/overlays.js",
  "data-loader.js",
  "data-quality.js",
  "filters.js",
  "trip-planner.js",
  "gpx-importer.js",
  "campsite-compare.js",
  "google-places-service.js",
];

// Separate cache names
const STATIC_CACHE = "kt-static";
const TILES_CACHE = "kt-tiles";

// Helper: is OSM base tile
function isOsmTile(url) {
  return url.origin === "https://tile.openstreetmap.org";
}

// Helper: treat these as “static assets”
function isStaticAsset(url) {
  return /\.(?:js|css|png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname);
}

// ------- Install: cache app shell -------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(VERSION);
        await cache.addAll(SHELL);
      } catch (err) {
        // Never fail install; allow SW to install even if caching shell has issues
      }
      // Activate the new SW as soon as possible
      self.skipWaiting();
    })()
  );
});

// ------- Activate: clean old caches -------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        const keep = new Set([VERSION, STATIC_CACHE, TILES_CACHE]);
        await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      } catch (err) {
        // ignore
      }
      await self.clients.claim();
    })()
  );
});

// ------- Fetch strategy matrix -------
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests. Let the browser handle everything else.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;

  // 1) HTML navigation: Network First (4s timeout), cached fallback
  if (request.mode === "navigate") {
    event.respondWith(safeRespond(networkFirstHTML(request)));
    return;
  }

  // 2) OSM base tiles: Cache First with cap, never reject
  if (isOsmTile(url)) {
    event.respondWith(safeRespond(cacheFirstTiles(request)));
    return;
  }

  // 3) Same-origin static assets: Stale-While-Revalidate
  if (isSameOrigin && isStaticAsset(url)) {
    event.respondWith(safeRespond(staleWhileRevalidate(request)));
    return;
  }

  // Otherwise: do nothing, let the browser handle it.
  // This prevents ORB issues on cross-origin resources.
});

// Wrapper: guarantees respondWith never gets a rejected promise
async function safeRespond(promise) {
  try {
    const res = await promise;
    if (res) return res;
    return new Response("", { status: 504, statusText: "No response" });
  } catch (err) {
    return new Response("", { status: 504, statusText: "SW fetch failed" });
  }
}

// ------- Strategies -------

// Network first for HTML navigation with cached fallback
async function networkFirstHTML(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const net = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    try {
      const cache = await caches.open(VERSION);
      // Keep index fresh. Use the actual request URL when possible.
      // Also store under "index.html" for fallback.
      cache.put(request, net.clone()).catch(() => {});
      cache.put("index.html", net.clone()).catch(() => {});
    } catch {
      // ignore cache errors
    }

    return net;
  } catch (err) {
    clearTimeout(timer);

    try {
      const cache = await caches.open(VERSION);
      const cached =
        (await cache.match(request)) ||
        (await cache.match("index.html"));

      if (cached) return cached;
    } catch {
      // ignore
    }

    return new Response("", { status: 504, statusText: "Offline" });
  }
}

// Cache first for tiles with capped cache size
async function cacheFirstTiles(request) {
  const cache = await caches.open(TILES_CACHE);

  // Use exact request match for tiles
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    // IMPORTANT: do NOT force mode:'cors' or anything.
    // Tile requests are often 'no-cors' in practice.
    const res = await fetch(request);

    // Cache successful OR opaque responses (opaque often has status 0)
    if (res) {
      try {
        await cache.put(request, res.clone());
      } catch {
        // ignore cache put failures
      }

      // Trim oldest entries
      try {
        const keys = await cache.keys();
        const LIMIT = 400;
        if (keys.length > LIMIT) await cache.delete(keys[0]);
      } catch {
        // ignore trim failures
      }
    }

    return res;
  } catch (err) {
    // Never reject respondWith
    const fallback = await cache.match(request);
    if (fallback) return fallback;

    // Empty 504 response is better than a rejected promise
    return new Response("", { status: 504, statusText: "Tile fetch failed" });
  }
}

// Stale-while-revalidate for same-origin static assets
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);

  const cached = await cache.match(request);

  const fetching = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => cached || new Response("", { status: 504, statusText: "Fetch failed" }));

  return cached || fetching;
}

// Allow page to force an update (index shows a toast)
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
