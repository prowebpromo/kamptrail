# Elevation source and pipeline — 2.12.0

Verified 2026-10-29 UTC. This feature samples interpolated bare-earth terrain; it does not measure a campsite pad, certify accessibility, determine a road grade, or establish whether a site is open. No elevation is inferred from neighbouring campsites or an agency's regional elevation range.

This document covers the static catalogue pipeline. The separate user-triggered route sampler introduced in 2.16 uses the same USGS service, with its own [bounded request, privacy and offline-cache contract](RIG_TERRAIN_CONTRACT_2.17.md). Static import retry/checkpoint policies below do not apply to route requests.

## Authoritative source

- [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer)
- [USGS getSamples operation](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples)
- [Esri operation contract](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/)
- [USGS elevation-query accuracy guidance](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map)

The fixed public HTTPS service requires no application key. The implementation permits only the exact metadata and sampling endpoints and rejects redirects. It does not follow raster URLs, use arbitrary user-supplied provider URLs, or query a provider from the browser. Service publication dates are retained in the service metadata, never assigned as the acquisition date of each point. On the verification date the service described data published through October 26, 2026 and copyright/publication text dated October 27.

Samples are requested using `geometryType=esriGeometryMultipoint`, WGS84 `spatialReference.wkid=4326`, `[longitude, latitude]` points, `returnFirstValueOnly=true`, `interpolation=RSP_BilinearInterpolation`, and `outFields=*`. The operation does not accept an elevation-unit switch; the fixed 3DEP elevation service supplies metres. An independent reviewer verified a nearest-neighbour service sample against EPQS in metres and feet; explicit bilinear sampling produced a different value, so the interpolation method is always retained. Do not mix EPQS dates or interpolation methods into these records.

The service's `maxRecordCount` is not a verified sampling cap. KampTrail conservatively uses at most **50 unique coordinates per request**, a single synchronous request at a time, and a half-second interval before every sample request, including subdivided batches and the first sample after service metadata. Transient HTTP 408/429/500/502/503/504 and transport failures receive at most three attempts per request, with two- and four-second minimum waits. On HTTP 429/503, valid `Retry-After` seconds or HTTP dates extend those waits; a required delay over 60 seconds or malformed header stops the run with checkpoints intact rather than retrying early. Responses are capped at 2,000,000 bytes; timeout is 45 seconds per attempt. HTTP 200 containing an ArcGIS error is a failure, not an empty or zero-elevation result.

After its three attempts fail, only HTTP 408/502/504 or a confirmed response-read timeout may cause a batch to split into two smaller requests. Subdivision is depth-first, limited to three levels and children of at least six coordinates: a 50-point batch can become 25, then 12/13, then 6/7. Each successful child validates its own zero-based `locationId` mapping and atomically checkpoints immediately. A persistent first-branch failure stops after at most 12 attempts across the four sizes; it does not visit later branches or fabricate unknown samples. HTTP 429/500/503, DNS/connect failures, malformed JSON, invalid IDs/coordinates, and nontransient HTTP errors never trigger subdivision. Completed siblings remain reusable on restart.

Pending coordinates are grouped by quarter-degree geographic cells in Morton (Z-order), then sorted numerically inside each cell. This reduces the raster areas touched by one request while retaining exact coordinate keys and response `locationId` joins. It changes no concurrency, batch-size, retry, pacing, or checkpoint limits. On the final 33,287-record catalogue after the first 500 cached samples, median 50-point batch bounding-box diagonal fell from approximately 4,070 km with latitude-string ordering to 180 km with spatial ordering. Geographic span is an efficiency diagnostic, not a terrain accuracy claim.

A single subsequent production-order 50-point spatial batch returned 50 known samples in 25.206 seconds, compared with approximately 37 seconds per earlier latitude-ordered batch. These points were checkpointed using the existing cached service metadata, bringing the resumable cache to 550 records. This small timing sample does not establish total run duration; requests remain serial and bounded.

