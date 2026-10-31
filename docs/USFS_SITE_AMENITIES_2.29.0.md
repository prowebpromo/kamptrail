# Forest Service site water and restroom statements (2.29.0)

Release 2.29.0 adds a second, separate evidence section to the campsite popup. For a Recreation.gov-linked campground that exactly matches a USDA Forest Service Recreation Site record, the popup quotes the Forest Service's own water and restroom statements. It adds a normalized label only when the wording is explicit. It does not change filters, fees, access, the Recreation.gov campsite-record amenity section, or the services map.

> Update, 2.31.0: amenity filters now use these statements. A listing matches the Toilets or Drinking water filter on an explicit Forest Service class the popup shows, only from a campground record (`CAMPGROUND`, `GROUP CAMPGROUND` or `HORSE CAMP`), with its update date or "date unknown". Conflicting records give no filter evidence. Coverage is not complete: of 2,158 Recreation.gov-linked listings, 676 have restroom text, 654 a known restroom class and 644 filterable restroom evidence. 601 have water text, 568 a known water class and 433 filterable drinking water. Records for other site types (8 IDs) are shown as a different site and never filter. See `docs/AMENITY_OWNERSHIP_2.31.0.md`.

## Acceptance criterion

A KampTrail campground is matched when its Recreation.gov facility ID equals a Forest Service record's `rec1stop_id` as an exact string. The ID is the catalogue identity `ridb:<id>`, either the primary ID or a legacy alias listed in `data/campsites/search-index.json`. For a match, the popup shows:

- the agency's exact water and restroom text, with a normalized label only when the text is explicit
- the credit "USDA Forest Service Recreation Site record", the record's last-update date, and the data retrieval date
- the record's season text (`open_season`, `season_description`) as context only

Ambiguous text ("Yes", "AVAILABLE", "None", blank) stays unknown and gets no label. Non-blank text that is not the literal `null` is still quoted. Nothing is inferred for a campground without a match, and nothing is inferred from absence. If one Recreation.gov ID matches several Forest Service records whose known classes disagree, the file records a conflict and the popup shows no label for that field.

## Source

| Item | Value |
| --- | --- |
| Layer | `https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0` |
| Licence | CC BY 4.0 per the Forest Service data catalogue mirror. The layer metadata states no access constraints. |
| Fields used | `site_cn`, `public_site_name`, `site_name`, `site_type`, `rec1stop_id`, `water_availability`, `restroom_availability`, `open_season`, `season_description`, `infra_last_update`, `edw_last_modify` |
| Query | `rec1stop_id IS NOT NULL`, paged by object ID (maxRecordCount is 2000, the builder uses 500) |
| Reviewed snapshot | Downloaded from GitHub Actions and retrieved 2026-10-31. 31,418 rows in the full layer, 2,249 with a `rec1stop_id`. |
| Row hash | `b175d423f2c39a8afa4ccc66411744908511c689b8de987281250ac8c67a81d2`. SHA-256 of canonical JSON (sorted keys, compact separators, UTF-8) of the eleven fields for all 2,249 rows with a `rec1stop_id`, ordered by `site_cn`. |

The snapshot, not a live query, built the committed file. The build sandbox cannot reach `apps.fs.usda.gov`, so the first live query happens in the weekly workflow.

## Output file

`data/campsites/usfs-site-amenities.json` has `version`, `source` and `facilities`, like the Recreation.gov amenity file. Each facility, keyed by the Recreation.gov ID, holds `records` and `conflicts`. Each record keeps `cn`, `name`, `type`, optional `water` and `toilet` statements (`text`, `class`, optional `qualifiers`), optional `season` context, `updated` (from `infra_last_update`) and `edw_modified`. Only records with water or restroom text are written. The file is about 229 KB, under the 2 MiB release ceiling. `DataQuality.validUSFSSiteAmenities` checks the whole shape, including that every disagreement between known classes is flagged in `conflicts`.

## Join method

1. Read the catalogue's exact positive-integer `ridb:` primary IDs and legacy aliases (the same set `build_ridb_sites.py` and `build_ridb_amenities.py` use).
2. Keep a Forest Service row only when `rec1stop_id` is a string equal to one of those IDs. There is no trimming, zero-padding, name matching or coordinate matching.
3. In the browser, attach evidence to a feature only for its own exact `ridb:` identities. A `usfs:` listing from KampTrail's separate recareaid import does not join.

## Normalization

Text is lowercased and whitespace-folded for matching only. The quoted text is the agency's, trimmed at the ends. The rules are conservative and tested in `scripts/tests/test_usfs_site_amenities.py`.

