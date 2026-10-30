# KampTrail 2.17.0

KampTrail is a free campsite map and trip planner at https://kamptrail.com/. No account is required for the core camping tools or moderated contributions.

Service discovery shares category and access rules across the map, nearby results and route corridor. Expanded showers, laundry, groceries and fuel coverage begins with a complete dated Utah extract; other regions retain older dump, water-fill and LPG data. Source dates and partial/offline coverage remain explicit. Overnight permission and RV access are separate, unverified facts.

## Features

- Search US cities, states, coordinates and campsite names; load state listings only when zoomed in. Saved stops, shared links, map filters and route discovery use the same source-aware catalogue.
- Camping fees remain free, free with conditions, paid or unknown. Unknown never means free. Full source wording, agency record IDs, retrieval dates and available source-update dates can be inspected from a popup; conflicting sources remain unknown.
- Filter by fee, campsite type, RV length and hookups from individual Recreation.gov campsites, reported amenities and rig types. Missing suitability data never silently matches; undocumented RV lengths can be included explicitly.
- Minimum/maximum terrain elevation in feet or metres, using coordinate-matched USGS 3DEP samples. Map and route filters agree; missing elevations stay unknown. Validated, dated state samples can be reused offline.
- Published camper rating/review-count filters and same-visit approach, noise, shade, crowding, personal comfort and carrier-signal reports. Moderated reviews/photos support author editing/removal and dated offline aggregates. Carrier observations are distinct from modeled coverage.
- Standard OpenStreetMap, USGS Topo and satellite basemaps; BLM public-land context; USFS motor-vehicle road designations, vehicle/season details and district source links.
- Opt-in, dated NIFC fire perimeters and NOAA satellite smoke plumes; on-demand NWS point alerts and forecast/elevation checks. These are context, not an evacuation, closure, AQI or emergency-notification service. Dynamic hazards require a connection.
- OSM dump stations, tagged water points and propane; nearest-service discovery from campsite popups.
- Ordered saved stops, dates, notes, GPX import/export, road geometry and along-route campsite discovery. Requested drive times/detours use the OSRM car router and are not checked for RV dimensions or road conditions.
- One local rig profile with separate campsite-fit and travel dimensions, campsite matching preferences, previewed JSON import and export. Metric dimensions preserve fractional-foot matching; travel dimensions remain reference values.
- Explicitly requested USGS terrain samples along a calculated car route, with source dates, unknown gaps, an accessible selector/table and exact-route offline reuse. Ground terrain does not establish road grade, bridge/tunnel height, clearance or RV suitability.
- Save selected USGS Topo areas offline. The app shell, previously visited listings, saved stops, cached routes and eligible dated camper aggregates remain available when browser storage permits. Name search must first load its index online. OpenStreetMap standard tiles are not bulk saved.
- First-party corrections/new-place proposals and a private status link, with moderator review. GitHub issue forms remain a fallback.

The catalogue combines Recreation.gov, USFS, BLM and OpenStreetMap source records, with uneven coverage and source dates. Listings are not field inspections. Agency fees, access, seasonal closures, location certainty and RV suitability are separate facts. A public-land boundary does not grant camping permission. The source-import and coverage checks are documented in [the free-camping audit](docs/FREE_CAMPING_AUDIT_2026-10-29.md).

## Remaining work

Modeled FCC coverage is blocked on actual provider access. Enforced RV-restriction routing, wider service/permission evidence and community/media depth remain separate packages. Accounts/social messaging, cross-device synchronization, notifications, native navigation and full video uploads are not implemented. Versioned features in this source tree are not evidence of deployment; release and live-verification gates remain in [the active parity queue](docs/replica/parity-queue.md). Existing historical parity scores do not establish current full-product parity.

The [rig and route-terrain contract](docs/RIG_TERRAIN_CONTRACT_2.17.md) describes local profile data, explicit coordinate disclosure, bounded sampling, private server caches and offline limits.

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
