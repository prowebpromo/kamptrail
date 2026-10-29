# Free-camping coverage audit — 2026-10-29

Local saved-data audit of main `155fabc98bd24068ee0a51aa594258c7830654a1` and the fee-correctness changes in the 2.10 worktree. These are reproducible local counts, not a claim about the deployed site or current conditions at individual campsites. No third-party campsite database was scraped and no source data was changed by this audit.

## What the current coverage actually contains

| Measurement | Total | Free | Conditional | Paid | Unknown |
|---|---:|---:|---:|---:|---:|
| USFS source file, imported 2026-10-29 | 4,481 | 669 | 41 | 2,800 | 971 |
| BLM source file, imported 2026-10-29 | 843 | 169 | 13 | 217 | 444 |
| Published agency state inputs | 5,321 | 837 | 54 | 3,016 | 1,414 |
| Original full map-loader replay, alphabetical state load | 33,220 | 2,126 | 52 | 8,254 | 22,788 |
| Corrected sequential map census, same state order | 33,220 | 2,113 | 56 | 8,244 | 22,807 |
| National search build, original and corrected normalizer | 33,220 | 2,113 | 56 | 8,245 | 22,806 |

The original map row is **before the fee persistence correction** and must not be presented as a verified-free count. The corrected national search build was computed in memory with `buildFromDirectory('data/campsites')`; no generated search file was replaced. The corrected sequential map census uses the loader’s exact merge-and-enrich sequence with the fixed normalizer. A residual one-record difference remains between paid/unknown search and map totals; this audit does not claim complete map/search equivalence. Free and conditional totals now agree.

The 50 base state files contain 64,162 raw records. Adding 5,321 agency records yields 69,483 raw inputs, not 69,483 unique campsites. Across those inputs 47,582 records survive initial feature normalization, and the national cleaner returns 33,220 publishable records after deduplication and camping screening. USFS + BLM source files contain three more records than the agency state outputs (one free, one paid, one unknown); raw-source totals therefore cannot substitute for map counts.

Only about 6.4% of the national searchable catalog is explicitly classified free. This establishes a substantial fee-evidence gap; counts alone cannot establish geographic completeness or adequate free-camping coverage.

## Why fees remain unknown

Of the raw USFS unknowns, **718 of 971 have no fee wording**. Of BLM unknowns, **399 of 444 have no fee wording**. Many remaining records point to Recreation.gov, an operator, or a fee schedule instead of stating a fee. Missing fees must remain unknown.

In the corrected sequential map census, 20,575 unknown records belong to the OpenStreetMap-only source group, 846 to Recreation.gov-only, 548 to USFS-only, and 343 to BLM-only. Mixed-source records account for the remaining 495. These groups are exclusive; source spelling/case variants were consolidated for this breakdown. The corrected unknown total includes 160 records with fee text and 22,647 with none, including 20 preserved source conflicts. Correcting persisted source conflicts increases unknown counts; it does not discover new free sites.

Largest corrected unknown state-attribution buckets:

| Retained state value | Unknown |
|---|---:|
| CA | 2,526 |
| TX | 1,603 |
| MI | 1,442 |
| ID | 1,263 |
| OR | 1,176 |
| WA | 1,085 |
| NY | 1,039 |
| CO | 1,009 |
| UT | 992 |
| MN | 914 |
| AZ | 764 |
| FL | 646 |

These are retained record state values, not validated geographic allocations. OSM retrieval uses overlapping state bounding boxes; missing state values can inherit the first loaded state. The corpus also contains values such as `Texas`, `Ohio`, `ga`, and `, IL`. Agency state assignment falls back to nearby GeoNames places rather than state boundaries. Normalize state codes and use authoritative boundary containment before treating these figures as state coverage measurements.

## Correctness changes made

1. **Keep source conflicts unknown across state loads and merge order.** Previously, OSM `fee=no` or `fee=yes` could overwrite an already merged conflict when another state loaded. A conflict arriving as the secondary merge record could also be ignored. Both sides now preserve an unresolved conflict, and normalized records retain their reconciled fee status.
2. **Keep conditional fees conditional.** Reapplying retained OSM tags previously changed Sourdough Creek, Lonesomehurst, and Lake Creek campgrounds from conditional to paid, and Lena Lake from conditional to free during the full replay. Initial source-tag interpretation now occurs only once.
3. **Recognize one explicit BLM camping statement.** Lake Vermilion Public Islands (`blm-area:1701`, MN) has an unambiguous no-permit-or-fee requirement to camp, currently stored as unknown. The classifier now recognizes that narrowly anchored statement. Tests retain unknown for negation/parking language, paid for explicit paid camping, and conditional for a separately required vehicle permit or Adventure Pass, even without a dollar amount.

The BLM change affects classification on a future source refresh. Saved agency files were not regenerated, so this audit claims **no new published free site** from that parser improvement.

Relevant validation: 47 JavaScript tests passed across data quality, loader, search index, and merge safety; 9 fee-text Python tests passed. The audit environment's broader Python invocation encountered missing `requests` imports in three unrelated modules; the focused fee tests did not require that dependency.

## Next work, in priority order

