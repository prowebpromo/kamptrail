# USFS road context (2.7.0)

The optional **USFS motor vehicle roads** map overlay queries the Forest Service's published MVUM road service only after a visitor enables it and zooms to level 10 or closer. Campsite popups offer **Approach roads**, which opens the surrounding view at road-detail zoom. Startup and the national map do not fetch road geometry.

Roads distinguish all-vehicle, highway-legal and special designations, with dashed lines for seasonal designations. Selecting a road shows the source's vehicle fields, dates, road number, surface, forest and district. Road popups support keyboard activation. The interface does not infer present passability, camping permission, clearance or RV suitability from those records.

District coverage comes from the service's Data Available/No Data status layers. The source's `roadmvum` unit-entry timestamp is shown separately from the retrieval date. A missing record is unknown coverage, not proof that no roads exist. Official forest links come from the Forest Service's ForestCommonNames service; no forest website paths are guessed.

- Roads: https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer/1
- Coverage: the same service, status layers 12 and 13.
- Forest links: https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestCommonNames_01/MapServer/0

A view is limited to 1,000 segments. A transfer-limit flag or a full response requires a closer zoom instead of silently displaying a partial road map. Changes cancel stale requests. A road popup remains readable during its automatic map pan. Road clicks do not turn into public-land spot popups.

Road opacity and public-land opacity can be adjusted independently. The layer toggle and opacity persist on the device. Up to 12 recently viewed road snapshots are cached locally. Offline or service-failure fallback is explicitly labeled as saved data with its retrieval date. No unknown view is labeled saved. Cached roads are separate from saved USGS Topo imagery, and worker upgrades retain those snapshots.

## Validation

Unit tests cover designations, unknowns, coverage timestamps, valid geometry, official-host links and WGS84 query construction. Browser tests cover opt-in/zoom gating, road evidence, accessible text and controls, dense responses, unknown coverage, saved-view fallback, and mobile errors. A live USFS query is checked before deployment sign-off. No claim is made that every forest or current emergency closure is represented.
