# KampTrail — PWA & Map Hardening (Drop-in Addendum)

## Why KampTrail
Fastest offline-first campsite map. Installable PWA, efficient clustering, and map-tiles caching for field reliability.

## Install
1) Open https://<your-domain>/ on mobile → **Add to Home Screen**.  
2) First run caches app shell; subsequent loads work offline.

## Offline Behavior
- Precached: app shell (HTML, manifest, icons) and share images.  
- Runtime cached: pages, static assets, images, map tiles (7 days, max 300 entries).  
- Updates: You’ll see a “New version ready” toast; tap **update now** to refresh.

## Development
- No build step required. Static deploy: GitHub Pages / Cloudflare Pages / S3+CF.
- Lighthouse CI runs on PRs; keep **PWA ≥ 0.90**, **Performance ≥ 0.90**.

## Data & Attribution
- Tiles: OpenStreetMap by default. Consider a provider key for production traffic.
- Data sources must be properly licensed and attributed.

## Contributing
- Keep HTML semantic and accessible (tap targets ≥ 44px, focus styles on).
- Run Lighthouse locally (Chrome DevTools) before PRs.
