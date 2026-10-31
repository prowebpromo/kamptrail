# FCC carrier coverage — access checkpoint

Checked 2026-10-28. No carrier layer is shipped yet.

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
