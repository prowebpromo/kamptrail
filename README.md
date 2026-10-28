# KampTrail 2.3.0

KampTrail is a free, no-account campsite map at https://prowebpromo.github.io/kamptrail/.

## Features

- Search US cities, states, coordinates, and all saved campsite listings nationally. Map, list, and counts stay in sync.
- Filter by reported fee, campsite type, reported rig type (tents, trailers), and reported amenities. Missing data never counts as a match.
- Basemaps: standard (OpenStreetMap), topo and satellite (USGS National Map).
- Public land layer (BLM Surface Management Agency) with a legend.
- Long-press (or right-click) anywhere to check a spot: GPS, land manager, the agency's stay-limit guidance, NWS forecast and elevation, save, share, directions, and "Suggest a campsite here."
- RV services layer: OSM dump stations and propane, plus tagged water fill points once the weekly data refresh runs. Each campsite popup can show the nearest of each.
- Campsite popups: source/operator link, directions, share link (`#site=`), forecast and elevation, land manager, and "Suggest a fix."
- Trips: saved stops with reorder, notes, arrive/leave dates, straight-line miles and planned nights, a route line, whole-trip Google Maps directions split into legs within Google's waypoint limits, and GPX export/import.
- Offline: the app shell, city search, previously loaded listings, services, and saved stops work after an online visit. Map imagery, forecasts, land lookups, and directions need internet.

Corrections and new campsites go through GitHub issue forms (`.github/ISSUE_TEMPLATE`), prefilled from the app. A free GitHub account is required.

The national catalogue has 1,774 source-supported campsite candidates. Clear offices, picnic/day-use facilities, lodging-only sites, and explicit private/prohibited/closed records are excluded. Missing prices remain unknown. These are source snapshots with uneven coverage, not field verification. Public land boundaries do not grant permission to camp.

## Not included

Accounts, reviews, photos, forums, cell coverage overlays, rig-length filtering, and drive-time routing are not in this release. Reviews and photos need a backend and moderation. Rig length needs a campsite-level data source. See the parity report in [docs/replica](docs/replica/parity.md).

## Run and test

Node.js 22 or later:

```sh
npm ci
npm start
```

Open http://127.0.0.1:8765/. The local server also supports `/kamptrail/` for GitHub Pages project-path testing.

```sh
npm test
python3 -m pip install -r requirements.txt pyyaml
npm run test:python
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

The build regenerates the national campsite-name index and creates `dist/kamptrail/` with only active MVP assets and necessary data/license files. Browser regressions isolate remote tiles; deployment verification checks the real live page and imagery.

## Updates

One reusable GitHub workflow refreshes source snapshots, rebuilds merged state files and national search, and serializes writes. Its weekly schedule is Sunday at 03:00 UTC. Failed/partial/empty source pulls preserve existing useful source files. RIDB uses repository secrets; no visitor needs an API key. See [source provenance](scripts/DATA_PROVENANCE.md).

The service worker preserves saved data, refreshes source snapshots online, and automatically reloads once when replacing an older cached app. Bump its version for application changes.

Code: MIT. Data and browser libraries retain their respective licenses. See [data credits](DATA_SOURCES.md).

## Clarity and integration update (2.2.1)

The app explains its core task immediately and includes an accessible About the data dialog with live catalogue counts, sources, missing snapshot dates, fee/access limits, and device/offline behavior. It keeps the MVP tool set unchanged.

The Boondock or Bust page is published at https://boondockorbust.com/resources/kamptrail-campsite-map/ and linked from the Resources menu as **KampTrail Map**. The apps article now describes the current MVP, and the free/cheap campsite guide and Useful Links page link to it. Desktop embed checks passed for Albany, NY search, saving a stop across reload, and directions coordinates. WordPress mobile rendering and Near me permission behavior have not been verified. Integration markup and the publication record are in [`integrations/boondock-or-bust/`](integrations/boondock-or-bust/). The real-RVer session protocol is [`docs/USABILITY_TASKS.md`](docs/USABILITY_TASKS.md); human sessions have not yet been conducted.
