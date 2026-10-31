# MVP source credits

- **OpenStreetMap:** © OpenStreetMap contributors. Camping records and map tiles use OSM data. Database content is available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/.
- **Recreation.gov RIDB:** federal recreation facility data from https://ridb.recreation.gov/. Source camping evidence is screened before display. A record does not establish current operating status, fees, or legal camping access. Original source/operator links are shown where recoverable.
- **GeoNames:** US city search is derived from cities5000 under CC BY 4.0. See `data/places-us.LICENSE.txt` for exact source, extraction details, and checksum. Population is used only to rank city matches.
- **Google Maps:** directions are external links for the selected coordinates. In-app road geometry and drive-time estimates use the FOSSGIS OSRM car router; RV clearances and road suitability are not checked.

The code's MIT license does not replace these data or third-party software licenses. Browser-library notices are in `vendor/`. No bulk map-tile downloads occur. Basemap imagery requires internet.

## Map layers and lookups (2.3.0)

| Data | Source | Terms |
| --- | --- | --- |
| Public land layer and land manager lookup | BLM Surface Management Agency map service (gis.blm.gov) | US federal government data. Boundaries can be approximate. Not permission to camp |
| Forecast and elevation | National Weather Service API (api.weather.gov) | US government data. US locations only |
| Topo and satellite basemaps | USGS The National Map (basemap.nationalmap.gov) | Public domain |
| Service discovery | OpenStreetMap contributors: dated Geofabrik state extracts and retained legacy Overpass records, delivered by `data/services/index.json` | ODbL. Saved coverage and source dates are shown; hours, RV fit, overnight permission and potability are not verified |
| Low-clearance heights | OpenStreetMap contributors: dated Geofabrik state extracts processed by `scripts/build_national_clearances.py` into `data/clearances/` (Rhode Island pilot plus national refresh) | ODbL 1.0 with attribution and share-alike for the derived height database. Raw tag text, parse status and dates are kept; a mapped height does not establish legal access, clearance on the driven road or safe passage |

## Agency campsites, RV details, routing, offline maps (2.4.0)

| Data | Source | Notes |
| --- | --- | --- |
| Forest Service camping records and fee wording | USFS EDW Recreation Opportunities (apps.fs.usda.gov), updated nightly by USFS | `data/sources/usfs.json`, split into `data/campsites/agency/` |
| BLM camping areas and facilities with fee wording | BLM National Recreation Sites and Facilities (gis.blm.gov), layers 2 and 8 | `data/sources/blm.json` |
| RV site lengths, hookups, stay limits, some fees | Recreation.gov RIDB full export (no key) | `data/campsites/ridb-sites.json` |
| Fee classification | `scripts/fee_text.py` | free, conditional, paid, unknown. Wording is kept as evidence |
| Drive times | FOSSGIS OSRM car router (routing.openstreetmap.de) | On demand, one request per click. Attribution shown. Not RV aware |
| Offline maps | USGS Topo tiles saved by the visitor | Public domain. OSM standard tiles are never bulk saved |

### Fire, smoke and weather alert context (2.10.0)

Opt-in viewport layers use the NIFC WFIGS Current Interagency Fire Perimeters and NOAA HMS Satellite Smoke Detection public services. On-demand point alerts use the National Weather Service API. Requests pass through the KampTrail server with bounded viewport, response-size and geometry limits; only complete responses are shown. No API token is required. Dynamic context is not saved on the device for offline use.

- NIFC source: https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0
- NOAA source: https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_Satellite_Smoke_Detection_(v1)/FeatureServer/0
- NOAA limitations and analysis schedule: https://www.ospo.noaa.gov/products/land/hms.html
- NWS API and use: https://www.weather.gov/documentation/services-web-api
- NWS point-alert geolocation: https://www.weather.gov/media/documentation/docs/NWS_Geolocation.pdf

Fire perimeters are not available for all incidents and may be substantially older than their incident record. Smoke plumes describe satellite-visible smoke, not ground-level AQI or a forecast. NOAA analysis may contain observation gaps. Each popup shows source dates separately from retrieval time. Empty results do not establish safe travel, no fire, clean air, camping permission, or absence of closures. NWS alerts do not cover all non-weather emergencies. Consult the land manager and local emergency authorities.

## Census state assignment for agency records (2.11.0)

**Source: U.S. Census Bureau, TIGERweb Boundary and Annexation Survey (BAS) 2026, detailed States layer; January 1, 2026 boundary vintage.** KampTrail repackages these public-domain U.S. Government data as 50 compressed GeoJSON reference files for its offline data pipeline. Census materials may be reproduced under 17 U.S.C. § 105; credit remains with the U.S. Census Bureau. KampTrail is an independent application, not a Census Bureau product or endorsement.

