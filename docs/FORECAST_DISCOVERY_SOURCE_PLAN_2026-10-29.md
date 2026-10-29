# Forecast discovery source plan — 2026-10-29

Status: researched architecture, bounded live-header pilot, and successful three-region decoder cross-check; not implemented or released. No national temperature coverage claim is supported yet.

## Recommendation

Use operational NOAA/NWS National Digital Forecast Database (NDFD) regional GRIB2 downloads for nationwide forecast discovery. Decode on the build runner and publish compact static forecasts; Hostinger does not need a GRIB decoder. Retain bounded NWS point/gridpoint requests for selected-site details. Do not require 33,287 `/points` requests before national discovery can work.

## Primary sources

- NOAA dataset and access/licensing/decoder guidance: https://registry.opendata.aws/noaa-ndfd/
- Official download structure: https://vlab.noaa.gov/web/mdl/ndfd-grid-data
- Official operational download root: https://tgftp.nws.noaa.gov/SL.us008001/ST.opnl/DF.gr2/DC.ndfd/
- NWS Instruction 10-201, effective November 21, 2023 (administrative update October 2024): https://www.weather.gov/media/directives/010_pdfs/pd01002001curr.pdf
- Grid projections and reference sphere: https://vlab.noaa.gov/web/mdl/ndfd-spatial-reference-system
- GRIB encoding: https://vlab.noaa.gov/web/mdl/ndfd-grib-all-sections
- Decoder/time-encoding caveats: https://vlab.noaa.gov/web/mdl/degrib-gotchas
- Current GIS metadata and regional cadence: https://www.weather.gov/gis/ndfd_metadata.html
- NOAA Python decoder: https://github.com/NOAA-MDL/grib2io and https://noaa-mdl.github.io/grib2io/
- NCEP GRIB2 native library: https://github.com/NOAA-EMC/NCEPLIBS-g2c
- wgrib2 nearest-point semantics: https://www.cpc.ncep.noaa.gov/products/wesley/wgrib2/lon.html
- GRIB temperature parameters/units: https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_doc/grib2_table4-2-0-0.shtml
- NWS API behavior/pricing: https://www.weather.gov/documentation/services-web-api
- NWS gridpoint temporal intervals and conditional requests: https://weather-gov.github.io/api/gridpoints

## Exact download contract

Public, anonymous HTTPS object pattern:

`https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.{conus|alaska|hawaii}/VP.{001-003|004-007}/ds.{temp|maxt|mint}.bin`

Examples:

- https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.conus/VP.001-003/ds.temp.bin
- https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.alaska/VP.001-003/ds.mint.bin
- https://noaa-ndfd-pds.s3.amazonaws.com/opnl/AR.hawaii/VP.001-003/ds.maxt.bin

The NWS alternative uses the same suffix beneath the operational download root above. `VP.001-003` means days 1–3 and `VP.004-007` means days 4–7. These mutable objects are replaced as forecasts change; the URL is not a snapshot identifier. Use only `opnl`, not `expr`, for this feature.

The live probe around 22:22–22:25 UTC on October 29, 2026 fetched three regional S3 listings and nine HTTP ranges (`Range: bytes=0-2047`). Every range returned HTTP 206, `Content-Length: 2048`, a matching `Content-Range`, and an ETag. Only 18,432 GRIB bytes were read. No full raster or campsite temperature was decoded in that initial probe. Web-search directory caches showed older dates; the measurements below came from direct live HTTPS responses.

| Region | temp bytes, days 1–3 | maxt bytes, days 1–3 | mint bytes, days 1–3 | All three, days 1–7 |
| --- | ---: | ---: | ---: | ---: |
| CONUS | 49,247,174 | 4,158,477 | 2,941,240 | 79,759,054 |
| Alaska | 4,862,592 | 768,063 | 581,915 | 10,899,738 |
| Hawaii | 249,901 | 43,691 | 29,132 | 566,961 |