| Field | Class | Rule (examples) |
| --- | --- | --- |
| Water | `drinking_water` | Text says drinking or potable water is provided ("Yes, drinking water is available from faucets", "Potable Water", "Drinking water is provided by a well with a hand pump"). Qualifier `hand_pump` when the text says hand pump or handpump. Qualifier `seasonal` only when the text says season or seasonal. |
| Water | `no_drinking_water` | Text says water is not for drinking ("No drinking water", "No potable water", "Non-Potable Water", "Not for drinking", "Water can be treated or filtered from nearby water sources"). |
| Water | `no_water` | Text says there is no water ("No", "No water is available", "No water available", "Water is not provided"). |
| Water | `unknown` | Everything else: "Yes", "AVAILABLE", "NOT AVAILABLE", "None", "Hand pump", "Water available", "Pressurized water system", blank, the literal `null`. Also text that mixes yes and no, names only a nearby place or particular sites, or describes a current or seasonal outage ("currently", "discontinued", "winter"). |
| Restroom | `flush` | Text names flush or flushing toilets only. |
| Restroom | `vault_or_pit` | Text names vault, pit, outhouse or composting toilets only. |
| Restroom | `no_toilet` | The whole text is "No", "No restroom available", "No toilets" or the same with different case. |
| Restroom | `nearby_only` | Restrooms are stated as available nearby, with no toilet type. |
| Restroom | `unknown` | "Yes", "Toilet (2)", "Restrooms Available.", "Portable toilet(s)", "Flush & Vault" (mixed types), booking boilerplate, blank, `null`. |

A restroom statement that is negated, closed or an outage ("Flush toilets not available", "Not flush", "Vault toilets closed for season") is never a toilet class. Water text that says water is "shut off" or "turned off" is unknown.

Unclassified text must be about its topic to be quoted. Restroom text that never mentions toilet, restroom, latrine, outhouse, privy or vault, and water text that never mentions water or potable, is treated as missing. A text that is explicitly classified ("No", "Flush", "Pit") is kept. Over-limit text is cut with an ellipsis at the page validator's limits (text 600, name 160, type 80). The build fails and keeps the saved file if a facility has more than 25 records or there are more than 3,000 facilities. The weekly step also runs the client validator on the built file and restores the saved file if it fails.

Restroom qualifier `accessible` is kept only when the text says accessible and does not say "not ADA accessible". Season text is never read for a water or restroom class. A water `seasonal` qualifier needs the word in the water text itself.

## Measured on the 2026-10-31 snapshot

Counted over the 2,163 catalogue Recreation.gov IDs (2,020 primary, 143 alias-only).

| Measure | Count |
| --- | ---: |
| Distinct catalogue IDs matched | 735 (713 by primary ID, 22 by alias only) |
| Matched IDs with a water or restroom statement | 685 (690 records) |
| IDs whose water text gains something the Recreation.gov amenity file lacks (any water text where it reports no drinking water) or whose restroom text does the same for toilets | 653 (632 by primary ID) |
| Same, counting only an explicit normalized class | 639 (618 by primary ID) |
| Matched IDs where Recreation.gov reports drinking water and the Forest Service says no water or no drinking water | 0 |

Water, by facility: 436 `drinking_water`, 54 `no_drinking_water`, 78 `no_water`, 32 text left `unknown`, 84 with no water text, 1 conflict (ID 251845). Restrooms, by facility: 558 `vault_or_pit`, 94 `flush`, 2 `no_toilet`, 0 `nearby_only`, 21 text left `unknown`, 9 with no restroom text, 1 conflict (ID 234257). The conflicts are a Forest Service record pair that says flush toilets in one and vault toilets in the other, and a pair where one record says water can be treated or filtered and another says drinking water is available from faucets.

The "gain" counts compare against the Recreation.gov file at the time of this release. A different gain definition produces a different number. The 0 contradictions check holds under every definition tried.

## Limits

- Only Recreation.gov-linked Forest Service campgrounds can match. KampTrail's `usfs:` listings come from a separate recareaid import and have no exact link to this layer, so they get nothing here.
- Statements are free text written by Forest Service staff. Wording varies, so many statements stay unknown. A label is a reading of the text, not a verified fixture.
- Each record's update date is the Forest Service's `infra_last_update`. The text is not a current-availability report, and an outage may not be reflected.
- Season text sits beside the statements as context. It does not say when water is on.
- Recreation.gov amenity counts and Forest Service statements are never added together. Different records may describe the same real toilet.
- A matched site record may describe one loop or one site of a larger campground. The popup shows the record name and type so a visitor can tell.

## Refresh

`.github/workflows/fetch-campsite-data.yml` runs `scripts/build_usfs_site_amenities.py` weekly after the Recreation.gov site details step. The step is non-blocking. The builder counts the layer at both ends of the download, requires unique object IDs, and refuses to write when the row count leaves 1,500 to 8,000, matches leave 300 to 2,000, or matches fall below 80 percent of the saved file. A refusal keeps the saved file. The step records `usfs_sites` health (`fresh` or `failed`) with `scripts/record_health.js`. The weekly commit step already adds `data/campsites`.

To rebuild from a saved download:

```sh
python3 scripts/build_usfs_site_amenities.py --snapshot usfs.json --retrieved 2026-10-31
```

The snapshot is JSON with the key `site` and a `rows` list, as GitHub Actions saved it. Network fetching is the default without `--snapshot`.

## Where it ships

- Page: `data-quality.js` (validation and attachment), `data-loader.js` (loading, popup section), `app.css`.
- Packaging: `scripts/build-release.js` validates and copies the file with a 2 MiB ceiling. `service-worker.js` (cache `kt-v61`) leaves the request to the page, as it does for the Recreation.gov amenity file.
- Text: Spanish and French entries for every new string in `locale.js` and `locale-fr.js`. The agency's own text is quoted unchanged.
- Tests: `scripts/tests/test_usfs_site_amenities.py`, `tests/usfs-site-amenities.test.js`, the popup tests in `tests/data-loader.test.js`, and `tests/browser/usfs-site-amenities.spec.js`.