TIGER/Line® is a registered trademark of the U.S. Census Bureau. The name identifies the Census data family, not a KampTrail product name.

- [Official layer metadata and query service](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/18)
- [Official TIGERweb service directory](https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_restmapservice.html)
- [Census citation, reproduction and boundary limitations](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2020/TGRSHP2020_TechDoc.pdf), sections 1.1–1.2
- Local provenance, source URLs, retrieval timestamp and file checksums: `data/reference/us-state-boundaries/manifest.json`; additional notes: `data/reference/us-state-boundaries/README.md`.

The pipeline checks Forest Service and BLM point coordinates against these polygons even when the source supplies a state. The original state is retained with assignment provenance. Points within 10 meters of a boundary, overlapping state matches, invalid coordinates and points outside the supported 50 states are held in a separate review report. The 10-meter band is an ambiguity rule, not a guarantee of source or GPS accuracy. Polygon holes and Alaska's dateline geometry are handled explicitly; longitude signs are never silently repaired.

The reference geometry is excluded from the website release and is not a visitor-facing boundary layer. These checks apply to agency records; existing Recreation.gov and OpenStreetMap state buckets have not all been revalidated. Census boundaries support statistical work, are not legal land descriptions, and do not determine ownership, jurisdictional rights, camping access or current land-manager restrictions. Neither boundary coordinates nor campsite coordinates are guaranteed accurate.

### Terrain elevation discovery (2.12.0)

