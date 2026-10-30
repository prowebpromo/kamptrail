# Official fee-evidence review — 2026-10-30

Release target: **2.11.1**, compared with deployed 2.11.0 commit `6ff9debd1f62f2e4d78849a978a1f492846f10f4`. These are saved-catalogue measurements, not a guarantee of current availability. All new observations were checked on October 30 UTC (October 29 local Eastern time).

## Measured change

| Catalogue | Total | Free | Conditional | Paid | Unknown |
|---|---:|---:|---:|---:|---:|
| 2.11.0 national catalogue | 33,287 | 2,144 | 59 | 8,289 | 22,795 |
| Reviewed 2.11.1 catalogue | 33,286 | 2,153 | 59 | 8,290 | 22,784 |

**No new camping locations are added in this batch.** Ten existing USFS source records gain individually reviewed official-page fee wording; nine combined catalogue records change from unknown to free. Airplane Flat was already free through OSM and gains independent agency evidence. All retained canonical IDs and coordinates stay unchanged. A single BLM source identity is removed, as described below.

| USFS record | Official site page | Combined catalogue result |
|---|---|---|
| 35347 | [Sulphide Del Rey Campground](https://www.fs.usda.gov/r03/tonto/recreation/sulphide-del-rey-campground) | Unknown → free |
| 35355 | [Jones Water Campground](https://www.fs.usda.gov/r03/tonto/recreation/jones-water-campground) | Unknown → free |
| 35645 | [Airplane Flat Campground](https://www.fs.usda.gov/r03/tonto/recreation/airplane-flat-campground) | Existing free; official evidence added |
| 35651 | [Haigler Canyon Campground and Day Use](https://www.fs.usda.gov/r03/tonto/recreation/haigler-canyon-campground-and-day-use) | Unknown → free |
| 35655 | [Colcord Ridge Campground](https://www.fs.usda.gov/r03/tonto/recreation/colcord-ridge-campground) | Unknown → free |
| 60306 | [Blodgett Campground](https://www.fs.usda.gov/r01/bitterroot/recreation/blodgett-campground) | Unknown → free |
| 60320 | [Gold Creek Campground](https://www.fs.usda.gov/r01/bitterroot/recreation/gold-creek-campground) | Unknown → free |
| 60666 | [Paradise Campground](https://www.fs.usda.gov/r01/bitterroot/recreation/paradise-campground) | Unknown → free |
| 66336 | [Devil's Corkscrew Campground](https://www.fs.usda.gov/r01/flathead/recreation/devils-corkscrew-campground) | Unknown → free |
| 67118 | [Upper Stillwater Lake Campground](https://www.fs.usda.gov/r01/flathead/recreation/upper-stillwater-lake-campground) | Unknown → free |

The USFS source remains 4,571 records: 702 free, 47 conditional, 2,846 paid, 976 unknown. Ten raw unknown fees became free; these counts must not be described as ten new campgrounds.

## Evidence and limits

The maintained observations in `scripts/fixtures/usfs_fee_overrides.json` retain full official fee wording, the dedicated site URL, website `recareaid`, the reviewed name and point, the observation date, nullable page-update date and its basis, and full access context. General page-update dates do not establish when a fee changed. RV limits, seasonal access, group permits and nearby uses remain visible context; the importer does not turn them into invented campsite-level suitability or current-open guarantees.

A positive review applies only to the same record ID and name within 300 metres of the reviewed point. Changed identity, missing geometry, a future check date or an expired review cannot promote an unknown fee. The ten observations have an operational recheck deadline of **2026-11-29**. Imports on or after that day stop applying them until rechecked; this window does not guarantee that the operator will keep fees unchanged. A later EDW fetch retains the original official-page observation date rather than presenting it as a new page check. Existing contradictory fee statements remain unknown with a conflict flag. Required camping/access permits still qualify otherwise free fees. Unchanged Broad Canyon evidence remains conflict-only.

The INFRA `fee_charged=N` inventory is useful for finding review candidates, but its field applies at the recreation-unit level and can coexist with campsite fees or seasonal parking charges. No bulk N-to-free rule, broad secondary-activity name relaxation, guessed coordinate repair or new INFRA location import is included. Deer Mountain / Chuck Best Snowmobile Park is held because its current site has seasonal Sno-Park charges and does not establish free camping. Upper Canyon Creek is held because its current point falls outside the identity radius.

## Independent BLM refresh changes

- Tower Rock Recreation Site (`blm-area:15035`) now publishes `5$ per night campsite fee.` in `RecAreaFeeDescription`. The importer retains that exact wording, source update date 2026-10-29, and retrieval date 2026-10-30, and correctly reads the amount as $5. This is an existing unknown-to-paid record, separate from the already-paid Tower Rock Campground facility record; their names/identities are not forcibly merged.
- Crocodile Staging Area (`blm-area:16439`) is absent from the complete BLM camping-area layer: its validated count changed from 538 to 537, while the facility layer stays at 305. There are zero malformed-row quarantines in this fetch. The stale source marker is removed. Its [official visitor page](https://www.blm.gov/visit/crocodile-staging-area) still exists, so absence is not treated as evidence of closure or a change in permission.
- BLM source: 842 records, comprising 180 free, 10 conditional, 222 paid, 430 unknown. The existing out-of-US point remains in the separate agency state-assignment quarantine.

## Verification and publication

Both complete agency fetches, the pinned Census BAS 2026 polygon assignment, state snapshots and national search were rebuilt. The local source suites pass 86 Python tests before the additional workflow regression; the local Node suite passes 99 with 19 PHP-dependent skips. The final automated release must pass real PHP/MySQL, backup restore, full browser checks and packaging in GitHub Actions before merge.

The guarded agency workflow requires this reviewed census before it commits: `{"total":33286,"free":2153,"conditional":59,"paid":8290,"unknown":22784}`. It refuses a moved branch and runs the full reusable regression workflow against the **new data commit**, because a bot data push alone does not trigger the normal pull-request workflow.

Reproduce from the saved data with `python scripts/build_agency_states.py` and `node scripts/build-search-index.js`; network refreshes can yield later observations. Compare all canonical and legacy identities before reporting additions or improvements. See the preceding audit in `FREE_CAMPING_UPDATE_2026-10-29.md` for the already-shipped 2.11.0 gains.
