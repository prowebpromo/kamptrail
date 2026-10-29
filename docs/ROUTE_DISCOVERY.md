# Road routes and along-route discovery — 2.8.0

Saved stops now calculate an actual car-road LineString, rather than drawing straight lines. Calculation is explicit, covers 2–25 saved stops, and preserves itinerary order. External whole-trip directions remain available. Geometry is invalidated when stops change. Never describe this as RV-safe routing: height, weight, length, clearances, seasonal closures and road conditions are not checked.

Discovery loads the national index only when requested. Compact normalized fee/type/amenity/rig/site-signature fields use the same filters as the map; the national start view still downloads no listing files or search index. Search 1, 5, 10 or 25 miles each side of the road, sort by progress or distance, filter names, view a full listing, or insert after the matched leg. Line distance is approximate straight-line distance, not a driving detour. A detour button makes one additional route calculation through the candidate and reports added car time and distance. It never automatically routes every result. The itinerary is checked before acting on old results.

## Provider and privacy

The fixed upstream is FOSSGIS OSRM car routing. The app shows attribution and a fix-the-map link. Official policy: https://routing.openstreetmap.de/about.html (checked 2026-10-28): valid User-Agent, at most one request/second, no scraping/heavy use. This is light-use, user-triggered routing. A shared MySQL reservation enforces 1.1 seconds between upstream starts; each salted connection hash is capped at 60 requests/hour. Requests rejected by the limiter do not reach FOSSGIS. At sustained demand, move to a contracted or self-hosted router; shared Hostinger is not an OSRM graph host.

Calculating transmits stop coordinates to FOSSGIS, which logs requests. KampTrail's database stores only a salted client hash, request timestamp, and global last-start timestamp, with one-hour event retention. It stores no coordinates or geometry. The proxy accepts points only; users cannot choose the upstream URL. There are no API secrets in browser code. Test upstream overrides work only in PHP's local development server and only at loopback.

Successful routes are cached on the device, bounded to eight routes. Online cache reuse lasts 24 hours; an explicit recalculation refreshes it. Older cached routes remain readable offline with calculation date and an offline warning. Viewed search index data is cached too. Browser storage can be unavailable or evicted; do not promise guaranteed offline storage. Community/private API responses are never cached by the worker.

## Deployment

Migration `003_routing` adds only `routing_state` and `routing_events`, with indexes; existing correction, review and photo tables remain unchanged. Apply through the signed-in moderation page, then verify health `routing: ready`. Build always regenerates the compact search index; generated data is not hand-edited. Keep both MVUM and route cache namespaces during worker upgrades.

## Verification

Pure tests cover road bends, leg order, dateline handling, same-site rig/hookup filtering, normalized index metadata, and invalid geometry. SQLite and MySQL API integration uses a local fixture upstream, covering method/origin/input validation, pending migration, annotation alignment, provider failure, per-client/shared rate limits and absence of coordinates in storage. Browser tests cover on-demand geometry/discovery, filters, detour and insertion, itinerary changes, offline reuse, errors, mobile layout and scoped accessibility. All CI must pass before deployment. Live verification must use public test coordinates, never the user's saved trip without their routing action.
