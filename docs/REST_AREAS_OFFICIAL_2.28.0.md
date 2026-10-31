# Official rest-area locations, 2.28.0

The "Official rest areas" layer grows from 5 states to 13. Each new location comes from the managing state transportation agency's own published layer, with its agency identity, validated coordinates and the original retrieval date.

## Coverage added

| State | Publisher and scope | Locations | Scope filter on the live layer |
|---|---|---:|---|
| California | Caltrans safety roadside rest areas | 87 | All records. The layer is Caltrans' rest-area layer and has no type or status field |
| Michigan | MDOT rest areas and welcome centers | 68 | `Status = 'Open'` (74 records: 68 open, 6 closed) |
| Washington | WSDOT active rest areas | 48 | All records of the "Sites Active Rest Area" layer. The separate buildings layer is not used |
| Iowa | Iowa DOT rest areas | 33 | `facility_type = 'Rest Area'` (all 33 records) |
| Kansas | KDOT rest areas | 33 | All records. 3 of 36 rejected for a blank KDOT number. The layer has no status field, so whether closed sites remain is unknown |
| Nevada | NDOT rest areas, rest stops and welcome stations | 31 | `MAINTAINED_BY = 'Nevada DOT' AND STATUS = 'Open To Traffic'` (38 records: 3 county-run and 4 closed, under construction or removed excluded) |
| South Dakota | SDDOT rest areas | 21 | `Type_ = 'Rest Area'` (all 21 records) |
| Indiana | INDOT rest areas and welcome centers | 17 | `MAINT_BY = 'INDOT' AND STATUS = 'Open'`, excluding truck-only parking. 10 Indiana Toll Road concessionaire sites are a different operator and excluded |

338 new locations, 586 in total across 13 states. Each new region passed the importer's checks: exact reviewed endpoint, expected count range, stable identity, coordinates inside the state's bounding box and Census geometry, and no duplicate identities. Existing regions, IDs and saved stops are unchanged.

Every filter value above was confirmed against the full live layer on 2026-10-31 before import, not inferred from samples.

## Permission

Every new location keeps `permission: unknown`, and each new state has a location-only policy entry with every rule unknown. No overnight parking, sleeping, camping or stay-limit rule was reviewed for these states. Each entry cites one hashed, dated source:
- California, Indiana, South Dakota and Washington: the agency's public rest-area page.
- Iowa, Kansas, Michigan and Nevada: the agency's location layer. Their public pages returned HTTP 404 (Iowa) or refused automated requests (Kansas, Michigan, Nevada) on 2026-10-31, so the layer is cited instead. Kansas, Michigan and Nevada popups still link their public pages for visitors.

Each new source URL is added to the exact-URL allowlist in both policy validators.

## Not imported

- Kentucky: the only layer is on a KYTC test server. Waiting for a production endpoint.
- Colorado: the layer's status field records survey state, not whether a site is open.
- Nebraska: the layer returned no features to a standard query.
- Georgia and Utah: the layers timed out.
- Other states: no official location layer found in the 2026-10-31 survey, or not yet reached.

## Refresh

The weekly data workflow already loops over every region in the importer, so the new states refresh automatically with the same safeguards: a failed, shrunken or out-of-range source keeps the saved file.

## Checklist effect

"Overnight parking places" stays partial. Official locations now cover 13 of 50 states, and commercial overnight places are not covered. Permission remains unknown unless a scoped, reviewed policy states it.
