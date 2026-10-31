# Completion contracts for the 13 incomplete rows

Date: 2026-10-31. Live release 2.29.1. Score 90.8/100 (99 of 109 weighted points). Status: draft for owner approval. No row's status changes, and no implementation starts, until the owner approves its contract.

## Rules for every contract

- Weights stay must 3, should 2, could 1. Partial earns half credit. The 61-row scope and the 109-point denominator stay frozen.
- Full credit is set by the original app's behavior, read from FreeRoam source (frontend `free-roam` at `f3b5f2d8`, backend `back-roads` master). Where KampTrail adds stricter honesty rules (dated evidence, unknowns kept, no inferred permission), those rules still apply. They do not raise the bar for credit beyond what the original did.
- Each row reports three measures:
  - Feature: does the capability work end to end? This decides credit.
  - Coverage: how many places have data. This is a separate number. It gates credit only where the contract states a threshold.
  - Freshness: the age of the newest and oldest evidence. Also reported separately.
- Crowd-sourced rows earn feature credit from fixture tests plus a live walkthrough of the submission, moderation and display path on a staging target. Production never gets seeded or fabricated reviews. Real submission counts are reported as coverage.
- Evidence to mark any row complete: a merged PR, the exact-head CI run ID, live `release.json` equal to the merge commit, a scripted live check with saved output, and an updated row in `features.csv`.

## What the original app actually did

Read from source on 2026-10-31. This changes several contracts.

| Area | Original behavior | File |
|---|---|---|
| Carrier coverage | Static per-carrier LTE fill layers for Verizon, AT&T, T-Mobile and Sprint, served from FreeRoam's tile server | `src/services/map.coffee` lines 492–575 |
| Cell signal filter, road difficulty, crowds, fullness, noise, shade, safety | Every value comes from campground reviews. Road difficulty, shade and safety are 1–5. Crowds and fullness are per season. Noise is day and night. Cell signal is per carrier and network, 1–5 | `back-roads/models/campground.coffee` lines 41–47, `campground_review.coffee` lines 49–56 |
| Fire weather and smoke | Dated `fire_weather.json` polygons with names, a `smoke.json` layer, and community-reported wildfire hazards | `map.coffee` lines 576–600, 356–364 |
| Low clearance | Hazard points carrying `heightInches`, filtered by the visitor's rig height | `map.coffee` lines 366–382 |
| Rig routing | Valhalla car routing with an `avoidHighways` toggle. With a rig height set, the route is checked against known low-clearance points and rerouted around up to 50 of them, for up to 3 attempts. This is not truck-legal routing | `back-roads/services/routing.coffee` lines 113–160 |
| Cell towers | A place type named by carrier and technology (for example "Verizon LTE"), listed under places nearby | `back-roads/models/cell_tower.coffee`, `src/components/place_nearby` |
| Overnight places | Overnight places submitted by visitors, with reviews and attachments (`new_overnight`, `overnight` pages) | `src/models/overnight.coffee` |

Two consequences follow:

1. The original did not offer legal truck routing or licensed commercial parking data. Requiring either would set a higher bar than the original.
2. The cell signal and road difficulty filters were review-based in the original. KampTrail's report-based filters may already meet the original behavior, so their parity is re-checked under contracts R4 and R5.

## Contracts

### R1. Cell carrier coverage overlay (should, 2.0 points, currently no)

- **Full credit:** a per-carrier coverage layer for at least Verizon, AT&T and T-Mobile, toggled one carrier at a time. Each layer is labeled as modeled provider-reported coverage, not measured service, and shows its data as-of date.
- **Coverage threshold:** contiguous US plus AK and HI for each of the 3 carriers. Missing areas show as no data, never as no coverage.
- **Acceptance tests:**
  - Each layer loads and shows its dated attribution.
  - A known covered point and a known uncovered point render as expected against the source file.
  - An outdated or missing file shows "coverage unavailable".
  - The layer works on mobile, by keyboard and in the offline fallback.
- **Dependency:** authorized automated access to FCC Broadband Data Collection mobile coverage. FCC ticket #64052 is open. The owner rejected manual per-provider downloads. Cost $0. Maintenance is a twice-yearly FCC data refresh, automated.
- **Status:** blocked externally. No authorized automated source exists today.

### R2. Filter by cell signal (could, 0.5, partial)

- **Full credit:** filter campgrounds by a minimum signal level for a chosen carrier, using dated visitor reports. This is the original's behavior. Modeled coverage belongs to R1 and is not required here.
- **Coverage:** reported separately as places with at least one dated report per carrier. No threshold.
- **Acceptance tests:**
  - A fixture with reports for 2 carriers filters correctly by carrier and level.
  - Places without reports are excluded and labeled as unreported, not counted as weak signal.
  - Stale reports are flagged.
- **Open check:** confirm KampTrail's report schema records a per-carrier level comparable to the original's 1–5. If it does, this row may already qualify. If it does not, add the level field.
- **Status:** buildable now. It may need only verification and a criterion review.

