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
