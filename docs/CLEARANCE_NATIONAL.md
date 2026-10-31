# National OSM clearance data (R10, data side)

This package builds source-reported OpenStreetMap height tags for the 50 states and DC. It is the data half of R10. It adds no map layer, no route matching and no rerouting. Those come in later client releases. The Rhode Island pilot file and its client are unchanged.

Nothing here claims that a road, bridge or tunnel is passable, that a tag is current, or that a state is complete.

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

Overpass and Geofabrik were both unreachable from the build sandbox. Every request ended in a connection reset at the sandbox proxy. No other route to the sites was tried. So no new state was built here.

- data/clearances/RI.json is the existing pilot file, unchanged (254 records).
- data/clearances/index.json is the manifest, generated from the files on disk. 49 states and DC read as not_built.
- A live attempt for RI through the real download path retried three times with backoff, failed, and kept the prior file. That is the guard working as designed. The failure was not written to the manifest because it came from the sandbox.
- The first real national run happens in CI through the monthly workflow. The measured counts table below must be refreshed from that run.
- The parser, sharding, guards, download retry and manifest are covered by tests. One test builds a synthetic PBF and runs the full native worker for DC.

## Source and license

Source choice: one public Geofabrik state extract per run, parsed with the pinned osmium 4.3.2 reader. This is how the RI pilot was built, so the receipt format, Census containment, resource limits and parse budgets are shared.

Why Geofabrik and not Overpass:

- An extract is a fixed, hashable file with a dated replication timestamp. A rerun on the same file gives the same result. An Overpass answer changes between calls and can return a partial result with a remark.
- The pilot already handles it, including per-object version and edit time, full original geometry and the dated receipt.
- One download per state per month is light on a donated service. Overpass per-state area queries for ways with geometry are heavier on a shared public server and are subject to slot and daily limits.
- The cost is bandwidth in CI. The state files total roughly 10 GB. Each job deletes its PBF after parsing. Runs go two at a time with a 10 second pause before each download, three attempts with 15 and 60 second backoff, and a Retry-After header is honored.
- If Geofabrik ever becomes impractical, Overpass is the fallback. It would need per-state queries, a pause between them, a timeout and backoff, and the same record shape. It is not implemented.

