# KampTrail MVP 2.2.0

The MVP is the live campsite finder, not a ZIP requiring the owner to deploy it.

## Acceptance scope

- Search cities, states, coordinates and campsite names nationally.
- Map, list, active filters and result counts agree.
- Reported fee and campsite type filters persist between visits.
- Details show GPS, reported access, source/operator link, Save stop and Google Maps directions.
- Saved stops persist on this device and support reopen, directions, remove and clear on desktop/mobile.
- Cached saved locations and previously loaded areas remain available offline. Map imagery needs internet.
- Existing cached installations update automatically, without manual browser-cache clearing.
- No API-key setup, disabled optional controls, comparison, GPX, photo, service POI, advanced-filter or extra-basemap features in the active interface.

The initial catalogue contains 1,774 source-supported campsite candidates. It is screened for direct camping evidence and excludes clear noncamping/private/prohibited/closed records. This is not a current field inspection. Fees/access/operating status still need operator confirmation.

## Verification before deployment

- 44 Node regression tests passed.
- 12 Python source/workflow tests passed.
- 15 Chromium workflow tests passed, including national search outside loaded states, persistent basic filters, mobile saved stops and automatic upgrade from a stale service worker.
- All 1,774 national search entries resolve through their supporting state snapshots, with no unresolved IDs.
- Clean static build succeeded with only MVP runtime assets.

The subsequent live deployment smoke checks city search, national campsite search, GPS directions, saving, mobile controls, actual map imagery, failed requests and page errors. Screenshots are captured after deployment.

See [the FreeRoam source review](FREEROAM_TAKEAWAYS.md) for the product patterns applied to this release. Earlier repair documentation describes the broader prototype and is superseded by this MVP scope.
