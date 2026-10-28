# KampTrail vs Free Roam: parity report

Date: 2026-10-28. Compared against the Free Roam open-source frontend (github.com/FreeRoamApp/free-roam), by source inspection. Free Roam went offline in early 2024, so there was no live app to screenshot. No layout diff was run.

## Scores

| | Before (2.2.1) | After (2.3.0) |
| --- | --- | --- |
| Feature parity (weighted must 3, should 2, could 1) | 42.5 | 67.3 |
| Must-haves done | 10 of 13 | 12 of 13 |

Full matrix: [features.csv](features.csv). Scored output: [parity-score.md](parity-score.md).

The remaining must-have is partial: the water side of "dump, water, propane." The old water points were Recreation.gov campgrounds tagged by keyword, so they were dropped. OSM water fill points (`amenity=water_point`, `waterway=water_point`) are now fetched by the weekly data workflow. The layer shows them after its next run.

## Left out on purpose

Accounts, friends, DMs, groups, forum, notifications, donations, and the product guide. These are Free Roam's community and business layers. KampTrail stays no-account. Turn-by-turn navigation hands off to Google Maps, as Free Roam's web app did.

## Still missing, in build order

1. Water fill points: run the data workflow once (manual dispatch) to populate.
2. Rig length filter: needs campsite-level max vehicle length. RIDB campsite attributes carry it. Requires extending the RIDB fetcher (API key already in Actions secrets).
3. Reviews and star ratings: needs a backend, moderation, and abuse handling. Biggest remaining gap and the most expensive.
4. Find places along a route: needs a routing service. A free public OSRM server is not for production load.
5. Cell coverage overlay: no free, keyless national tile source verified. The FCC map has no public tile API that was confirmed here.
6. Drive time on trip totals: needs routing (same as 4). Totals are straight-line and labeled so.

## Behaviour differences

| Flow | Free Roam | KampTrail 2.3.0 | Keep or fix |
| --- | --- | --- | --- |
| Check land at a point | Tap map, server lookup | Long-press or right-click, BLM SMA query in the browser, plus agency stay-limit guidance | Keep. Fewer steps than the original |
| Trip directions | Server-side Mapbox routing | Google Maps handoff, split into legs that fit Google's 3 (mobile) or 9 (desktop) waypoint limit | Keep. Fixes the "11 stops" complaint seen in user research |
| Save a place | Needs an account | Saved on device, GPX export to move or back up | Keep. Matches the no-account positioning |
| Report a problem | Direct edit by logged-in users | GitHub issue form prefilled with the campsite | Fix later. A GitHub account is a barrier for non-technical campers |
| Weather | DarkSky (now shut down) | National Weather Service, US only | Keep |

## Verdict

Not yet shippable by the replica rule (one must-have partial). Shippable in practice once the data workflow runs and water points appear. The two bugs found during testing were fixed before release: an open campsite popup was re-rendered on every data update (erasing loaded forecast or land results), and removing a clicked popup button made Leaflet treat the click as a map click and close the popup.

## Tests

46 Node unit tests, 14 Python tests, 23 Playwright browser tests (7 new for 2.3.0). The new browser suite passed 35 of 35 on a 5x repeat. A live check against the real BLM, NWS, USGS, and OSM endpoints passed at 1440x900 and 390x844 with no page errors or failed requests. That is a point-in-time check, not an uptime guarantee.

## Update: 2.4.0

Feature parity 67.3 to 71.0. Added RV length and hookup filters (Recreation.gov RIDB bulk export, no key), on-demand drive times (FOSSGIS OSRM), and offline USGS Topo map areas. Fee status now comes from each source's own wording: US Forest Service and BLM recreation services, OpenStreetMap fee tags, and Recreation.gov fee text. Listings with free-camping evidence rose from 4 to 1,305 of about 15,700 loaded records in a full-data check on 2026-10-28.

The weekly OSM refresh had been failing with HTTP 406 because Overpass rejects the default Python client. The scripts now identify the app. Confirm on the next workflow run.

Most free sites still have no documented RV length (2 of 1,305). The finder says how many listings an RV length filter hides and offers to include them, labeled.
