# Services 2.14 — real Utah source proof

This is a regional pilot, not nationwide expanded-category coverage. Utah has a dated public Geofabrik import; other accepted US locations retain legacy dump/water/LPG evidence. None establishes current opening, RV access, cylinder refill, or overnight permission.

## Actual source and runtime

- Public source: https://download.geofabrik.de/north-america/us/utah-latest.osm.pbf
- Observed same-host redirect: https://download.geofabrik.de/north-america/us/utah-261028.osm.pbf
- Actual downloaded bytes: 170,897,476; SHA-256 `2f2476fd7e8d5f9aaf50b17eb3cf731312f8e749addf9bd5ad1a4b61e4ae34d2`.
- PBF header extract date: `2026-10-28T21:21:02Z`; retrieval completed: `2026-10-29T23:52:02Z`.
- Serial download: 14.657 seconds. Final native-filter parse plus Census assignment: 19.456 seconds (local runner; not a service-level guarantee).
- Parser: official PyPI `osmium==4.3.2`, checksum-pinned CPython 3.12 manylinux x86_64 wheel, installed with `--no-deps --require-hashes`. See `scripts/requirements-services.txt`; no browser/runtime parser dependency.
- Raw PBF, binary wheel and local replay receipts stay outside the repository and release. Canonical source and emitted row schemas contain no contributor user, uid, or changeset fields.

## Accepted evidence

| Category | Utah memberships |
|---|---:|
| dump | 156 |
| water | 24 |
| lpg | 10 |
| showers | 72 |
| laundry | 106 |
| groceries | 1323 |
| fuel | 1305 |

There are 2,981 distinct Utah identities (886 nodes, 2,080 ways, 15 relations). Category totals overlap because one exact identity can offer multiple services. Separate nearby OSM objects remain separate.

The producer excluded 24 otherwise positive closed/lifecycle service elements. It retained seven explicitly restricted records for a deliberate restricted view and 52 customer/permit records with conditional labels. The client applies the single shared default exclusion of access=no/private. Those access/lifecycle diagnostic counts describe candidates before state containment.

Nineteen Utah candidates were quarantined: three in another Census state, one ambiguous boundary point, and 15 tagged relations without supported assembled area geometry. Unknown relation geometry is omitted, never guessed from another place. Way/area locations are existing representative geometry nodes and do not establish an entrance or driveway.

Legacy normalization examined the 5,509 previously valid OSM rows. Census containment accepted 4,532 and quarantined 977 outside the 50 supported state polygons; these include non-US/buffered records and can include unsupported jurisdictions. Do not describe all 977 as Canadian or Mexican. Raw legacy input remains unchanged; retained per-row source dates were not refreshed. An accepted full Utah extract replaces all 173 legacy rows in Utah, irrespective of legacy retrieval date, leaving 4,359 legacy identities elsewhere.

Full quarantine identities/reasons, source-linked samples, runtime measurements and normalized file hashes are in `docs/SERVICES_PILOT_2.14.json`.

## Output proof

- Snapshot `aa125629cee931801c7a836c`: 7,340 identities in 698 spatial shards.
- Manifest: 198,948 bytes. All shard bytes: 2,322,573. Largest shard: 427,766 bytes / 1,285 rows.
- Caps: 1 MiB manifest, 4,096 shards, 1,000,000 identities; 512 KiB / 1,500 rows per shard. One-degree cells subdivide deterministically when required. Coordinates at ±180° are assigned without crossing bounding boxes.
- SHA-256 is calculated from actual UTF-8 shard bytes. Immutable per-generation manifest and shards exist before atomic current-index promotion. Current plus two prior generations are retained; packaging must retain each complete validated generation. Compatibility `services.json` projects only dump, water and LPG.

## Traceable samples

Each link below identifies an element parsed from the actual PBF. The accompanying positive tags are the extracted evidence, not an independent site visit or live operating-status verification.