Coordinate-matched terrain samples come from the [USGS 3DEP elevation service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), using explicit bilinear interpolation and metres. [USGS states that 3DEP products are free and unrestricted](https://www.usgs.gov/3d-elevation-program). KampTrail's state files and compact search values are derived samples, not surveyed campsite-pad measurements or unaltered USGS products.

Records preserve retrieval time and available raster datum/acquisition metadata separately. Acquisition fields have provider-specific formats; a retrieval date never becomes an acquisition or inspection date. Grid resolution is not guaranteed point accuracy. Missing values remain unknown, including outside source coverage. No elevation value establishes road grade, clearance, current access or RV suitability. Static validated samples may remain available offline.

See [the pipeline contract and verification](docs/ELEVATION_SOURCE_2.12.0.md) for response-order matching, coordinate identity, bounded retries, publication and source limitations. Raw cache and recovery seed files are pipeline-only and excluded from the browser release.

### Forecast sample discovery (2.13.0)

The temperature discovery filter derives samples from the [NOAA/NWS National Digital Forecast Database](https://vlab.noaa.gov/web/mdl/ndfd), using fixed [operational GRIB download products](https://vlab.noaa.gov/web/mdl/ndfd-grid-data) for CONUS, Alaska and Hawaii. [NWS reuse terms](https://www.weather.gov/disclaimer) identify public-domain information and require avoiding claims of ownership, endorsement or presenting modified products as official government material. KampTrail's coordinate-matched temperature summaries are derived products; NOAA/NWS does not endorse KampTrail.

The filter checks every available published temperature sample in the next 24 or 48 hours against inclusive user bounds. It does not establish continuous minimum/maximum temperatures, daily extrema, observed campsite conditions or safe travel. Actual grid distance, sample intervals, model reference times, source-file modification times, generation and expiry are retained separately. Source hashes bind the exact downloaded GRIB bytes. Files may contain forecasts from different offices and reference times. Packaging does not refresh old meteorology.

Only a complete, current, coordinate-matched series can satisfy an active filter. Missing samples remain unknown; no neighboring value replaces a missing grid cell. Expired or offline forecasts never match. Weather snapshots are separate from campsite records and generic offline caches. See [the wire contract](docs/FORECAST_CONTRACT_2.13.md), [operations and deployment checks](docs/FORECAST_OPERATIONS_2.13.md), and the versioned decoder audit.

### Service discovery (2.14.0)



The separate services database is derived from OpenStreetMap contributors under [ODbL 1.0](https://www.openstreetmap.org/copyright). Expanded-category imports use [Geofabrik's public regional PBF extracts](https://www.geofabrik.de/data/download.html). They allow ODbL reuse with attribution and share-alike for derived databases. Source and derivation code remain available in this repository. Public extracts exclude contributor user IDs, names and changeset IDs. No private metadata endpoint is used.

The shipped expanded extract is currently Utah. The weekly writer stages all 50 states and promotes only a complete, same-batch, hash-verified candidate that passes the current accepted sources’ date/loss guards and every delivery cap. Until that succeeds, the saved snapshot remains in use. Sources and dates in About the data reports the actual saved expanded state coverage and source extract dates; service attempts are counted separately from campsite refresh attempts. Other areas retain legacy dump, water-fill and LPG evidence, screened against Census state geometry. [Geofabrik explains](https://download.geofabrik.de/technical.html) that extract boundaries are buffered and can include neighboring regions; the pipeline does not use the extract name as proof of state membership. Ambiguous, outside-state and unsupported geometry records are quarantined. Exact node/way/relation identity, version, edit date, extract timestamp, retrieval date, source hash and relevant tags remain separate. A retrieval or build is not a field inspection.

Only explicit supported tags establish a service category. Potability, opening, fees, customer-only access and other restrictions remain source-reported or unknown. LPG does not establish cylinder refill; parking, a brand, land ownership or a successful stay does not establish overnight permission. Representative map points are not guaranteed driveway entrances or RV access. Service discovery sends no route coordinates to an external POI service.

Spatial shards limit delivery to the viewed area or route corridor. Hash-validated visited shards can be read offline with their source dates; uncached or budget-limited areas remain incomplete. Service metadata and previous bounded snapshots survive separately from weather, which never matches offline. See [the contract](docs/SERVICES_CONTRACT_2.14.md) and the source pilot report for measured coverage and limitations.

### Official rest-area locations (2.15)

The first official rest-area pilot uses TxDOT's public [location list](https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html). It preserves exact source labels, links and coordinates, validated against Census state geometry, with document hashes and retrieval dates. Texas travel information centers are excluded. The separately sourced [visitor duration context](https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html) does not establish permission to sleep overnight. Every pilot location's overnight permission remains unknown. See [the source audit](docs/REST_AREAS_PILOT_2.15.md). Other states are not yet covered.

### National service promotion operations

The sole weekly data writer calls the read-only state staging workflow with exactly 50 Census states and at most two parallel imports. Its candidate artifact is bound to the caller run ID and source commit. Promotion copies and validates checkpoint bytes, compares every served byte with a deterministic rebuild, and rechecks current main source dates and the 30% loss guard before committing and after a rebase. A missing state, mismatched hash, older extract, excessive loss, or delivery-cap failure preserves the exact public last-good service sources, assets and freshness. The workflow reports the failure separately; campsite refreshes may continue. There is no fallback to a partial national candidate. Caps remain 1 MiB per manifest, 4,096 shards, 1,000,000 identities, and 512 KiB/1,500 rows per shard.

A complete state extract supersedes legacy rows for that exact state, including objects absent from the new extract. The promotion receipt reports legacy exact OSM identities also present in state extracts and those absent. These are node/way/relation identity comparisons, not counts of new physical businesses or services. Legacy source evidence remains available for audit; once all 50 extracts are served it contributes zero selected rows and its old freshness row is retired. Unknown access, potability, cylinder refill, overnight permission and RV fit stay unknown.

### On-demand route terrain (2.17.0)

The route profile uses the same fixed [USGS 3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) and [getSamples operation](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples) as the catalogue elevation pipeline, with bilinear interpolation, WGS84 coordinates and values in metres. It has a separate user-triggered request and cache contract: opening a profile makes no terrain request. Choosing Load sends at most 200 distinct sampled coordinates, in sequential batches of at most 50, through the same-origin server. The full route and rig profile are not transmitted to USGS.

Endpoints and route leg boundaries are included. Target spacing is one kilometre and adapts to the sample cap; the actual maximum spacing is shown. Missing or failed values remain gaps. The displayed extrema are sampled terrain extrema, not complete route minima/maxima, road grade or cumulative ascent. Terrain under bridges and over tunnels is not road-surface elevation and cannot establish clearance, road access or safe passage.

Each sample retains its retrieval date and available provider datum/date metadata. Device storage is bounded to eight exact-route profiles, without automatic expiry; offline use retains their dates and unknown gaps. The private server cache stores independent coordinate hashes and normalized values, not routes, stop names or rig profiles. Read [the 2.17 contract](docs/RIG_TERRAIN_CONTRACT_2.17.md) for request limits, cache behavior, deployment and verification.

## Reported height tags: Rhode Island pilot

An optional OSM/Geofabrik layer retains dated, Census-contained node/way height-tag evidence, original geometry and raw values. The initial RI asset contains 254 highway ways. General/legal and physical tags remain separate. Nonnumeric, conditional, directional and lane values are not interpreted as vehicle clearance. Coverage is incomplete, source dates are not inspections, and this layer does not enforce routing or safe passage. See docs/CLEARANCE_RI_PILOT.md and docs/CLEARANCE_RI_PROOF.json. OSM contributors, ODbL 1.0: https://www.openstreetmap.org/copyright .
