# Current implementation comparison with historical FreeRoam

Audit date: October 29, 2026. Reviewed workspace: the KampTrail agency-coverage worktree, based on commit `0744c59cd43fd210e9bcb426929dc199bee0fecf`, with uncommitted 2.11.0 work present. This report records a read-only implementation and evidence review; adding this report does not change the application or the existing comparison matrix.

**Full historical FreeRoam parity is not established.** The implemented camping-planning core has substantial functionality, but the inherited checklist excludes entire product areas and omits two previously documented historical capabilities. Neither the working-tree version number nor the arithmetic below establishes deployment, production readiness, original-app reliability or complete product coverage.

## Scores and their limits

| Checklist | Earned / possible weighted points | Provisional implementation score | Scope |
| --- | ---: | ---: | --- |
| Current root matrix, frozen 59 scored rows | 89.5 / 107 | **83.6 / 100** | Existing `features.csv`, including its exclusions and inherited assumptions |
| Reconstructed expanded 61 scored rows | 89.5 / 109 | **82.1 / 100** | Same current implementation statuses, plus missing campsite videos and cell-tower location discovery from the earlier expanded audit |

Weights are must=3, should=2 and could=1; partial receives half credit. Rows marked `skip` and rows marked `original=no` are excluded. All 13 must-haves in this selected checklist remain marked implemented. This is not a statement that every historical FreeRoam must-have has been identified or completed.

The root matrix calculation was reproduced with the existing `parity.py` scoring tool. The 61-row figure is a reconstruction: the earlier expanded audit adds two `could` rows, both still absent, to the denominator without adding earned points. No reconstructed matrix was written and no existing row, weight or status was changed for this report. The provisional figures preserve the current road-difficulty row as `no`; the possible partial credit discussed below has not been added.

The historical root report's 80.8 score is not current matrix arithmetic. The current 2.9/2.10 statuses add three earned points: minimum rating +1; observed signal filtering +0.5; condition filtering +0.5; structured review observations +0.5; fire/smoke context +0.5. The in-progress 2.11 coverage work earns no additional score here. More catalogue records do not automatically complete another feature or prove national completeness.

These numbers may be presented as caveated implementation-checklist calculations. They must not be presented as a current full-product percentage, a newly verified live release, or a comparison against a working original app. No layout or combined visual score is available.

## Evidence reviewed

- Current repository: `docs/replica/features.csv`, `parity.md`, `parity-score.md`, `parity-queue.md`, `test-report.md`, and `docs/FREEROAM_TAKEAWAYS.md`.
- Release descriptions: `docs/COMMUNITY_OBSERVATIONS_2.9.0.md` and `docs/ENVIRONMENT_CONTEXT_2.10.0.md`, checked against the relevant current code paths below.
- Retained earlier comparison: `kamptrail-parity-current/docs/replica/2026-10-29/{features.csv,recon.md,parity.md}` in the audit workspace. That expanded audit records 61 scored rows, including videos and tower discovery, and identifies uncorroborated inherited claims.
- Retained prior recon and evidence from the version-2 October 28 comparison archive. These describe historical releases and are not evidence of the present deployed state.

