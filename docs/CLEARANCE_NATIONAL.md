# National OSM clearance candidates (R10, data side)

This package builds source-reported OpenStreetMap height tags for the 50 states and DC. It is the data half of R10. It adds no map layer, no route matching and no rerouting. Those come in later client releases. The Rhode Island pilot file and its client are unchanged. Update (R10 client, docs/CLEARANCE_CLIENT_R10.md): the client now reads these tiles and scripts/build-release.js packages the manifest and every listed tile after a bytes and sha256 check. RI.json is no longer packaged.

Nothing here claims that a road, bridge or tunnel is passable, that a tag is current, or that a state is complete.

## Wording

Records are called clearance candidates in data, manifest and docs. A candidate is an OSM object that carries a height tag. Its meaning is not established until validation. The term "verified clearance" is not used.

## Acceptance criterion (written before the fix)

The national dataset is acceptable when all of the following hold. Measurements behind it are in docs/CLEARANCE_NATIONAL_REVIEW.md.

1. Records are called clearance candidates in data, manifest and docs. No file calls them verified clearances.
2. No candidate exists only because of a plain `height` tag on a fence, wall, gate, bollard or similar non-road object. Every exclusion keeps its raw value and a reason code, with counts by reason, tag and state and a compact excluded-id record per state.
3. Bare numbers are read as metres per OSM semantics. No value is changed or relabelled as feet. Suspect values are flagged and stay visible.
4. Every candidate has a status (numeric_only, mixed, directional_only, conditional, unknown, suspect) and a `comparable` flag. Only fully numeric, non-suspect, unconditional candidates are comparable. Equality with rig height is never clear. An empty set has no minimum.
5. `applies_to` comes from tag evidence only, with the evidence recorded. A bridge alone is never evidence.
6. One OSM identity appears once. A viewport that crosses a state or tile edge still loads it.
7. RI is protected, not failed, and is not downloaded.
8. Each tile file is at most 512 KiB. The manifest lists bbox, bytes, records and sha256 per tile. A city view loads a bounded number of tiles.
9. Two builds from the same input are byte-identical. A rerun on unchanged data rewrites no file and makes no dataset commit.
10. `npm run test:python` and `npm test` pass. The client does not read national data, and scripts/build-release.js still packages only the RI pilot.

## Status of this build

- Geofabrik is blocked from the build sandbox, so nothing was downloaded.
- The committed data was regenerated offline from the committed version 2 state files with `build_national_clearances.py migrate`. No information was lost. Dropped records are listed in data/clearances/excluded with their raw values. Source dates (retrieved_at, extract_timestamp, PBF sha256) are copied unchanged from each state file.
- Counts after migration: 56,568 candidates in 1,059 tiles (44.5 MB), 58,669 excluded records, 43,445 comparable candidates, 69 suspect candidates, 9 duplicate identities merged.
- RI.json is untouched and protected.
- The next workflow_dispatch run (or the scheduled run) rebuilds each state from a fresh extract with the same code path. A rerun whose content is unchanged commits nothing.

## Source and license

Source: one public Geofabrik state extract per run, parsed with the pinned osmium 4.3.2 reader. This is how the RI pilot was built, so the receipt format, Census containment, resource limits and parse budgets are shared.

