# Live acceptance of 2.36.0 (PR #163, merge b0dfbdbc)

Observed values only, from the live site and the raw files in this folder. Chrome 153.0.8010.12 (Playwright, sandbox). `release.json` reported `b0dfbdbc…` at the start and end of every check. Index and host-map hashes are unchanged from 2.35.0.

| Check | Desktop 1280x720 | Mobile 390x844 |
|---|---|---|
| Identity census (33,370 expected, 33,370 browser, all difference counts 0) | PASS, reversed order | PASS, seed 7 |
| Saved stop `ridb:232479` reopens Cosby offline through the drawer | PASS | PASS |
| National clearance layer, densest tile `13-2045-3244` (535 records), zoom 13: every tile 200, "Unmapped hazards are unknown", ODbL credit in control and attribution bar, no page errors | PASS (5 tiles, 1,022 candidates) | PASS (4 tiles, 1,010 candidates) |
| Rhode Island, online then offline in one tab: "Saved snapshot" appears offline only, uncached fetch blocked | PASS | PASS |
| Visitor clearance reports endpoint answers | FAIL | FAIL |

## Open: migration 006 not applied on production

`api/health.php` returns HTTP 503 with `"schema":"migrations_pending"` (`health.json`). Migration `006_clearance_reports` has not been applied, so the map shows "Visitor reports unavailable" and clearance submissions return 503, as designed until the migration runs. Campsite corrections, community reviews and the rest of the app are unaffected. Migrations are applied by an administrator through "Apply migrations" in `api/admin.php`. After that, rerun `scripts/acceptance/live-clearance-check.js` with `REQUIRE_REPORTS=1` and check that health reports `"schema":"current"`.

Files: `clearance-*.json` are the runs with `REQUIRE_REPORTS=1` (stopped at the reports check, before the RI part). `clearance-*-noreports.json` are the full runs without it.

No parity claim. Score 91.7.
