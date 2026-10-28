# KampTrail MVP 2.2.1

KampTrail is a campsite finder at https://prowebpromo.github.io/kamptrail/.

## Included in the MVP

- Search US cities, states, coordinates, and all saved campsite listings nationally.
- Browse the same results on a clustered map and a nearby campsite list.
- Filter by reported fee and campsite type. Filters and map position persist on this device.
- See campsite coordinates, reported access, and source/operator links.
- Save named stops on this device, reopen their locations, remove stops, and open Google Maps directions.
- Use cached city search, previously loaded campsite listings, and saved stops after an online visit. Basemap imagery and external directions need internet.

The initial national catalogue has 1,774 source-supported campsite candidates. The runtime map and national search use the same screening. Clear offices, picnic/day-use facilities, lodging-only sites, and explicit private/prohibited/closed records are excluded. General recreation-activity records without direct campsite evidence are withheld from the MVP. Missing prices remain unknown.

These are source snapshots with uneven coverage, not field verification of current opening status, fees, access, road clearance, or water. A city search is not a promise that listings exist in every locality. The city index contains 7,557 places; smaller destinations can be reached by map or coordinates. Hawaii currently has no saved campsite records.

## Deferred from this release

Comparison, GPX import/export, nearby photos, cell coverage/towers, service POIs, public-land overlays, alternate basemaps, user accounts/reviews, advanced rig/road/rating filters, and route optimization are outside the MVP. Their old code remains recoverable in repository history. The live interface has no setup-dependent controls or placeholder features.

The MVP focuses on campsite discovery and saved locations. It does not claim feature parity with FreeRoam. See [FreeRoam source-review takeaways](docs/FREEROAM_TAKEAWAYS.md).

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

Boondock or Bust integration markup and publication instructions are in [`integrations/boondock-or-bust/`](integrations/boondock-or-bust/). This is prepared markup, pending authenticated WordPress publication and theme verification. The real-RVer session protocol is [`docs/USABILITY_TASKS.md`](docs/USABILITY_TASKS.md); human sessions have not yet been conducted.