### R3. Cell tower locations (could, 1.0, no)

- **Full credit:** tower points named by carrier and technology, shown on the map and listed under places nearby with distance. Each point is labeled as a location estimate that does not prove service.
- **Coverage threshold:** national, from one maintained source refreshed at least monthly.
- **Source options:**
  - OpenCelliD (Unwired Labs) matches the original's carrier and technology fields. It needs a free API token the owner would register. Its CC BY-SA 4.0 license, as reported by secondary sources, needs primary verification. The share-alike term binds the published tower file. Positions are crowd-estimated.
  - FCC Antenna Structure Registration is public data with no account. It names structure owners, not carriers. It cannot meet the carrier-and-technology requirement, so it earns no credit.
- **Acceptance tests:**
  - License text is captured from the primary page.
  - Carrier mapping is checked against the published MCC/MNC table for a sample of 50 towers.
  - The label wording is tested.
  - The refresh job keeps the prior file on shrinkage.
- **Status:** blocked by an owner decision: approve the OpenCelliD token and share-alike terms, or accept the 1.0 cap.

### R4. Filter by road difficulty (could, 0.5, partial)

- **Full credit:** a filter for maximum approach-road difficulty, based on dated visitor reports. KampTrail uses 3 levels where the original used 1–5, and the owner accepts that equivalence when approving this contract.
- **Coverage:** reported separately. No threshold.
- **Acceptance tests:** the existing report-based filter passes fixture and live tests. Unknown is kept and is never treated as easy.
- **Open check:** the current partial status cites "no dedicated control for sparse source road_difficulty data". Source road data was not part of the original. If the owner approves this contract, the row moves on verification alone.
- **Status:** buildable now, likely verification only.

### R5. Review sub-scores and cell signal reports (could, 0.5, partial)

- **Full credit:** optional dated sub-scores covering the original's axes:
  - road difficulty
  - crowds by season
  - fullness by season
  - noise, day and night separately
  - shade
  - personal comfort, standing in for the original's safety
  - per-carrier signal
- **Gap today:** day and night noise, crowds as a seasonal number, fullness, and confirmation of per-carrier signal levels.
- **Acceptance tests:**
  - Submission, moderation and display work on staging for every axis.
  - Every axis is optional.
  - Averages need at least 3 qualifying ratings.
  - Ratings from a single visit never fill another season.
- **Status:** buildable now. Safety stays "personal comfort". No objective safety score is published.

### R6. Filter by crowds, noise, shade and safety (could, 0.5, partial)

- **Full credit:** numeric threshold filters for each R5 axis, including a seasonal crowds filter and a day or night noise filter, matched within the same visit.
- **Acceptance tests:** fixture filters for each axis. Places without ratings are excluded and labeled.
- **Status:** buildable after R5.

### R7. Place detail: seasonal sub-scores (could, 0.5, partial)

- **Full credit:** per-season averages for crowds and fullness, plus the existing quietness, shade and comfort averages, each with its rating count and a minimum of 3.
- **Status:** buildable after R5.

### R8. Place detail: amenities list (should, 1.0, partial)

- **Full credit:** every campground popup shows an amenities section. Each value carries its source and date, or the popup states "no amenity source for this listing".
- **Coverage threshold to approve:**
  - 100% of Recreation.gov-linked listings. Met today: 2,158 of 2,158.
  - Attributed amenity values for at least 50% of all listings, with the OpenStreetMap amenity tags already in the catalogue (toilets, drinking water, showers, dump station) shown with OSM attribution where present.
  - The baseline percentage per source class is measured and published before build.
- **Known gaps:** 2,204 Forest Service recreation-area listings have no exact link to the site layer. The 528 BLM listings have no amenity source.
- **Acceptance tests:**
  - Attribution is correct per source class.
  - Conflicts between sources show no label.
  - Absence is never inferred.
  - The coverage script runs in CI and reports per class.
- **Status:** buildable now. The 50% figure is a proposal and needs owner approval.

### R9. Overnight parking places (should, 1.0, partial)

- **Full credit:** 2 parts, matching the original.
  - Visitors can submit an overnight place (rest area, store lot, truck stop, casino or other), with moderation, coordinates and a dated permission report. Permission is a visitor report, kept separate from posted rules and ordinary parking.
  - Official rest areas are shown where an agency publishes them.
- **Coverage threshold to approve:** official rest areas in at least 25 states. Today: 13 states, 586 locations. Commercial locations come only from visitor submissions. There is no threshold for them.
- **Acceptance tests:**
  - Submission and moderation work on staging.
  - A submitted place shows "visitor-reported, date" and never "allowed" without a report.
  - Duplicates near an existing place are flagged.
  - Rest-area tests stay green.
- **Dependencies:** Georgia 511 key (pending approval) and more state publishers. Paid parking data is declined and not needed.
- **Status:** buildable now. The rest-area threshold needs owner approval.

### R10. Low clearance hazards (could, 0.5, partial)