Totals: 62,882,185 bytes for nine days-1–3 objects; 91,225,753 bytes for all eighteen days-1–7 objects. These are observed snapshot sizes, not limits or guarantees. Days-4–7 aggregate sizes were CONUS 23,412,163; Alaska 4,687,168; Hawaii 244,237 bytes.

Headers: days-1–3 max/min objects had `Last-Modified: Thu, 29 Oct 2026 21:52:38 GMT`; temperature objects were 21:52:40 GMT for CONUS and 21:52:39 GMT for Alaska/Hawaii. All first messages had reference time `2026-10-29T22:00:00Z`. Examples of returned ETags: CONUS temp `a47a446dc4c4d901ac529b6bb2d50458`, Alaska temp `5984afd474005a3c04a4ef8d81bc5b31`, Hawaii temp `bbf1064258e2f7f958af463e1a3cc2dd`. Preserve ETags as opaque validators, not assumed cryptographic content hashes.

## Grid and decoding requirements

| Region | Live dimensions | Points | GRIB grid template | Projection | Nominal spacing |
| --- | --- | ---: | ---: | --- | --- |
| CONUS | 2145 × 1377 | 2,953,665 | 30 | Lambert conformal | 2.5 km |
| Alaska | 1649 × 1105 | 1,822,145 | 20 | Polar stereographic | 3 km |
| Hawaii | 321 × 225 | 72,225 | 10 | Mercator | 2.5 km |

All nine first messages used **scan mode 80**, with `GRIB` beginning after an 80-byte NDFD heading. NOAA expressly warns that some decoders mishandle this scanning pattern and recommends grib2io, degrib, or wgrib2. Do not assume a pygrib/ecCodes result is oriented correctly without an independent check. Pin the decoder and its native dependencies; grib2io requires NCEPLIBS-g2c, so a bare pip install is not a guaranteed self-contained deployment.

Map the actual campsite coordinate to the actual NDFD grid, not to a WFO grid ID or a state-name guess. Read the earth model/projection/scan metadata, normalize longitude across the dateline, and sample coordinates and values using the same normalized ordering. Cache mappings by grid-definition hash plus campsite coordinate hash. Publish sampled grid coordinates and distance. Missing cells and coordinates outside the domain must stay unknown; never clamp to a distant boundary or silently borrow a different valid cell.

The local search snapshot had 33,287 sites, including 613 with an AK tag and 49 with an HI tag. This is not a weather coverage census: labels are insufficient to establish geographic grid coverage or valid-cell availability.

The inspected fields were GRIB edition 2, temperature category 0, parameters 0/4/5 for temp/maxt/mint, surface type 103 and value 2 (2 m above ground). GRIB temperatures are Kelvin. Preserve source units and convert exactly once to the application's canonical units.

## Temporal semantics: release gate

Do not label MaxT/MinT as the extrema of the rolling next 24 hours. NWS Instruction 10-201 defines daytime as 07:00–19:00 local standard time and overnight as 19:00–08:00; Alaska uses 05:00–20:00 and 17:00–11:00. A separate NWS verification page gives a shorter overnight definition, so the governing directive and actual encoded product require care. These local windows also differ from nominal GRIB UTC markers.

Concrete live ambiguity: the first MaxT message in each region used template 4.8, reference 22:00Z, lead-to-start 0 hours, ending timestamp 00:00Z October 30, statistic maximum, and duration 12 hours. `reference + lead` therefore disagrees with `end - duration`. MinT used lead 2 hours, ending 12:00Z October 30, statistic minimum, duration 12 hours. Do not silently normalize away this mismatch or pretend the nominal common UTC interval is each campsite's local daytime. NOAA's DeGRIB gotchas documents ambiguity around negative forecast start times for already-started periods. Preserve all raw fields and validate local-day labeling with official forecast outputs before release.

Temperature is valid at indicated times, not an observed continuous range. NWS documentation describes hourly CONUS near-term grids, then three-hour and six-hour spacing farther ahead; OCONUS metadata describes three-hour spacing. The first temperature leads observed were 1 hour in CONUS and 2 hours in Alaska/Hawaii. A complete temporal inventory has not yet been decoded, and documentation alone must not substitute for per-file validation.

