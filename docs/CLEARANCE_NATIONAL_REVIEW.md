# National clearance data: review findings (re-measured)

The original review document was lost. Every number below was re-measured from the committed v2 files at origin/main afdfb3f9 (data/clearances, 115,245 v2 records in 50 states and DC, plus the 254 record RI pilot file). Counts are record counts unless stated. Example ids are the first ids in sort order.

## 1. Plain height only records

58,708 records carry only the plain `height` tag and no maxheight key. This matches the earlier count. Plain `height` is a structure dimension. On a fence or wall it is not a vehicle limit.

By object tag (barrier value, or structure when there is no barrier):

| Object | Records | Example ids |
|---|---|---|
| barrier=fence | 32,845 | osm:node:13759830809, osm:node:13829925437 |
| barrier=wall | 8,847 | osm:node:13591733860, osm:way:1001892224 |
| barrier=gate | 5,712 | osm:node:10003425519 |
| barrier=bollard | 4,027 | osm:node:10035132807 |
| barrier=retaining_wall | 3,885 | osm:way:1001320587 |
| barrier=hedge | 1,206 | osm:way:1012654398 |
| barrier=kerb | 486 | osm:node:10098287505 |
| structure=tunnel (no barrier) | 287 | osm:way:1011850821 |
| structure=covered (no barrier) | 264 | osm:node:12485851652 |
| barrier=swing_gate | 239 | osm:node:10218605014 |
| barrier=jersey_barrier | 230 | osm:node:10127559822 |
| structure=bridge (no barrier) | 176 | osm:way:1003684310 |
| all other barrier values | 2,501 | mound, guard_rail, cable_barrier, city_wall, block, toll_booth, chain and about 30 more |

The earlier fence figure was 32,844 and this run finds 32,845. Wall matches at 8,847. Only 3 of the barrier=fence/wall/gate/bollard/retaining_wall records have a highway tag. Only 727 records (tunnel, covered, bridge) have a structure tag and no barrier, and about 100 of those sit on a highway way.

Remaining after removing these: 56,537 records, of which 43,432 have a maxheight style value that parses as a number. The 43,700 figure in the brief is close to that numeric group.

## 2. Unitless values

808 maxheight style values (805 records) are bare numbers with no unit. OSM semantics make them metres. 756 are below 6 and look normal as metres (2, 3, 5, 1.5, 2.5, 4.49 and so on).

52 are 6 or more. These are suspect as metres:

- 30 fall between 8 and 16 and look like feet (11 appears 10 times, 7 appears 6 times, 13 appears 4 times, 9 appears 3 times).
- "13" example ids: osm:way:617539905 (CA), osm:way:1383997591 (CA), osm:way:720203197 (KS), osm:way:1294585259 (MO).
- "55" appears 6 times, all on motorway ways in Illinois: osm:way:1366056972, 1366056973, 1549585206, 164075292, 164075295, 52535812. 55 m is not a clearance. It is probably a speed or a typo. It stays visible as a value needing a check.
- 150 appears twice and 24 and 20 once each.

By state, bare values of 6 or more are spread widely (TN 9, IL 6, FL 5, MD 5, CA 4, MA 4).

## 3. Directional only and mixed

- Directional only: 86 records have no plain key and only maxheight:forward, maxheight:backward or maxheight:lanes (52 forward/backward, 34 lanes). Example ids: osm:way:1040818133, osm:way:1047759852, osm:way:1047759854.
- Mixed: 39 records pair a plain key with forward, backward or lanes. The earlier review counted 6 under a narrower definition. Example ids: osm:way:1075226534, osm:way:1078555203, osm:way:1087555763.
- Conditional: 9 records carry maxheight:conditional (example osm:way:1119336899). 8 tag values contain an @ condition. These can never be compared to a rig.

## 4. DC, VA and MD duplicates

9 OSM ways appear in two state files. The DC extract uses a coarse bounding box and the VA and MD extracts use Census polygons, so a way near the boundary lands in both. 115,245 rows hold 115,236 distinct ids.

- DC and VA: osm:way:1018158558, 1018158559, 121980267, 1432424375, 1457066720, 50560677, 518092249, 986674245
- DC and MD: osm:way:948782254

A client that loads both state files would double count them.

## 5. Current sharding payloads

The v2 files are split by id order. Ids have no spatial meaning, so every part of a state covers the whole state. A map view cannot skip any part.

| View | Files | Raw bytes | Gzip bytes |
|---|---|---|---|
| Los Angeles street view (CA) | 15 | 7,843,296 (7.8 MB) | 971,781 |
| New York City (NY only) | 8 | 4,138,250 | 604,655 |
| Chicago (IL) | 5 | 2,492,035 | 329,376 |
| Wyoming interstate (WY) | 1 | 188,063 | 24,747 |
| West Virginia two lane (WV) | 1 | 95,147 | 17,792 |

A neighbouring state would add its own files when a view crosses a state line.

## Consequences

These findings drive the requirements in docs/CLEARANCE_NATIONAL.md: drop the non-road height records, keep unitless values as metres and flag suspects, add a comparability status, deduplicate by OSM identity, and replace id shards with spatial tiles.
