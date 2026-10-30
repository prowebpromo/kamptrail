# Forecast producer: dated national proof

The producer uses three fixed public NOAA NDFD days 1–3 instantaneous two-metre temperature objects: `AR.conus`, `AR.alaska`, and `AR.hawaii`, each `ds.temp.bin`. It does not fetch per campsite, MaxT or MinT. Raw GRIB remains outside the browser and PHP. The complete machine-readable proof is [FORECAST_PROOF_2.13.json](FORECAST_PROOF_2.13.json).

## Result

This is a historical, offline reproducibility run with the explicitly supplied clock **2026-10-29T23:24:07Z**, using the exact downloaded bytes identified in the proof. It is not evidence that the snapshot remains fresh when this report is read. All three objects reported modification time 2026-10-29T22:53:34Z; GRIB reference time was separately 2026-10-29T23:00:00Z. Absolute expiry is 2026-10-30T01:53:34Z. Repackaging cannot extend it.

| Measure | Actual result |
|---|---:|
| Exact unique catalogue IDs | 33,287 |
| Valid nearest grid mappings | 33,287 |
| Complete published samples through 24 hours | 32,325 |
| Complete published samples through 48 hours | 32,325 |
| Incomplete: bitmap-null temperatures | 962 |
| Total verified GRIB source bytes | 54,374,183 |
| State shards | 50 |
| Total compressed shard bytes | 2,685,044 |
| Largest compressed state bytes | 273,568 |
| Largest raw state bytes | 1,933,795 |
| Manifest bytes | 17,378 |
| Offline producer runtime | 30.877 seconds |
| Peak producer resident memory | 479,920 KiB |

The offline rerun downloads zero source bytes. Runtime includes source checksum verification, decoding, nearest-grid queries, JSON generation, gzip and completeness auditing; it excludes the earlier source transfer. Memory is Linux `getrusage().ru_maxrss`, not compressed source size. The fixed 150 MiB download and 300 MiB source-cache limits are separate from process memory.

Catalogue coordinate SHA-256: `9a77eed89c95fee0452953c542fce2f8c1cc0e190fb765dd035d1f62cf7edaa3`. This exactly matches `data/campsites/coordinate-index.json`. Mutable fee/elevation enrichment is excluded. Snapshot: `9f60ec5aebbb8fe7ee506916`.

| Regional product | Mapped IDs | Complete 24/48h | All samples null |
|---|---:|---:|---:|
| CONUS | 32,625 | 31,815 | 810 |
| Alaska | 613 | 461 | 152 |
| Hawaii | 49 | 49 | 0 |

All 962 incomplete records have a mapped nearest grid cell whose entire published series is missing; there are no partially missing series in this dated sample. They must fail active forecast filtering. Missing-state memberships: AK 152, AZ 4, CA 2, ME 125, MI 64, MN 68, NH 28, NM 3, NY 401, OH 4, TX 23, WA 98. A missing value is not evidence of unsafe weather, nor permission to substitute a neighbouring cell.

The first audit found 1,717 incomplete records because selecting the nearest cell across all regional rectangles let the overlapping Alaska rectangle win for some Pacific Northwest coordinates. The corrected producer selects the regional product from catalogue state membership before grid lookup (AK → Alaska, HI → Hawaii, other states → CONUS). It never selects a product based on temperature presence. This recovered 755 complete records; the remaining 962 are preserved as missing. A regression test verifies the product restriction.

## Decoder and grid evidence

The 105-archive SHA-256 explicit environment lock pins Python 3.12.16, grib2io 2.8.2, NCEPLIBS-g2c 2.3.0, wgrib2 3.8.0, NumPy 2.5.4, SciPy 1.18.1 and pyproj 3.8.0. Direct versions are documented in `environment/forecast.yml`; production installs `environment/forecast-linux-64.lock`.