Why Geofabrik and not Overpass: an extract is a fixed, hashable file with a dated replication timestamp. A rerun on the same file gives the same result. One download per state per month is light on a donated service. Each job deletes its PBF after parsing. Runs go two at a time with a 10 second pause before each download, three attempts with 15 and 60 second backoff, and a Retry-After header is honored. User-Agent: KampTrail-clearances/1.0 (+https://github.com/prowebpromo/kamptrail).

District of Columbia: the Census boundary reference covers the 50 states only. The builder adds a DC extract URL and a coarse bounding-box containment test. Records near the DC edge may be labeled DC while lying just outside it. The source entry says containment is bbox. Where DC and a state both list the same OSM object, the state wins (see DC overlap).

License: OpenStreetMap data is under the Open Database License 1.0. The files are a derived database and stay under ODbL 1.0 with attribution and share-alike. Attribution text:

Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0. See https://www.openstreetmap.org/copyright

Every JSON file except RI.json carries the license, license_url, copyright_url and attribution fields in its header. data/clearances/LICENSE-DATA.md states the terms. DATA_SOURCES.md row "Low-clearance heights" carries the sentence and link. Any screen that shows these records must show the attribution or an equivalent link.

## Files

- data/clearances/index.json is the manifest. It holds totals, the tile index, exclusion counts, per-state sources, failures and states_protected.
- data/clearances/tiles/{z}-{x}-{y}.json holds candidates. A crowded cell at the deepest zoom continues in {z}-{x}-{y}-p2.json and so on.
- data/clearances/excluded/{ST}.json is the compact excluded-id record for one state.
- data/clearances/LICENSE-DATA.md is the license notice.
- data/clearances/RI.json is the protected version 1 pilot file.
- Limits per tile: 512 KiB, 2000 candidates, 50,000 vertices (the pilot client limits). A state build is limited to 48 MiB and the directory to 200 MiB.

## Tile scheme

Candidates sit in a slippy-map quadtree. A candidate belongs to exactly one tile, chosen by the centre of its bounding box. Candidates start in z7 cells. A cell splits into four children while it is over 128 KiB (the target) up to z13. At z13 a still crowded cell continues in numbered parts. No file exceeds 512 KiB (the largest is 377,452 bytes).

The manifest tile entry holds path, z, x, y, part, parts, bbox, bytes, records and sha256. The bbox is the union of the bounding boxes of the candidates in that tile, not the cell. A way that crosses a cell edge is stored once and the tile bbox covers all of it, so a view on either side of the edge finds it. A client loads every tile whose bbox intersects the view.

Why a slippy quadtree and not 1x1 degree: a fixed grid cannot adapt to density. Measured on this data (candidate bytes per cell by bbox centre):

| Grid | Cells | Largest cell | Cells over 512 KiB |
|---|---|---|---|
| 1 x 1 degree | 665 | 1,903,450 bytes | 20 |
| z7 fixed | 166 | 3,846,335 bytes | 18 |
| z8 fixed | 481 | 2,411,944 bytes | 18 |
| z7 start, adaptive split (used) | 1,059 tiles | 377,452 bytes | 0 |

A degree cell is also narrower in ground distance at high latitude, and it cannot split where New York or Los Angeles is dense. A z7 start keeps rural states to a few small files (Wyoming I-80 at z12 loads one 39 KB tile). The quadtree key is the same z/x/y scheme the map already uses, so the client can find a tile from a view with integer math or with the bbox index. The cost is more files (1,059) and a manifest of about 386 KB that holds the tile index.

Measured payloads for a 1280 x 800 CSS pixel view, from `build_national_clearances.py measure`:

| View | Zoom | Tiles | Raw bytes | Gzip bytes | Candidates |
|---|---|---|---|---|---|
| New York City | 8 | 158 | 7,803,996 | 1,136,626 | 9,495 |
| New York City | 10 | 55 | 3,192,837 | 431,251 | 3,982 |
| New York City | 12 | 19 | 1,347,432 | 166,974 | 1,733 |
| Los Angeles | 8 | 46 | 2,063,816 | 258,346 | 2,701 |
| Los Angeles | 10 | 32 | 1,706,757 | 205,579 | 2,245 |
| Los Angeles | 12 | 16 | 714,748 | 83,664 | 943 |
| Chicago | 8 | 68 | 3,425,837 | 418,795 | 4,413 |
| Chicago | 10 | 37 | 1,959,418 | 214,438 | 2,563 |
| Chicago | 12 | 17 | 1,094,105 | 112,981 | 1,449 |
| Wyoming I-80 (Rawlins) | 8 | 7 | 334,379 | 43,238 | 454 |
| Wyoming I-80 (Rawlins) | 10 | 2 | 127,119 | 14,767 | 182 |
| Wyoming I-80 (Rawlins) | 12 | 1 | 39,492 | 5,272 | 55 |
| West Virginia US-219 (Marlinton) | 8 | 39 | 2,254,001 | 328,539 | 2,747 |
| West Virginia US-219 (Marlinton) | 10 | 1 | 129,764 | 19,700 | 153 |
| West Virginia US-219 (Marlinton) | 12 | 1 | 129,764 | 19,700 | 153 |

A Los Angeles street view (z12) now loads 0.71 MB in 16 tiles. It loaded 7.8 MB before, because every id-sorted CA part covered the whole state. A city view at z8 is still large. The later client should not draw candidates below about z10, or should cap tiles per request.

## Candidate fields

Top level of each tile: version 3, schema kamptrail-clearances-3, kind clearance_candidates, the license header, notice, tile {z, x, y, part, parts}, bbox, and candidates. A tile has no download or extract dates, so a tile only changes when its candidates change.

Each candidate:

| Field | Meaning |
|---|---|
| id, osm_type, osm_id | Exact OSM identity, for example osm:way:123. Nodes and ways never collide |
| osm_version, edited_at | OSM object version and timestamp. Not an inspection date |
| state | Canonical region (see DC overlap) |
| also_in_extracts | Other extracts that listed the same object. Present only when there are any |
| geometry | Original vertices, unsimplified. Point for nodes, LineString for ways |
| tags | Raw tag text for maxheight, maxheight:physical, maxheight:conditional, maxheight:forward, maxheight:backward, maxheight:lanes and height. Never altered |
| context | Route-association tags: name, ref, highway, bridge, tunnel, covered, layer, barrier, man_made, railway, junction, oneway, access, source and signed fields |
| restriction_on | way or node |
| structure | Any of bridge, tunnel, covered, height_restrictor |
| metres, inches, parse | Normalized values and parse status per key that counts. Metric converts to inches floored to 0.01 |
| status | numeric_only, mixed, directional_only, conditional, unknown or suspect |
| comparable | true only for numeric_only |
| min_inches, min_metres | Present only when comparable. The lowest numeric value. Absent otherwise, so an empty set has no minimum |
| plausibility | ok, suspect or not_assessed |
| unit_assumed | metres when any value is a bare number |
| reasons | Reason codes for every uncertainty, exclusion of a key or flag |
| applies_to, applies_to_evidence | way_itself, road_below or unknown, with the tag evidence used |

## Height rule and exclusions

A record whose only height evidence is a plain `height` tag is kept only where that tag plausibly limits a vehicle path:

- barrier=height_restrictor (reason height_kept_height_restrictor)
- a highway way that is a tunnel or covered (height_kept_tunnel_or_covered_highway)

Every other plain-height-only record is excluded. A plain `height` on a bridge (highway or not) is the structure's own height: it does not limit traffic on the bridge, and a bridge's presence is not evidence about the road below. Those records are excluded with reason plain_height_is_bridge_structure_height. Every other one is excluded with reason plain_height_not_vehicle_path. This covers fences, walls, gates, bollards, hedges, kerbs, retaining walls and the rest of the barrier values, plus structure tags with no highway. When `height` sits beside a maxheight key on such an object, the record stays for the maxheight and the height is ignored with reason height_ignored_plain_height_not_vehicle_path. The raw value stays in tags.

In the live builder, objects with only a `height` tag and no road, barrier, railway or structure context (buildings and the like) are skipped. They are counted by object kind in the build status and not listed.

Published counts, in index.json under exclusions: total, by_reason, by_tag (reason, then object tag such as barrier=fence) and by_state, plus a file entry per state. An excluded file lists ids by reason, tag and OSM type. Ids are sorted and delta encoded. Decode: the first entry of ids_delta is absolute and each later entry adds to the previous id. raw[i] indexes values and gives the raw height text. This reproduces the exclusion without storing full records.

After migration: 58,669 excluded. plain_height_not_vehicle_path 58,472 (fence 32,840, wall 8,838, gate 5,712, bollard 4,027, retaining_wall 3,885, hedge 1,206 and the rest). plain_height_is_bridge_structure_height 197, of which 28 are highway bridges (20 motorway, 8 motorway_link) that an earlier draft kept as way_itself, 19 of them comparable. 39 plain-height-only records are kept, all height restrictors or tunnel and covered highways.

## Units and plausibility

OSM semantics: a bare number is metres. The OSM wiki page Key:maxheight (https://wiki.openstreetmap.org/Key:maxheight, fetched 2026-10-31) says: "If no unit is included, the value is assumed to be in metres." It gives maxheight=3.8 as 3.8 m. It gives feet and inches as 6'7" with a typewriter apostrophe and double quote and no spaces.

So bare numbers are valid. They are never changed and never relabelled as feet. A record with a bare number carries unit_assumed: metres. A value is flagged plausibility: suspect, with a reason, when:

- a bare number is 6 or more: bare_number_likely_feet from 6 to 20, bare_number_implausible_metres above 20 (for example 55 on Illinois motorways)
- the value is under 5 ft on a vehicle highway (under_5ft_on_highway), or a number whose unit is assumed reads over 18 ft on a vehicle highway (over_18ft_on_highway). An explicit value above 18 ft, such as 20'0", is what the mapper stated and is an ordinary posted clearance, so it is not flagged. Exactly 5 ft and exactly 18 ft are plausible. Footways, cycleways, paths, pedestrian ways and steps are not vehicle highways, and barrier nodes without a highway tag are not checked against the bounds.

Suspect candidates stay in the data as "value needs checking" and are excluded from comparison. After migration 69 candidates are suspect: 54 assumed-unit values over 18 ft on a highway, 53 bare numbers read as likely feet, 7 bare numbers implausible as metres and 1 under 5 ft. A candidate can carry more than one reason.

## Status and comparability

| status | Meaning | comparable |
|---|---|---|
| numeric_only | Every key that counts parses to a number, no direction or lane tag, no condition, not suspect | true |
| mixed | A plain numeric value beside a directional or lane tag, or beside a non-numeric plain key | false |
| directional_only | Only maxheight:forward, :backward or :lanes | false |
| conditional | Any conditional key, or any value with @ or a time condition. Never comparable | false |
| unknown | No usable number: none, default, below_default, unparseable, ranges, other units | false |
| suspect | A numeric value that failed a plausibility check | false |

Order of precedence: conditional, suspect, numeric/mixed, directional_only, unknown. After migration: numeric_only 43,445, unknown 12,915, suspect 69, mixed 44, directional_only 86, conditional 9.

min_inches is the lowest of the numeric plain values (maxheight, maxheight:physical and counted height) and exists only on comparable candidates. A minimum over an empty set does not exist.

Comparison in clearance_parse.compare_to_rig gives below, equal, above or unknown. comfortable is true only when the clearance is strictly greater than rig height plus margin. Equal is never comfortable.

## applies_to

Derived from tag evidence only. The evidence used is recorded in applies_to_evidence.

- way_itself: the restriction tag is on the highway way being traveled (evidence tag_on_highway_way and highway=...). A bridge tag alone adds nothing.
- road_below: the tag is on a highway way that itself passes below something: a tunnel, a covered way or a negative layer (evidence way_is_tunnel, way_is_covered or way_on_negative_layer). The limit applies to traffic on that tagged way, exactly as for way_itself. The label records why the limit exists, not a different road. An explicit structure relation would also count. The data holds no relations, so none is used.
- unknown: everything else. A barrier node (for example barrier=height_restrictor) is unknown because the dataset does not record which way the node sits on (evidence barrier_node_parent_way_not_recorded). Any object with no highway way is unknown (no_highway_way_evidence).

A bridge's presence alone is never evidence. After migration: way_itself 47,702, road_below 7,351, unknown 1,515.

## Data contract for route use (for the later client)

These rules bind any client that reads this data:

1. A comparable candidate never establishes that a whole route is clear. It is one tagged object. Absence of candidates is not clearance.
2. Missing or uncomparable data along a route stays visible. Candidates with status mixed, directional_only, conditional, unknown or suspect, and candidates with applies_to unknown, must be shown as unresolved, not dropped and not treated as clear.
3. A clearance equal to rig height must never produce a clear result. Use compare_to_rig and show equal as a warning.
4. A suspect candidate is shown as "value needs checking" and is never compared.
5. A candidate whose applies_to is unknown cannot be tied to the driven road by this data. The client must resolve it or flag it.
6. Every display must carry the ODbL attribution.

## DC overlap

The DC extract uses a coarse bounding box, and VA and MD use Census polygons, so objects near the boundary appeared in two state files (9 identities in the old data). The new rule: identity is osm type plus id. Each identity is stored once. The canonical region is the one with Census polygon containment, so VA or MD beats DC, and the other extracts are listed in also_in_extracts. Because tiles are spatial and not by state, a view that crosses the DC boundary finds the object in one tile through the bbox index. Refreshing one extract removes only that extract's membership, so a later DC-only refresh does not drop an object that VA still lists. This is tested in scripts/tests/test_national_clearances.py (DedupeTests).

## RI is protected

RI.json is the shipped version 1 pilot. The manifest records it under states_protected with status protected, a reason and a release gate. It is not in states_with_failures. The builder never downloads it, and the workflow plan excludes it. The gate: release a client that reads kamptrail-clearances-3 tiles, then review and rebuild RI under this schema.

## Determinism and churn

- Output is canonical JSON (sorted keys, fixed separators). Candidates sort by id and tiles by z, x, y, part. Two builds from the same input are byte-identical.
- Each state build computes content_sha256 over its candidates and excluded record, without any source field. A new download with the same content is status unchanged_content and stages nothing. Publish also keeps the committed source entry when the hash matches.
- Tiles hold no download or extract dates. Dates live in the sources section of index.json, per state. A source entry changes only when that state's content changes, so source age reads as "date of the extract that last changed this state". The latest check for a run is in the workflow summary and the staged status files.
- publish rewrites a file only when its bytes differ. An unchanged run leaves git clean and the commit step logs No clearance changes. A test runs the workflow's commit step against a local bare repository and confirms the second run adds no commit.
- Failure entries in the manifest hold a reason code only, no timestamps.

To measure real monthly growth after a run:

```
git log --oneline -- data/clearances | head
git rev-list --count HEAD -- data/clearances
git diff --shortstat HEAD~1 HEAD -- data/clearances
git show --stat --format= HEAD -- data/clearances | tail -3
git count-objects -vH
du -sh data/clearances .git
git clone --bare . /tmp/size-check.git && du -sh /tmp/size-check.git
```

Compare `git count-objects -vH` (size-pack) before and after a monthly commit, and `git diff --shortstat` for the dataset commit.

## Parsing

- Accepted forms: bare metres, metres with a space and m, and ASCII feet and inches such as 9'4" or 12'. This matches the pilot and clearances.js.
- Values must be above 0 and at most 100 m. none, default, no_indications, unsigned and blank are unknown. below_default has its own parse status. Ranges, lists, other units, comma decimals and anything else are unparseable and stay null.
- Legal (maxheight), physical (maxheight:physical) and structure height (height) are kept as separate keys.

## Nearby hazards and the driven road

OSM does not say which road a route drives. This dataset does not decide that. To support later matching each candidate keeps name and ref, highway class, tunnel, bridge, covered and layer, restriction_on, and full geometry. Not recorded: which way passes under a bridge, parent ways of a node, and travel direction beyond the raw directional tags.

## Limits

- OSM tagging is uneven. Counts are not comparable between states.
- No completeness claim. A missing candidate is not a clear road.
- Tags can be stale, wrong or signed differently from reality.
- Objects that cross a state border are quarantined by the all-vertex containment rule. A border bridge can be missing from both states. Counts are in the manifest sources section.
- Relations and objects with incomplete geometry are quarantined and not kept. Lifecycle objects (disused, abandoned, proposed, construction and similar) are excluded.
- RI has no national candidates until the gate in RI is protected is met.