- **Full credit:** national low-clearance points from OpenStreetMap `maxheight` (ODbL, attributed, refreshed monthly) plus visitor-reported clearances. They are filtered by the saved rig height and shown along a route.
- **Gap against the original:** the original matched by proximity only. Points on another road or the other direction are flagged as "may be a different road" instead of claimed.
- **Coverage threshold:** all 50 states imported. A completeness percentage is not required because OSM tagging is uneven, and that limit is stated.
- **Acceptance tests:**
  - Rig-height filtering is correct at the boundary, for example 13 ft 6 in.
  - Unknown heights are shown as unknown.
  - A route fixture with a known clearance reports it.
  - A parallel-road fixture gets the "may be a different road" flag.
- **Status:** buildable now. It is free, but the refresh job adds national data volume.

### R11. Route settings: rig height and avoid highways (could, 1.0, no)

- **Full credit, matching the original:**
  - An avoid-highways toggle.
  - With a rig height set, the car route is rerouted around known low-clearance points from R10 that are lower than the rig. Limits: up to 50 points and 3 attempts.
  - The result is labeled "avoids known mapped low clearances only, not a legal or RV-safe route".
- **Not required:** truck-legal routing and restriction tests. The original did not have them.
- **Acceptance tests:**
  - The toggle changes the route on a fixture.
  - A route through a known low point reroutes, or reports that it could not avoid it.
  - The label is always visible.
  - Failure falls back to the plain car route with a warning.
- **Dependency:** openrouteservice car profile with `avoid_features` and `avoid_polygons`. It is free, with 2,000 requests per day and 40 per minute. Public traffic may exceed that, so a quota-exceeded state must be handled.
- **Status:** blocked by an owner decision. The current decision is "public RV routing stays off". This contract is the narrower, labeled form the original shipped. Approve it, or accept the 1.0 cap. The 2026-11-01 test of height enforcement and truck-only false exclusions belongs to the stricter HGV option and does not gate this contract.

### R12. Fire weather and smoke layers (could, 0.5, partial)

- **Full credit:** a dated overlay of active NWS Red Flag Warnings and Fire Weather Watches.
  - Alerts with a polygon draw that polygon.
  - Zone-only alerts draw their forecast-zone geometry.
  - Each alert shows its event, issue and expiry times, and a link to the NWS alert.
  - The overlay is labeled as a weather alert, separate from fire perimeters, smoke and closures. Smoke and perimeters already ship.
- **Acceptance tests:**
  - Fixtures cover a polygon alert, a zone-only alert, an expired alert (hidden) and an empty state.
  - Zone geometry fetch failure shows the alert as a list entry.
- **Dependency:** captured samples. Two capture runs so far found no active alerts. Faster path: the NWS alerts endpoint also returns recent past alerts, which could supply fixtures without waiting for a live event. Not yet verified from here.
- **Status:** buildable once fixtures exist.

### R13. Multi-language es and fr (could, 0.5, partial)

- **Full credit:**
  - The how-to page is translated to Spanish and French.
  - A native-speaker review of the French interface and how-to is completed, with its issues fixed.
  - The Spanish catalogue gets the same review if it has not had one.
- **Acceptance tests:** catalogue parity, the how-to page in each language, and the reviewer's issue list closed with each fix referenced.
- **Dependency:** a native French reviewer, plus Spanish if needed. This is an owner choice and may cost money. Multi-language work is deprioritized for this version.
- **Status:** deferred by owner.

## Point ceiling by decision

| Scenario | Points added | Score |
|---|---|---|
| Build every buildable-now row: R2, R4 to R10 and R12 | +5.5 | 104.5/109 = 95.9 |
| Plus approve the narrow routing contract (R11) | +1.0 | 105.5/109 = 96.8 |
| Plus approve OpenCelliD (R3) | +1.0 | 106.5/109 = 97.7 |
| Plus French reviewer (R13) | +0.5 | 107/109 = 98.2 |
| Plus FCC access restored (R1) | +2.0 | 109/109 = 100 |

R8 and R9 depend on the coverage thresholds the owner sets. If a threshold is higher than the available data can reach, that row stays partial, and each such row costs 1.0 point. That outcome is honest, not a defect.

Correction to the earlier estimate of 5 points depending on parked work. Measured against the original's definitions, 2 rows in that estimate are buildable now:

- R2 needs no modeled coverage.
- R10 needs no router.

Only R1, R3 and R11 depend on parked decisions or external access. Together they are worth 4.0 points.

## Owner decisions needed

1. Approve this method: original behavior sets full credit, and coverage and freshness are reported separately.
2. R8: approve the 50% attributed-amenity threshold or set another.
3. R9: approve visitor-submitted overnight places and the 25-state rest-area threshold.
4. R11: approve the labeled avoid-highways and known-clearance reroute, or keep routing off and accept the cap.
5. R3: approve an OpenCelliD token and share-alike terms, or accept the cap.
6. R13: choose a reviewer, or keep the row deferred.
7. R2 and R4: accept that report-based filters match the original, so these rows move on verification.
