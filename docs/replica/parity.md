# KampTrail vs FreeRoam — 2.8.0 feature audit

Date: 2026-10-28. Feature score: **80.8/100**, up from the latest independent 69.2 baseline (2.4.1). All **13 of 13 must-haves** are implemented. This measures 59 features in the existing matrix, weighted must=3, should=2, could=1; partial earns half credit. Deliberately excluded social/account features and KampTrail-only additions do not inflate the score.

This is an updated implementation/evidence audit against the existing FreeRoam source baseline, commit `f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14`. It is not a new test of a running FreeRoam backend or a claim that KampTrail reproduces its community, campsite inventory, or real-world data accuracy. No comparable original screenshots were available; no layout score or combined visual score is claimed. The current audit archive (KampTrail_FreeRoam_Audit_2026-10-28.zip, version 2) was re-read for scope continuity. It retains 32 historical FreeRoam feedback items: 21 archived iOS, 4 archived Android and 7 direct Reddit comments. This selected sample is not representative or newly collected in this release. The older repository mixed-competitor sample is a different evidence set and is not counted here. No fresh quotations or matched original-runtime tests are claimed. Original-feature support has not been independently re-established for every inherited row.

## What changed

- Reviews and photos: independent moderation, published ratings/gallery, private pending images, author management, edits returned to review, reporting and removal. Live verification used an explicitly synthetic unlisted QA identifier. It never created a review on a real campground, and all QA content was removed. Encoded photos survived a real deploy; disposable MySQL dumps were restored and compared.
- USFS MVUM: official viewport road geometry, vehicle/season evidence, district coverage and unit-entry dates, official links, independent layer opacity and bounded offline views. Source designation is not RV clearance, current road conditions or camping permission.
- Routes: actual car-road geometry, filtered campsite corridor search, requested driving detours, leg-order insertion, stale-itinerary checks and device caching. FOSSGIS requests are user-triggered and centrally limited. It is not RV-safe navigation.
- The nearby-services row is corrected from partial to yes: the existing UI covers dump, water-fill and propane points. That is verification of an existing feature, not new inventory added in 2.8.0.
- FCC carrier coverage remains no. Authenticated current-data access and usage conditions are outstanding; see ../FCC_COVERAGE_ACCESS.md.

## Behaviour differences to keep

| Flow | Original source baseline | KampTrail |
| --- | --- | --- |
| Contribute | Account-based community | No-account form, independent moderation and private author code; no account recovery |
| Save or move trips | Account/server state | Device snapshots and GPX transfer; browser storage may be evicted |
| Road context | Map layers | Opt-in official source evidence, missing-coverage labels and dated saved views |
| Find a stop on a trip | Server routing/discovery | User-triggered car-road corridor; route-line distance and actual driving detour are separate |
| Routing limits | Original service-dependent | Up to 25 saved stops per car calculation; external directions split to provider limits |

## Next five priorities

1. Unlock FCC mobile-data access and confirm permitted redistribution, then build dated provider/technology tiles. This is the outstanding item from the four-package plan.
2. Connect moderated community averages to minimum-rating discovery; add optional structured signal/noise/shade observations with visit dates and small-sample labels. Do not treat carrier models as camper measurements.
3. Add verified clearance and approach-road hazards, preserving unknowns and source freshness. MVUM alone cannot decide RV fit.
4. Improve overnight-parking coverage and campsite amenity completeness with documented permission and operating-status evidence.
5. Add fire/restriction context from authoritative feeds with update times and explicit missing/stale states.

Operationally, review the moderation queue and monitor source-refresh errors, image-storage usage, backup coverage and routing volume. FOSSGIS permits light use; a sustained audience needs a contracted or self-hosted routing service. Shared hosting should continue serving the app/API, not an OSRM graph.

## Release evidence

2.8.0 shipped on 2026-10-29: 79 Node/PHP tests,31 Python tests,55 browser/accessibility flows,MySQL integration and real dump/restore comparison passed. Production migration003 is applied; health reports routing and community ready. A live public-campground route returned106 road miles and3hr17min, and discovery found111 catalogue records within5miles of the road. These are smoke-test observations, not travel advice. See test-report.md. The 2.8.1 follow-up adds regressions for explicit popup navigation and ambiguous forest links without changing the parity score.

Full matrix: features.csv. Generated scoring output: parity-score.md. No current claim of full FreeRoam parity: coverage, structured review sub-scores, clearance data and several filters remain absent.
