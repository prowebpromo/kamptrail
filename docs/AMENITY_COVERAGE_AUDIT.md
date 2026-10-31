# R8 amenity coverage audit

Read-only audit of origin/main at b54b421 (PR #143). No app code was changed. Date of audit: 2026-10-31.

## Method

- The app's own `data-quality.js` was run in Node over every file the app loads. For each of the 50 states the run loaded `{ST}_merged.geojson` plus `agency/{ST}.geojson` where `agency/index.json` lists the state. It then applied `publicationCandidates`, `normalizeFeature`, the three sidecar attaches and `cleanAndDedupeGeoJSON`, as `mergeLoaded` does (data-loader.js:150-186, 215-230).
- Result: 33,370 listings. This equals `search-index.json` exactly, so the simulation reproduces the published catalogue.
- OSM tag ownership was tested against the retained raw OSM extract in `data/opencampingmap/*.geojson` (63,441 rows, 47,342 unique element ids). A tag counts as owned only if the listing's own OSM element carries that key with the same value.
- Scratch scripts and intermediate JSON are in the session scratchpad, not in the repo.

## 1. How the catalogue is built

Pipeline:

1. Raw sources: `data/campsites/{ST}.geojson` (Recreation.gov, 48 files) and `data/opencampingmap/{ST}.geojson` (OSM, 50 files).
2. `scripts/merge_all_states.js` and `scripts/merge_campsite_data.js` merge them into `{ST}_merged.geojson` (50 files, 64,280 rows: 60,130 OSM and 4,150 Recreation.gov, 48,710 unique ids).
   - Dedupe rule: `areDuplicates` (merge_campsite_data.js:138-156) merges on the same facility id, the same OSM id, or distance under 500 m with name similarity above 0.85.
3. `scripts/fetch_usfs_recreation.py` and `scripts/fetch_blm_recreation.py` write `data/campsites/agency/{ST}.geojson` (5,412 rows: 4,571 `usfs`, 536 `blm-area`, 305 `blm-facility`). These are not merged by the merge script. The app loads them beside the merged file (data-loader.js:219-222).
4. At load, `cleanAndDedupeGeoJSON` merges again on same normalized name within 300 m (data-quality.js:230-270).
5. `scripts/build-search-index.js` runs the same publish path and writes `search-index.json` (33,370 sites). There are no shard files. Per-state files are the shards.

Campendium and iOverlander are defined as sources in merge_campsite_data.js:431-435. No such files exist, and no listing carries those sources.

Files the app loads (data-loader.js:76, 121, 190-230):
- `index.json`
- `agency/index.json`
- `{ST}_merged.geojson`
- `agency/{ST}.geojson`
- `ridb-sites.json`
- `ridb-amenities.json`
- `usfs-site-amenities.json`
- `search-index.json`

`ridb-amenities-audit.json` is not loaded.

### Unique listings per class in the published catalogue

Class is the canonical id prefix in `search-index.json`.

| Class | Listings | Note |
|---|---|---|
| osm | 28,618 | 1,727 also absorbed a USFS record, 136 carry a Recreation.gov id alias |
| ridb | 2,020 | 592 also absorbed at least one OSM element |
| usfs (Forest Service recreation area, `usfs:`) | 2,204 | 2 carry a Recreation.gov alias |
| blm-area | 528 | |
| Total | 33,370 | |

- Host class depends on load order. My viewport-independent simulation gave osm 28,628 and usfs 2,194, so 10 listings swap class. Counts above are the published index.
- The 305 `blm-facility` records appear in no canonical id. They were absorbed into other listings or dropped by the camping classification.

## 2. Amenity sources

| Source | File | Granularity | Join |
|---|---|---|---|
| Recreation.gov campsites | `ridb-amenities.json` | Counts of overnight campsite records per facility: reported, negative, unknown, conflict. 2,163 facility ids (2,020 primary, 143 alias-only). 1,446 have overnight records, 53,693 records in total. | Exact: `ridbFacilityIds(p)` on `p.id` and `legacy_ids` matching `ridb:N` (data-quality.js:288-293, 313-326) |
| Recreation.gov hookups | `ridb-sites.json` | Per-facility site counts for electric, water, sewer and RV length | `p.facility_id` only (data-quality.js:385-387) |
| Forest Service site layer | `usfs-site-amenities.json` | Verbatim water and restroom text per Forest Service record, with normalized class. 685 facilities, 690 records, retrieved 2026-10-31, CC BY 4.0. | Exact, through the Recreation.gov id only (data-quality.js:372-383) |
| OSM | tags on `{ST}_merged.geojson` rows | Per element | None (the tag is on the row) |
| `usfs:` and `blm-area:` agency rows | `agency/{ST}.geojson` | `amenities` is empty on all 5,412 rows. No other amenity field exists. | None |

### OSM tag ownership

Findings, with evidence:

- Fee, charge and access tags are guarded. They are moved to `member_evidence` and not inherited: merge_campsite_data.js:17-18 (`osmTag`, `ownedOsmField`), :22-44 (`memberEvidence`), :238-251.
- Amenity tags are not guarded.
  - `mergeProperties` builds `{...secondary, ...primary}` (:207-209). Any OSM key the kept record lacks is copied from the absorbed record.
  - `osmTag` matches only `fee`, `charge` and `access`. `toilets`, `drinking_water`, `shower`, `sanitary_dump_station`, `power_supply`, `bin`, `openfire`, `fireplace` and `picnic_table` are not in the stripped set.
  - `amenities` and `rig_friendly` arrays are unioned unconditionally (:214-215).
- Client side repeats the gap.
  - `normalizeFeature` sets `osm` true when `raw.osm_id != null` or `raw.tourism` is camp_site or caravan_site (data-quality.js:80). `tourism` is itself inherited, so a Recreation.gov host that absorbed an OSM element is treated as OSM.
  - It then derives `p.amenities` and `p.amenity_negatives` from the `toilets`, `drinking_water`, `sanitary_dump_station`, `fireplace`, `picnic_table` and `shower` tags (:132-139).
  - `mergeFeatures` unions `amenities` and `amenity_negatives` with no ownership check (:204-205), while its fee and access logic does check.

Measured on the 33,370-listing catalogue (raw tags in the published rows, compared with the listing's own element):

| Host | Listings with at least one non-owned OSM amenity-type tag | Tag instances |
|---|---|---|
| ridb (no OSM tag of its own; all OSM tags are borrowed) | 180 | 517 |
| osm (inherited from an absorbed OSM element) | 49 | 119 |
| Total | 229 | 636 |

- Borrowed instances on ridb hosts, by tag:
  - drinking_water 142
  - toilets 125
  - power_supply 66
  - shower 59
  - sanitary_dump_station 51
  - picnic_table 35
  - openfire 33
  - bin 4
  - fireplace 2
- Donor type: in 15 listings every donor element has a site-style name (matches the merger's own `INDIVIDUAL_SITE_NAME` regex). In the other 214 listings the donors are not site-named, so most are likely a duplicate way or node of the same campground. Ownership still does not transfer.
  - Example: `osm:node:2462384222` "Backcountry 1" absorbed 9 individual-site nodes and inherited `sanitary_dump_station`, `openfire` and `picnic_table`.
- First donor wins. One listing has donors that disagree on `drinking_water`, and the disagreement is not recorded. `data_conflicts` tracks cost only (:203-205).

What is displayed now:

- Yes. data-loader.js:355 prints "Amenities reported:" followed by `p.amenities`. That list comes from OSM tags through data-quality.js:132-139, with no source, scope or date.
- 4,436 listings show a non-empty line (osm 4,281, ridb 149, usfs 6). The same 4,436 carry `m.a` in `search-index.json` (build-search-index.js:46).
- 188 of those listings show at least one value not owned by the listing: ridb 149 (all of them), osm 36, usfs 3.
- Borrowed values on ridb hosts, by amenity (listings): toilet 121, water 83, picnic_table 33, dump 11, shower 7, fire_ring 2.
- Not shown anywhere:
  - `power_supply` (3,093 listings carry it on their own element)
  - `bin` (152)
  - `openfire` (1,358)
  - `amenity_negatives`
  - raw values other than yes or no
- The amenity filter (filters.js:5, data-quality.js:487) uses `p.amenities` only. It filters on borrowed values and ignores the Recreation.gov and Forest Service evidence.
  - Example: 221 listings have Recreation.gov records reporting toilets, and 209 of them are invisible to the Toilets filter.
- `amenity_negatives` grows on each normalization pass because it is copied and pushed without dedupe (data-quality.js:129, 136). One listing holds 255 entries with 5 distinct values. It is never displayed, so the effect is memory only.
- OSM date available: `source_retrieved_at` on every OSM row (fetch date), `check_date` on 296 listings that own it. Neither is shown.

## 3. Recreation.gov-linked listings

Three separate counts (a, b, c). Population is the same in all three: listings with a Recreation.gov id or alias.

| Count | Definition | Listings |
|---|---|---|
| (a) | Eligible for an exact join: `ridb:` id in `id` or `legacy_ids` | 2,158 (ridb 2,020, osm 136, usfs 2) |
| (b) | Evidence attached | 2,158 have a sidecar entry. Strictly: 1,448 have a record that says something. |
| (c) | At least one known amenity value (present or absent) | 1,324 |

Details on (b):
- `ridb_amenity_evidence` is attached to all 2,158.
- 1,446 of them have at least one overnight campsite record.
- 2 more have only Forest Service evidence.
- The other 710 attach an entry with 0 records. The popup says "No overnight campsite records in this snapshot", which is an explicit no-evidence state.
- `usfs_site_evidence` is attached to 685 (ridb 663, osm 22).

Details on (c). Count is the union of three sources, each listed alone:
- Recreation.gov sidecar: 1,088
- Forest Service site layer: 672 (water or restroom class not unknown, no conflict)
- Recreation.gov hookup counts above 0: 371
- Union: 1,324
- Of the 1,448 listings with evidence, 124 have no known value (all fields blank or unknown).
- Explicit negatives are rare.
  - The sidecar has negative values in 2 listings and a conflict in 1.
  - The Forest Service layer has 132 listings with a stated negative (no water, not for drinking, no toilets, or nearby only).

Scope check, Recreation.gov-sourced:
- The sidecar popup is correctly scoped: "mentioned in N of M records" (data-loader.js:287-298), with the note that counts describe records, not fixtures.
- Hookups: "electric at N sites" is scoped (data-loader.js:272).
- Hookups are not attached to the 136 osm hosts and 2 usfs hosts that carry a Recreation.gov alias, because `attachSiteDetails` needs `p.facility_id` (data-quality.js:387), which they lack.
- The Forest Service block shows record name and type (CAMPGROUND 576, GROUP CAMPGROUND 92, HORSE CAMP 14, others 8), so it stays scoped. 5 facilities have more than one record.

Site or loop level amenities presented as campground-wide:
- OSM yes/no copied from absorbed elements into the host and shown in "Amenities reported": 188 listings (section 2). This is the only campground-wide presentation found.
- Sub-case: the Recreation.gov host receives toilets, water and similar from a duplicate way or node, and the popup says nothing about which element the value came from.

## 4. Coverage by source class and amenity

Definitions:
- Eligible: listings in the class that a source could cover for that amenity.
  - OSM: all listings, since any element can carry the tag.
  - Recreation.gov and Forest Service: listings with a Recreation.gov id or alias.
- With evidence: a source record exists for that listing.
  - OSM: the tag key is present on the listing's own element.
  - Recreation.gov: at least one overnight campsite record, or Forest Service text for water and toilets, or hookup data for electric.
- Known: stated present or stated absent. Blank, unknown, conflict and nonstandard values do not count.
- "Fire rings" uses OSM `fireplace` and Recreation.gov `fire_fixture` or `grill_or_fire_ring`. OSM `openfire` is a permission tag and is excluded.
- "Electric" uses OSM `power_supply` and Recreation.gov hookup counts. A hookup count of 0 is treated as unknown because absence is not recorded as a negative.

### A. OSM own-element tags (class osm, 28,618 listings, owned tags only)

| Amenity | Eligible | With evidence | With known value |
|---|---|---|---|
| Water (`drinking_water`) | 28,618 | 2,981 | 2,905 |
| Toilets (`toilets`) | 28,618 | 3,388 | 3,121 |
| Showers (`shower`) | 28,618 | 2,282 | 2,210 |
| Dump (`sanitary_dump_station`) | 28,618 | 2,084 | 1,933 |
| Electric (`power_supply`) | 28,618 | 3,093 | 3,086 |
| Trash (`bin`) | 28,618 | 152 | 152 |
| Fire rings (`fireplace`) | 28,618 | 25 | 25 |

Nonstandard values (counted as evidence, not known): toilets 267 (vault 223, customers 10, pit 8), water 76, showers 72, dump 151, fire permission `permit` 36.

### B. Recreation.gov and Forest Service join (by host class)

| Host class | Amenity | Eligible | With evidence | With known value |
|---|---|---|---|---|
| ridb | Water | 2,020 | 1,369 | 627 |
| ridb | Toilets | 2,020 | 1,369 | 782 |
| ridb | Showers | 2,020 | 1,367 | 42 |
| ridb | Dump | 2,020 | 1,367 | 35 |
| ridb | Electric | 2,020 | 1,361 | 356 |
| ridb | Trash | 2,020 | 1,367 | 43 |
| ridb | Fire rings | 2,020 | 1,367 | 818 |
| osm (alias) | Water | 136 | 79 | 32 |
| osm (alias) | Toilets | 136 | 79 | 38 |
| osm (alias) | Showers | 136 | 79 | 3 |
| osm (alias) | Dump | 136 | 79 | 1 |
| osm (alias) | Electric | 136 | 0 | 0 |
| osm (alias) | Trash | 136 | 79 | 3 |
| osm (alias) | Fire rings | 136 | 79 | 39 |
| usfs (alias) | all seven | 2 | 0 | 0 |

### C. Classes with no amenity source

| Class | Listings | Eligible for any amenity source | With evidence | With known value | What the popup shows |
|---|---|---|---|---|---|
| usfs (`usfs:`) | 2,204 | 2 | 0 | 0 | "Amenities reported: Not verified" |
| blm-area | 528 | 0 | 0 | 0 | "Amenities reported: Not verified" |

- The Forest Service site layer joins only through a Recreation.gov id, so 2,202 of 2,204 `usfs:` listings and all 528 blm-area listings have no join path.

### D. OSM values on non-OSM hosts (disallowed, not counted as known above)

- Recreation.gov hosts display OSM-derived values for 149 listings, none of them from Recreation.gov: toilet 121, water 83, picnic table 33, dump 11, shower 7, fire ring 2.

## 5. Gaps against R8, smallest change set, risks

### Gaps (each with measurement)

1. **Ownership.** OSM amenity tags are copied across merged members (636 instances, 229 listings) and shown (188 listings). The merge guard covers fee, charge and access only.
2. **No source, scope or date on OSM amenities.** 4,436 listings show a bare "Amenities reported:" line.
3. **No explicit no-evidence state** for these listings:
   - blm-area (528)
   - usfs (2,202 without a join path)
   - osm listings whose own element has no yes/no amenity tag (24,337 listings show no amenities line)
   - They all read "Not verified", which also covers an explicit "no" and a conflicting source. Nothing separates known, negative, conflict and unknown.
4. **Negatives hidden.** `amenity_negatives` is never rendered. OSM own explicit "no" counts: water 1,170, toilets 410, showers 1,120, dump 703, electric 1,050.
5. **Nonstandard OSM values dropped to unknown.** 573 tag instances (toilets 267, dump 151, water 76, showers 72, power 7), for example `toilets=vault`, `dump=customers`.
6. **Conflicts invisible.** Donor disagreement is not recorded (1 listing for `drinking_water`), and first donor wins.
7. **Electric** is shown only through the Recreation.gov hookup line. OSM `power_supply` (3,093 own, 24 inherited, 66 borrowed on ridb hosts) is not displayed. The 136 alias hosts miss hookups.
8. **Filters and search ignore Recreation.gov and Forest Service evidence** (209 of 221 toilet-reporting listings are filtered out) and use the unguarded OSM-derived list.
9. **`amenity_negatives` duplicates** grow per normalization pass (255 entries, 5 distinct).

### Smallest set of code changes

1. **Fix ownership at the source (merge_campsite_data.js).**
   - Extend `osmTag` (:17) with the amenity-type keys (`toilets`, `toilets:*`, `drinking_water`, `shower`, `sanitary_dump_station`, `power_supply`, `bin`, `openfire`, `fireplace`, `picnic_table`).
   - `ownedOsmField` and `memberEvidence` then retain them under `member_evidence[].fields` with source id, retrieved date and URL, as for fee.
   - Replay the 50 states using the existing `verify-osm-provenance.js --remerge`.
2. **Client guard (data-quality.js).**
   - In `normalizeFeature` (:80, :132) derive amenities only when the record's own id is `osm:*` and the tag is not in `member_evidence`.
   - Drop the `tourism` test for hosts whose id is not `osm:`.
   - In `mergeFeatures` (:204-205) skip amenity arrays from `q` when `distinctOsm`.
   - Interim without re-merge: suppress OSM-derived amenities on any listing where `source_ids` holds another OSM id or the id is not `osm:` (about 1,726 listings, and it would also hide owned values on part of them).
3. **Popup (data-loader.js:355).** Replace the line with an evidence block, per source class:
   - OSM: "OpenStreetMap, this element (node/way id), data retrieved {source_retrieved_at}, survey date {check_date} when present". Show yes, no, other raw value and not tagged separately.
   - Recreation.gov and Forest Service: unchanged.
   - Member evidence (donor tags) shown, if at all, in a labeled "nearby OSM element" row.
4. **Explicit no-evidence state.** Add one helper returning a state for every listing: known, negative-only, conflict, unknown or no-source. Render a line such as "No amenity source is joined to this listing" for blm-area, `usfs:` without a Recreation.gov id, and ridb-linked listings with no records.
5. **Optional, small.** Feed filter chips from the guarded OSM list plus Recreation.gov and Forest Service known-present values. Dedupe `amenity_negatives` at data-quality.js:129 and :136. Attach hookups on the alias hosts with a `ridb:` id.

### Risks

- Re-merge changes a large `_merged.geojson` diff. The `search-index.json` `m.a` field, ids and coordinates must stay stable, which the existing `verify-osm-provenance.js` assertions check. Cache version in the service worker must be bumped.
- About 188 listings lose amenity lines and filter hits, and the Toilets, Water, Dump and Shower filters shrink. Expect user-visible regressions that need a release note.
- Moving tags to `member_evidence` can strand wanted facts: a campground node whose toilets tag sits on its own polygon duplicate is a legitimate duplicate, and the data would then say unknown. Per-pair review or a same-site rule may be wanted later.
- ODbL attribution: displaying more OSM data raises the attribution bar. Confirm the existing credit text covers the new block.
- `retrieved_at` is a fetch date, not a survey date. The popup must not imply recency. Only `check_date` (296 listings) is a survey date.
- Strings need keys in `locale-fr.js` (the French UI is shipped) and test updates in `tests/`.
- Fire-ring mapping: `openfire=yes` is a permission, `fireplace=yes` a fixture. Do not merge them.