## Matching, metadata and unknowns

The cache key is `latitude,longitude`, each normalized to **exactly seven decimal places**; negative zero becomes zero. Python rounds the actual binary floating-point value with `Decimal.from_float` and `ROUND_HALF_UP` to match JavaScript `toFixed(7)`, including exact positive and negative ties. Queries use those same rounded coordinates. Input catalogue records sharing a coordinate reuse one sample. A changed coordinate requires a new sample even if the campsite ID is unchanged.

Returned samples can be out of order. The importer joins zero-based `locationId` to the request and verifies returned WGS84 coordinates against the exact normalized key. Missing IDs become explicit `unknown/missing_sample`. Duplicate result IDs become `unknown/duplicate_location_id`, without selecting an arbitrary value. Invalid IDs, unexpected coordinate systems, mismatched coordinates, malformed response structure and provider errors fail the batch. Missing coverage or a recognized NoData value becomes unknown. Unknown elevations are null, never zero; valid zero and negative elevations remain numeric. Known values must be within the shared frontend/pipeline range of −500 through 9,000 metres; values outside it are unknown rather than silently clamped.

Each record retains:

- `coordinate_key`, `status`, numeric `elevation_m` or null, and an unknown `reason` where applicable;
- actual `sample_coordinates: {lat,lng}` or null when no unambiguous sample exists;
- `source` containing the service name, service URL, sample URL, canonical `units: "metres"`, interpolation, and horizontal CRS;
- `retrieved_at`, `service_metadata_id`, raster ID, raw resolution and sample attributes when supplied;
- `vertical_datum` as reported for that raster, or null;
- nullable `acquisition_metadata`, preserving provider values for `AcquisitionDate`, `StartDate`, `EndDate`, `pubdate`, and `Cdate` without inventing dates.

`AcquisitionDate` is a raw ArcGIS epoch-millisecond attribute. Other provider date fields can have different formats: the pilot included `pubdate=2013` and eight-digit dates, plus string `EndDate` values. Preserve them as reported; do not blindly parse every value as milliseconds or YYYYMMDD. A service metadata timestamp is neither point acquisition nor ground inspection. Datum may vary by source. Raw resolution is not a statement of vertical accuracy or exact on-ground pixel dimensions; the frontend should omit it unless its units and context are made explicit.

## Cache and publication contract

`scripts/fetch_elevation.py` accepts a catalogue with a nonempty `sites` array (or `records` for compatibility), each containing `id`, `lat`, `lng`, and `states`. It rejects conflicting duplicate IDs and invalid coordinate/state fields. The accepted state set is the app's 50 U.S. states; DC and territories are outside this release's catalogue scope. State membership is inherited from the final catalogue; this importer does not independently certify state boundaries or repair coordinates.

Default pipeline-only cache: `data/sources/elevation.json`:

```json
{"version":1,"updated_at":"ISO time","coordinates":{"lat7,lng7":{"status":"known","elevation_m":123.4}},"sources":{"metadata-sha256":{"service_metadata":{}}}}
```

This illustration omits required per-record provenance described above. Each successful batch atomically checkpoints the full cache using a temporary file and replacement. A failed batch preserves prior checkpoints. Valid cached known **and explicit unknown** results are reused without network access. A valid record must match its key, units, interpolation and source, and reference intact hashed service metadata describing the expected provider. Unknown results with a returned sample must still match the requested coordinates; missing/duplicate samples carry no selected coordinates. Use `--retry-unknown` explicitly to resample cached unknown coverage; known values remain cached. There is no automatic 33,000-point refetch. Service metadata must identify the expected single-band elevation service, and retrieval timestamps must be real UTC ISO datetimes with seconds and optional 1–6 fractional digits, ending `Z` or `+00:00`, not date-only strings.

Public output is committed only when every requested coordinate has a validated known or explicit unknown record. The publisher writes immutable state files first, then atomically replaces:

`data/campsites/elevation/index.json`