Recommended user semantics:

- Selected-date daytime high and overnight low, using validated source periods.
- Forecast temperature samples over the next 24 hours, with actual hourly/three-hourly cadence displayed.
- Trip-date forecasts only inside available forecast coverage.

Never phrase sampled min/max as a guarantee that temperature stays inside a range throughout an interval. Require every expected sample for the stated cadence/horizon; do not fabricate hourly values between three-hour samples. Missing, expired, partial, or unsupported data is unknown and must not match enabled forecast filters. Preserve unknown offline too.

## Proposed pipeline and freshness policy

These are proposed application policies, not provider guarantees:

1. Download days 1–3 hourly and days 4–7 every six hours, using conditional requests where possible. At measured sizes this is approximately 1.62 GB/day before savings.
2. Use fixed source paths, two download workers, bounded timeouts/retries/bytes, and a finite total runtime. Stream one GRIB message at a time and retain only required cells; do not load all regional forecast rasters simultaneously.
3. Produce state shards and a generation manifest containing catalogue hash, source URLs, ETags, SHA-256 hashes, retrieval and object-modification times, GRIB reference times, grid-definition hashes, period inventory, coverage counts, and expiration.
4. Publish an entire generation atomically and keep weather separate from stable campsite and fee data. **Do not commit volatile forecast shards or GRIB inputs to either application or release Git history.** Hourly weather refreshes must not trigger full application builds, deployments, or browser CI.
5. Proposed near-term cutoff: stop current forecast matching after three hours without a successful refresh. Historical files may remain visible with an expired/date label, but cannot power current filters.

Object modification time is not the issuance time of every WFO/cell in the mosaic. NWS Instruction 10-201 says outdated WFO grids can still be mosaicked. Label provenance as “NDFD file updated,” not “each campsite forecast issued.” Fresh download time alone must never renew source freshness.

## Cost, access, and comparison

The NOAA public bucket needs no AWS account and NODD permits reuse. Attribute NOAA/NWS, avoid implied endorsement, and identify transformed output as derived. Suggested wording: “Forecasts derived from NOAA/NWS NDFD; sampled to nearby forecast grid points by KampTrail.”

The NWS point API is free but its numerical rate limit is explicitly not public. A twelve-cell PHP request bound is an application safeguard, not an NWS allowance. NWS also says cached `/points` mappings require periodic rechecking because office/grid assignments can change. Bounded point requests are useful for selected-site details, but do not support claiming complete national filtering.

No documented NDFD-specific numeric request cap was found. AWS's general S3 performance figures are not a dataset-specific SLA: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html

Standard GitHub-hosted runners for public repositories are free; private-repository charges/allowances depend on account settings. Decoder runtime, peak memory, and output size were not measured in the initial header probe: https://docs.github.com/en/actions/concepts/billing-and-usage

## Initial pilot gates (subsequent results below)

- Decode a pinned, small three-region sample and independently cross-check scan orientation and nearest-grid values with wgrib2.
- Inventory real 24-hour/72-hour samples and identify gaps, missing values, and overlapping/conflicting records.
- Validate date/period labels, especially current-day MaxT and Alaska local windows; do not call nominal periods rolling extrema.
- Measure memory/runtime and then produce an exact catalogue-wide valid/missing/outside-domain count.
- Test failed/partial/expired/offline states and atomic publication before enabling forecast discovery.

This file records research, not authorization or evidence of a completed forecast feature. Further pilot measurements should be appended with their exact capture times, dependency versions, and input hashes.

## Completed decoder pilot — captured 22:29 UTC, October 29

