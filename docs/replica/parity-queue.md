# Active comparison and implementation queue

Updated October 31, 2026 (current release section). The sequence below dates from October 30, after the live 2.20 verification and the owner's revised priorities. This is the execution order, not a new parity score. Earlier dated reports and candidate gates are historical.

## Current release and accounting

Live release on October 31, 2026: **2.25.1**, source `8c9bde808c26ff64e1d1952a4fa9947434fb699f` (PR #130, route clearance dialog translated, verified live; see `docs/ROUTE_CLEARANCE_I18N_2.25.1.md`), following 2.25.0 (`d5ba80f1`, PR #127, French interface, verified live; see `docs/FRENCH_UI_2.25.0.md`), 2.24.0 (`47db64ed`, PR #126, visitor overnight-stay answers), 2.23.0 (`95387557`, PR #125, official rest areas in five states) and 2.22.0 (`6b54e7f2`, PR #123).

Score at 2.25.1: **90.8/100**, unchanged from 2.24.0, 99 of 109 weighted points, **13/13 must-haves complete**, 61 scored rows. Re-verified live on 2.25.1 in the [2.25.1 parity check](2026-10-31-parity-2.25.1-live.md), with every must-have exercised on production. The only scored change since the [2.22 parity check](2026-10-31-parity-2.22-live.md) is "Overnight allowed voting" (could), which moved from no to yes after its predefined criterion was met live (`docs/OVERNIGHT_ANSWERS_2.24.0.md`). The 2.23.0 rest-area expansion and the live 2.25.0 French interface leave their rows partial. Multi-language stays partial because the how-to page remains English-only and the French has had no native-speaker review. The route clearance dialog was translated in 2.25.1. Excluded full-product features (accounts and sync, social messaging, groups and events, notifications, native navigation) stay outside the 109-point denominator.

Remaining 10 points: overnight places, amenities, cell coverage and tower rows, router-gated rows (rig routing, low clearance), and the could-level partials. Reasons each remaining condition, amenity and filter row did not move are in `docs/PACKAGE5_AUDIT_2026-10-31.md`. The cell-tower source assessment is in `docs/CELL_TOWER_DATA_ASSESSMENT_2026-10-31.md`. FCC modeled coverage stays parked. The RV router feasibility gate still comes before national clearance expansion. A 96.3 figure, if cited, is conditional arithmetic on unbuilt work, not a forecast.

Pending dates: physical-phone offline acceptance on November 2, 2026, 3:00 to 3:20 pm Eastern. USFS fee-recheck backstop on November 23 (existing task, not duplicated).

## Revised sequence and gates

The maintenance pilot and frozen first 30 reviews have executed. The failed interim gate stops the remaining 20. New manual review batches and national clearance expansion retain the dependencies below. A merged source package is not itself proof of deployed capability.

| Order | Package and single home | Current status and next gate |
| --- | --- | --- |
| 1 | Ten-record fee maintenance: [USFS_FEE_RECHECK_PILOT.md](../USFS_FEE_RECHECK_PILOT.md), [PR118](https://github.com/prowebpromo/kamptrail/pull/118) | **Merged.** Real pilot checks found ten unchanged pages. Human observation dates remain intact. Current October 30 receipts still end November 29; confirm a later successful scheduled check or resolve exceptions by **Friday, November 27**. The November 23 backstop remains scheduled. |
| 2 | Focused [2.20 amenity verification and re-score](2026-10-30-parity-2.20-live.md), [PR116](https://github.com/prowebpromo/kamptrail/pull/116) | **Merged and completed within documented limits.** Exact deployed source and actual cases verified. Broader agency amenities remain partial with no extra parity credit. No fresh interactive browser or real-phone pass is claimed by that report. |
| 3 | [Probably-free method and fixed sample](../fee-evidence/PROBABLY_FREE_PILOT.md), [first 30 results](../fee-evidence/2026-10-30-first30-results.md), [PR114](https://github.com/prowebpromo/kamptrail/pull/114), [PR119](https://github.com/prowebpromo/kamptrail/pull/119) | **Method merged; first 30 executed and independently audited. STOP remaining 20:** 4/30 credited evidence outcomes, two free and two paid, **zero published changes**. The frozen selection and thresholds remain the dated plan. Full-source structured-parser repair is separate work under review; no repaired or deployed classification is claimed here. |
| 4 | State rest-area policy: [REST_AREA_STATE_POLICIES_2026-10-30.md](../REST_AREA_STATE_POLICIES_2026-10-30.md), [PR113](https://github.com/prowebpromo/kamptrail/pull/113) | **Merged**, including scoped state/operator/facility-class inheritance, explicit exceptions and client integration. Source and apply each rule at its actual scope. Deployment/live verification remains separate; this status does not imply additional places or blanket permission. |
| 5 | Router feasibility: [RV_ROUTER_ASSESSMENT_2026-10-30.md](../RV_ROUTER_ASSESSMENT_2026-10-30.md), [PR115](https://github.com/prowebpromo/kamptrail/pull/115) | **Assessment merged; router gate has not passed.** Resolve provider/runtime, vehicle semantics, known restriction cases, usage rights and production-host gates first. Scale clearance data only after a router passes. Rig dimensions, route proximity and Rhode Island markers remain reference evidence, not enforcement. |
| 6 | Offline readiness: [OFFLINE_READINESS.md](https://github.com/prowebpromo/kamptrail/blob/4688803a16ad76f15b4530c8fcda5ead96468443/docs/OFFLINE_READINESS.md), [PR117](https://github.com/prowebpromo/kamptrail/pull/117) | **Shipped in 2.21; physical-phone acceptance pending (Nov 2, 3:00 p.m. ET).** Actual cache-inventory implementation is prepared; record exact-head release/live acceptance separately. Mr. Price’s real-phone cold-launch check is scheduled for **Monday, November 2, 3:00–3:20 PM Eastern** and remains pending. Follow the runbook and record actual device results. |

The linked single-home contracts own policy details, frozen thresholds, fixtures and acceptance steps. This queue records ordering, status and dependencies. Candidate links and PRs carry later integration and release evidence.

## External dependency and persistent limits

FCC coverage stays parked pending the existing access/support case. No credential retries are part of this queue. Observed camper signal reports and cell locations do not establish modeled usable carrier coverage.

Automatic account synchronization, social/community features, notifications and native navigation remain excluded or absent full-product areas. Preserve the historical scope caveats in the comparison reports. The real-phone offline check cannot be completed from this workspace.

For every executable package, retain exact identity joins, dated source evidence, unknown/unavailable states, moderation, mobile/keyboard access, portable saves and rollback. Run the relevant tests and required release checks, then verify the deployed source and real provider behavior. Measure actual classification changes or new-place counts rather than counting source records as outcomes.
