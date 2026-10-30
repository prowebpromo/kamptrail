# Dated overnight-permission evidence — 2.15 contract

Status: production release 2.15.0 verified on 2026-10-30. `release.json` returned HTTP 200 with source `5ba72fe76026442d8bb491ee449a3634a2532e57` (PR #88, including the PR #94 RIDB alias-scope fix and reviewed PR #92 parity baseline). A production backup passed a compatible MariaDB offline restore check before the existing authenticated admin/CSRF path applied only `005_permissions`, with explicit UI confirmation. Post-migration health returned HTTP 200 with all services ready. The restore check did not test exact-version server startup or independently compare current production rows against the snapshot. Strict checklist parity remains 84.9, with overnight parking partial and permission voting absent.

## Product boundary

Permission is separate from fees, access tags, reviews and land ownership. A zero price does not authorize an overnight stay. Parking an unoccupied vehicle does not authorize sleeping. Personal permission does not establish operator policy for another visitor. Reports never change campsite fee classifications or official source conclusions.

The official rest-area pilot imports 78 exact TxDOT Texas locations, with source hashes and retrieval dates; 12 travel information centers are excluded. Every location's overnight permission remains unknown. TxDOT's separate visitor duration statement is context only. See `REST_AREAS_PILOT_2.15.md` and its JSON audit. The source table was retrieved at `2026-10-30T13:11:18Z` and the separate duration page at `2026-10-30T13:11:26Z`; source update dates were not supplied. The table contains 90 rows: 78 imported rest areas and 12 excluded travel information centers. No nationwide rest-area coverage or automatic permission inference is claimed.

A place descriptor is `{kind,id,name,coordinates:[longitude,latitude]}`. Catalogue places resolve against a generated protected identity lookup. `campsite` and `service` identities stay distinct even when their OSM IDs match. Generic spots use the existing `spot:LAT5,LNG5` convention with canonical rounding and no negative zero. No nearby-place, chain-wide or public-land inference.

## Evidence and freshness

The initial reviewed sources cover Sand Island and Sand Mountain/Pipeline, both BLM locations. Everything else starts unknown. Official records carry scope, source URL, short preserved evidence, conditions, effective dates when published, retrieval/review times and a review deadline. Source statements may be allowed, conditional or prohibited; the presentation can also report unknown, conflict or historical evidence. Review deadlines are local freshness rules, never invented agency reopening dates.

Explicit supersession survives expiration: an expired closure cannot make older generic camping prose become current again. A newer explicit reopening may replace a closure. Published personal reports stay in a separate dated section and never establish official permission.

## Reporting and moderation

Activities: `overnight_occupancy`, `unoccupied_vehicle_parking`. Firsthand observations: `granted_to_me`, `refused_to_me`, `prohibition_sign_seen`, `stayed_without_asking`. Grant/refusal records require an authority role and office; private contact details are not requested. Visit date cannot be in the future. Public name, visit date, location and text are disclosed before submission. Every submission starts pending. These are individual reports, not permission votes; the published-report count is not an overnight-allowed vote tally. Unknown permission never counts as allowed.

An independent random management token is returned once and retained only as a hash server-side. The client may retain management metadata and its token locally; public report responses and permission conclusions are never cached. Owner edits return published reports to pending. Owner deletion wipes public personal fields and cannot be undone by a moderation action. Integer versions prevent stale edits and decisions. Flags and audit events use dedicated tables, without owner tokens in their payloads.

## Transport and operations

`POST api/permissions.php` carries read, owner, submit, edit, delete and flag actions in JSON bodies. Bearer tokens use the Authorization header. No submitted place coordinates, tokens or public names in endpoint URLs or logs. All responses are no-store. Strict origin, accepted-field, enum, body-size, date and identity checks apply server-side. Writes use prepared statements and independent rate-limit labels. Static official evidence remains available if the reporting database is unavailable; `reports_available:false` is distinct from zero published reports.

The moderator uses the existing authenticated admin session and CSRF gate. Migration005 is additive, restart-safe and applied through the existing migration path after backup verification. No new provider account, API key or public migration bypass. Generated lookup JSON is denied over HTTP and rebuilt from the release catalogue.

## Release gates

- Owner isolation, stale versions, published-edit moderation, deletion and flag handling verified with real PHP/MySQL in CI.
- Evidence expiry, conflict, supersession, scope and catalogue/spot identity tests.
- Accessible dialog, offline/unavailable behavior, rapid place changes, moderation lifecycle and no token URL/cache exposure.
- Exact release packaging, protected generated-data denial and live source/API checks.
- Update parity evidence only after checks and deployed behavior are verified.

## Production verification, 2026-10-30

- Main test workflow, production publish and Lighthouse CI completed successfully for the release.
- The deployed Texas catalogue matched the reviewed file bytes: 78 locations, every overnight-permission value unknown. The live Hale County Northbound popup showed both source retrieval timestamps and the distinction between a visitor time limit and permission; the normal popup close control worked.
- Permission read returned HTTP 200 with `reports_available:true`, unknown official permission and zero published reports. The live dialog showed that available empty result, and the authenticated Overnight reports moderation queue opened empty. No synthetic firsthand observations were submitted; this check did not exercise a production submission/edit/delete lifecycle.
- The generated permission manifest returned HTTP 403. About showed all eight freshness entries Current, including the dated TxDOT Texas source.

See `replica/2026-10-30-parity.md` for workflow references and local test limitations.
