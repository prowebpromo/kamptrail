# R11 router findings for Claude

November 1, 2026. Research and implementation recommendation. No authenticated routing requests, production changes, provider messages, or subscriptions were made. Claude retains implementation and release ownership.

## Recommendation and scope

Use hosted openrouteservice Standard with driving-car as the leading R11 candidate. Implement highway avoidance and a bounded loop around KampTrail's own road-associated clearance hazards. Treat the provider as technically promising, with public release pending the behavioral and privacy gates below.

The approved COMPLETION_CONTRACTS.md R11 defines car routing plus highway avoidance and known-clearance rerouting. It excludes weight/width enforcement and RV-access certification. The October 30 assessment primarily tested a broader dimension-aware truck router. Its HGV/bus false exclusions do not decide whether the car-profile approach meets R11. Further HGV height tests are unnecessary for this narrower implementation unless the owner reopens dimensional routing.

Repository sources read from main on November 1 were docs/replica/COMPLETION_CONTRACTS.md, docs/RV_ROUTER_ASSESSMENT_2026-10-30.md, api/_lib/routing.php, route-clearance.js and docs/CLEARANCE_NATIONAL.md. The previous pilot recorded 8/8 paired height cases on one RI segment and three truck-only exclusions. This investigation did not rerun those cases.

## Verified provider findings

| Question | Finding and evidence |
|---|---|
| Hosted cost | The current public account application lists Standard at zero euros. Its Directions policy supplies 2,000 daily requests and 40 per minute. Actual account entitlement and remaining shared quota still need checking through the existing authorized runner. |
| Commercial use | HeiGIT's October 12 forum answer expressly permits Standard commercial use. |
| PHP backend | The current official FAQ recommends a server-side adapter to protect the key. This fits KampTrail's PHP hosting. |
| Endpoint | Use https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson . The older api.openrouteservice.org host is deprecated. |
| Highway and area avoidance | The official options reference documents highways for driving profiles and GeoJSON Polygon/MultiPolygon exclusion areas. Car routing does not accept profile dimension restrictions. Actual hosted behavior is still untested here. |
| GPX | The documented POST API supports GPX. KampTrail can instead export the returned geometry locally, preserving attribution and license information. This avoids an additional provider request. |

The current account terms identify route outputs as CC BY-SA 4.0 and require attribution. They prohibit sending personal data and permit account blocking for repeated quota abuse. I found no express cache-expiry requirement in those terms. The linked Creative Commons license supports copying and adaptation with attribution, license links and applicable ShareAlike duties. This supports a cache/export design, subject to those obligations. The older staging website's CC-BY text is superseded evidence for this assessment. Public release still needs the coordinate-use question resolved. Sources below include the actual current application asset, because the terms page is rendered with JavaScript and returned no readable body in web extraction.

The provider's September 21 response to a permanent commercial route-geometry database question requested direct contact. Its August matrix-storage answer allowed reuse subject to terms. Neither answer specifically clears KampTrail's arbitrary user itinerary processing. Avoid claiming a blanket provider approval.

## Constraints that affect the design

1. The last indexed official restrictions page lists 150 km for routes using avoid areas, 50 waypoints, 200 square kilometres of avoidance polygons and a 20 km polygon extent. The page returned 404 during this check. These are provisional compatibility limits until confirmed against the current service, not a verified current entitlement. KampTrail permits 26 stops, but long RV itineraries can exceed the avoid-area limit even with two stops. First implementation should reject an unsupported constrained trip explicitly. Automatic splitting is additional work that must test leg joins, returned distances, turn restrictions and global retry budgets.
2. Current kr_reserve allows one request every 1.1 seconds and retains one hour of events. That can exceed 40 requests per minute and does not enforce a shared daily provider cap. Reserve each actual upstream attempt atomically against a global rolling-minute budget and the provider's quota-reset window. Preserve per-client limits too. Read provider remaining/reset headers, respect Retry-After, and stop retries when a limit is reached. Configure headroom for the existing pilot and any other consumers of the same key.
3. Define three total provider attempts per user calculation, including the initial route. At that cap, 2,000 provider calls yield at most 666 worst-case completed calculations before other consumption or headroom. This is capacity arithmetic, not a traffic estimate. Limit avoidance to at most 50 distinct hazard identities and cap polygon bytes/vertices as well.
4. A clearance candidate is not automatically a hazard on the driven road. The current client only searches within 100 metres and explicitly lacks road identity. R10 must supply usable association evidence. Conditional, directional, ambiguous, stale or unavailable evidence must remain unresolved. Do not turn all nearby tags into exclusion polygons.
5. Polygon avoidance can also exclude nearby parallel roads or roads on another level. Build bounded areas around the associated passage, inspect returned paths and independently check every attempted route. A changed route length alone cannot prove avoidance. No successful avoidance result may imply that unmapped hazards are absent.
6. Treat clearance equal to rig height as a conflict. Retain integer canonical rig units and validate conversions. Changing stops, height, highway setting, provider/profile or clearance dataset invalidates incompatible results. Store request identity and response engine/graph metadata where exposed. Cached routes retain their original dates and cannot certify current conditions.
7. ORS response structure differs from the existing OSRM normalizer. Implement a separate parser and validate geometry, waypoint indices and stop-to-stop boundaries. Preserve the existing client geometry/legs/leg_ends contract. Keep the provider URL fixed server-side and the key private. Do not forward visitor headers, identifiers or raw logs to the provider.