| Category | Exact OSM identity | Positive source tags |
|---|---|---|
| dump | [osm:node:10180786523](https://www.openstreetmap.org/node/10180786523) | `amenity=sanitary_dump_station` |
| dump | [osm:node:10597305956](https://www.openstreetmap.org/node/10597305956) | `amenity=sanitary_dump_station` |
| water | [osm:node:11236990940](https://www.openstreetmap.org/node/11236990940) | `amenity=water_point` |
| water | [osm:node:11237039538](https://www.openstreetmap.org/node/11237039538) | `amenity=water_point` |
| lpg | [osm:node:10096672329](https://www.openstreetmap.org/node/10096672329) | `fuel:lpg=yes` |
| lpg | [osm:node:11207881579](https://www.openstreetmap.org/node/11207881579) | `fuel:lpg=yes` |
| showers | [osm:node:10189428453](https://www.openstreetmap.org/node/10189428453) | `amenity=shower` |
| showers | [osm:node:11075019253](https://www.openstreetmap.org/node/11075019253) | `amenity=shower` |
| laundry | [osm:node:10085067971](https://www.openstreetmap.org/node/10085067971) | `shop=laundry` |
| laundry | [osm:node:10184117825](https://www.openstreetmap.org/node/10184117825) | `shop=laundry` |
| groceries | [osm:node:10014717920](https://www.openstreetmap.org/node/10014717920) | `shop=convenience` |
| groceries | [osm:node:10016807455](https://www.openstreetmap.org/node/10016807455) | `shop=convenience` |
| fuel | [osm:node:10012311570](https://www.openstreetmap.org/node/10012311570) | `amenity=fuel` |
| fuel | [osm:node:10085947417](https://www.openstreetmap.org/node/10085947417) | `amenity=fuel` |

## Reproduction and publication gates

```sh
python3 -m pip install --no-deps --require-hashes -r scripts/requirements-services.txt
python3 scripts/import_services.py --region legacy --scratch "$RUNNER_TEMP/services-pbf"
python3 scripts/import_services.py --region UT --scratch "$RUNNER_TEMP/services-pbf"
python3 -m unittest scripts/tests/test_services_import.py
node --test scripts/tests/services-builder.test.js tests/services.test.js
node scripts/build-services.js
```

Only Utah is download-allowlisted. Downloads are serial with a 2 GiB / 30 minute cap, 60-second network reads, fixed HTTPS source and only the exact same-host Utah dated-file redirect. Truncated downloads, malformed PBF/header, hash mismatch, future/missing UTC dates, empty source, date regression or unreviewed >30% count loss fail before replacing the accepted source. `--allow-reviewed-shrink` bypasses only the explicitly reviewed count-loss gate, never empty/date/schema gates. No periodic nationwide Overpass expansion is used.

A source failure keeps the previous accepted state and current published manifest. The accepted full state extract owns only its Census-validated state, removing stale legacy identities there while preserving every other state. Exact-identity overlaps choose higher OSM version, then newer extract/retrieval evidence, then a deterministic tie. Legacy duplicates with equal identity/provenance union categories.

Source aging is explicit: extract time, retrieval time, element edit time and build time are distinct. `generated_at` is derived from accepted retrieval evidence; a rebuild or `--reuse-download` replay does not refresh it. The replay re-hashes the existing PBF against its receipt. Historical dated evidence may remain available offline, but is never labeled current inspection or current operating status. Missing offline/unsupported areas remain unknown. AK/HI/dateline geometry fixtures pass; this pilot does not claim a new real Alaska or Hawaii import.

This producer checkpoint includes seven Python tests (including actual native PBF node/way/relation decoding) and nine Node builder tests. Full application/browser/release checks belong to the integrated release gate.

## Attribution and derivation

OSM-derived services are a separate ODbL-1.0 database. Attribute [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) on every basemap while showing services. Regional extracts are supplied by [Geofabrik](https://download.geofabrik.de/). Derivation is implemented in `scripts/import_services.py` and `scripts/build-services.js`; original legacy bytes remain at `data/poi_dump_water_propane.geojson`. Membership uses the pinned Census reference and existing pure polygon helper in `scripts/build_agency_states.py`.