Installed an isolated scratch environment using micromamba 2.3.3 and conda-forge packages, the distribution path documented by NOAA's grib2io project. Versions actually resolved: grib2io 2.8.2 (`py312h0ec8046_0`), NCEPLIBS-g2c 2.3.0 (`h8288008_0`), wgrib2 3.8.0 (`h021f410_7`), Python 3.12.16, NumPy 2.5.4, pyproj 3.8.0, NCEPLIBS-ip 5.4.1. The explicit package lock was saved in scratch. No runtime packages were added to the application.

Distribution instructions and packages:

- https://github.com/NOAA-MDL/grib2io#install
- https://anaconda.org/conda-forge/grib2io
- https://anaconda.org/conda-forge/wgrib2
- https://mamba.readthedocs.io/en/latest/installation/micromamba-installation.html
- Pinned installer: https://micro.mamba.pm/api/micromamba/linux-64/2.3.3 (archive SHA-256 `e7274528ceb9c20d048a428d6c22d7e02e268f8ffb762c4c365422347c8b8ba2`).

The pilot downloaded complete days-1–3 **temperature** files for all three regions, but only the first complete GRIB message (including its 80-byte heading) from each max/min file. This was sufficient to inventory the temperature timelines and cross-check representative period fields without fetching all nine full products or any days-4–7 data. ETag preconditions (`If-Match`) bound each data download to its previously inspected object. Every data request was HTTP 206 with the requested exact length. Nine header ranges plus nine data ranges transferred **56,797,519 bytes**, below the 63 MB pilot bound; download and preflight elapsed time was **29.733 seconds** with two workers.

Data capture timestamps were 22:29:17–22:29:28 UTC. CONUS objects had advanced to modification time 22:23:09 UTC and GRIB reference 22:30 UTC; Alaska/Hawaii retained the preceding 21:52:38/39 UTC objects and reference 22:00 UTC. This demonstrates that regions need not update simultaneously and that a reference timestamp may slightly precede or follow collection time. Freshness validation must distinguish reference time, object modification time, and retrieval time, with an explicitly bounded clock/cycle tolerance.

| Captured input | Bytes saved | SHA-256 of saved bytes |
| --- | ---: | --- |
| CONUS temp, complete | 49,235,489 | `6c33f18dbda9059e7a672334279ece47753cea618a4985e53cc477387ce9dd55` |
| CONUS maxt, first message | 1,050,814 | `c87c3069b3ac9d14e00d3f7f77d1e4f62aed811b2a05b1b261eb3ece24f76658` |
| CONUS mint, first message | 977,788 | `46ef15f874a159950a62d70982f5421e481b0a3792a2ba826ca92faced86b728` |
| Alaska temp, complete | 4,862,592 | `bb5e8bea511e794fec70134a5b3b8b88d4e88ee17cf0784ab39d667d77869fe1` |
| Alaska maxt, first message | 190,553 | `1ee35389487e53d22b06c84f69fc8b2236cb203ce34aa51f273924cee3c7b5ff` |
| Alaska mint, first message | 191,157 | `427c4f73ec1dd5f6ff6b379b35800f2dfc182fb585f1bfbf11b456b9208f215e` |
| Hawaii temp, complete | 249,901 | `07ab5e00abcdf57bc43a3efea15307ad2b31518360efbbe73b616057dcd54366` |
| Hawaii maxt, first message | 10,903 | `7b579e818e05fabe48fae15b097682020599049ee4b69953d33ef48294c8b2c9` |
| Hawaii mint, first message | 9,890 | `561e7dcb9b288c528bcdc597d00c1793bf630bd1c9796ad7952fc630aaa9a30d` |

### Orientation, nearest-point, and value checks

The three test coordinates came from the existing catalogue. Official park pages confirm the named public campgrounds; the pilot does not establish current availability:

- Tuolumne Meadows Campground: https://www.nps.gov/yose/planyourvisit/tmcamp.htm
- Teklanika River Campground: https://www.nps.gov/dena/planyourvisit/campground-tek.htm
- Kulanaokuaiki Campground: https://www.nps.gov/havo/planyourvisit/kulanaokuaiki-campground.htm

