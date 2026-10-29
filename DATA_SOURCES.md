# MVP source credits

- **OpenStreetMap:** © OpenStreetMap contributors. Camping records and map tiles use OSM data. Database content is available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/.
- **Recreation.gov RIDB:** federal recreation facility data from https://ridb.recreation.gov/. Source camping evidence is screened before display. A record does not establish current operating status, fees, or legal camping access. Original source/operator links are shown where recoverable.
- **GeoNames:** US city search is derived from cities5000 under CC BY 4.0. See `data/places-us.LICENSE.txt` for exact source, extraction details, and checksum. Population is used only to rank city matches.
- **Google Maps:** directions are external links for the selected coordinates. KampTrail does not calculate or optimize routes.

The code's MIT license does not replace these data or third-party software licenses. Browser-library notices are in `vendor/`. No bulk map-tile downloads occur. Basemap imagery requires internet.

## Map layers and lookups (2.3.0)

| Data | Source | Terms |
| --- | --- | --- |
| Public land layer and land manager lookup | BLM Surface Management Agency map service (gis.blm.gov) | US federal government data. Boundaries can be approximate. Not permission to camp |
| Forecast and elevation | National Weather Service API (api.weather.gov) | US government data. US locations only |
| Topo and satellite basemaps | USGS The National Map (basemap.nationalmap.gov) | Public domain |
| Dump stations, water fill points, propane | OpenStreetMap contributors via Overpass, built into `data/services/services.json` | ODbL. Hours, fees, and potability not verified |

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
