# Forecast discovery contract — 2.13

First increment: filter **published NWS temperature samples over the next 24 or 48 hours**. This is not continuous extrema, observed campsite weather, daily MaxT/MinT or a guarantee of conditions. Selected-site NWS forecasts remain separate. Raw NDFD GRIB data stays in the producer, never in the browser or PHP decoder.

## Source and matching

Use fixed NOAA NDFD days 1–3 `ds.temp.bin` for CONUS, Alaska and Hawaii. Pinned grib2io/g2c decodes; wgrib2 cross-checks normalized scan order. Choose the regional product by catalogue state (AK → Alaska, HI → Hawaii, other states → CONUS), independently of temperature presence; overlapping grid rectangles must not select another jurisdiction’s product. Map final catalogue coordinates to actual nearest grid points, retain grid coordinates/distance/hash, reject distant edge points, and never substitute a nearby nonmissing value. Convert Kelvin once to Celsius (millidegrees suppress decoder noise). Null stays unknown; zero and negative Celsius are valid. Preserve exact sorted UTC timestamps; cadence can be 1–3 hours.

## Wire format v1

All datetimes are real UTC ISO strings; hashes lowercase SHA-256; snapshot ID 24 lowercase hex. Only existing 50 state codes. Coordinate keys use elevation's shared seven-decimal `latitude,longitude` format.

Manifest:

```json
{"version":1,"snapshot_id":"24hex","catalogue_sha256":"64hex","generated_at":"UTC","expires_at":"UTC","source":{"name":"NOAA/NWS NDFD","files":[{"region":"conus","url":"fixed NOAA HTTPS URL","etag":"reported","last_modified":"UTC","bytes":123,"sha256":"actualGRIB64hex","sha256":"source64hex"}]},"regions":{"conus":{"times":["UTC"],"reference_times":["UTC"],"grid_sha256":"64hex","max_step_seconds":10800,"reference_times":["UTC"]}},"states":{"CA":{"asset":"forecast-v1-24hex-CA.json.gz","sha256":"compressed64hex","json_sha256":"raw64hex","bytes":123,"json_bytes":456,"count":789}},"coverage":{"total":0,"grid_known":0,"unknown":0}}
```

State file, hashed over exact raw JSON bytes before gzip:

```json
{"version":1,"snapshot_id":"24hex","state":"CA","generated_at":"UTC","expires_at":"UTC","records":{"campsite-id":{"coordinate_key":"lat7,lng7","region":"conus","status":"known","grid_lat":1,"grid_lng":2,"grid_distance_m":100,"temperatures_c":[0,null,-5]}}}
```

Each source file includes `sha256` over the actual downloaded GRIB bytes. Each region includes sorted, unique UTC `reference_times` (at most 100), separate from file modification and retrieval times.

Source file `sha256` hashes the downloaded GRIB bytes. Regional `reference_times` is the sorted, unique set of actual model reference UTC timestamps, with 1–100 entries; it is distinct from HTTP file modification time. Arrays align exactly with manifest regional timestamps. An unknown record retains coordinate key, `status:"unknown"`, bounded reason and no invented temperatures/grid point. Known mapping may contain null forecast values; required samples must all be finite to match.

`catalogue_sha256` is SHA-256 of deterministic UTF-8 JSON (literal Unicode, no spaces), an array sorted by ID, rows `[id, coordinate_key, sortedStates]`. Mutable fee/elevation metadata is excluded. Search builder writes `data/campsites/coordinate-index.json` as `{version:1,sha256,count}`; PHP/client compare this tiny file instead of parsing the national index. Producer independently computes identical hash. Coordinate identity still checked per record.

Limits: 50 states, 100,000 records globally, 20,000/state, 100 samples/region, 2 MiB compressed/8 MiB raw per state, 256 KiB manifest, 150 MiB source download/run, 300 MiB private cache. Actual national output must be benchmarked.

## Freshness and predicate

Expiry is at most three hours after the oldest included NOAA file modification time AND at most three hours after generation. Packaging never refreshes old meteorology. File modification and model reference times are separate; a new mosaic is not proof of freshly issued WFO data everywhere.

Controls: `forecastMinC`, `forecastMaxC` (inclusive, canonical Celsius/null), `forecastHours` 24 or 48, `forecastUnit` F/C. Same effective time/evidence in map and route predicates. Inventory must extend through selected horizon, have no gap exceeding declared cadence (max 3h), and contain required samples. Every published sample inside window must be finite/in range. Never interpolate missing values or shorten horizon silently.

Index API includes `server_now`; client anchors effective clock to it plus monotonic elapsed time and refreshes on resume. Show actual interval, cadence, source-file update and expiry. Missing/incomplete/expired/offline evidence never matches active filters; controls remain selected. Old details may be labelled history, never current offline matching.

## Transport/hosting

No hourly Git data commits or full app deploys. Dedicated public non-latest prerelease with immutable generation assets and TWO fixed public download pointers `current-a.json` / `current-b.json` containing full manifests. Upload/verify complete new generation before replacing older pointer. One valid pointer remains during replacement. Protect both pointer targets and retain retired generations through expiry + 30min reader grace. Refuse immutable-release policy rather than disabling it. No new persistent secret, inbound publisher or JWT service.

PHP pulls only fixed repository/tag/public HTTPS URLs with per-hop host validation, bounded bytes/hashes/schema/source dates and catalogue compatibility. Never forward credentials or log signed redirects. Private weather cache is sibling of public_html, preserved across deployments. Atomic active-manifest promotion; previous valid cache survives pull failure but absolute expiry remains binding. Global metadata reservation 15min + error backoff; max two shard downloads; no arbitrary caller URLs/paths/downloadable generation IDs.

- `GET api/forecast.php?kind=index` → `{ok:true,server_now,manifest}`, or explicit unavailable/stale.
- `GET api/forecast.php?kind=state&state=CA&snapshot=24hex` → exact validated raw state JSON, ETag=`json_sha256`. Only locally accepted/retained generations; unsupported IDs cannot trigger arbitrary downloads.

Frontend new module `KampTrailForecast`; network outside per-marker rendering. No overview downloads. Load states only when an active filter needs listing-level results; route discovery loads candidate states before common predicate. No weather embedded in campsite search index. No customer DB/moderator credential changes. Public catalogue coordinates only; personal routes/stops are not sent to NOAA.

## Gates

Decoder/orientation/value/period tests; national coverage/size/memory; zero/null/negative/24–48h/timezone/clock/expiry/offline cases; coordinate/hash identity and map/route agreement; concurrent/failed two-pointer publication and expiry-aware cleanup; actual private cache/TLS permissions and deploy survival; mobile/keyboard/AXE; full CI and live verification. Do not claim full FreeRoam parity.
