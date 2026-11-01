# Rig-tag load-order check (2.34.0)

Script: `scripts/verify-rig-load-order.js`. Result: `docs/RIG_TAG_LOAD_ORDER_2.34.0.json`. Run against the real committed snapshots of this branch in Chromium.

## Result

**Rig suitability and Tents/Trailers filtering change with load order for 18 of the 245 affected listings. Deployment should wait for the separate identity fix.** 2 more listings never match the index in any order. This repair does not change `data-loader.js` host election.

| Measure | Value |
| --- | ---: |
| Listings checked (every fixture case) | 245 |
| Multi-state listings | 40 |
| Scenarios | 84 |
| Stable in every scenario | 225 |
| Source identities change with order | 0 |
| Rig line or Tents/Trailers outcome changes with order | 18 (plus `ridb:266477`, popup member list only) |
| Differ from the published fixture in every order | 2 (`usfs:24878`, `usfs:9461`) |
| Not loaded in one scenario | 1 (`ridb:232162`, default batch only, see below) |

Scenarios: the default (all 34 affected states in one batch), sequential forward, sequential reversed, one delayed state response (ID, held 4 s), and each multi-state listing's states one at a time in both orders.

## What changes and why

The set of source ids merged into each listing never changes. What changes is which id the browser elects as host. `data-loader.js` L182 merges loaded states without the index's `preferredIds`/`previousHosts` (pre-existing, not changed here). When a state that holds the absorbed OSM element loads first, the OSM element becomes the host. The new rule then correctly reads that element's own tags as the listing's own, so the listing shows rig types and matches the filters. In the index order the Recreation.gov or Forest Service record is the host and shows none.

So the rig result follows the elected host. The ownership rule is applied consistently. The host election is what is unstable. In every case the unstable run is the reversed order of that listing's states.

| Index id | States | Host in reversed order | Rig line then | Orders that differ |
| --- | --- | --- | --- | --- |
| `ridb:10072881` | OH, VA, WV | `osm:way:849430082` | Tents: reported | sequential_reversed, WV>VA>OH |
| `ridb:10278188` | NM, TX | `osm:node:9170786474` | Tents: reported; Trailers and caravans: reported | sequential_reversed, TX>NM |
| `ridb:233284` | NC, TN | `osm:way:1107154603` | Tents: reported; Trailers and caravans: reported | sequential_reversed, TN>NC |
| `ridb:233839` | CA, NV | `osm:way:413964717` | Tents: reported | sequential_reversed, NV>CA |
| `ridb:234029` | ID, OR | `osm:node:9357309094` | Tents: reported; Trailers and caravans: reported; RV: reported | sequential_reversed, OR>ID |
| `ridb:234311` | CA, NV | `osm:way:42486230` | Tents: reported; Trailers and caravans: reported | sequential_reversed, NV>CA |
| `ridb:234586` | AR, MO, TX | `osm:way:368988012` | Tents: reported | sequential_reversed, TX>MO>AR |
| `ridb:234619` | ID, OR | `osm:node:5052010921` | Tents: reported; Trailers and caravans: reported; RV: reported | sequential_reversed, OR>ID |
| `ridb:238258` | MI, MN, WI | `osm:way:1262261506` | Tents: reported | sequential_reversed, WI>MN>MI |
| `ridb:239840` | MT, SD | `osm:way:321246474` | Tents: reported; Trailers and caravans: reported | sequential_reversed, SD>MT |
| `ridb:240665` | ID, MT | `osm:node:7546363380` | Tents: reported; Trailers and caravans: reported | sequential_reversed, MT>ID |
| `ridb:242613` | CA, NV | `osm:way:489193357` | Tents: reported; Trailers and caravans: source says no | sequential_reversed, NV>CA |
| `ridb:242655` | CA, NV | `osm:way:1284785363` | Trailers and caravans: reported | sequential_reversed, NV>CA |
| `ridb:245568` | CA, NV | `osm:way:300876539` | Tents: reported; Trailers and caravans: source says no | sequential_reversed, NV>CA |
| `ridb:251720` | ID, MT | `osm:way:731234864` | Tents: reported; Trailers and caravans: reported | sequential_reversed, MT>ID |
| `ridb:273848` | NC, TN | `osm:way:1107154604` | Tents: reported; Trailers and caravans: reported | sequential_reversed, TN>NC |
| `usfs:26883` | ID, MT | `osm:way:1539329187` | Tents: reported; Trailers and caravans: reported; RV: reported | sequential_reversed, MT>ID |
| `usfs:80159` | ID, MT | `osm:way:901434590` | Tents: reported; Trailers and caravans: value not recognized | sequential_reversed, MT>ID |

`ridb:266477` (CA, OR) keeps its host, rig line and filters in every order. Only the popup's merged-element list differs between runs.

## Always different from the index

`usfs:24878` (shown as `osm:way:334210652`) and `usfs:9461` (shown as `osm:relation:19325196`) are elected under the OSM id in every order, as the brief predicted. They show the OSM element's own `tents=yes` and match Tents in the browser. The index and the fixture have them as no rig source.

## Not loaded once

`ridb:232162` (WV) was not found in the default 34-state batch run. It was found, with the expected result, in the other 3 runs that load WV. The batch loader runs 4 state requests at once, and one WV request failed or timed out under load. This is a test-environment fetch issue, not an ownership or order effect.

## For live acceptance

Look these 20 listings up by alias, not by canonical id. Accept their rig result only after the identity fix lands, then re-run `node scripts/verify-rig-load-order.js` and expect 245 stable.
