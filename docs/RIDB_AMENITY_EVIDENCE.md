# Recreation.gov campsite amenity evidence

This package adds a separate, optional details panel for amenity mentions in RIDB overnight campsite records. It does not change campground admission, fees, RV fit, amenity filters, overnight permission or the services map. An amenity mentioned in some campsite records does not establish a campground-wide amenity or public RV service.

## Source and scope

The public source is [Recreation.gov's RIDB full CSV export](https://ridb.recreation.gov/downloads/RIDBFullExport_V1_CSV.zip). The completed canonical HTTP 200 download was 248,007,392 bytes, SHA-256 `13afd4dc1d1dec6885c2299bb4d939eb554e97ab32fc6bcd715b9ef4d9618e01`, retrieved `2026-10-30T16:33:49.112988+00:00`. Its HTTP Last-Modified value was `2026-10-29T18:46:42Z`. The ZIP's `CampsiteAttributes_API_v1.csv` entry time was `2026-10-29T18:45:44`, with unknown timezone. Individual attribute update dates are unknown. These dates are preserved separately, and a later inspection never refreshes the retrieval date.

This export has campsite, permit-entrance and tour attribute tables. It has no facility attribute CSV. Therefore the producer joins `CampsiteAttributes_API_v1.csv` only to `Campsites_API_v1.csv` records with `TypeOfUse=Overnight`. It selects the catalogue's exact positive ASCII `ridb:` primary and legacy identities, preserving the PR #94 alias scope. A nearby name, coordinate or unrelated numeric agency ID cannot join amenity evidence.

The reviewed snapshot contains 2,163 selected facility IDs, including 143 alias-only IDs. Of these, 1,446 have overnight campsite records and 1,031 have a positive mapped amenity mention. The 53,693 overnight campsite records provide the following counts. Each count is distinct campsite records per amenity, not fixture counts. Different amenity columns may refer to the same records.

| Mapped amenity | Positive records | Facility IDs with positive mentions | Other observed values |
| --- | ---: | ---: | --- |
| Toilets | 4,498 | 221 | 1,430 accessible and 675 seasonal qualifiers |
| Drinking water | 3,078 | 120 | 3 blank/unrecognized records; 423 accessible, 316 hand-pump and 311 peak-season qualifiers |
| Showers | 1,915 | 45 | 3 blank/unrecognized records; 837 accessible, 305 coin, 257 seasonal and 1 outdoor qualifiers |
| Dump station | 1,268 | 36 | 3 blank/unrecognized records |
| Picnic tables | 35,509 | 1,013 | 2 explicit negatives and 207 blank/unrecognized records |

Qualifier counts overlap. Missing fields remain unknown and are not included in the explicit blank/unrecognized counts. A reported accessible feature does not establish whole-campground accessibility. Drinking-water mentions do not establish RV filling access. A dump-station mention does not establish public access or price. Coin qualifiers apply only to shower mentions.

For a concrete production check, catalogue identity `ridb:233309`, [Camp Gateway–Brooklyn](https://www.recreation.gov/camping/campgrounds/233309), has 54 overnight records. This snapshot mentions toilets in 12 records, drinking water in 10, showers in 12, a dump station in 1 and picnic tables in 54. All 12 toilet and shower mentions carry seasonal qualifiers. These are source-record statements, not a current-operation guarantee.

## Implementation and failure behavior

`scripts/build_ridb_amenities.py` uses exact observed field/value pairs. It deduplicates repeated attribute rows per campsite and amenity. Conflicting positive/negative records take precedence over positive, then explicit negative, then blank/unrecognized. Unrecognized truthy values, water hookups, water spigots and nonpotable water do not become drinking-water evidence. No positive facility-wide amenity is inferred from absence or from a campsite record.

The output sidecar is `data/campsites/ridb-amenities.json`; `ridb-amenities-audit.json` records scope, counts and provenance for review. Its selection hash binds the generation-time exact ID set. Later ordinary catalogue refreshes may add or remove identities independently; an unmatched identity remains unavailable, and an unused old summary does not attach by proximity. This optional snapshot does not change the existing weekly catalogue writer. The builder verifies a supplied canonical download receipt against the actual ZIP hash and size, HTTP status and coherent UTC dates before replacement. Without a matching receipt, retrieval remains explicitly unknown. Raw ZIPs and receipts stay outside the repository.

The page validates the optional sidecar before attaching or caching it. Exact facility summaries survive source/state deduplication without adding their counts repeatedly. Amenity requests run independently of campground loading. Slow, failed or corrupt evidence leaves campground markers and filters usable; relevant details display an unavailable message. A previously validated cached sidecar remains available offline with its original source dates. The generic service worker does not cache this endpoint before page validation.

The release packager validates the sidecar and enforces a 2 MiB byte ceiling before including it. The reviewed source sidecar is approximately 202 KB. The audit is not a runtime dependency. This evidence package is prepared for release 2.16.0; publication remains gated by the release checks in [RELEASE_2.16.0.md](RELEASE_2.16.0.md).

## Rebuild and acceptance

From the repository root, with the actual completed-download receipt matching the supplied ZIP:

```sh
python3 scripts/build_ridb_amenities.py /absolute/path/RIDBFullExport_V1_CSV.zip --download-receipt /absolute/path/completed-download-receipt.json
```

Acceptance requires the generation-time exact catalogue ID set, actual canonical hash, original retrieval evidence and record counts to match the audit. Node and Python checks cover exact aliases, source/date corruption, distinct counts, qualifiers, explicit negatives, unknowns, conflicts, malformed evidence and offline fallback. The mobile browser check covers safe rendering, source links, qualified counts, width, unknown update dates and unchanged water-filter behavior. The existing `features.spec.js` popup/share/link regression remains enabled and unchanged.

Local preparation on current main `369efee3ed2f2b81ce867f269ff08bad523c039b` passed the full Node suite (230 tests: 184 passed and 46 PHP-dependent skips), full Python suite (192 tests, seven optional skips) and diff check. The focused browser attempt selected 13 tests and stopped at the first launch because the expected Chromium executable was absent; one launch failed and 12 tests did not run. This is not a browser pass. GitHub must run the complete browser suite, real PHP/MySQL checks and Lighthouse before release.