The earlier expanded recon cites archived developer descriptions and selected reviews for the correct FreeRoam Foundation product: iOS `1434359242`, Android `app.freeroam.main`. Its historical sources include [AppBrain](https://www.appbrain.com/app/freeroam-campgrounds-boondo/app.freeroam.main), [JustUseApp](https://justuseapp.com/en/app/1434359242/freeroam-boondocking-more/reviews), and [AppsHunter](https://appshunter.io/ios/app/freeroam-boondocking-and-more/id1434359242). These references are retained provenance; they were not reopened during this targeted review. Archived advertised behavior is not a runtime test.

This pass inspected local files only. It did not rerun release suites, inspect private credentials, retry FCC access, create production contributions, inspect a running original backend, collect matched screenshots, or test cold offline launch on a physical phone. Release-document test results remain attributed to their original release, not to this report.

## Current implementation evidence

| Capability | Current code evidence | Practical limit |
| --- | --- | --- |
| Map, list, local place/campsite search and persisted filters | `app.js`, `data-loader.js`, `filters.js` | Source inventory and geographic coverage are separate from UI capability |
| Fee, amenities and joint rig-length/hookup suitability | `data-quality.js`, `filters.js`, `scripts/build-search-index.js` | Missing source evidence remains unknown; 2.11 source changes still need their release checks |
| Published ratings and same-visit conditions/carrier observations | `community-discovery.js`, `community.js`, `api/community-discovery.php`, `api/_lib/observations.php` | Moderated, dated reports; no modeled carrier coverage or objective safety guarantee |
| Shared map/route observation predicates and aliases | `data-quality.js`, `routes.js`, `scripts/build-search-index.js` | A stale route index needs current community metadata; no automatic original-inventory equivalence |
| Review/photo submission, moderation and author management | `community.js`, `api/community.php`, `api/_lib/community.php`, `api/_lib/community-admin.php` | Photo functionality does not implement a video pipeline or social accounts |
| Actual road routes, corridor discovery and requested detours | `routes.js`, `trip-planner.js`, `api/route.php` | Car routing; no enforced RV height, weight, length or clearance constraints |
| Public-land and official MVUM road context | `layers.js`, `mvum.js` | Land ownership and road designation do not establish overnight permission, clearance or current passability |
| Fire perimeters, smoke plumes and point weather alerts | `environment.js`, `api/environment.php`, `api/_lib/environment.php` | Partial environmental context; no general fire-weather risk or comprehensive closure/restriction layer |
| On-demand forecast and approximate elevation | `spot-info.js`, popup actions in `data-loader.js` | A selected-place display does not implement elevation or forecast discovery filters |
| Dump, water-fill and propane services | `scripts/build-services.js`, `layers.js` | Current builder and map kinds cover these three categories; not a broader showers/laundry/grocery/fuel directory |
| Local trips, GPX portability and saved Topo areas | `trip-planner.js`, `offline-maps.js`, `service-worker.js` | No automatic cross-device synchronization; offline readiness and phone cold-launch verification remain incomplete |

## Matrix reconciliation required

1. **Do not silently drop the expanded scope.** The root `features.csv` lacks the campsite-video and cell-tower-location rows that the earlier expanded audit supported with archived developer descriptions. Both remain absent in current implementation.
2. **Separate historical evidence from current verification.** Most root rows still cite the 2.4.1 commit `153b097489890ea8a39199874b7ec17ca34962d8`, generic evidence text, and `recon.md`/`evidence.json` files not present in that root comparison directory. These references cannot establish current deployment or row-specific validation.
3. **Retire obsolete build priorities without erasing history.** The root `parity.md` still lists rating/structured observations and fire context as future work. Current 2.9/2.10 code implements the narrower capabilities described above. The active queue is the more current planning document.
4. **Review the road-difficulty acceptance definition.** `filters.js` exposes observation controls from `community-discovery.js`, including easy/moderate/difficult approach reports with visit and rig context. The separate source `road_difficulty` predicate exists in `data-quality.js`, but its dedicated control is absent. The root row's “no; engine supports it” description is incomplete. Partial credit is a candidate after defining the intended user job; full equivalence is not demonstrated by similar labels.
5. **Keep uncertain historical requirements explicit.** The expanded recon did not independently corroborate an original rig profile, route elevation chart, precise seasonal subscores, or specific Spanish/French support. They may be useful product goals, but should not become verified historical requirements merely because inherited rows say `original=yes`.
6. **Do not treat restricted checklist completion as full-product completion.** Existing scope exclusions must be revisited when the objective becomes at least the entire historical FreeRoam product.

## Full-product omissions and remaining larger gaps

| Area | Remaining work or evidence gap |
| --- | --- |
| Accounts and identity | User accounts, profiles and account recovery are absent; anonymous author-management codes provide a different contribution model |
| Cross-device state | Automatic trip/save synchronization and recovery are absent; GPX transfer is manual. Exact historical original synchronization behavior still needs evidence |
| Social/community | Friends, direct messages, groups, forums, events and nearby community presence remain excluded or absent; local trip dates/notes do not establish public check-ins |
| Notifications | No product notification system or push/background alert flow; on-demand NWS alerts are a different function |
| Native navigation | In-app turn-by-turn navigation is excluded; external map handoff is implemented |
| Connectivity | Predicted carrier/technology coverage and coverage-aware discovery remain absent; observed signal reports do not replace them. Cell-tower discovery is also absent and would not prove usable service |
| RV access/routing | Sourced low-clearance/access hazards, enforced restriction avoidance and relevant route preferences remain incomplete; MVUM and car routes cannot supply these guarantees |
| Services/overnight stops | Broader service categories, operating-status evidence and dated overnight-permission reports remain incomplete. Parking availability, brand affiliation, land ownership and votes do not establish permission |
| Environmental discovery | Elevation and forecast filtering are absent; broader authoritative restrictions/fire-weather context remains incomplete |
| Community/media depth | Campsite videos, richer structured/seasonal summaries and overnight reports remain incomplete; a photo gallery or free-text review does not complete them |
| Language and guidance | Multilingual UI and more complete land-respect guidance remain backlog items; exact historical language scope needs corroboration |
| Business/editorial scope | Donations/partners and product-guide/backpack content are deliberate exclusions. They must be named as exclusions in any whole-product comparison |
| Offline reliability | An explicit combined readiness display and a real-phone cold-launch check remain outstanding even though cached data, shell and saved Topo functionality exist |

The original community, accounts, reviews and third-party data cannot be assumed transferable. Inventory quality, coverage, freshness and moderation operations must be evaluated independently of feature counts. FCC remains a separate access/data-validation lane; this report authorizes no retry or credential handling.

## Next executable package: elevation and forecast discovery

Complete the current free-camping coverage checks first. Then implement actual campsite discovery filters, with these acceptance conditions:

1. **Explicit controls and semantics.** Provide minimum/maximum elevation with visible units and a temperature/forecast filter for a clearly identified date or period. Define whether bounds are inclusive and what forecast metric qualifies. Display the selected conditions in map and route results; a popup alone does not satisfy this package.
2. **Appropriate source evidence.** Elevation needs a documented batch/static source with units, coverage, resolution and provenance. NWS forecast-grid elevation must not silently become an exact campsite terrain measurement. Forecast records need issued/retrieved times, valid intervals and the applicable location/time zone.
3. **Bounded fetching and shared results.** Fetch forecast grids on explicit demand with request, concurrency, response-size and cache bounds. Reuse grids where appropriate; do not request one forecast per national campsite on every filter change. Reconstruct necessary metadata in the route index and apply the same predicate to map/list and route-corridor discovery.
4. **Unknown, stale and offline behavior.** Missing, uncovered, expired, partial or failed evidence must not satisfy an active filter. Distinguish unavailable results from no matches. Define cache lifetimes and show the exact forecast period and freshness; cached historical forecasts must not look current offline.
5. **Persistence and interaction.** Persist valid controls, reset them correctly, retain unit/date interpretation, expose loading/retry states and prevent superseded responses from changing current results. Keep controls and result explanations usable by keyboard, screen reader and on mobile.
6. **Meaningful verification.** Test bounds, units, missing data, time-zone/daylight-saving/date boundaries, overlapping forecast intervals, expiry, source failures, throttling, pagination/completeness and asynchronous changes. Verify identical map/route matches. Run relevant regressions and required release checks, then verify real provider responses from the deployment host and representative live UI flows before marking the package complete.

After this package, prioritize broader services and permission evidence, then sourced access/clearance hazards and supported routing restrictions. Portable rig preferences, route elevation context, community/media depth and language support can follow with their own explicit acceptance criteria. Reassess full-product scope separately; none of these increments makes the excluded social/native capabilities disappear.

## Verdict

The current code supports an advanced camping-planning core with documented limits. The **83.6 frozen-checklist** and **82.1 reconstructed expanded-checklist** figures are honest provisional arithmetic when their scope is stated. A full-product parity percentage, a matched original-runtime comparison and a new production-readiness verdict remain unsupported. Use this dated baseline to record verified increments, preserve missing areas, and continue independent work while external access is blocked.
