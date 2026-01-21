// service-worker.js — KampTrail SW (dev-safe: never intercept 3rd-party tiles)
const VERSION = "kt-v18";

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

const STATIC_CACHE = "kt-static";
const DATA_CACHE = "kt-data";

// Install: cache shell (best-effort)
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(VERSION);
        await cache.addAll(SHELL);
      } catch (e) {
        // never block install
      }
      self.skipWaiting();
    })()
  );
});

// Activate: cleanup old versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        const keep = new Set([VERSION, STATIC_CACHE, DATA_CACHE]);
        await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      } catch (e) {
        // ignore
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;

  // 1) Navigation (HTML): network-first with cached fallback
  if (req.mode === "navigate") {
    event.respondWith(safeRespond(networkFirstHTML(req)));
    return;
  }

  // 2) Never touch cross-origin (THIS FIXES OSM TILE FAILURES + ORB issues)
  if (!isSameOrigin) return;

  // 3) Same-origin static assets: stale-while-revalidate
  if (/\.(?:js|css|png|svg|webp|jpg|jpeg|ico)$/.test(url.pathname)) {
    event.respondWith(safeRespond(staleWhileRevalidate(req, STATIC_CACHE)));
    return;
  }

  // 4) Same-origin data files: stale-while-revalidate
  //    This protects /data/*.json + /data/*.geojson from hiccups
  if (/\.(?:json|geojson)$/.test(url.pathname)) {
    event.respondWith(safeRespond(staleWhileRevalidate(req, DATA_CACHE)));
    return;
  }

  // Otherwise: browser handles it
});

async function safeRespond(p) {
  try {
    const res = await p;
    return res || new Response("", { status: 504 });
  } catch {
    return new Response("", { status: 504 });
  }
}

async function networkFirstHTML(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const net = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    try {
      const cache = await caches.open(VERSION);
      cache.put("index.html", net.clone()).catch(() => {});
      cache.put(request, net.clone()).catch(() => {});
    } catch {}

    return net;
  } catch {
    clearTimeout(timer);

    try {
      const cache = await caches.open(VERSION);
      const cached = (await cache.match(request)) || (await cache.match("index.html"));
      if (cached) return cached;
    } catch {}

    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetching = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached || new Response("", { status: 504 }));

  return cached || fetching;
}

// Allow page to force update
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
