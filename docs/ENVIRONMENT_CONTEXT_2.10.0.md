# Fire, smoke and point-alert context — 2.10.0

The map previously offered forecasts and agency road designations but no dated fire/smoke context. This release adds two opt-in overlays under Map layers and a Weather alerts action on campsite and map-point popups. Fire and smoke nearby opens both layers around the selected coordinate.

## Behavior

- At zoom 7 or closer and within a 10-degree viewport, request NIFC fire perimeters and NOAA HMS smoke polygons. Larger/antimeridian views ask for a closer view.
- Fire popup: incident name/type, reported acres, source perimeter timestamp and retrieval time. NOAA popup: plume density, observation interval and retrieval time. No safe/open/clear conclusions.
- Weather alerts: on-demand NWS point query, severity, issued/effective/onset/expiry timestamps, exact source headline, description and instructions as escaped text. Expired/ended alerts are omitted. Refreshes while the dialog remains open; no notifications or background location tracking.
- Dynamic context is never put in a browser offline cache. Going offline removes shapes and replaces alert contents with an explicit unavailable message. Source failures, stale payloads, truncated datasets and invalid geometry show unavailable rather than a partial all-clear.
- NIFC and NOAA empty responses explicitly acknowledge missing perimeters and undetected smoke. Smoke is not ground-level air quality/AQI. Neither layer is a closure, evacuation or camping-permission map.

## Server

`api/environment.php` accepts only a known `kind` with a bounded bbox or numeric coordinate. It does not accept upstream URLs. Fixed HTTPS sources, TLS validation, no redirect following, response-size/time/feature/coordinate limits and normalized public attributes. Cache files live outside the public root, with a fixed number of slots and lock/throttle protection. No config credentials or database migration are required. Fresh server cache: 5 minutes for fire/alerts, 15 minutes for smoke; failures are briefly cached; stale snapshots are not served. NOAA requests select the latest observed source day and reject a source observation older than 48 hours.

Both polygon feeds request ArcGIS `maxAllowableOffset=0.001` with `outSR=4326`, generalizing shapes for map display at approximately 110 meters of latitude. Complete intersecting source polygons can exceed the response cap even in a small viewport; generalization keeps the contextual overlay practical without relaxing byte, coordinate or completeness checks. These displayed shapes are not precise incident boundaries; consult the linked source for boundary details.

## Verification

Unit/API fixtures cover invalid bounds, complete versus partial ArcGIS responses, geometry limits, NOAA Julian-day UTC parsing, source timestamps, NWS status/expiry and cache behavior. Browser fixtures cover opt-in/zoom gating, dated popups, safe text, offline removal, empty/failure states and mobile accessibility. Production feeds must also be checked after deployment because fixture tests cannot prove upstream availability from the host.

## Replica scope

Adds smoke/fire context as a feedback-led improvement. It does not complete weather/elevation filtering, RV clearance routing or FCC predicted coverage. Historical original-app claims and earlier parity scores are not automatically updated by this release.