1. **Ship fee persistence fixes and verify map/search agreement.** Counts depend on screening, deduplication, enrichment order, and loading order; use the same provenance-aware logic for both surfaces. A free label must not survive a known unresolved paid report.
2. **Verify existing unknowns against operator evidence.** In unique raw OSM inputs, 4,596 records without a `fee` tag have a `website` value. These are candidate verification links, not 4,596 promised free campsites; some records are excluded or enriched by another source at runtime. Capture the camping-specific statement, source URL, retrieval date, access restrictions, permit requirements, and seasonal conditions.
3. **Improve narrow, evidence-backed parsing and enrichment.** There are 47 unique raw OSM records with `charge` but no `fee`; two contain `charge=0` (Little Goose Landing Camping and Willow Landing Campground). Review the tag's camping scope before classification. Other values are prices, ambiguous text, or conditional rates. Agency unknown examples include paid-on-arrival wording for Creek Pasture, Superbowl, Sand Island, and Hamburger Rock; these can improve paid/unknown accuracy, not free coverage. USFS links to campground fee tables are useful follow-up evidence, not a basis to assume free.
4. **Add verified state, county, municipal, and agency camping datasets.** Evaluate specific official camping inventories and permitted reuse, then preserve provenance and distinguish area-level dispersed-camping opportunities from actual campsite locations. A BLM/USFS polygon or general recreation-area point is not proof that camping is permitted at every coordinate. The current USFS fetch filters `markeractivity` to six camping categories; inspect the official service schema for camping that is recorded as a secondary activity before widening selection.
5. **Seek a licensed Freecampsites.net feed or written permission if desired.** Its [terms](https://freecampsites.net/terms-of-service/) expressly prohibit automated scraping/harvesting and require prior written authorization for redistribution. Do not bulk import under those published terms. Its [About page](https://freecampsites.net/about/) describes both free and low-cost camping (up to $12/night and some low-cost long-term permits), so membership in that directory would never itself mean free. No outreach was sent.

## Matching and evidence risks to address before expansion

- The offline merger uses a 500 m distance and greater-than-0.85 name similarity; the runtime cleaner uses exact normalized names within 300 m or shared IDs. These are different identity rules. Names, adjacent campground loops, and nearby facilities need review; proximity alone is insufficient.
- Runtime keeps differing explicit facility IDs separate during geographic matching, but an intervening OSM record without a facility ID can still join nearby records with differing facility IDs. Galbraith Lake Campground currently combines one BLM paid report and another BLM free report; the result must remain unknown pending source reconciliation.
- USFS and BLM fee text is classified before it is truncated to 400 characters in stored evidence. Five agency source records reclassify differently using only the retained excerpt. Preserve the complete fee statement separately when adding evidence so decisions can be reproduced without losing conditions beyond the excerpt.
- Fee evidence, access permission, active/closed status, and suitability for an RV are separate facts. Do not convert missing cost to zero, infer free from land ownership, or turn broad area coordinates into invented campsites.

## Reproduce the corrected sequential map census

Run from the repository root. This reads saved files and reproduces the loader's alphabetical state merge followed by RIDB site-detail attachment; it performs no network request and writes no data. It intentionally retains raw source state values so attribution problems remain visible.

```sh
node <<'NODE'
const fs=require('node:fs'),q=require('./data-quality.js');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const states=read('data/campsites/index.json').states.map(s=>s.state).sort();
const agency=read('data/campsites/agency/index.json');
const details=read('data/campsites/ridb-sites.json').facilities;
let sites=[];
for(const state of states){
  const base=read(`data/campsites/${state}_merged.geojson`).features;
  const extra=agency.states.includes(state)
    ?read(`data/campsites/agency/${state}.geojson`).features:[];
  sites=q.cleanAndDedupeGeoJSON({features:[...sites,...base,...extra]},{state}).features;
  sites.forEach(f=>q.attachSiteDetails(f,details));
}
const fees={},unknownStates={},unknownSources={};
for(const {properties:p} of sites){
  fees[p.fee_status]=(fees[p.fee_status]||0)+1;
  if(p.fee_status!=='unknown')continue;
  unknownStates[p.state]=(unknownStates[p.state]||0)+1;
  const source=[...new Set(p.sources.map(s=>/openstreetmap/i.test(s)
    ?'OpenStreetMap':/recreation.gov/i.test(s)?'Recreation.gov':s))].sort().join(' + ');
  unknownSources[source]=(unknownSources[source]||0)+1;
}
console.log(JSON.stringify({total:sites.length,fees,unknownStates,unknownSources},null,2));
NODE
```

For the original baseline, run equivalent logic with `data-quality.js` from commit `155fabc` and the same saved input files. The original full loader was additionally replayed in a VM using local-file `fetch` responses, initializing its source indexes and RIDB details, then invoking `loadStates` for all 50 alphabetically sorted state codes; no states failed. The corrected search build can be checked without writing the index with:

```sh
node -e "const r=require('./scripts/build-search-index').buildFromDirectory('data/campsites'); console.log(r.sites.length,r.sites.reduce((a,s)=>(a[s.m.f]=(a[s.m.f]||0)+1,a),{}));"
```