The Python decoder generated latitude/longitude arrays and found the nearest grid point by spherical distance. Independently, wgrib2 received the original requested campsite coordinate. It returned the same grid row and column and equivalent temperature. Each field also checked the immediately preceding and following grid row at the same column, exercising both directions of the alternating-row scan pattern.

**All 27 checks passed**: three locations × three fields × three row samples. Maximum numeric difference was 0.0000184 K, consistent with decimal formatting versus float representation. wgrib2 confirmed input `WE|EW:SN`, normalized output `WE:SN`. Grid indices below are zero-based; wgrib2's one-based indices agreed after conversion.

| Location | Requested latitude, longitude | Sampled latitude, longitude | Row, column | Offset |
| --- | --- | --- | --- | ---: |
| Tuolumne Meadows | 37.8721532, −119.3571582 | 37.8746471, −119.3649697 | 750, 228 | 739.6 m |
| Teklanika | 63.6701659, −149.5804452 | 63.6764331, −149.5706584 | 682, 887 | 847.7 m |
| Kulanaokuaiki | 19.3438305, −155.2741353 | 19.3416514, −155.2805017 | 56, 261 | 710.6 m |

| Location | First temp K | First MaxT K | First MinT K |
| --- | ---: | ---: | ---: |
| Tuolumne Meadows | 279.8 | 282.0 | 269.8 |
| Teklanika | 275.9 | 277.0 | 273.1 |
| Kulanaokuaiki | 297.6 | 297.6 | 291.5 |

These are dated fixture values, not current camping advice. The first temperature was valid October 29 at 23:00Z in CONUS and October 30 at 00:00Z in Alaska/Hawaii. Every inspected MaxT field ended at October 30 00:00Z, and every MinT field ended at October 30 12:00Z, with a nominal duration of 12 hours. The temporal ambiguity remains: grib2io's MaxT `leadTime` was 12 hours even though `validDate` was only 1.5–2 hours after reference; its interval lead incorporates duration while the explicit end timestamp is read separately. **Do not compute statistical-field validity as `refDate + leadTime`.** Preserve the explicit end-of-period timestamp and raw temporal metadata. Cross-decoder agreement does not resolve the difference between nominal encoding and local daytime/overnight definitions.

### Actual temperature inventory and filter completeness

| Region | Total messages | First valid UTC | Last valid UTC | Consecutive intervals |
| --- | ---: | --- | --- | --- |
| CONUS | 49 | Oct 29 23:00 | Nov 2 00:00 | 35 × 1 h, 1 × 2 h, 12 × 3 h |
| Alaska | 25 | Oct 30 00:00 | Nov 2 00:00 | 24 × 3 h |
| Hawaii | 25 | Oct 30 00:00 | Nov 2 00:00 | 24 × 3 h |

CONUS's hourly portion ended October 31 at 10:00Z, followed by 12:00Z and then three-hourly times. Thus a simplistic fixed-step check would falsely mark its legitimate transition as a missing hour. Conversely, pretending the entire file is hourly would invent forecasts.

For windows `(GRIB reference, GRIB reference + horizon]`, the selected cells contained:

| Region | Next-24-hour samples / nonmissing | Next-72-hour samples / nonmissing | 24-hour sample range °C | 72-hour sample range °C |
| --- | --- | --- | --- | --- |
| CONUS | 24 / 24 | 48 / 48 | −3.35 to 6.65 | −5.55 to 6.65 |
| Alaska | 8 / 8 | 24 / 24 | 1.15 to 2.75 | −6.15 to 2.75 |
| Hawaii | 8 / 8 | 24 / 24 | 18.35 to 24.45 | 17.75 to 24.45 |

These counts validate the captured timelines at these three cells, not continuous interval extrema or arbitrary query timestamps. The last sample strictly inside the 72-hour window was November 1 at 21:00Z; the next available sample was November 2 at 00:00Z. The first sample was also later than reference time. Any feature requiring exact endpoint coverage must treat those unsupported endpoints as unknown instead of extending sample values. A sample-based feature can disclose the actual first/last sample and cadence. A strict hourly 24-hour contract would support the sampled CONUS fixture and correctly reject Alaska/Hawaii as hourly-incomplete; a documented three-hour contract supports their eight nonmissing expected timestamps without claiming hourly information.