## Behavioral acceptance for Claude

Use public, non-personal fixture coordinates in the existing authorized GitHub runner. Confirm its current entitlement before the bounded test. Capture sanitized request, response digest, UTC time and exposed engine/graph identity.

- A highway corridor whose normal control uses a highway and whose requested avoidance demonstrably avoids it, plus an impossible avoidance case.
- The known Blackstone Street corridor with the car control, a road-associated clearance conflict, an exclusion reroute and an independent check of the returned path. Test both directions, below/equal/above height, a parallel road, a crossing on another level and ambiguous direction.
- A second geographically independent clearance fixture with reviewed evidence. This guards against tuning solely to the RI example. Expand coverage when failures show a need.
- Invalid dimensions, a stop inside an excluded area, no alternative route, exceeding the distance/geometry limits, and the 50-hazard/three-attempt limits.
- Two-stop and 26-stop route normalization, response truncation, malformed geometry, timeouts, daily-quota 403 and minute-rate 429. The FAQ distinguishes those two limit responses.
- Concurrent requests cannot overrun shared quota. Changed settings invalidate old results. A delayed old response cannot replace the new route. Failure offers ordinary car routing only after explicit user choice.
- Attribution and license links survive cached display, saved routes and GPX export. Describe any modifications to provider geometry.

After implementation, require normal CI, desktop/mobile production acceptance on the published SHA and saved-session upgrade checks. No parity credit is earned from this research or a successful API fixture alone.

## One provider clarification to send only with owner authorization

Please confirm whether KampTrail may use the free Standard plan through a private PHP backend for user-selected campground itineraries, including device GPS or home-origin coordinates, given the prohibition on transmitting personal data. We would send route coordinates and avoidance options without names, user IDs or visitor IP forwarding. We would retain dated route geometry on the user's device and permit GPX export with openrouteservice/OpenStreetMap attribution, a CC BY-SA 4.0 link and modification notices. Are these uses permitted, and are there any retention, redistribution or additional attribution requirements? Please also confirm the current driving-car avoid-area distance and polygon limits.

Until clarified, a public-coordinate pilot can establish behavior. Merely omitting names does not establish that a person's route coordinates are non-personal.

## Primary sources and capture notes

- https://account.heigit.org/info/tos — current terms. Public SPA routes to https://account.heigit.org/chunk-TC2R7MR4.js . Read directly on November 1.
- https://account.heigit.org/info/plans — current public plans. Public SPA routes to https://account.heigit.org/chunk-7SF2PHKW.js . Standard Directions policy inspected directly. No account session or key accessed.
- https://giscience.github.io/openrouteservice/frequently-asked-questions — server-side usage, quota timing and response codes.
- https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options — highways and polygon avoidance.
- https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/requests-and-return-types — response normalization and GPX format.
- https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912 — endpoint migration.
- https://ask.openrouteservice.org/t/free-plan-in-an-app-with-a-paid-tier-license-cc-by-sa-4-0-personal-data-and-attribution-questions/8079 — current commercial-use statement and link to current terms.
- https://ask.openrouteservice.org/t/persistent-storage-and-reuse-of-matrix-api-duration-results/8010 — limited matrix-storage response.
- https://ask.openrouteservice.org/t/persistent-storage-and-commercial-reuse-of-directions-api-route-geometry/8057 — geometry storage question referred to direct contact.
- https://openrouteservice.org/restrictions/ — indexed restrictions available, direct page returned 404. Numeric limits need reconfirmation.
- https://creativecommons.org/licenses/by-sa/4.0/ — license summary. Applicable legal code is linked there.

The marketing website reports a website outage and says the API services remain available. This is not evidence of a routing API outage. Backend documentation currently describes version 10.0.1. The actual hosted engine must be recorded from the next authenticated response rather than inferred from the documentation version.

Capture SHA-256 (public assets, November 1, 2026):

- `chunk-TC2R7MR4.js`: `45d589c32d38ac9cec223ea15942b557dc21a488f0fd7e4d10161a6b0a7aaf2e`
- `chunk-7SF2PHKW.js`: `dd67f24720874d29dd40384dcdc8aa850e311d1f0259f77388f5caf7562465e2`

This documentation-only branch starts at verified baseline `041ff76c47cbc002ef38aa29e39a508337e2bf91`. It changes no runtime or generated data. Claude should take this document only, without resetting or replacing current implementation work.
