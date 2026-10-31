# Completion contracts for the 13 incomplete rows

Date: 2026-10-31. Approved by the owner on 2026-10-31 with the revisions recorded here. The baseline is live release 2.29.1 with a score of 90.8/100, which is 99 of 109 weighted points.

Scope: the frozen 61 scored rows and the 109-point denominator. Accounts, social features, notifications and native navigation stay outside it.

## Scoring rules

- Weights are must 3, should 2 and could 1. A partial row earns half credit.
- A contract's approval earns no points. A row's status changes only on implementation or verification evidence:
  - a merged PR
  - the exact-head CI run ID
  - live `release.json` equal to the merge commit
  - a saved scripted live check, including a saved-session upgrade check
  - an updated `features.csv` row that cites all of the above
- Every row reports three measures separately:
  - **Feature:** the capability works end to end. Only this decides credit.
  - **Coverage:** counts by source and type. Milestones may be set, but they never gate parity credit.
  - **Freshness:** the original observation date, the source update date and the retrieval date, each kept as its own field. A refresh never makes an old observation look new.
- Review-driven features are proven on isolated fixtures and on staging submissions. Those cover submission, moderation, publication and filtering. Production is never seeded. Genuine production submissions are reported as coverage. The deployed client is verified separately.
- Physical-device acceptance is never marked complete from workspace automation. The 2026-11-02 phone test and the 2026-11-23 Forest Service fee backstop stay as scheduled.

## Criterion changes prompted by new source evidence

The earlier matrix rows, statuses and notes are preserved in `features.csv` at commit `b54b4211d9a899680a1d476e1373dbeee030422b`. Before this review, the rows were inherited scope. The old evidence column reads "Archived descriptions/reviews support major functional areas", with no source reading.

The FreeRoam source, read on 2026-10-31, sets the functional bar for each row. Every change below lowers or clarifies a bar, or adds a requirement. None of them awards points.

| Row | Earlier implied bar | Approved bar | Why |
|---|---|---|---|
| R2 Cell-signal filter | Modeled FCC coverage required | Dated visitor reports | Original filtered on review-derived per-carrier signal |
| R4 Road difficulty | Source road data control required | Visitor reports, 3 levels as an accepted adaptation | Original was a review-derived 1–5 value |
| R9 Overnight places | Licensed commercial locations | Visitor-submitted places plus official rest areas | Original overnight places were visitor-submitted |
| R10 Low clearance | Correct association with the driven road | Route-context display with explicit unresolved flags | Original used a narrow buffer plus road-name matching |
| R11 Rig routing | Legal and restriction tests | Avoid-highways plus bounded known-clearance rerouting | Original was car costing plus clearance retries |
| R8 Amenities | "Broader agency amenities", undefined | Attributed display or explicit no-evidence for every supported source class | Removes an undefined coverage bar |
| R9, R8 milestones | — | 25 rest-area states and 50% amenity coverage as milestones only | Not inherited from FreeRoam |

A score change is recorded in `features.csv` only when its row's evidence exists. Each change gets its own entry in "Score history" below.

## Original source references

Each reference is pinned to an immutable commit. All were fetched and line-checked on 2026-10-31.

- Frontend: `FreeRoamApp/free-roam` at `f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14`.
- Backend: `FreeRoamApp/back-roads` at `bbbdc950008becde1428ba25dacfdc6a790910e9`. The files below fetched successfully at this commit. `services/routing.coffee` is byte-identical to the `master` copy read earlier.

