# Cell-signal and road-approach filters, 2.30.0

Status: owner-approved criterion. Written before the code that implements it.

Original source for the comparison: FreeRoamApp/back-roads, commit
`bbbdc950008becde1428ba25dacfdc6a790910e9`, `models/campground.coffee` L47.

## R2. Cell-signal filter

The filter works from dated visitor reports. It never predicts coverage.

1. Carrier selection: AT&T, Verizon, T-Mobile or Other carrier.
2. Signal thresholds: "No service reported", "Weak or better", "Usable or better", "Strong".
3. Unknown handling: a site with no report for the chosen carrier and threshold never matches. Missing is not "no service".
4. Stale evidence: reports older than the Observation age setting are ignored. The date of each report is shown.
5. Consistency: the map, the list and route-corridor results use the same matcher and the same published evidence.
6. Radio technology: a report may name the technology (LTE or 5G). It is shown where reported. Reports without it show nothing extra. The optional "Reported technology" filter matches only reports that name that technology.
7. Scale mapping: KampTrail levels are mapped to the original per-carrier 1 to 5 scale as ordered categories. No numeric precision is manufactured.

### Mapping table

| KampTrail level | Relation to the original 1 to 5 per-carrier bars |
| --- | --- |
| No service | No usable signal. Below the original's 1. |
| Weak | Approximately the low range |
| Usable | Approximately the middle range |
| Strong | Approximately the high range |

Weak, Usable and Strong are ordered categories (Weak < Usable < Strong). No numeric equivalence is claimed. A KampTrail "Usable" is not a 3.

### Radio technology values

| Stored value | Meaning |
| --- | --- |
| `lte` | Visitor reported LTE |
| `5g` | Visitor reported 5G |
| `unspecified` | Visitor did not say. Accepted by the API and stored as no field, so cohorts do not fragment. |

## R4. Maximum approach difficulty

The control filters the 3-level visitor approach scale. This is an accepted adaptation of the original 1 to 5 scale.

1. Rank: easy = 0, moderate = 1, difficult = 2.
2. A report matches when `rank(report.access) <= rank(filter.observed_access)`.
3. Options: Any, "Easy only", "Up to moderate", "Up to difficult". Stored values stay `easy`, `moderate`, `difficult`, so filters saved in localStorage load unchanged. A saved `moderate` now means "Up to moderate", which is the wider reading of the same choice.
4. Unknown never means easy. A report with no access value, or an unrecognised one, never matches any maximum.
5. Provenance: every rating is a visitor report with a visit date. The popup and the match note show the dates.
6. Consistency: map, list and route results use the same matcher.

### Mapped road surface is not difficulty

Bundled campsite rows carry a legacy `road_difficulty` field with the values paved, gravel, dirt and unknown. These are surface labels, not approach difficulty.

Finding: no script in this repository assigns a non-null value. The current builders (`merge_campsite_data.js`, `scrape_recreation_gov.js`, `scrape_campendium.js`, `fetch_recreation_gov_data.py`, `convert_axiom_to_geojson.js`) write `null`. The surviving values in the bundled state files come from two places: legacy `recreation.gov` rows (already blanked at load unless `schema_version` is 3 or higher) and rows with `source: "generated"`, which are placeholder records with no external source. Neither can be attributed to a surface survey or an OSM `surface` tag. The popup therefore no longer shows the field. It is never labelled difficulty. The `roadDifficulty` option in `data-quality.js` `applyFilters` has no UI and is left in place with a comment that it compares a surface label only.

## Out of scope

No change to the FCC link, the aggregate API shape beyond the optional `radio` key, or any other filter.