### Measured resources and limits of the pilot

With `OPENBLAS_NUM_THREADS=1` and `OMP_NUM_THREADS=1`, the successful decoder/sample/cross-check process completed in **8.869 seconds**, including nine wgrib2 subprocesses and all 99 temperature messages. Peak Python-process RSS was **381,792 KiB (~372.8 MiB)**; child-process peaks are not included. Per-region elapsed times were CONUS 6.881 s, Alaska 1.823 s, Hawaii 0.164 s. Messages were decoded one at a time and `flush_data()` released their data arrays. Latitude/longitude arrays were reused.

This is a local warm-filesystem measurement, not a GitHub-runner benchmark or a 33,287-site benchmark. Dependency bootstrap/solver time is excluded; the initial conda solve also created about 923 MiB of metadata cache. Prefer a reviewed explicit dependency lock or prebuilt pinned runner image to repeating a full channel solve on every hourly run. The pilot's brute-force spherical nearest search was appropriate for three points; national mapping should use the decoded grid projection or a once-built spatial index, not repeat a three-million-cell distance scan for every campsite. Missing masks remain essential: wgrib2 reported 1,454,641 undefined cells in the first CONUS MaxT field and 48,333 undefined cells in the first Hawaii MinT field. A rectangular grid does not imply every point is covered.

Scratch-only evidence is in `/workspace/scratch/2f7921418a46/ndfd-pilot/`: download-manifest.json, decoded-report.json, environment-explicit.txt, pilot scripts and bounded GRIB samples. These are temporary reproducibility evidence, not release assets. This document preserves the input hashes and measured outcomes if scratch is removed.

## Hostinger weather-storage handoff — unresolved

Weather generations must live in a stable shared hosting directory **outside the Git deployment lifecycle**. A dedicated GitHub Actions weather workflow should decode, validate, then use the deployment's existing SFTP mechanism/secret references to stage a bounded generation and atomically switch its manifest. Do not place hourly output in `main`, the `hostinger` release branch, or the full application release job. No secret value was accessed during this research.

Read-only inspection found that the checked-in `.github/workflows/publish-hostinger.yml` runs `scripts/publish-hostinger.js`, which builds a complete Git tree and pushes `refs/heads/hostinger`. The deployment documentation describes Hostinger Git integration into the document root. These inspected files do not define an SFTP weather target, preservation rule, or weather secret-variable mapping. Therefore the final shared path and transport handoff are **not verified** by this research, and cannot be inferred from successful Git publication.

The existing PHP bootstrap documents a private sibling of `public_html` (`private/kamptrail-config.php`). A dedicated sibling such as `private/kamptrail-weather/`, exposed through a bounded read-only PHP endpoint, is a candidate; a stable public weather directory is another option only if deploy/rollback preservation is demonstrated. This is a proposed path, not an assertion that it exists or is writable.

Before implementation, inspect the actual deployment path contract and supported SFTP atomic rename behavior using the authorized deployment workflow. Then prove a weather generation survives an application deploy and rollback. Proposed storage limits: retain the active and immediately previous generation; delete abandoned staging generations after bounded age; hard-cap per-generation output bytes, total output bytes, source download bytes, and concurrent publishers. Derive final output limits from a national sampling benchmark. Publish the manifest last, preserve older schema compatibility through application rollback, and expire forecasts by their actual timestamps even when an older generation remains on disk.

Remaining gates after this pilot: national valid/missing/outside-domain census, local MaxT/MinT date interpretation, timestamp/cadence contracts for arbitrary current and trip times, GitHub-runner/output-size benchmark, stable shared-host storage and atomic publication verification, and UI/filter/offline integration. No forecast feature or production weather publication was implemented.
