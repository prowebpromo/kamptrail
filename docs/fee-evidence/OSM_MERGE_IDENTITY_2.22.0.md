# OSM merge identity, 2.22.0

The snapshot merge (`scripts/merge_campsite_data.js`) used to treat two OpenStreetMap campgrounds as one place when their names were more than 85% similar and they were within 500 m. That hid real campgrounds whose names differ only by a positional word, for example Upper Grays Meadow inside Lower Grays Meadow, South Deer Lake inside North Deer Lake, and the Upper loop of Johnny Creek. The October 30 merge identity audit reviewed 33 merged pairs and found every merge of differently named places wrong.

## What changed

1. Two different OSM elements whose names differ only by a positional word stay separate. The words are Upper, Lower, Middle, Inner, Outer, the compass directions, Old, New, Little and Big. Recreation.gov records and identical OSM elements keep the existing rules.
2. Numbers and letters keep today's grouping. A bare number or letter can name a separate campground, a loop of one park or a single site, and names alone cannot tell those apart. Individually numbered sites ("Site 4", "Group Site A", "Moon Lake #2") are grouped as before. Fees on grouped records stay provenance-safe under 2.21.2.
3. Published listing IDs stay canonical. Community reviews and saved stops are keyed by listing ID, so a re-merge must not rename a published listing:
   - Snapshot merge: when a published listing matches a record whose ID was never published, the published listing stays the kept record, with its own point.
   - Index build: when a newly separated record merges with a published listing, the published ID and point are kept and the new record becomes its alias. An alias that still matches its previous listing rejoins that listing.
   - Both read the committed `data/campsites/search-index.json`. A second rebuild is byte-identical.

## Measured result

All 50 states were re-merged from unchanged retained sources and the index was rebuilt. Exact lists are in `osm-merge-identity-2.22.0.json`.

| Measure | Before (2.21.2) | After (2.22.0) |
|---|---:|---:|
| Listings | 33,286 | 33,370 |
| Free | 2,140 | 2,150 |
| Conditional | 58 | 58 |
| Paid | 8,206 | 8,224 |
| Unknown | 22,882 | 22,938 |

- 84 separated listings, all OSM elements that the old rule absorbed into a differently named neighbor. Their fee labels come from their own tags: 10 free, 18 paid and 56 unknown. These are existing source records shown separately. They are not newly verified campgrounds.
- 10 existing USFS listings gain the newly separated OSM element as an alias, for example `usfs:20680` Upper Grays Meadow gains `osm:way:335361783`. Their IDs and points are unchanged.
- No listing was removed. No existing listing changed fee, point or ID, and no alias was removed.

## Not in this release

- Grouping numbered sites and lettered loops under a parent campground.
- Same-name pairs (two areas with one name, or nodes far apart) still merge as before. The audit lists them as unresolved.
- Area geometry capture (`out center bb;`) for node-inside-area checks.
