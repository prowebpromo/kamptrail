# Census BAS 2026 state reference

**Source: U.S. Census Bureau, TIGERweb Boundary and Annexation Survey (BAS) 2026, detailed States layer; January 1, 2026 boundary vintage.** KampTrail repackages these U.S. Government data for offline state assignment of Forest Service and BLM camping records. The files are public domain under 17 U.S.C. § 105. Retain this source credit when redistributing them. KampTrail is independent of the Census Bureau and is not a Bureau product or endorsement.

TIGER/Line® is a registered trademark of the U.S. Census Bureau. This notice identifies the Census data family; it does not name a KampTrail product.

## Source and packaging

- [Official States layer 18](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/18), within the service's BAS 2026 group. This is its finest-scale States layer, with a published display range of 1:1,001–1:42,000.
- [Official service directory](https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html).
- [Census technical documentation](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2020/TGRSHP2020_TechDoc.pdf), sections 1.1–1.2, supplies the reproduction, trademark and boundary-use notices.
- `manifest.json` records the source query for every state, boundary vintage, retrieval time, completeness inventory, byte and coordinate counts, and SHA-256 hashes for compressed and uncompressed content.

The 50 `XX.geojson.gz` files contain the GeoJSON responses returned in WGS84. The fetcher requests neither geometry simplification nor coordinate rounding. Gzip packaging is lossless. The checked-in snapshot contains 959,460 coordinates and occupies 13,319,113 compressed bytes; its manifest records the exact retrieval time. “Detailed” describes the selected source layer, not a positional-accuracy guarantee.

These are pipeline reference files, excluded from the public website release. They are not an online state-boundary map or a camping-permission dataset. `scripts/fetch_state_boundaries.py` refreshes the complete set from the fixed official service; `scripts/build_agency_states.py` verifies completeness and hashes before using it. Failed or incomplete downloads leave the previous reference intact.

## Assignment limits

Agency points must fall inside exactly one state polygon. Existing state labels are checked rather than trusted. Original source states and assignment provenance are preserved. Polygon holes, multipart geometry and Alaska's antimeridian crossings are supported; positive longitudes are not automatically changed to negative ones.

Points within 10 meters of a polygon boundary, points matching overlapping states, invalid coordinates and locations outside the supported 50 states are quarantined in `data/sources/agency-quarantine.json`. Public agency index metadata reports exclusion counts. The 10-meter threshold is a conservative ambiguity rule, not a source-accuracy specification. Campsite coordinates can have larger errors even when a point falls well inside a polygon.

These checks apply to Forest Service and BLM records. They do not establish that every pre-existing Recreation.gov or OpenStreetMap state bucket is geographically correct. Census boundaries are intended for statistical use, are not legal land descriptions, and do not settle ownership, jurisdictional rights, camping access or restrictions. Verify location and access with the responsible land manager.