| Behavior | Reference |
|---|---|
| Carrier coverage layers for Verizon, AT&T, T-Mobile and Sprint, as static fill tiles | free-roam `src/services/map.coffee` L492–575 |
| Review dimensions: road difficulty, shade, cleanliness and safety as integers. Crowds and fullness by season. Noise by day and night. Cell signal per carrier as JSON | back-roads `models/campground_review.coffee` L49–58; aggregates in `models/campground.coffee` L41–48 |
| Campground filters: cellSignal, seasonal crowds and fullness, roadDifficulty, shade, safety, day/night noise | free-roam `src/services/map.coffee` L254–355 |
| Hazard filters: wildfire subtype, low clearance with `heightInches` ≤ rig height | free-roam `src/services/map.coffee` L356–384 |
| Overnight subtypes: Walmart, truck stop, rest area, casino; visitor-submitted, with `isAllowedScore` | free-roam `src/services/map.coffee` L386–420; back-roads `models/overnight.coffee` L36, L156 |
| Smoke and fire-weather overlays, dated JSON | free-roam `src/services/map.coffee` L576–625 |
| Rig height and avoid-highways trip settings | free-roam `src/components/edit_trip_settings/index.coffee` L28–40 |
| Routing: Valhalla `auto` costing, `use_highways: not avoidHighways`, retry around low clearances, up to 3 attempts and 50 avoid points | back-roads `services/routing.coffee` L113–160 |
| Clearance check: 0.003-mile buffer around the route, heights ≤ rig height. A hazard counts when it is a tunnel, under a non-road, or has a road name that matches a maneuver street name (substring, or string similarity above 0.7) | back-roads `services/routing.coffee` L227–271 |
| Cell towers named by carrier and technology | back-roads `models/cell_tower.coffee` L9–39 |

Correction to the first draft: the original did not match clearances by distance alone. It also compared each hazard's road name with the route's maneuver street names, and it treated tunnels and under-non-road hazards separately.

## Contracts

Each contract has three parts:

- **Source:** verified FreeRoam behavior.
- **Adaptation:** accepted KampTrail differences.
- **Added:** KampTrail requirements beyond the original.

### R1. Carrier coverage overlay (should, 2.0, no)

- **Source:** separate fill layers per carrier.
- **Added:** each layer is dated and attributed, and Verizon, AT&T and T-Mobile can each be selected on their own.
  - Missing data is shown separately from no coverage.
  - Tests cover covered, uncovered, missing, stale and unavailable states.
  - Offline: a cached layer shows its data date and a "not current" label. It never implies current coverage.
- **Dependency:** authorized automated FCC Broadband Data Collection access. FCC ticket #64052 is open.
  - No credential retries.
  - No manual nationwide download maintenance.
  - No purchased substitute.
- **Credit:** awarded for the working, verified feature only. Restored access alone earns nothing.
- **Status:** blocked externally.

### R2. Cell-signal filter (could, 0.5, partial)

- **Source:** filter on per-carrier signal taken from reviews.
- **Adaptation:** dated visitor reports. No modeled coverage.
  - The KampTrail signal levels are published with their relation to the original 1–5 scale.
  - No numeric precision is manufactured from categorical reports.
  - Radio technology is kept where reported.
- **Verify:**
  - carrier selection and signal thresholds
  - unknown handling and stale evidence
  - matching map, list and route results
- **Status:** verification first. If the existing feature passes, verification completes the row.

### R3. Estimated cell locations (could, 1.0, no)

- **Source:** tower places named by carrier and technology.
- **Adaptation:** a free OpenCelliD pilot.
  - Records are labeled "estimated cell location", never "tower".
  - Network, operator and technology are shown only when reliably mapped. Unknown mappings stay unknown.
  - Record counts are never presented as tower counts.
  - No coverage circles.
- **Before public integration:**
  - document the current account terms and CC BY-SA 4.0 attribution
  - document the changes made and the ShareAlike and database obligations, reviewed against the actual transformation and publication design
  - validate pilot size, maintenance and mobile performance
- **Allowed sources:** permitted bulk or incremental downloads only. No paid plan. No unbounded visitor-facing API use.
- **Owner step:** account registration, if it needs the owner. All other preparation is done first. Tokens never appear in code, logs or chat.
- **References:** https://docs.opencellid.org/docs/attribution and https://docs.opencellid.org/docs/help/troubleshooting.