User-Agent: KampTrail-clearances/1.0 (+https://github.com/prowebpromo/kamptrail). It carries the project URL and no personal address.

District of Columbia: the pinned region registry and the Census boundary reference cover the 50 states only. The builder adds a DC extract URL and a coarse bounding-box containment test. The DC URL and the box are unverified because the sandbox could not reach Geofabrik. Records near the DC edge may be labeled DC while lying just outside it. The source block says containment is bbox. Replace it with the Census polygon when the reference gains DC.

License: OpenStreetMap data is under the Open Database License 1.0. The files in data/clearances are a derived database and stay under ODbL 1.0 with attribution and share-alike.

Attribution text, also stored in index.json:

Contains information from OpenStreetMap, © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0. See https://www.openstreetmap.org/copyright

Any screen that shows these records must show that text or an equivalent link. Root DATA_SOURCES.md is outside this package and still needs a line for this dataset.

## Files

- data/clearances/{ST}.json holds part 1 of a state. Larger states continue in {ST}-2.json, {ST}-3.json and so on.
- Every part stays within the pilot client limits: 512 KiB, 2000 records and 50,000 vertices. A state is split by record order, which is sorted by id.
- data/clearances/index.json is the manifest. It lists all 51 regions.
- A state is limited to 48 MiB and the whole directory to 200 MiB. Past either limit the refresh keeps prior data or refuses to publish.
- The size of the national set is not yet measured. Monthly commits of tens of megabytes will grow git history. Review the first run before leaving the schedule on.

Existing RI.json is version 1 (pilot format). National files are version 2. The builder will not replace a version 1 file unless run with allow-schema-change. That stops a scheduled run from breaking the shipped RI client. Turn it on only after the client reads version 2.

## Record fields

Top level of each file:

| Field | Meaning |
|---|---|
| version, schema | 2 and kamptrail-clearances-2 |
| region | State code |
| part, parts | This file's number and the state's file count |
| source | Geofabrik URL, resolved dated URL, PBF sha256 and bytes, retrieved_at, extract_timestamp, containment (census_polygon or bbox), boundary reference hash, license fields |
| records | The records below |

Each record:

| Field | Meaning |
|---|---|
| id, osm_type, osm_id | Exact OSM identity, for example osm:way:123. Nodes and ways never collide |
| osm_version | OSM object version |
| edited_at | OSM object timestamp |
| state | Region code |
| geometry | Original vertices, unsimplified. Point for nodes, LineString for ways |
| tags | Raw tag text for maxheight, maxheight:physical, maxheight:conditional, maxheight:forward, maxheight:backward, maxheight:lanes, and height. Plain height is kept only on bridges, tunnels and barriers |
| metres | Normalized metres for maxheight, maxheight:physical and height, or null |
| inches | Normalized inches for the same keys, or null |
| parse | Status per key: numeric, below_default, unknown or unparseable |
| context | Route-association tags: name, ref, highway, bridge, tunnel, covered, layer, barrier, man_made, railway, junction, oneway, access, source and signed fields |
| restriction_on | way if the tag is on a way, node if it is on a node |
| structure | Any of bridge, tunnel, covered, height_restrictor |

The retrieval date is source.retrieved_at. The OSM timestamp is edited_at. The extract date is source.extract_timestamp. None of these is an inspection date.

Parsing:

- Accepted forms are bare metres, metres with a space and m, and ASCII feet and inches such as 9'4" or 12'. This matches the pilot and clearances.js.
- Feet and inches convert exactly. Metric converts to inches and is floored to 0.01, so rounding never raises a height.
- Values must be above 0 and at most 100 m.
- none, default, no_indications, unsigned and blank are unknown.
- below_default is its own status with no number.
- Ranges, lists, conditionals, other units, comma decimals and anything else are unparseable and stay null.
- Conditional, directional and lane tags are kept as raw text only. They have no status and no number.
- Legal (maxheight), physical (maxheight:physical) and structure height (height) never stand in for one another. Plain height is a dimension of the structure and not a clearance.

Comparison, in clearance_parse.compare_to_rig, gives below, equal, above or unknown. comfortable is true only when the clearance is strictly greater than rig height plus margin. Equal is never comfortable. Above is still not a passage claim.

## Unknowns

A record with a null inch value is kept, not dropped. Unknown, below_default and unparseable all mean the number is not known. The RI pilot has 15 such records out of 254, all none or default. A road with no tag is not in the data at all, and its absence says nothing about clearance.

## Nearby hazards and the driven road

OSM does not say which road a route drives. This dataset does not decide that either. Association happens at route time, and unresolved cases stay flagged.

The original FreeRoam check (back-roads services/routing.coffee L227 to L271 at commit bbbdc950008becde1428ba25dacfdc6a790910e9) kept a hazard when it was a tunnel, was under a non-road, or its road name matched a maneuver street name. To support the same tests later, each record keeps:

- name and ref for name matching
- highway class for road versus non-road
- tunnel, bridge, covered and layer for grade separation
- restriction_on, so a tag on a node or on a structure is not mistaken for a tag on the driven way
- the full geometry, for distance checks

Not recorded, because OSM files do not hold it: which way passes under a bridge, the travel direction a height applies to beyond the raw directional tags, and parent ways of a node. A node record has no road claim. A bridge way's maxheight may describe the deck or the road below. The data does not choose. The client must flag these as unresolved.

## Limits

- OSM tagging is uneven. Some states have thorough height mapping and some have almost none. Counts are not comparable between states.
- No completeness claim. A missing record is not a clear road.
- Tags can be stale, wrong or signed differently from reality. Check signs and the responsible operator.
- Objects that cross a state border are quarantined by the all-vertex containment rule. A border bridge can be missing from both states. Counts are in the manifest.
- Relations and objects with incomplete geometry are quarantined and not kept.
- Lifecycle objects (disused, abandoned, proposed, construction and similar) are excluded.
- Source changes between monthly runs are not tracked as history. Each state file is the latest extract.
- Plain height and conditional tags are raw text. No client logic is defined for them yet.

## Visitor-proposed clearances (record design only)

No client or API exists. This is the target shape for the later package. Visitor data is stored apart from OSM data. It is never merged into the OSM files, so ODbL share-alike does not attach to the visitor layer, and visitor values never overwrite OSM tags.

```json
{
  "schema": "kamptrail-clearance-proposal-1",
  "proposal_id": "uuid",
  "submitted_at": "2026-11-05T14:02:11Z",
  "kind": "new | correction | removal",
  "status": "pending | approved | rejected | withdrawn | superseded",
  "location": {"lat": 0, "lon": 0, "accuracy_m": 0},
  "target_osm": {"type": "way", "id": "123", "version_seen": 4},
  "reported": {
    "raw_text": "13'6\"",
    "inches": 162,
    "basis": "signed | measured | estimated",
    "applies_to": "legal | physical",
    "direction": "both | forward | backward | unknown",
    "structure": ["bridge"]
  },
  "road": {"name": "Main St", "ref": "US 9"},
  "evidence": {"photo_ids": [], "photo_sha256": []},
  "submitter": {"anonymous_id": "salted hash"},
  "terms_version": "clearance-terms-1",
  "moderation": {"reviewed_by": null, "reviewed_at": null, "decision": null, "reason_code": null, "note": null}
}
```

Rules to carry into the build:

- Keep raw_text and inches, the same as OSM records. Unparseable text stays unknown.
- Show a proposal as visitor-reported and unverified until a moderator approves it. After approval it is still a visitor report with a date.
- Estimated values never display as signed values.
- Moderation uses the existing observation moderation path. Rejections keep a reason code and are not deleted.
- Photos need the existing photo handling and size limits.
- A proposal for an OSM object records version_seen, so a later OSM edit can flag the proposal for review.
- Do not copy values from Google, Waze, other apps or commercial databases.
- Open license question for the owner: which license a submitter grants, and whether approved proposals may be offered back to OpenStreetMap. This needs owner and legal review before any submission form ships.

## Refresh process

Workflow: .github/workflows/refresh-national-clearances.yml. It fires on Tuesdays and runs only on the first Tuesday of the month, so it avoids weekends. It can also be started by hand for chosen states.

1. plan picks the states.
2. One job per state, two at a time. Each runs the tests, pauses, downloads the extract, parses it in the bounded child (8 GiB address space, 30 minute CPU and wall limits, 12 GiB disk), shards it, and writes a stage directory with a status file. The artifact is kept even on failure.
3. publish downloads every stage, moves passing states into data/clearances, rewrites index.json, recomputes every hash, runs the existing clearance Node tests and commits only data/clearances with a rebase and retry push.

Guards. In every case the prior file is kept and the failure goes into the manifest.

- A fetch, parse or budget failure.
- Zero new records.
- A state with 10 or more prior records that falls below 70 percent of them.
- A state over 48 MiB.
- A prior file in the pilot format, unless schema change is allowed.
- A job that crashed and left no status.
- If more than a quarter of the planned states fail, nothing is published.
- If the extract hash equals the committed one, the state is left alone.

Manifest. Each state entry has status (present, kept_prior, failed or not_built), schema, records, parts, files with bytes, sha256 and record counts, a state sha256 over its files in order, retrieved_at, extract_timestamp, source_sha256, parse_counts, quarantined counts by reason, and the last failure with its time. The manifest has no run timestamp of its own, so an unchanged refresh makes no diff.

Local use:

```sh
python3 scripts/build_national_clearances.py build --dry-run
python3 scripts/build_national_clearances.py build --state DC --stage /tmp/stage --scratch /tmp/pbf
python3 scripts/build_national_clearances.py publish --stage /tmp/stage
python3 scripts/build_national_clearances.py verify
```

Install the parser with python -m pip install --no-deps --require-hashes -r scripts/requirements-services.txt. Stage and scratch must be outside the checkout.

## Measured counts per state

Only RI is measured. It is the pilot file from the 2026-10-28 Geofabrik extract, retrieved 2026-10-30. It has 254 records in 119,065 bytes, 239 numeric and 15 unknown, and 4 quarantined. All other regions are not built.

| Region | Records | Bytes | Status |
|---|---|---|---|
| RI | 254 | 119,065 | present (pilot format) |
| AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA SC SD TN TX UT VA VT WA WI WV WY | none | none | not_built (sandbox could not reach the source) |

After the first CI run, replace this table from index.json.

## What remains

- Run the workflow once by hand and review per-state counts, sizes and quarantine reasons. Confirm the DC extract URL.
- Add DC to the Census boundary reference.
- Client release for R10 display: read version 2 files and the manifest, load by state or viewport, show raw value, source dates, attribution and unknowns, and apply compare_to_rig logic with equality never comfortable. Then run the workflow with schema change allowed so RI moves to version 2.
- Route association at route time: way name and ref, highway class, tunnel, bridge and covered flags, restriction_on, geometry distance, and direction. Mark unresolved cases.
- R11 rerouting: use only records with a known inch value, treat equality as blocking comfort, and report a failed avoidance as a failure.
- DATA_SOURCES.md entry and the visitor-proposal package, including the license decision.
