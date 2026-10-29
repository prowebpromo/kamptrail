# KampTrail vs historical FreeRoam: fresh scope and feature audit

October 29, 2026. Current public app: KampTrail 2.8.1. Audited deployed source:
`3bc973ad3cd081d8359bff7c5c497882f0f44d75`.

**FCC is not the only gap.** It is the unfinished package from the last build plan.
It is not the sole obstacle to historical FreeRoam feature parity.

## Scores and what they mean

| Checklist | Current | FCC overlay complete | FCC overlay and signal filter complete |
| --- | ---: | ---: | ---: |
| Same 59 scored features as the previous report | 80.8 | 82.7 | 83.6 |
| Expanded 61 scored features in this audit | 79.4 | 81.2 | 82.1 |

All scores are out of 100. Must/should/could weights are 3/2/1. Partial earns half
credit. The original 107 weighted points yield 86.5 earned points. This pass adds
campsite videos and cell-tower location discovery, both advertised in the archived
developer description and absent from KampTrail. The expanded denominator is 109
with the same 86.5 earned points. No app regression caused the lower expanded score.

The expanded matrix has **13/13 scored must-haves complete**, **19 absent** rows and
**3 partial** rows. Six deliberate exclusions and 13 KampTrail-specific additions
are not scored. Completing the two FCC-related rows still leaves 20 incomplete
rows on the expanded checklist, or 18 on the old checklist.

These are reproducible checklist scores, not percentages of every FreeRoam feature,
data accuracy, customer satisfaction or production reliability. Several inherited
original-feature claims have not been independently corroborated. The matrix flags
that limitation instead of converting assumptions into verified historical facts.
No complete-product parity score or screenshot similarity score is established.

## Evidence used in this pass

- Re-read version 2 of the prior comparison archive. It records the independent
  2.4.1 audit, not the current app. Reconciled it with the subsequent 2.8.x repository
  matrix and reports rather than treating either old score as fresh proof.
- Pinned current source and checked the live release marker against it.
- Fresh live health check returned HTTP 200 with database/schema current and
  contribution, review/photo and routing services ready.
- Inspected live campsite filter and layer controls. No minimum-rating, road
  difficulty, elevation, forecast, camper-condition or carrier filter is exposed.
  No carrier, fire/smoke or cell-tower layer is exposed.
- Reviewed the implemented filters, reviews/photo schema, route modules and
  corresponding tests. An unused property or old test assertion is not a shipped
  feature. For example, the legacy root audit.spec.js mentions a tower control that
  is absent from the deployed map.
- Reused the latest completed release validation: 81 Node/PHP tests, 31 Python
  tests and 57 browser flows, plus MySQL integration and disposable backup restore.
  These tests were not rerun solely to produce this documentation. The FCC form's
  synthetic browser save is not a successful real FCC authentication test.
- Reopened the correct archived FreeRoam Foundation developer description and
  selected historical review pages. Original IDs: iOS 1434359242 and Android
  app.freeroam.main. Excluded unrelated contemporary storytelling apps with the
  same name.

The old iOS listing returned 404 and the original website could not be retrieved.
There was no matched original runtime, current original backend, comparable
same-state screenshot pair or fresh physical-phone offline test. Archived
descriptions establish advertised capability, not its historical reliability.

## The meaningful remaining gaps

| Area | What remains | What already exists |
| --- | --- | --- |
| Connectivity | Dated carrier/technology coverage, coverage-aware discovery, structured camper signal reports, cell-tower locations | Secure private credential intake. FCC authentication/access was denied. Support request was submitted; no real coverage geometry is published. |
| Community discovery | Minimum-rating filter, dated access/noise/shade/crowding observations, structured subscores and overnight-permission reports | Moderated overall star reviews, dated visits, rig text, photos, author edits, reports and removal. A general text review does not implement these structured features. |
| Road and RV context | Verified low-clearance hazards and avoidance, rig profile/preferences, approach-road difficulty, route elevation profile | Actual car-road route geometry, route corridor campsites, separately requested detours, official MVUM vehicle/season context. None establishes RV clearance or current passability. |
| Services and overnight stops | Broader showers/laundry/groceries/fuel discovery; stronger overnight-parking permission and operating-status evidence | Dump/water/propane points. Campground shower amenity filtering is not a separate nearby-shower directory. Overnight parking is a type, but inventory and permission evidence remain partial. |
| Environment | Fire/smoke context and elevation/temperature-based campsite discovery | NWS forecasts/elevation at selected places and topo basemaps. A forecast popup is not a regional forecast filter. |
| Other historical capabilities | Campsite video flow, multilingual UI, seasonal subscores and more complete amenity information | Photo gallery and reported source amenities. Some inherited historical rows need stronger original evidence before becoming build commitments. |

Historical developer claims about low-clearance avoidance, nearby services, route
detours and community functions are preserved at [S1]. Weather-filter and smoke
layer value is also described in individual archived reviews [S2]. This audit does
not claim the original successfully protected every RV or had perfectly accurate
coverage.