### R4. Road-difficulty filter (could, 0.5, partial)

- **Source:** review-derived road difficulty on a 1–5 scale, filtered by maximum.
- **Adaptation:** the 3-level visitor approach-road scale (easy, moderate, difficult).
- **Verify:**
  - a maximum-difficulty control
  - provenance and dated reports
  - unknown never treated as easy
  - matching discovery results
- **Not required:** an agency road-difficulty dataset.
- **Status:** verification first.

### R5. Review sub-scores (could, 0.5, partial)

- **Source dimensions:**
  - road difficulty
  - crowds by season
  - fullness by season
  - noise by day and by night
  - shade
  - cleanliness
  - safety
  - per-carrier signal
- **Adaptation:** personal comfort replaces subjective safety.
- **Added:**
  - Every dimension is optional.
  - Visit dates, counts, moderation, author editing and removal, and unknowns are preserved.
  - Categorical observations stay separate from numeric satisfaction scores. No conversion without an approved, documented mapping.
  - A published numeric average needs at least 3 qualifying ratings.

### R6. Condition filters (could, 0.5, partial)

- **Source:** slider filters over the R5 dimensions, including seasonal crowds and day/night noise.
- **Added:**
  - Each scale's direction is stated.
  - Tests cover boundaries, combined criteria, unknowns and conflicting observations.
  - Criteria that describe one visit must match within that same visit. Reports from different visitors are never combined into a visit that did not happen.

### R7. Seasonal sub-scores (could, 0.5, partial)

- **Source:** crowds and fullness per season.
- **Added:**
  - Seasonal crowds and fullness are shown with counts, alongside the existing seasonal numeric aspects.
  - The minimum sample applies.
  - Only visit data that explicitly applies to a season enters it.
  - Tests cover insufficient samples, season boundaries, edits and removals.

### R8. Amenities (should, 1.0, partial)

- **Source:** campground amenities shown in place details.
- **Added:**
  - Every supported source class shows its evidence with source, scope and date, or an explicit no-evidence state.
  - Known values, explicit negatives, conflicts and unknowns stay distinguishable.
  - Amenities tied to one site or loop never become campground-wide claims.
- **Recreation.gov-linked reporting:** three separate counts:
  - listings eligible for an exact join
  - listings with evidence attached
  - listings with at least one known amenity value
- **OSM:** amenity-tag ownership is audited before any tag is shown, so merged records do not reintroduce inherited or borrowed amenities.
- **Coverage:** reported by source and by amenity type. The 50% overall figure is a milestone, not a gate.

### R9. Overnight places (should, 1.0, partial)

- **Source:** visitor-submitted overnight places with subtypes and an allowed score.
- **Adaptation and added:**
  - Categories: stores, truck stops, casinos, rest areas and other.
  - Required: coordinates, moderation, duplicate handling, dated visitor permission reports, and source attribution where available.
  - Discovery and filtering are verified in map, nearby and route results.
  - Visitor reports, official rules, ordinary parking, sleeping and camping stay distinct. A brand name or a submission never establishes permission.
  - Existing IDs and saved places stay compatible.
- **Rest areas:** expansion continues. 25 states is a milestone. No paid feed.

### R10. Low-clearance discovery (could, 0.5, partial)

- **Source:** clearance hazards filtered by rig height. Route checking uses a narrow buffer plus road-name, tunnel and under-non-road logic.
- **Added:**
  - National OSM processing (ODbL, attributed) plus moderated visitor-reported clearances, with maintainable update safeguards.
  - Raw values, normalized units, source dates and unknowns are preserved.
  - Tests cover clearances below, equal to and above the rig height. Equality is never treated as comfortable clearance.
  - Nearby hazards are distinguished from hazards associated with the driven road. Unresolved road or direction relationships are flagged, with no claim of passage or avoidance.

