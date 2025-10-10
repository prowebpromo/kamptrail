/* eslint-disable no-restricted-globals */
/**
 * KampTrail Service Worker (build-less)
 * Strategy: Precache app shell + runtime caching for pages/assets/map tiles.
 * Workbox CDN: v6.5.4
 */
// Import Workbox from CDN
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Ensure Workbox loaded
if (!self.workbox) {
  console.warn('Workbox failed to load. Falling back to a very simple SW.');
} else {
  const {precacheAndRoute} = workbox.precaching;
  const {registerRoute} = workbox.routing;
  const {CacheFirst, StaleWhileRevalidate, NetworkFirst} = workbox.strategies;
  const {ExpirationPlugin} = workbox.expiration;
  const {setCacheNameDetails} = workbox.core;

  setCacheNameDetails({prefix: 'kamptrail', suffix: 'v1'});

  // Precache static app shell (EDIT: keep list short; update upon deploy)
  // You can add more assets as needed; revision strings bust caches.
  precacheAndRoute([
    {url: '/', revision: '1'},
    {url: '/index.html', revision: '1'},
    {url: '/manifest.json', revision: '1'},
    {url: '/icon-192.png', revision: '1'},
    {url: '/icon-512.png', revision: '1'},
    {url: '/og.png', revision: '1'}
  ]);

  // HTML documents: try network, fallback to cache quickly
  registerRoute(
    ({request}) => request.destination === 'document',
    new NetworkFirst({ cacheName: 'kt-pages', networkTimeoutSeconds: 4 })
  );

  // Static assets (CSS/JS/Workers)
  registerRoute(
    ({request}) => ['style','script','worker'].includes(request.destination),
    new StaleWhileRevalidate({ cacheName: 'kt-assets' })
  );

  // Images (icons, screenshots)
  registerRoute(
    ({request}) => request.destination === 'image',
    new StaleWhileRevalidate({
      cacheName: 'kt-images',
      plugins: [new ExpirationPlugin({maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14})]
    })
  );

  // Map tiles (OSM/MapTiler/etc.)
  registerRoute(
    ({url, request}) => request.destination === 'image' && /tile|tiles|osm|mt1|maptiler|tile\.openstreetmap/.test(url.href),
    new CacheFirst({
      cacheName: 'kt-map-tiles',
      plugins: [new ExpirationPlugin({maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7})]
    })
  );
}

// Update flow: allow page to trigger skipWaiting
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Fallback very-simple fetch if Workbox missing
self.addEventListener('fetch', (event) => {
  if (self.workbox) return; // Workbox handles routing
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
