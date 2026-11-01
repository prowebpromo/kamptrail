# Fire-weather alert overlay (R12)

Branch `feat/fire-weather-r12`, built from main `023d444d`. No version bump, no PR.

## Criterion

From `docs/replica/COMPLETION_CONTRACTS.md`, R12 (approved):

- A dated overlay of NWS Red Flag Warnings and Fire Weather Watches, kept separate from smoke, perimeters and closures.
- Polygon alerts are drawn as polygons. Zone-only alerts are resolved through NWS zone geometry. A usable alert list stays available when geometry is unavailable.
- Each alert shows its event, issued, effective, expires and source. The overlay shows when it was retrieved. Expired and cancelled alerts are never shown as active. Stale data is labelled stale.
- Tests cover polygon alerts, zone-only alerts, expiry, cancellation, empty results, stale data and geometry-fetch failure.
- Fixtures come from the NWS `/alerts` endpoint for the previous 7 days, with capture URL, timestamp and hash. Synthetic edge cases are labelled synthetic. Historical fixtures are never shown as current alerts.
- The NWS API gets a User-Agent that identifies the app. Rate limits and caching headers are respected.
- Every new string has Spanish and French entries. Desktop and mobile layouts work.

This change does not edit `features.csv`. A row changes only on merged-PR evidence under the scoring rules.

## Design

Server, `api/_lib/environment.php` (the existing proxy, so the browser never calls NWS):

| Query | Upstream | Result |
|---|---|---|
| `kind=firewx` | `GET /alerts/active?event=Red Flag Warning,Fire Weather Watch&status=actual` | Normalised alerts. Cancel messages are kept so the client can retire what they reference. Expired alerts, tests, other events and unknown message types are dropped. |
| `kind=zone&zone=fire/COZ214` | `GET /zones/{fire\|forecast\|county}/{ID}` | One zone polygon, rounded to 4 decimals and thinned to 1500 points per ring. |

- Inputs are validated before any cache or upstream access. A zone is a strict `type/ID` path, never a URL.
- The User-Agent is `KampTrail/1.0 (https://kamptrail.com; public environment context)`. It names the project and carries no personal address. A test fails if an `@` appears in it.
- Caching and rate limits: the transport reads `Cache-Control: max-age` and `Retry-After`. Alerts are cached 300 to 600 seconds. Zones are cached 3600 to 86400 seconds, following upstream `max-age` inside that range (NWS sends about 30 days for zones). A 429, or a 503 with Retry-After, is cached as a failure for the Retry-After time, up to 600 seconds, and is not retried. The existing global two-second spacing between upstream starts still applies. Cache hits do not touch NWS.
- Cached alerts are re-filtered at read time, so an alert that expires inside its cache life is dropped. Cancel messages stay.
- The national alert fetch allows 8 MB of upstream bytes. A response over that is reported as unavailable, never partial.

Client, `firewx.js` (new, registered in `index.html`, `service-worker.js` and `scripts/build-release.js`), with small additions to `environment.js` (`request` is exported, `firewx` and `zone` are known kinds):

- Its own layer in the Map layers control, "Fire weather alerts (NWS)", and its own panel. It shares no toggle, panel, colour or legend with fire perimeters or smoke. Warnings use a solid red outline and watches a dashed brown outline, so colour is not the only cue.
- `select()` decides what is current. Cancelled alerts (named by a Cancel message), alerts replaced by an Update, and alerts past `expires` or `ends` are removed and counted ("N ended, cancelled or replaced alerts are not shown"). Judgement uses the browser clock, not the retrieval time, so stale data never revives an expired alert. A watch whose onset is in the future is shown as "Not yet in effect".
- `resolveShape()` draws an alert from its own polygon, else from its resolved zones (one MultiPolygon). States: polygon, zones, partial, pending, unavailable, none. Every state is stated in the alert card.
- Zone geometry is requested for zone-only alerts only, 12 zones per refresh, through the existing request queue (about 2.1 seconds apart). A failed zone is not retried for 10 minutes. The alert list renders first and does not wait for geometry.
- Freshness: up to 15 minutes is fresh. Older is labelled "Stale". A failed refresh keeps the last alerts, labelled stale, for up to 6 hours, then shows nothing. Offline removes all alerts and shapes, as the fire and smoke layers do.
- Any payload carrying a `fixture` marker is shown with a "Synthetic test data" or "Historical captured test data" banner. The server never emits that marker. Specs rebase fixture times to the browser clock and still show the banner.
- Each card shows event, issued, effective, expires, an event-end time when it differs, the area description, the source link, and how the area was drawn. The panel shows the retrieval time.

Known limit: NWS gives no bounding box, so zone-only alerts across the whole country compete for the 12-zone refresh budget, and zones for distant alerts load on later refreshes. Alerts are listed immediately either way.

## Fixtures

Real capture, `tests/fixtures/fire-weather/captured/`, made 2026-11-01 from this sandbox with `scripts/capture_fire_weather_fixtures.py`. Every file is saved byte for byte. `manifest.json` records URL, HTTP status, UTC retrieval time, byte count and SHA-256 for each, and the test suite re-hashes them.

- Window: `start=2026-10-25T14:46:28Z`, `end=2026-11-01T14:46:28Z` (7 days).
- Red Flag Warning: HTTP 200, 0 alerts. Fire Weather Watch: HTTP 200, 0 alerts. A control event (Small Craft Advisory, limit 1) returned an alert, which shows the query and the real property schema work. A separate check on 2026-10-31 (`docs/FIRE_WEATHER_CAPTURE.md`, branch `docs/fire-weather-seven-day-check`) found none either.
- Three real fire-zone geometries: `fire/COZ214`, `fire/CAZ281`, `fire/NMZ104`.

Consequence: no real Red Flag Warning or Fire Weather Watch existed in the seven-day window, so no real polygon or zone-only alert could be captured. Nothing was invented and presented as a capture.

Synthetic, `tests/fixtures/fire-weather/synthetic/cases.json`, built by `build-synthetic.js` and labelled `SYNTHETIC` in the file, in every alert id (`urn:synthetic:`) and in every headline. The alerts are invented. The only real content is the zone geometry, thinned. A test regenerates the file and fails on any difference. Cases: polygon, zone_only, mixed, expired, cancelled, updated, empty, geometry_failure, partial_zones. Stale is produced by the specs by ageing `retrieved_at`.

A real non-fire alert from the control capture, with only its event rewritten inside a test, checks that the PHP normaliser accepts the real NWS alert schema. That rewrite is marked synthetic in the test.

Capture workflow: `.github/workflows/capture-fire-weather.yml` now also runs the seven-day capture on its existing schedule and keeps it as an artifact for 90 days. When a real Red Flag Warning or Fire Weather Watch appears, the next run captures it with its hash. Promote it to `captured/` by hand, then add a case.

## Tests

See the results section below.
