# Probably-free fee pilot: first 30 results

**Decision: stop the remaining 20 records and change the method.** Independent review credits **4 of 30 evidence resolutions (13.3%)**, below the predeclared minimum of nine. No fee classifications, manual overrides or production data were changed by this audit.

This records the frozen experiment against main `6f46c79e8a0f071e396334f0f18ebce1f3489712`, before any separately reviewed parser/data repair. Later releases may change the live census. The full machine-readable audit is [2026-10-30-first 30-results.json](2026-10-30-first 30-results.json). The original method and thresholds remain in [PROBABLY_FREE_PILOT.md](PROBABLY_FREE_PILOT.md).

## Result against the fixed gates

| Measure | Observed | Interpretation |
|---|---:|---|
| Attempts | 30 | Fixed IDs/order; none replaced |
| Evidence-resolved | 4/30, 13.3% | Fails interim minimum 9/30 |
| Dated free evidence | 2/30, 6.7% | Includes one current-conditions-only case |
| Free share of resolutions | 2/4, 50% | Does not override the failed resolution gate |
| Paid evidence | 2/30 | Both selected canonical records remain unchanged in production |
| Unknown after review | 26/30 | Conflicts, missing evidence and unresolved crosswalks retained |
| Maintenance-ready or published changes | 0 | Evidence resolution is not an approved production override |
| New free physical places | 0 | These were already catalogued places |

| Targeting stratum | Attempted | Evidence-resolved | Free | Paid |
|---|---:|---:|---:|---:|
| Dispersed | 9 | 0 | 0 | 0 |
| Primary agency, not dispersed | 9 | 4 | 2 | 2 |
| Remaining OSM federal-operator leads | 12 | 0 | 0 | 0 |

This small, deliberately stratified feasibility sample does not estimate a national conversion rate. No further records may be reviewed under the same experiment merely to improve its yield.

## Four evidence resolutions, each still requiring publication work

- **Aspen Grove, USFS 11263: paid.** The exact official record/name/coordinates match and its dedicated fee field states an ordinary per-night fee. Currency is not explicit, so no dollar cost is invented. Its description calls the same record Aspen Campground; no separate name-only join was used. [Official structured source](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query?f=json&where=recareaid%3D11263&outFields=recareaid%2Crecareaname%2Clatitude%2Clongitude%2Crecareaurl%2Cforestname%2Cmarkeractivity%2Cfeedescription%2Crestrictions%2Copenstatus&returnGeometry=false).
- **Heaton Bay, USFS 40863: paid.** The dedicated official page matches the title and coordinates and supplies a single-site overnight rate. Other site types/rates are not inferred. The page is outside the accepted ten-record baseline. [Official page](https://www.fs.usda.gov/r02/whiteriver/recreation/heaton-bay-campground).
- **Rio Chama, USFS 75504: free evidence.** The exact named/coordinate-matched record expressly describes its campground as no-fee. The fee field is empty, exposing a structured description-extraction gap. This needs an approved, scoped recurring parser adapter before publication. [Official structured source](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query?f=json&where=recareaid%3D75504&outFields=recareaid%2Crecareaname%2Clatitude%2Clongitude%2Crecareaurl%2Cfeedescription%2Crecareadescription&returnGeometry=false).
- **Penny Springs, USFS 70865: dated current-free evidence only.** Current Conditions explicitly says no fees are collected while water, trash and toilet-cleaning services are suspended. The header says Site Partially Closed; general seasons are mid-May to mid-September. Page coordinates differ by about 196 m, within the existing 300 m identity check. No conflicting ordinary camping price was found. This supports only the current published condition as retrieved October 30, not a stable normal fee, access permission or future opening. The ten-record maintenance adapter requires a dedicated fee section, which this page lacks. [Official page](https://www.fs.usda.gov/r04/boise/recreation/penny-springs-campground).

Exact compact fee excerpts, source URLs, check metadata and raw response hashes are retained in the JSON. Human observation and provider modification dates are kept separate.

## Independent corrections and withheld credit

Workers initially reported seven provisional resolutions, then withdrew Mee Corner. Independent canonical review also withheld Paha and Shafer Butte, yielding the four credited results above.

- **Paha:** selected `osm:way:332687399` is unknown, while separate `usfs:65214` is already paid. The OSM website supplies a useful source-ID lead, but no approved canonical alias/crosswalk currently propagates the fee. Keep it as identity/dedup work, without gate credit.
- **Shafer Butte:** selected `usfs:5087` is unknown, while separate `osm:way:1186910591` already has a paid classification. A Recreation.gov gateway card advertises a minimum overnight rate, but the manual name/forest/description join is not an approved canonical crosswalk. No gate credit or new paid physical place is claimed.
- **FR9350 and Big John's Flat:** official free agency records already exist separately from the selected unknown OSM records. Polygon containment or identical coordinates plus a similar name does not install an approved crosswalk. Neither counted as a new free place or resolution.
- **Mee Corner:** provisional conditional credit was withdrawn. The official map/name/river-context join is not an exact policy-ID crosswalk. The booking authority charges a mandatory non-refundable reservation fee, and agency/booking calendars disagree. Existing fee classification of the full wording is paid, not conditional. Uncertainty is retained as unknown, with no asserted season or price. [Agency policy](https://www.blm.gov/visit/ruby-horsethief-canyon-permits), [booking policy](https://www.recreation.gov/permits/74466), [official campsite map](https://www.blm.gov/sites/blm.gov/files/documents/files/Ruby_Horsethief_Campsites_legal_20200416.pdf).
- **Bonneville:** a current waiver/normal paid-rate combination and roughly 800 m coordinate discrepancy remain unresolved.
- **Windy Saddle:** OSM fee=no conflicts with an exact USFS alias's paid overnight statement. Retrieval recency does not establish which source has precedence.

The existing canonical comparison is pinned by the frozen search-index hash in the JSON, rather than inferred from primary-source-feed row counts.

## Time and evidence integrity

Per-record active attention was not separately measured. Three worker assignment-to-final-logging/QA outer bounds sum to **26.97 minutes**, or **0.899 minutes per attempted record**. These include orchestration and unattended network waits. They are not measured active productivity, a median, or a certified all-in time-gate pass. Independent aggregation/review/report-writing overhead is not attributed to individual records. Active-time fields remain null.

The failed resolution gate is sufficient to stop, so no favorable timing interpretation is needed. Any follow-up experiment should instrument active review separately from network time and include independent QA cost.

Verified the frozen report SHA256 `7f6102e5b9ac0e11646ab55aaba05616353fe2384561c67e8a5030dc14a132f9`, seed `kamptrail-fee-pilot-v1`, all 30 IDs/names/order, the three disjoint assignments, and **84 raw receipt hash checks across 79 unique artifacts**, with no mismatch. The current saved index still matches the frozen input hash. Extra discovery queries supported assigned cases and were not additional pilot records. Entire provider pages are not copied into this documentation PR; compact reviewed excerpts, URLs and hashes are durable in the JSON.

## Change the method before another batch

Prioritize source-level parsing gaps and explicit canonical crosswalk/dedup repairs. Review the two structured USFS extraction candidates separately, using current complete raw records, regression cases for ancillary/conditional fees, and a full before/after census. Do not mass-promote operator tags or dispersed classification to free.

An expanded page review needs a separately declared experiment with a new method/seed and the same explicit measurement discipline. Additional maintained observations also need an approved recheck mechanism. The existing ten-record [maintenance pilot](../USFS_FEE_RECHECK_PILOT.md) and November 23 verification backstop remain in place; today's receipts alone do not establish a successful future weekly run.