### R11. Highway avoidance and known-clearance rerouting (could, 1.0, no)

- **Source:** car routing, an avoid-highways setting, and rerouting around relevant known low clearances. Up to 50 points and 3 attempts.
- **Added:**
  - Limits are disclosed.
  - Behavioral tests prove actual avoidance. Tests also cover equality, parallel roads, direction ambiguity, unresolved hazards, invalid dimensions, provider errors, quota exhaustion and stale results.
  - Changing stops, rig height or settings invalidates incompatible routes and caches.
  - A failed avoidance is reported as a failure. An ordinary car route is offered only by explicit user choice.
  - The limitation stays visible: known mapped clearances only. No legal access or RV-safe passage is implied.
- **Out of scope:** truck-legal routing, weight and width enforcement, and RV-access certification.
- **Before public release:** verify provider terms, free-tier entitlement, caching and GPX rights, request budgets and production behavior. No paid service.

### R12. Fire-weather overlay (could, 0.5, partial)

- **Source:** a dated fire-weather polygon overlay, separate from smoke.
- **Added:**
  - NWS Red Flag Warnings and Fire Weather Watches, kept separate from smoke, perimeters and closures.
  - Tests cover polygon alerts, zone-only alerts, expiry, cancellation, empty results, stale data and geometry-fetch failure.
  - A usable alert list remains when geometry is unavailable.
- **Fixtures:**
  - Captured from the NWS `/alerts` endpoint (the previous 7 days), with capture URL, timestamp and hash.
  - Synthetic edge cases are labeled synthetic.
  - Historical fixtures are never shown as current alerts.

### R13. Spanish and French (could, 0.5, partial)

- **Added:**
  - Translate the remaining first-party how-to content.
  - Audit dynamic UI, errors, and permission, fee, closure and clearance wording.
  - Prepare a reviewer brief and source a qualified native French reviewer.
  - Check for existing Spanish review evidence.
- **Spending:** a fixed-price quote goes to the owner for approval before any cost. No AI check is presented as a native review.
- **Verify:** reviewer findings are closed with referenced fixes. Tests cover persistence, fallback labels, mobile layout, placeholders and offline use.

## Execution order

1. Merge this document.
2. Verify R2 and R4.
3. Build R5, then R6 and R7.
4. Build R8 and R9.
5. Build R12.
6. Build R10, then R11.
7. Run the R3 pilot.
8. Prepare R13.
9. Build R1 when access works.

Independent packages may run while another is blocked. Shared modules (`data-loader.js`, `community*.js`, locale catalogues, versioned files) are changed one package at a time.

Escalate to the owner only for:

- authentication
- new spending
- unresolved license obligations
- destructive changes
- material departures from these contracts

## Score history

| Date | Release | Score | Change | Evidence |
|---|---|---|---|---|
| 2026-10-31 | 2.29.1 | 99/109 = 90.8 | Baseline for these contracts | `docs/replica/parity-queue.md` |
| 2026-10-31 | 2.30.0 | 100/109 = 91.7 | R2 cell-signal filter and R4 road-difficulty filter partial to yes (+0.5 each) after verified live 2.30.0 and an end-to-end submission-to-filter test | `docs/replica/evidence/2026-10-31-live-2.30.0.txt`, PR #146 run 41239742146 |

## Reproducible score calculation

```
python3 - <<'EOF'
import csv
w = {'must': 3, 'should': 2, 'could': 1}
rows = [r for r in csv.DictReader(open('docs/replica/features.csv'))
        if r['priority'] in w and r['original'] == 'yes']
earned = sum(w[r['priority']] * {'yes': 1, 'partial': 0.5}.get(r['clone'], 0) for r in rows)
possible = sum(w[r['priority']] for r in rows)
print(len(rows), earned, possible, round(100 * earned / possible, 1))
EOF
```
