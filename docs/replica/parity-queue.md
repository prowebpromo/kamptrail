# Active FreeRoam comparison and build queue

Updated for the 2.9–2.11 work. This is an implementation queue, not a new parity score. Earlier matrix scores are historical: the original runtime is unavailable and some inherited original-feature claims remain uncertain. Do not describe completion of a reduced camping-planning scope as 100% historical FreeRoam product parity.

## Established capabilities

- Published community rating/review-count filters, moderated review/photo lifecycle, and same-visit approach/noise/shade/crowding/comfort/carrier observations shipped in 2.9. Signal observations are not predicted coverage. Numeric/seasonal subscores remain incomplete.
- Dated NIFC perimeter and NOAA satellite-smoke layers plus NWS point alerts shipped in 2.10. The live NWS query defect was fixed by PR83. Regional fire-weather risk, broad restriction feeds, forecast discovery and elevation filters remain incomplete.
- 2.11 improves authorized agency camping/fee evidence and geographic validation. Measure actual catalogue deltas after screening and deduplication; a source record is not necessarily a new place or a newly free campground.

## Release sequence

| Order | Package | Completion gate |
|---|---|---|
| 1 | Verified free-camping coverage | Full source wording and provenance; primary/secondary activity identity checks; fee/permit/season conflicts; actual new-place versus enrichment counts; regional source samples; correct state containment and explicit quarantine. |
| 2 | Elevation and forecast discovery | Batch/static elevation data; bounded, cached forecast grids and explicit date periods; common map/route predicate; missing/expired nonmatches; units/time-zone/rate-limit/mobile checks. |
| 3 | More services and overnight permission | Showers, laundry, groceries, fuel; separate operator/agency permission and dated moderated reports. Brand, parking availability, land ownership and majority votes never establish permission. |
| 4 | Portable rig profile and route elevation | Local dimensions/preferences and export/import; apply preferences consistently; bounded route sampling and accessible text. Terrain elevation cannot prove bridge/tunnel clearance or road grade. |
| 5 | Enforced routing restrictions | Sourced restriction hazards first; actual height/weight/length avoidance only through a backend that can enforce them. Current OSRM car routing cannot acquire RV capabilities from a checkbox. Verify known restricted routes and unresolved coverage. |
| 6 | Community/media depth | Dated overnight reports, supported seasonal summaries/subscores, moderated videos and author management/removal. An external video link is a useful increment, not a complete upload pipeline. |
| 7 | Language support | Extract UI strings, reviewed translations, locale dates/units and visible fallback; cover errors, accessibility and offline screens. Exact historical language claims remain unverified. |

FCC predicted coverage and cell towers remain a separate lane. Resume only after a real authentication/data pilot succeeds and usage is confirmed. Tower locations must not be presented as usable carrier service.

Across packages, preserve portable saves, moderation operations, mobile/keyboard access, dated unknown/offline handling and rollback. Finish the offline-readiness display and verify a real-phone cold launch; desktop automation alone does not complete that gate.

## Full-product scope still missing

Accounts/profiles, cross-device synchronization, friends/messages/groups/events, notifications and native navigation remain real full-product gaps. Donations/partners and editorial product guides remain business/editorial exclusions. Some archived descriptions support video and tower discovery; source-verified functionality must be distinguished from uncertain inherited matrix rows. Update evidence before changing weights or publishing a new score.

## Verification after every package

1. Run relevant unit/source-contract regressions and required full checks.
2. Review actual input/output diffs, identity conflicts, source failures and published counts.
3. Merge/deploy only tested work; verify real provider responses from the host and core live UI flows.
4. Record what passed and what remains partial, then continue to the next package. External access or billing blockers do not stop independent work.