```json
{
  "version": 1,
  "snapshot_id": "24 lowercase hex characters",
  "previous_snapshot_id": null,
  "generated_at": "ISO time",
  "source": {"name":"USGS 3DEP","url":"fixed ImageServer URL","units":"metres","interpolation":"RSP_BilinearInterpolation"},
  "states": {"CA":{"url":"snapshots/<snapshot_id>/CA.json","sha256":"64 hex characters","count":123}}
}
```

Each state payload is `{version:1,snapshot_id,state,records:{"canonical campsite ID":record},sources:{"metadata-sha256":metadata}}`. Manifest URLs are relative to the `elevation/` directory. There is deliberately no mutable `elevation/CA.json` alias: following immutable manifest URLs prevents a partially replaced multi-state release. Each SHA-256 is over the exact JSON file bytes, including the trailing newline.

The atomic index switch is the publication commit. A failure before it leaves the previous manifest and referenced files usable. Afterward, retain current and immediately previous immutable generations; prune older generations. Cleanup failure leaves an orphan for the next run rather than invalidating the published snapshot. Republishing the same snapshot preserves the prior generation.

Clients must validate manifest paths, state/snapshot agreement, hashes, record units/status and the coordinate key against the **actual final feature coordinates** before attaching a value. ID/alias agreement alone is insufficient. Keep last-validated state results for offline fallback. Unknown or unverified elevation must not pass a numeric elevation filter. Heights remain metres internally; feet are a display conversion.

## Running and verification

Bounded pilot with an isolated cache, without publishing an incomplete catalogue:

```sh
python scripts/fetch_elevation.py --catalogue /path/to/final/search-index.json --cache /path/to/pilot-cache.json --limit 6 --no-publish
```

For authorized full enrichment, omit `--limit` and `--no-publish`, explicitly pointing at the final post-merge catalogue. Reruns reuse cached coordinates and checkpoint new batches. The reviewed initial full run was paused after 500 samples to improve geographic batching. A subsequent run preserved 1,800 samples before exhausting three HTTP 502 attempts; bounded adaptive subdivision was added afterward. No incomplete public snapshot was published. Do not publish against a stale catalogue merely to claim complete coverage.

Tests:

```sh
python -m unittest scripts/tests/test_elevation.py -v
```

Twenty-six focused tests cover spatial batching and exact-once pending coverage, adaptive HTTP 502 recovery and per-child checkpoints, persistent-failure bounds, failure classification and `Retry-After`, reversed result ordering, cross-language coordinate rounding, units, zero/negative/missing values, duplicate IDs, coordinates and CRS, error bodies, cache-source integrity and UTC timestamp checks, supported state scope, restart with coordinate deduplication, atomic-write failure, interrupted publication, hashes and bounded generation retention.

The six-point live pilot used temporary files, generated six state sidecars, reran with **zero network calls**, then removed the temporary output. No persistent enrichment data was added:

| State | Catalogue ID | Sample coordinate key | Metres |
| --- | --- | --- | ---: |
| AK | osm:node:6736769388 | 63.9688404,-139.2753494 | 912.204833984 |
| HI | osm:node:10566510241 | 19.2587278,-155.1949765 | 2.652970076 |
| CA | osm:node:14202252007 | 37.4442316,-122.3023959 | 345.335754395 |
| CO | osm:node:12230767910 | 39.9954022,-105.5692938 | 2976.327636719 |
| FL | osm:node:4033683462 | 29.4860422,-82.9760783 | 4.473155499 |
| NY | osm:node:5077802445 | 44.1999093,-74.3102944 | 477.213134766 |

All six returned known values and a reported NAVD 88 datum. This is a response-integrity check, not independent survey validation or a current camping-access endorsement; the CA catalogue record is explicitly closed. The independent reviewer's separate six-point protocol probe also demonstrated duplicate input coordinates, out-of-order returned IDs, valid negative elevation, and an omitted no-coverage location.
