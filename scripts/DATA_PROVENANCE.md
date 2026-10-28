# Data provenance and refresh behavior

The saved files are snapshots, not current operational verification. They combine Recreation.gov RIDB records, OpenStreetMap tags and older imported sources. Presence on the map does not establish that overnight camping is legal, a road fits a vehicle, water is available or a campground is open.

## Historical defects handled by this repair

- RIDB extraction previously defaulted missing fees to $0, unparsed fee descriptions to $15, and roads to paved. It inferred amenities and RV compatibility by searching broad descriptions, including phrases such as “no water” and references to lakes. These values are not evidence of services or access.
- Legacy RIDB records without `schema_version: 3` have these inferred fields cleared in the runtime normalizer and merger. The original values remain under `legacy_inferred` for diagnosis.
- Legacy OSM data retained `osm_id` but discarded node/way/relation identity. New pulls preserve `osm_type` and use `osm:<type>:<id>` identifiers.
- The old POI generator turned any campground `water` amenity into a water station. New code requires an explicit drinking-water tag or structured provenance. Even a reported drinking-water amenity does not establish public access or RV tank-filling suitability.
- An OSM LPG fuel tag does not establish cylinder refilling. It is labeled as LPG fuel with cylinder-refill availability unverified.

## Current extraction rules

RIDB numeric fees are accepted only from an exact, unambiguous nightly fee phrase or an explicit free-camping statement. Other fee descriptions remain available as source text with an unknown numeric cost. Amenities, vehicle suitability and road difficulty remain unknown unless a future structured source establishes them. A record's schema version identifies the parser rules, not a new field inspection or current verification.

Stable identifiers come from RIDB facility IDs and OSM element type/ID. Generic web-scraped prices and broad amenity keyword matches are no longer published as confirmed overnight fees or amenities.

Fetchers validate coordinates and write nonempty output atomically. RIDB pagination failures raise an error rather than publish a partial state. Overpass errors, partial-response remarks and empty results preserve the existing saved source file. Raw inputs remain separate from merged output to prevent a later refresh treating a merged dataset as an original source.

The single scheduled data owner is `.github/workflows/fetch-campsite-data.yml`, running Sundays at 03:00 UTC (`0 3 * * 0`). Its default state batch is CA, CO, UT, AZ, OR, WA, MT and WY. It uses RIDB and OSM sources. RIDB uses the repository secret `RECREATION_GOV_API_KEY` or `RIDB_API_KEY`; there is no embedded fallback credential. If unavailable, it retains saved RIDB records. No source refresh was run as part of this repair. No historical data was bulk replaced.

## Regression checks

```sh
python -m pip install requests
python -m unittest discover -s scripts/tests -p 'test_*.py'
node --test scripts/tests/merge-safety.test.js
```

All manual data workflow entry points delegate to that same reusable owner. The owner validates state/source/page-size inputs supplied through environment variables, runs the merge for every requested state, rebuilds the index from all saved merged snapshots and serializes writes under the `kamptrail-data-refresh` concurrency group. Callers do not take the same lock themselves, avoiding a nested-lock deadlock. The former all-states Sunday 02:00 UTC schedule was removed. Manual all-state, single-state, RIDB-only and selected OSM batches remain available. Every writer has explicit `contents: write` permission. No workflow copies merged files over raw source data.
