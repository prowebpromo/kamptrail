# FCC carrier coverage — access checkpoint

## November 20, 2026

The Public Map Data API accepted the existing account credentials on `https://broadbandmap.fcc.gov/api/public/map/`. Two GitHub Actions checks returned nine availability dates. The earlier 403 came from `bdc.fcc.gov`.

- [Authenticated host comparison](https://github.com/prowebpromo/kamptrail/actions/runs/44724487961)
- [Repeat on the corrected host](https://github.com/prowebpromo/kamptrail/actions/runs/44724791558)

A [live state-file download](https://github.com/prowebpromo/kamptrail/actions/runs/44725420857) returned the June 30, 2026 Rhode Island 4G LTE GeoPackage (FCC file 1885503). It contains 37,248 WGS84 polygons with technology, minimum speeds, modeled environment and H3 cell ID. The statewide archive contains no provider ID. Carrier layers must use provider-specific records.

The owner's [October 29 review of the FCC's License and Attribution notice](https://github.com/prowebpromo/kamptrail/blob/93d46ca5184a3a5562c2470b96c6c61670f9a3db/docs/FCC_COVERAGE_ACCESS.md) distinguished BDC availability data from the separately restricted CostQuest Location Fabric.

The private worker in `scripts/fcc_download.py` supports `check`, `list` and `download` with the owner-only directory documented in [FCC credential entry](FCC_CREDENTIAL_ENTRY.md). Run `list` with `--as-of YYYY-MM-DD` first, then `download` with the same date and a `--file-id` from that catalog. The default catalog is `Provider`. Use `--category State` on both commands for state files. Each successful download writes a ZIP and a provenance record with its source URL, filing date, retrieval timestamp and SHA-256. The worker is excluded from the web release.

## New York and Rhode Island mobile coverage

KampTrail uses each carrier's raw mobile availability polygons and the 2025 Census TIGER/Line boundaries of the two published states. Outdoor stationary LTE includes FCC environment codes 0 and 1 with technology 400 and minimum speeds of 5 Mbps down and 1 Mbps up. The state boundary includes coastal waters. A gray pixel indicates no modeled LTE coverage at this map resolution inside the published area. Outside the published states, the result is unknown. Camper reports remain separate.

| State | Carrier | FCC provider ID | FCC file ID | Source polygons |
| --- | --- | --- | --- | ---: |
| New York | AT&T | 130077 | 1890539 | 1,525,930 |
| New York | T-Mobile | 130403 | 1890598 | 2,844 |
| New York | Verizon | 131425 | 1890752 | 195,286 |
| Rhode Island | AT&T | 130077 | 1890550 | 34,136 |
| Rhode Island | T-Mobile | 130403 | 1890613 | 146 |
| Rhode Island | Verizon | 131425 | 1890751 | 7,289 |

All six files represent June 30, 2026. Source counts measure how providers divided their geometry and cannot be used to compare coverage area. The [archive verification](https://github.com/prowebpromo/kamptrail/actions/runs/44725966726) records the original hashes. The [first integrated qualification](https://github.com/prowebpromo/kamptrail/actions/runs/44727106921) built 60 viewport tiles and checked their classifications against the raw source and state boundary.

The [New York build](https://github.com/prowebpromo/kamptrail/actions/runs/44727609435) rendered 1,710 tiles. The [two-state qualification](https://github.com/prowebpromo/kamptrail/actions/runs/44728454427) runs the same independent native-vector checks for all six carrier/state combinations.

The latest manifest is served at `data/fcc-coverage/manifest.json`. Its region entries record the filing, source file, provider, archive hash, Census boundary and zoom range. The refresh runs monthly and retains the previous validated generation. A failed download, incomplete region or source mismatch prevents a new generation from replacing the existing one. Enlarge the reviewed geographic scope only after checking the new source against its state boundary and deployed capacity.

## Historical checkpoint, October 28, 2026

The FCC public map's download page returned Access Denied in this browser, including one reload. No attempt was made to evade that restriction. The documented public-data API requires an FCC user account. No FCC account/API credentials were available in this session, and redistribution/usage conditions for the intended mobile datasets have not been verified.

Official sources:
- https://help.bdc.fcc.gov/hc/en-us/articles/20044640394395-How-to-Create-an-FCC-User-Account
- https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions
- https://www.fcc.gov/sites/default/files/bdc-public-data-api-spec.pdf (not retrievable here)

Resume with authorized FCC download/API access or a user-provided current mobile coverage export plus its usage documentation. Verify mobile-data redistribution separately; do not infer it from Location Fabric licensing. Record provider identifiers, technology, data-as-of date and modeled service assumptions. Simplify/tile on the server or in builds; load viewport tiles only. Keep carrier models distinct from camper-reported signal. Model coverage is not a promise of usable service inside an RV.

Do not add a decorative coverage toggle, substitute an old mirror, invent carrier polygons, or mark parity complete until current licensed data is loaded and tested. This is the only external-access blocker among the four requested packages.

## Owner decision, 2026-10-31: manual bulk download rejected

The FCC Data Download page works in the owner's own signed-in browser. Its "By State" tab offers one mobile availability file per state per technology (4G LTE, 5G-NR, Mobile Voice), covering all providers in that state. Data shown as of June 30, 2026, last updated October 24, 2026.

A national refresh would mean about 50 manual downloads per technology every filing round, roughly twice a year. The owner rejected this as unmanageable without automation. A pilot download was not run, because proving the file works would not change that.

Automating that page is not an option. It denied automated access on 2026-10-28, and scraping would work around a deliberate restriction.

Carrier coverage therefore depends on the FCC Public Data API alone (support ticket #64052, account authorization returning HTTP 403). The rows "Cell carrier coverage overlay" (should, no) and the modeled part of "Filter by cell signal" (could, partial) stay parked until the API works.

Alternatives checked the same day and not adopted:
- Ookla open data: CC BY-NC-SA 4.0 (noncommercial, share-alike), and it measures speed tests taken, not coverage.
- NTIA National Broadband Availability Map: access described for participating states and federal agencies.
- OpenCelliD: tower positions, not coverage. Ruled out in `CELL_TOWER_DATA_ASSESSMENT_2026-10-31.md`.
- CellMapper and carrier coverage maps: no reuse license established, no carrier API.
- California CPUC mobile data (four carriers, as of December 31, 2024): one state only, so it does not solve the national problem.

## Cross-network API test, 2026-10-31

Single requests to `GET https://bdc.fcc.gov/api/public/map/listAsOfDates` with the documented `username` and `hash_value` headers, an honest User-Agent ("KampTrail coverage importer"), no redirects followed, and only status and declared format recorded:

| Network | UTC time | Result |
|---|---|---|
| GitHub Actions runner (`scripts/fcc_network_check.py` on branch `pilot/fcc-check`) | 2026-10-31 15:48:50 | HTTP 403, `text/html` |
| Owner's home connection (`scripts/fcc_download.py check-local` from draft PR #77) | 2026-10-31 15:54:43 | HTTP 403, `text/html` |

Two unrelated networks returned the same HTML block page, so the denial is not specific to Hostinger or datacenter addresses. An HTML response rather than the API's JSON error suggests the request is stopped before credential validation. The owner's account works in a browser on the Data Download page. Who applies the block and why is unconfirmed and can only be answered by the FCC. Evidence was added to ticket #64052. No further self-serve tests are planned. Repository secrets `FCC_USERNAME` and `FCC_TOKEN` stay in place so the check can rerun when the FCC replies.
