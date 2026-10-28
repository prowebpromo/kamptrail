# KampTrail

A static camping map with US city search, campsite listings, protected-land access imagery, service locations, comparison, saved trip stops, and GPX import/export.

## Run locally

Node.js 22 or later:

```sh
npm ci
npm start
```

Open http://127.0.0.1:8765/. The app also works at http://127.0.0.1:8765/kamptrail/ for testing the GitHub Pages project path.

For a static release, serve the extracted folder over HTTP rather than opening `index.html` directly. Python is also sufficient:

```sh
python3 -m http.server 8000
```

On Windows, use `py -m http.server 8000` if Python was installed with the launcher.

## What works

- Leaflet map and bundled browser dependencies, without a required script CDN.
- Local search across 7,557 US places, loaded campsite names, states, and latitude/longitude pairs. Smaller places absent from GeoNames cities5000 can still be reached by coordinates or the map.
- State snapshots, marker clustering, filter vocabulary aligned with source tags, retryable downloads, and map/list result counts.
- Stable source identifiers, duplicate cleanup, and source links where recoverable.
- Unknown fees are displayed as unknown. Unsupported legacy price, water, road, and vehicle-access guesses are hidden.
- Standard, topographic, satellite, and terrain basemaps. The USGS PAD-US 3.0 layer shows protected-land access classes. It is an overview of public and private protected lands, not a camping-permission map.
- Community campsite snapshots from the actual state files rather than the former empty combined file.
- Saved trip and comparison snapshots that remain usable when another map region is open.
- Namespaced GPX import, separate track segments, saved waypoint export, and directions links.
- Offline app shell, city search, saved trip details, and previously loaded campsite areas after an online visit. Basemap tiles, land imagery, directions, and photos require internet. Browsers can evict cached data, so export important trip stops as GPX.

## Data limits

This is a repaired version of the current KampTrail static app. It does not provide all of FreeRoam's original backend services, community accounts, reviews, or downloadable offline basemaps. FreeRoam's original frontend depends on its separate `back-roads` backend, so the frontend repository alone cannot restore those services.

Source snapshots have incomplete and uneven coverage. Older RIDB camping-activity pulls can include recreation facilities other than overnight campgrounds, and state bounding boxes can include neighboring areas. A listing does not establish legal overnight access, current availability, potable water, rig clearance, or an operating campground. Confirm those details with the operator.

The repair preserves historical source files and does not claim to have refreshed or field-verified every listing. Legacy inferred attributes remain available for diagnosis but are not displayed as facts. See [DATA_SOURCES.md](DATA_SOURCES.md) and [scripts/DATA_PROVENANCE.md](scripts/DATA_PROVENANCE.md).

Cell towers are disabled until an OpenCelliD provider key is configured. A tower location does not predict campsite signal or carrier coverage. Nearby Wikimedia Commons photos link to original file pages and available author/license information. Photos within the search radius may depict another nearby location.

## Test and build

```sh
npm test
python3 -m pip install -r requirements.txt pyyaml
npm run test:python
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

`npm run build` creates `dist/kamptrail/`, containing only the static app assets, necessary snapshot files, and license notices. The optional `CHROMIUM_PATH` environment variable can select an existing Chromium binary for tests.

Browser regressions use real committed campsite/city snapshots while isolating optional remote imagery for repeatability. Live provider checks and desktop/mobile screenshots are recorded in [docs/REPAIR_2026-10-27.md](docs/REPAIR_2026-10-27.md). Automated checks run on pull requests and main-branch pushes.

## Refresh and deployment

GitHub Pages serves this repository at https://prowebpromo.github.io/kamptrail/. The static release can also run on another HTTPS host. All asset and dataset paths are relative to the app directory.

One reusable workflow owns dataset refreshes and serializes writes. Its existing weekly schedule is Sunday at 03:00 UTC. Manual state/source workflows call the same owner. Failed, partial, invalid, or empty source fetches preserve saved data. Successful fetches rebuild the visible merged snapshots and the aggregate index. RIDB uses the repository secret `RECREATION_GOV_API_KEY` or `RIDB_API_KEY`. No embedded fallback key is used. No data refresh was run during this repair.

When modifying application files, bump the version in `service-worker.js`. The app automatically reloads once when a previous worker is replaced, so existing installations switch to the new bundled shell. The worker preserves visited data and does not delete caches belonging to neighboring apps.

Code: MIT. Third-party libraries and datasets retain their respective licenses.