## Five build packages, in recommended order

This order combines user jobs, missing discovery functionality and dependencies.
It is not a forecast of completion time or a commitment to build every optional row.

1. **Structured observations and rating discovery.** Extend the existing operated
   review backend with optional dated signal/access/noise/shade/crowding fields,
   publish moderated aggregates and connect minimum rating to map and route
   discovery. Keep empty samples unknown, show dates/sample sizes, and retain
   edit/report/moderation controls. Separate measured or reported signal from
   future modeled carrier coverage. This work can proceed while FCC is blocked.
2. **FCC pilot, then coverage-aware discovery.** Resolve the denial, validate one
   provider/state/date download and geometry, then deliver bounded regional tiles.
   Label filing date, carrier, technology and modeled outdoor/in-vehicle assumptions.
   Add filtering only after point-in-coverage behavior and unknowns are tested.
   Do not equate a cell tower with usable campsite coverage. This is the blocked lane.
3. **Environmental planning.** Add dated authoritative fire/smoke context and useful
   elevation/forecast filtering. Distinguish smoke, fire detections, alerts and legal
   restrictions. Stale, unavailable and uncovered areas must remain explicit.
4. **Broader services and permission evidence.** Expand useful roadside services and
   overnight places with provenance, operating status, reported permission and dates.
   Confirm coverage quality in pilot areas before claiming national completeness.
   More points alone do not establish that an RV may stay overnight.
5. **Rig-aware approach and routing.** Add a portable rig profile and route elevation
   context, then integrate licensed/authorized, current clearance/access evidence.
   Require an appropriate routing service and test known restrictions. Do not label
   existing car routes RV-safe or infer clearance from MVUM road designation.

Campsite videos and language support remain lower-priority backlog items. Before
calling any release ready for boondockers, also test cold offline launch and saved
areas on a real phone, source freshness failures, recovery/export and moderation
operations. Those are quality gates even when they earn no parity points.

## Behavior differences and scope decisions

| Flow | Historical FreeRoam evidence | KampTrail decision |
| --- | --- | --- |
| Contribute observations | Account/community-based contribution advertised | Keep account-free reading and moderated contributions. Add structured evidence instead of requiring social accounts merely for parity. |
| Discover suitable stops | Signal/weather/safety/crowding filters advertised | Current filters cover fees, type, reported equipment/length, hookups and selected amenities. Additional discovery filters are real remaining work. |
| Choose an approach | Low-clearance avoidance advertised; original runtime not tested | Keep car-route limits explicit. Official road designation is supplementary evidence. |
| Move personal trips | Trip planning advertised; exact cross-device behavior not re-established | Keep local saves and GPX portability. Do not claim automatic account sync. |
| Prepare offline | Offline support advertised; reliability complaints recorded | Cached shell/data and saved Topo areas exist. Keep separate readiness states and verify real-device cold launch. |

Accounts/profiles, friends/messages/groups/events/nearby community presence,
notifications and native in-app turn-by-turn navigation remain outside the selected
scope. Donations/partners and product-guide content are also excluded from the
checklist. Those exclusions must be reopened to pursue the entire historical
product. The original community, reviews, accounts and commercial data cannot be
assumed transferable.

## Verdict

**The core MVP is implemented; full historical FreeRoam parity is not established.**
The scored core has all 13 must-haves and the latest release regression checks
passed. This targeted comparison is not a new exhaustive QA or field-accuracy
certification. There are meaningful optional capability gaps, deliberate social
scope exclusions and evidence limits. Finishing FCC does not remove those.

Recommended next executable package: structured observations and minimum-rating
discovery. Keep FCC resolution and pilot work in parallel when access is restored.
No application code, live data or production configuration was changed by this audit.

## Sources and reproduction

- [S1: archived developer description](https://www.appbrain.com/app/freeroam-campgrounds-boondo/app.freeroam.main), reopened October 29, 2026.
- [S2: archived iOS reviews](https://justuseapp.com/en/app/1434359242/freeroam-boondocking-more/reviews), reopened October 29, 2026. Individual reports are qualitative evidence; ignore the archive's unrelated aggregate NLP/safety scores.
- [S3: archived original identity and reviews](https://appshunter.io/ios/app/freeroam-boondocking-and-more/id1434359242), reopened October 29, 2026. Generated summaries are not treated as original documentation.
- [Current source](https://github.com/prowebpromo/kamptrail/tree/3bc973ad3cd081d8359bff7c5c497882f0f44d75).
- [Passing release workflow](https://github.com/prowebpromo/kamptrail/actions/runs/40926581338).
- Live checks: https://kamptrail.com/release.json and https://kamptrail.com/api/health.php.

Run from this directory:

```sh
python3 parity.py features.csv --json
python3 parity.py benchmark-features.csv --json
```

See [the scored gap list](parity-score.md), [feature evidence](features.csv),
[original recon and limits](recon.md) and [feedback update](feedback.md).
