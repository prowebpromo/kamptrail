# What the FreeRoam source review changed

Reviewed the original frontend at commit `f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14`. This was code inspection, not a running-app test. The original backend was not restored or tested.

| Verified FreeRoam pattern | Applied to KampTrail MVP |
| --- | --- |
| Search blends named campgrounds and geocoded destinations, then adjusts map bounds. | National campsite-name search plus local city/state/coordinate search. City selection opens a useful surrounding region. |
| Map bounds, filters, counts, and list results are coordinated. Map position and filters persist. | One filtered viewport result source drives map/list/counts. Basic filters and map position persist. |
| Details distinguish a zero price from an unknown price and expose coordinates, contacts, Directions, and Add to Trip. | Unknown fees remain unknown. Popups show GPS, source/operator links, Save stop, and Directions. |
| Campgrounds are the default category; services, hazards, and other point types are separate. | Mixed services and unrelated recreation facilities are removed from the MVP map. |
| Advanced layers and community features depend on FreeRoam-owned services and community data. | No dead FreeRoam endpoints are reused. Advanced features are deferred until their supporting services and data are dependable. |

Primary code references:

- [Search](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/components/places_search/index.coffee)
- [Map and result coordination](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/components/places_map_container/index.coffee)
- [Place details](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/components/place_info/index.coffee)
- [Coordinates and contact](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/components/place_info_contact/index.coffee)
- [Place categories](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/components/places/index.coffee)
- [Map layers and advanced filters](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/services/map.coffee)
- [Backend place model](https://github.com/FreeRoamApp/free-roam/blob/f3b5f2d87517c57afe6e6af3f5ee52f42c43fe14/src/models/place_base.coffee)

Public-land boundaries remain a useful candidate for a later boondocking release. This MVP is presented as a campsite finder and saved-location tool.
