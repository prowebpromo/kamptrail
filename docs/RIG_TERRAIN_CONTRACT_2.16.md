# Local rig profiles and sampled route terrain — 2.16.0

This source implementation is a separate release package. Passing local checks does not establish deployment or full-product parity. Car routing remains FOSSGIS OSRM and does not enforce vehicle restrictions.

## Rig profile

`rig-profile.js` keeps one named local profile under `kt_rig_profile_v1`. Its JSON format is `kamptrail-rig-profile`, `schemaVersion: 1`, with a UUID, created/updated UTC timestamps, display units, canonical integer millimetres/kilograms and supported campsite preferences. Empty measurements are null. Campsite fit length is separate from travel combination length. Height, width, travel length and weight are reference values only.

The profile supports only the source-backed any/tent/trailer categories. It does not infer motorhome class, van or truck-camper suitability. Matching checks fee, campsite type, source category, amenities, campsite fit length, selected hookups and the explicit unknown-length option. Length and all hookups must occur on one source campsite. Millimetres convert directly to fractional feet for matching, without rounding down to a shorter site's reported limit.

Applying the profile replaces only those matching preferences; unrelated map filters remain. Route discovery uses the same current filters when its filter option is enabled. A manual matching-filter edit or filter reset unlinks the profile while retaining it. The link is session-only; filter values may persist independently. Unchecking the link or deleting the profile leaves current filter values in place.

Import accepts a JSON file no larger than 32 KiB, validates supported fields/schema/limits, and shows a preview. Only Replace changes the profile. Export includes profile data, not trips, route geometry, account data or contribution management codes. Dimensions and import/export remain local. Storage failures retain the previous saved profile and offer explicit session-only recovery and export; do not claim persistence after a failed write. Deletion requires a second action. Browser-data deletion and a different site origin can make a saved copy unavailable.

## Terrain request and interpretation

`route-elevation.js` samples the complete original calculated LineString using great-circle distances and interpolation. It includes route endpoints and leg boundaries, targets one-kilometre spacing, and adapts to at most 200 samples. Repeated coordinates share one provider request location. The UI reports actual maximum spacing, route distance, value count and sampled extrema. Route geometry plus leg boundaries and a versioned sampling policy determine a SHA-256 exact-route identity.

Opening a terrain profile reads device data and does not request USGS values. Load, Refresh and Retry are explicit actions. The browser sends at most 50 locations at a time, sequentially:

```json
{"samples":[{"id":0,"lat":40,"lon":-110}]}
```

The fixed endpoint is `POST api/route-elevation.php`, with JSON, same-origin credentials and `cache: no-store`. Coordinates are in the body. No full route geometry, stop names, notes or vehicle dimensions are included. The endpoint forwards sampled coordinates only to the fixed HTTPS USGS 3DEP metadata/getSamples services. Browser and server responses have independent size caps. No provider key is required.

The server validates origin including scheme/host/port, method, content type, empty query, body size, unique bounded IDs and numeric coordinates. USGS output is matched by `locationId` and exact requested coordinate/CRS identity, never array order. Duplicate/missing locations, malformed values and upstream failure stay unavailable. A valid no-data response is distinct from transport failure. The response includes value/no-data/unavailable status, metres, retrieval time, source metadata and available datum/date metadata; absent metadata stays unknown.

The chart breaks at gaps. A keyboard sample selector and readable table expose distances, legs, values/status, source dates and metadata. Unit changes do not refetch. Values describe ground terrain, not road surface, cumulative ascent, grade, bridge or tunnel elevation, clearance, access or safe passage. A sample retrieval date is not its terrain acquisition date or an inspection date. Sparse samples cannot establish complete route extrema.

Itinerary or route changes invalidate an open profile and reject delayed responses. Closing cancels pending work. Failed refresh samples retain prior exact-route values with their original dates; valid provider no-data results replace those samples with gaps. No automatic retry loop runs.

## Storage and privacy

Device terrain uses `kt_route_terrain_v1`, bounded to eight exact-route profiles and 600,000 serialized characters. It has no automatic expiry. Offline reuse requires the exact geometry, leg boundaries and sampling policy; dates and gaps remain visible. Changed routes never borrow a nearby profile. Storage failure leaves loaded values available in the open view with an explicit notice. Clear saved terrain cancels pending loads before removing persistence, so a delayed response cannot recreate the cleared cache. The open view retains its existing values until closed. Retrying a complete profile makes no request and explains that all sampled values are available. Browser storage can be disabled, evicted or cleared.

The server uses a private SQLite cache beside the configured private config location, under `route-elevation-cache/`, outside the webroot. There is no MySQL migration for this feature. The cache has 512 fixed slots containing independent coordinate SHA-256 keys and normalized terrain values, plus one metadata slot. Ordinary values/no-data have a 24-hour cache lifetime; unavailable samples have a 30-second lifetime. It stores no raw route, stop name, rig profile or raw coordinate column. USGS receives coordinates during the request; upstream logging is outside this local cache contract.

Request budgets use 128 fixed connection-address hash buckets rather than storing client identifiers. Each bucket allows 12 requests per minute; upstream work has a shared 24-reservation-per-minute budget. Reservations persist before transport, so failed calls consume the budget too. A nonblocking lock serializes cache/transport work; concurrent busy requests return 503. Metadata/sample transport has fixed HTTPS destinations, TLS checks, no redirects and no retry loop. Cache files/directories are private, bounded and rejected when placed under the public webroot or reached through the checked symlink paths.

The service worker never caches API responses. Device rig, terrain, routes, map tiles and forecast evidence use separate storage policies. Clearing saved terrain does not clear a rig profile or trip.

## Release and verification

Build packaging must include both JavaScript modules, the PHP endpoint/helper and updated About text. The private cache directory must be writable by PHP with PDO SQLite and cURL available. A missing extension, inaccessible directory or cache lock returns a bounded unavailable state, not fabricated elevation. Deploy the endpoint/helper with the rest of the release; no public writable cache or new provider secret is needed.

`npm test` includes rig-profile, terrain client and PHP-contract tests. PHP integration checks require the PHP/PDO SQLite/cURL runtime; skipped tests are not passes. The Playwright runner includes both `rig-profile.spec.js` and `route-elevation.spec.js`, covering portable data, preview/import failures, storage failure, precise shared matching, mobile/keyboard/focus behavior, scoped accessibility, explicit coordinate disclosure, units, gaps, exact-route offline reuse and stale response rejection.

Before release, pass the full required CI/package checks, verify the private cache and fixed upstream from the production host using public test coordinates, and verify the real UI's mobile dialog/terrain behavior. Do not sample a user's saved trip without their Load action. FCC access is independent and remains blocked; this package does not add predicted coverage or towers.