The producer rejects anything other than instantaneous Kelvin TMP at two metres (PDT 0, surface type 103), changing grids, duplicate timestamps, periods over 100 messages, invalid reference leads and gaps over three hours. The cached source hash is checked against actual GRIB bytes; ETag is retained separately. Every regional manifest contains actual sorted unique UTC reference times and valid times. Values convert to Celsius once with millidegree rounding, retain negative and zero values, and preserve bitmap/NaN as null.

For each of the three actual grids, `audit_forecasts.py` compares first, middle and last messages with pinned wgrib2. It checks corners, reversed-scan row boundaries, centre and finite odd/even row cells: **81 grid value/coordinate comparisons**, plus **nine independent nearest-site coordinate/value comparisons**. All passed; latitude/longitude tolerance is 0.000002 degrees and finite Kelvin tolerance 0.001 K. Native missing values must agree with wgrib2's missing sentinel. All grids use alternating row scan flags `[0,1,0,1,0,0,0,0]`; decoded normalized coordinates and temperatures agree with wgrib2's WE:SN output.

| Region | Grid dimensions | Published samples | Valid interval |
|---|---|---:|---|
| CONUS | 2145 × 1377, Lambert conformal | 49 | 2026-10-30T00:00:00Z to 2026-11-02T00:00:00Z |
| Alaska | 1649 × 1105, polar stereographic | 25 | Same |
| Hawaii | 321 × 225, Mercator | 25 | Same |

The maximum cadence is three hours. Catalogue mapping uses a spherical nearest-point KD tree over every grid cell, including missing cells, with a 5 km limit and independent projected-domain gate. Projection rectangularity checks reject scan/orientation disagreement. Corners and adjacent grid rows are included in the live-grid comparison; synthetic tests also exercise outside-domain and distance rejection.

## Reproduce

Install micromamba 2.3.3 from its versioned Linux x86-64 archive and verify its SHA-256 `e7274528ceb9c20d048a428d6c22d7e02e268f8ffb762c4c365422347c8b8ba2`. Set `MAMBA_ROOT_PREFIX` to an isolated temporary directory. From the repository root:

```sh
micromamba create --yes --prefix /tmp/forecast-env --file environment/forecast-linux-64.lock
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
/tmp/forecast-env/bin/python -m unittest discover -s scripts/tests -p test_fetch_forecasts.py -v
/tmp/forecast-env/bin/python scripts/fetch_forecasts.py \
  --catalogue data/campsites/search-index.json \
  --cache /tmp/ndfd-cache --output /tmp/forecast-output > /tmp/forecast-benchmark.json
/tmp/forecast-env/bin/python scripts/audit_forecasts.py \
  --catalogue data/campsites/search-index.json \
  --cache /tmp/ndfd-cache --output /tmp/forecast-output \
  --benchmark /tmp/forecast-benchmark.json --report /tmp/forecast-proof.json
```

That command produces a new dated snapshot from the current public objects and its own proof. To reproduce the exact historical proof, retain the three cache `.bin` files and metadata `.json` files, verify their recorded hashes, and pass `--offline --now 2026-10-29T23:24:07Z` to the producer. NOAA's fixed URLs rotate; fresh downloads are not guaranteed to reproduce older bytes. The CLI rejects `--now` without `--offline`.

The 15 producer tests cover correct regional product selection, Kelvin/zero/negative/null, bitmap masking, nearest missing-cell preservation, scan/projection/distance failures, invalid parameter/surface/product/lead/grid/timestamps, 24/48-hour completeness, strict source age, conditional 304 behavior, actual-byte hashing, corrupt/truncated cache rejection, byte limits and preservation of the previous manifest after packaging failure. Run them in the pinned environment; dependency-free test runs explicitly skip the six native decoder tests.

This proof establishes source decoding, bounded packaging and dated sample coverage. It does not establish continuous temperature extrema, live host cache/TLS permissions, deployment survival, browser offline behavior or full FreeRoam parity; those are separate integration gates.
