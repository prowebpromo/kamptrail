# Overnight permission evidence, 2.15.0

This release has reviewed official evidence for **two exact campsite records**, not national permission coverage. All other campsites, all service businesses, and saved map spots have unknown official overnight permission unless a future reviewed record explicitly covers their exact identity and activity. A campsite label, BLM ownership, brand, service category, nearby point, user report, or successful earlier stay cannot establish permission.

## Primary sources reviewed October 30, 2026

- [BLM Sand Island](https://www.blm.gov/visit/sand-island): the page explicitly says the campground is temporarily closed effective October 26, 2026 because of flooding. Its lower generic year-round campground description does not override the closure. No reopening date is given. Bound only to `campsite:osm:node:436690832`, coordinates `[-109.6180927,37.2606718]`, Sand Island Campground. Page coordinates are less precise; identity binding was reviewed against the existing catalogue record, not extended to nearby places.
- [BLM Sand Mountain Pipeline](https://www.blm.gov/visit/sand-mountain-pipeline-designated-dispersed-camping-area): camping is authorized in eight numbered sites, with stays limited to 14 days in a 28-day period. The official conclusion is conditional, applies to the designated sites, and does not establish vacancy or permission at arbitrary nearby coordinates. Bound only to `campsite:blm-area:10301148`, coordinates `[-113.439236,37.098591]`.

`retrieved_at` and `reviewed_at` are actual evidence capture/review times. They are not source publication dates. Unknown publication, opening-hour, reopening, and effective-end facts are not invented. The closure is due for review after one day; the designated-site evidence after 30 days. These are editorial freshness deadlines, not official rule expirations. There is no automatic refresh job: records become historical after their deadline until a human rechecks the source and updates them.

Quotes across all records from each page total no more than 25 words. `sha256` is the SHA-256 of the UTF-8 retained quote, **not a claim that the complete webpage has been archived or checksummed**. Conditions are editorial paraphrases of the cited page. A superseded general description is retained to document why generic prose cannot reactivate permission.

## Scope and identity

Every record carries `place: {kind,id,name,coordinates:[longitude,latitude]}` and `activity`. Overnight occupancy (camping/sleeping in a vehicle) is distinct from leaving an unoccupied vehicle parked overnight. The two initial pages support only `overnight_occupancy`; neither is used to infer `unoccupied_vehicle_parking`.

Campsite and service keys are `kind:id`. An OSM node represented as both a campsite and a service has two independent keys. Legacy IDs, name matches, land ownership, and proximity are never permission aliases.

Generic map spot IDs and keys are `spot:LAT5,LNG5`. Both JS and PHP use `sign(value) * floor(abs(value) * 100000 + 0.5) / 100000`, normalize negative zero, then format five decimal places. Original spot coordinates must reproduce the submitted ID; the server returns the rounded canonical coordinates. Numeric strings and out-of-range coordinates are rejected. Catalogue places instead require the exact published coordinates and return the authoritative catalogue name.

## Build and request path

`node scripts/build-permissions.js` reads the actual campsite search index and current services manifest. Each service shard's bounded path, byte count, SHA-256, schema, identity, and bounds are validated using the same services validator used by clients. It compiles all identities into 256 files chosen by the first byte of `SHA256(place_key)` in `api/_data/permissions`. A dedicated `.htaccess` denies all access; the API also denies direct JSON serving. This generated directory is rebuilt for every release and should never be hand edited.

Reviewed source records live in `data/permissions/official.json`; the builder checks their exact catalogue identity, approved HTTPS source URL, excerpt hash, dates, and acyclic same-place/same-activity supersession links before writing the protected copy. All reads are local. No submitted or stored source URL is fetched by the PHP helper, preventing request-triggered SSRF.

The helper `api/_lib/permission-evidence.php` requires no database:

- `kp_resolve_place(input)` returns the authoritative place or null.
- `kp_place_key(place)` returns its exact key.
- `kp_official(place, now = null, activity = 'overnight_occupancy')` returns `{status,activity,evidence,summary,as_of}`.
- `kp_reduce_evidence(records, place, now, activity)` is the pure dated reducer used by the helper and tests.

## Reduction and failure behavior

`allowed`, `conditional`, and `prohibited` require valid, current official records for the exact place, coordinates, and activity. A current prohibition conflicting with a current allowance/conditional allowance produces `conflict`. Conditions are not silently discarded when combined with a general allowance. No applicable evidence produces `unknown`. Only expired, superseded, or overdue evidence produces `historical`, explicitly stating that current permission is unknown. Future evidence is displayed as future and does not authorize the present.

Every returned record has `freshness: current|superseded|expired|future|stale`. Effective end dates are inclusive calendar days in UTC; freshness ends exactly at `review_after`. The date-only effective source statement has no fabricated hour.

Supersession is a permanent tombstone once the replacement applies. A stale or expired closure can never revive the lower generic description. A newly reviewed reopening would require its own explicit official evidence. Malformed or duplicate evidence fails closed to unknown. Missing protected data also yields unknown. Community reports are stored and moderated separately and are never arguments to the official reducer.

## Validation

`node --test tests/permission-evidence.test.js` verifies source bindings, timestamps, hash/URL rejection, service shard corruption, 256-bucket generation, and separate same-ID campsite/service keys. With PHP installed, it also executes the real resolver and reducer for precise coordinate mismatch, kind mismatch, negative zero, cross-language spot rounding, unknown places, distinct activities, conditional/prohibited outcomes, conflict, expiry, future dates, freshness boundaries, and permanent closure supersession. CI should use `KT_REQUIRE_PHP=1` so missing PHP cannot silently skip those checks.
