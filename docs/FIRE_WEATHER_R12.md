# Fire-weather alert overlay (R12)

Branch `feat/fire-weather-r12`, rebased onto main `76da929f`. No version bump.

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

What the empty capture shows: the `/alerts` endpoint, queried with the URLs in the manifest at the recorded times, returned HTTP 200 and an empty feature list for each fire event. It verifies the no-alert state and nothing more. It says nothing about how a real fire-alert record looks or is handled, and real zone geometry does not close that gap. The positive-alert fixture requirement stays open. No claim is made about fire alerts across the country, only about what this endpoint returned for these queries.

Nothing was invented and presented as a capture.

Candidate archives: none identified. No third-party archive (for example IEM VTEC) is used as the contract's NWS `/alerts` capture. If an authentic archived NWS `/alerts` response turns up, list it here with its provenance for the owner to decide.

Synthetic, `tests/fixtures/fire-weather/synthetic/cases.json`, built by `build-synthetic.js` and labelled `SYNTHETIC` in the file, in every alert id (`urn:synthetic:`) and in every headline. The alerts are invented. The only real content is the zone geometry, thinned. A test regenerates the file and fails on any difference. Cases: polygon, zone_only, mixed, expired, cancelled, updated, empty, geometry_failure, partial_zones. Stale is produced by the specs by ageing `retrieved_at`.

A real non-fire alert from the control capture, with only its event rewritten inside a test, checks that the PHP normaliser accepts the real NWS alert schema. That rewrite is marked synthetic in the test.

Capture workflow: `.github/workflows/capture-fire-weather.yml` now also runs the seven-day capture on its existing schedule and keeps it as an artifact for 90 days. Retention rule: the script marks a capture `positive` only when its saved bytes contain a Red Flag Warning or Fire Weather Watch feature. A positive capture is uploaded as `nws-fire-weather-POSITIVE-<run_id>-<attempt>` with `overwrite: false`, a name no later run reuses, so an empty run cannot replace it. The script also refuses to write into a directory that already holds a positive capture. Every positive capture stays a separate artifact for 90 days. The first one is also kept permanently: the `preserve-first-positive` job checks every saved file's byte count and SHA-256 against `manifest.json`, commits the files unchanged to `tests/fixtures/fire-weather/captured/first-positive/` on the branch `fire-weather/first-positive-capture` with a `PROVENANCE.txt` (run link, artifact name, sha256sum), and opens a pull request for review. It never pushes to main and never force-pushes. Once that branch exists, later positive runs skip the job and stay artifacts only. The capture job itself stays read-only. Only the preserve job gets `contents: write` and `pull-requests: write`. A pull request opened with the workflow token does not start CI, so CI is rerun on it before review. If the repository does not allow Actions to create pull requests, that last step fails after the push, and the branch still keeps the capture. The PR is then opened by hand. The empty capture stays a separate fixture. Tests in `scripts/tests/test_capture_fire_weather_fixtures.py` cover the rule, including a changed byte and a non-positive manifest being rejected. A captured file is never edited.

## Readiness and parity credit

- Code readiness: built and unit tested against synthetic alerts and real zone geometry. Browser results are below.
- Parity credit: none claimed. The positive-alert fixture requirement is open, and `features.csv` is not edited.

## Tests

Durable-capture change (workflow, its tests and this document only): `npm run test:python` 416 run, OK, 9 skipped, including 12 capture tests. A changed byte and a non-positive manifest are rejected, and the real capture script's positive output passes. The results below are from 4c45554f and cover all app code.

Run 2026-11-01 in `/home/claude/wt-r12`.

First pass, before the full suites, passed 72 Node tests across 7 files and 10 Python tests:

- `tests/firewx.test.js` (12): parsing, malformed and partial payloads, expiry, cancellation and update, upcoming status, zone resolution and budget, geometry-fetch failure and retry window, stale labelling and the 6-hour limit, the environment bridge, fixture hashes and the synthetic label, and Spanish and French coverage with matching placeholders.
- `tests/environment-api.test.js` (14, PHP): fixed query validation, strict zone paths, normaliser behaviour, real captured empty responses and real zone geometry, cache TTL from upstream `max-age`, expiry re-filtering with Cancel retained, and Retry-After handling. Also checks the User-Agent has no `@`.
- `tests/environment.test.js`, `tests/locale.test.js`, `tests/release-package.test.js`, `tests/service-worker.test.js`, `tests/offline-readiness.test.js`.
- `scripts/tests/test_capture_fire_weather_fixtures.py` (5) and the existing `test_capture_fire_weather.py`.

Full suites at 4c45554f, rebased onto main 76da929f, on a server started from this worktree (port 8811, cwd checked):

- `npm test`: 493/493.
- `npm run test:python`: 414 run, OK, 9 skipped.
- `tests/browser/firewx.spec.js`: 31/31, desktop and mobile, at 4c45554f.
- `tests/browser/environment.spec.js`: 7/7. It covers the smoke layer, and `firewx.spec.js` checks separation from smoke and perimeters.
- `locale.spec.js` and `app.spec.js`: 20 passed, 1 failed. The failure is the known `app.spec.js` mobile map height (493 against more than 500), which also fails on main.
- These three files ran on the commit before the last test-only edit to `firewx.spec.js`.
- Fixes these runs revealed: alert headings are `h2` (axe flagged a skipped level), the Spanish and French spec is split into separate tests, and the panel opens by keyboard because the expanded layers control intercepted clicks.

Run the browser spec with `PORT=<free> node scripts/serve.js` from this worktree, then `BASE_URL=http://127.0.0.1:<port> CHROMIUM_PATH=<chrome> npx playwright test tests/browser/firewx.spec.js tests/browser/environment.spec.js`.
