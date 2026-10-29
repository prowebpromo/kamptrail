# Official camping coverage update — 2026-10-29

This is a local 2.11 build audit, compared with the national search census generated from baseline commit `0744c59cd43fd210e9bcb426929dc199bee0fecf`. It is not a deployment check or a guarantee of current campsite availability. Both official agency feeds were retrieved on October 29, 2026; the baseline files also carried that date, so the commit, rather than the date alone, identifies the comparison.

## Measured results

| Dataset | Total | Free | Conditional | Paid | Unknown |
|---|---:|---:|---:|---:|---:|
| Baseline national search census | 33,220 | 2,113 | 56 | 8,245 | 22,806 |
| Updated national search census | 33,287 | 2,144 | 59 | 8,289 | 22,795 |
| Updated actual map-loader replay (alphabetical states) | 33,287 | 2,144 | 59 | 8,289 | 22,795 |
| Updated USFS source | 4,571 | 692 | 47 | 2,846 | 986 |
| Updated BLM source | 843 | 180 | 10 | 221 | 432 |
| Updated agency state inputs | 5,413 | 871 | 57 | 3,067 | 1,418 |

The final actual map replay loaded all 50 states with zero failures. Map and search agree on all 33,287 canonical IDs, retained legacy-ID sets (excluding each record's own ID), and fee classifications: zero mismatches. The former Steck Park discrepancy is resolved by the shared state-snapshot admission rule. Focused regressions also pass for both Idaho/Oregon loading orders and for unknown or explicitly paid unverified Recreation.gov candidates. The full replay used unmodified `data-loader.js` and `data-quality.js`, local-file fetch responses, and stubbed map/marker APIs, then called `KampTrailData.loadStates([code])` sequentially in alphabetical order and counted `getAllCampsites()`. This verifies the saved catalog and tested loading orders, not every possible load sequence or live deployment.

The catalog has **31 more free classifications**, but this is not 31 newly discovered free campgrounds. Identity matching uses each record's canonical ID and retained `legacy_ids`:

- **62 newly indexed identities:** 16 free, 1 conditional, 31 paid, 14 unknown.
- **30 existing unknown records gained fee evidence:** 15 became free, 2 conditional, and 13 paid.
- Four existing conditional records became free after excluding commercial/group-only permit requirements; four free records became conditional after preserving seasonal or access qualifications.
- Five previously merged OSM/USFS pairs split after the official coordinates changed: Antelope Flat, Arch Dam, Rock Creek, Silver Creek, and Whitestar. These account for the other five records in the net increase of 67. They are not counted as newly discovered locations. Rock Creek and Whitestar's OSM records consequently reverted from paid to unknown while their separate USFS records retained paid evidence. These potential duplicate pairs need identity review; the matching radius was not widened to inflate a count.
- Steck Park also changed from paid to unknown: the shared state-snapshot admission rule excludes an unverified Recreation.gov candidate before cross-state enrichment, leaving the independently supported OSM campsite. This resolves the previous map/search fee discrepancy without turning ambiguous recreation listings into campsite evidence. Seven other records lose only unsupported state/alias associations; their fees and the total record count do not change.
- No baseline identity disappeared from the searchable catalog.

The USFS secondary-activity join added **92 source identities**: 62 became new searchable records and 30 enriched existing records. Their raw fees were 26 free, 2 conditional, 47 paid, and 17 unknown. Nine of the 26 free source additions are reported closed or temporarily closed; eight of those are new searchable identities and one enriches the existing Cedar Pass record. They must not be advertised as newly available camping. Two older USFS source records (`5665`, `83530`) were excluded for missing or invalid official geometry, leaving a net source increase of 90. BLM gained no new source identities; its changes enrich existing records.

## Fee evidence behind the changes

The BLM importer now examines the complete description only for eligible campground facilities and narrowly explicit, same-site fee statements. Eight BLM source records changed from unknown to free: Hawkins Reservoir (`2079`), Graves Creek (`15021`), Cutthroat Trout (`202084`), Sage Hen Flats (`202085`), Morgans Bridge (`202067`), Pipeline (`202069`), Goodenough Creek (`202082`), and Lake Vermilion Public Islands (`1701`). Goodenough was already free in the combined catalog, so this produces **seven**, not eight, combined unknown-to-free transitions. Lake Vermilion is an existing island camping area, not a newly identified developed campground.

The five initially verified campground descriptions explicitly state that there are no fees associated with the site. Their source update date is February 25, 2026; retrieval on October 29 does not pretend that the underlying statement was updated that day. Evidence is retained with the original field, agency record ID, source URL, retrieval date, available source update date, and SHA-256 hash.

Creek Pasture, Superbowl, Hamburger Rock, and Sand Island changed from unknown to paid because their dedicated fee fields require payment on arrival. Their nightly amount remains unknown; a price is not inferred from mandatory payment. Sand Island's temporary closure is a separate access fact and must not be hidden by its paid classification. The rebuilt search index preserves reported status in `m.o`: 1,877 closed and 136 temporarily closed records. All nine closed/temporarily closed secondary-activity free additions retain that status after deduplication, including Cedar Pass under its OSM canonical ID.

Seasonal free wording at USFS North Fork (`54389`), and temporary no-charge wording at Meadow View (`11202`) and Jerry Johnson (`82782`), remain conditional. Fire-building permits and commercial/group-only permits do not automatically qualify ordinary camping fees. Table Top Trail remains conditional because the fee field names a Barry M. Goldwater Range permit whose relationship to access has not been resolved.

The current [Broad Canyon operator page](https://www.fs.usda.gov/r04/salmon-challis/recreation/broad-canyon-campground-trailhead) states a nightly charge while the EDW feed says no fee. The maintained evidence record leaves `usfs:76196` unknown with a conflict flag, rather than selecting the free claim. These source conflicts are a reason to preserve full evidence, not truncate it to 400 characters.

## Geography, exclusions, and remaining gaps

Agency state assignment now uses the pinned U.S. Census Bureau BAS 2026 state polygons, vintage January 1, 2026, rather than nearest-place guesses. The output spans 42 states: 769 source assignments agree with the polygons, 4,632 lacked a source state and were assigned, and 12 were corrected. These assignments affect agency records only; the base OSM/Recreation.gov state snapshots have not been comprehensively reassigned.

One source point, `blm-area:10390884`, has positive longitude `114.1417` at latitude `34.28848`, outside the supported U.S. states. It is retained in `data/sources/agency-quarantine.json` and excluded from state snapshots. The sign was not silently repaired. The builder also quarantines points within 10 metres of an uncertain state boundary; this run had none.

The USFS source retains 61 excluded candidates with reasons: 6 invalid/missing official geometries, 11 nearby-only camping references, 19 without explicit on-site camping, 19 not named camping locations, 1 administrative/multiple-location umbrella, 4 ambiguous day-use/trailhead locations, and 1 prohibited/ambiguous camping location. BLM's fetched layers contained 538 area rows and 305 facility rows, with no malformed-coordinate/name/ID quarantine in this run. The area layer still includes broad recreation areas: an existing area point is not proof of a specific campsite at that coordinate.

Unknown fees remain substantial: USFS has 986 unknown records, including 727 without retained fee wording; BLM has 432, including 392 without retained fee wording. Missing prices are not zero. No land-ownership inference, reservation-only inference, invented coordinates, or automated Freecampsites.net import was used. Future coverage should prioritize official operator evidence and additional permitted camping inventories; these counts do not establish geographic completeness.

## Reproduce and validate

Run from the repository root after installing the pinned state-boundary reference. Refreshing sources makes network requests and may produce later data; rebuilding from the saved snapshots is offline:

```sh
python3 scripts/build_agency_states.py
node scripts/build-search-index.js
python3 -m unittest discover -s scripts/tests
node --test tests/data-quality.test.js tests/data-loader.test.js
```

Both importers validate bounded, complete ArcGIS responses, stable before/after counts, unique record IDs, and malformed/error responses before atomic replacement. The agency builder validates all inputs and boundary hashes before staging the complete output. The search builder writes a temporary file and renames it only after a successful build.

For national fee counts, count `site.m.f` in `data/campsites/search-index.json`. To reproduce the baseline census, check out the baseline commit in an isolated worktree and call `require('./scripts/build-search-index.js').buildFromDirectory('data/campsites')`; the saved baseline census was generated this way, rather than treating an older tracked search-index format as current runtime output. For transitions, intersect the sets `{id, ...legacy_ids}`; unmatched new records are additions, matching records are enrichments, and one old record matching multiple new records is a split. Raw source counts use `features[].properties.fee_status` and must not be substituted for deduplicated search or map counts.

This offline snippet reproduces the final loader's admission, merge, and site-detail sequence without rendering markers:

```sh
node <<'NODE'
const fs=require('node:fs'),q=require('./data-quality.js');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const root='data/campsites',details=read(root+'/ridb-sites.json').facilities;
const states=fs.readdirSync(root).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).map(n=>n.slice(0,2)).sort();
let all=[];
for(const state of states){
  const agency=root+'/agency/'+state+'.geojson';
  const raw=[...read(root+'/'+state+'_merged.geojson').features,...(fs.existsSync(agency)?read(agency).features:[])];
  const incoming=q.publicationCandidates(raw,{state}).map(f=>q.normalizeFeature(f,{state}));
  incoming.forEach(f=>q.attachSiteDetails(f,details));
  all=q.cleanAndDedupeGeoJSON({features:[...all,...incoming]},{state}).features;
  all.forEach(f=>q.attachSiteDetails(f,details));
}
const fees={};for(const f of all)fees[f.properties.fee_status]=(fees[f.properties.fee_status]||0)+1;
console.log({total:all.length,fees});
NODE
```
