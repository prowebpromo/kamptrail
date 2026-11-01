# Clearance client (R10)

Branch feat/clearance-client-r10 from 023d444d. Version not bumped. No PR.

## Criterion (contract R10, written before the build)

From docs/replica/COMPLETION_CONTRACTS.md R10 and the owner rules for this package:

1. National OSM processing (ODbL, attributed) reaches the client only when builder, schema and client pass together. The production package holds only what the client reads.
2. Moderated visitor-reported clearances, with submission, moderation and publication proven on an isolated database.
3. Raw values, normalized units, source dates and unknowns are preserved.
4. Only status numeric_only with comparable=true is compared with a rig height. Below and equal are conflicts. Equal is never clear. Suspect, conditional, directional, mixed and unknown stay visible as "needs checking" or "unknown" and are never compared.
5. Nearby candidates are distinguished from candidates associated with the driven road. Association needs evidence. Proximity alone never associates. Unresolved road and direction relationships are flagged, with no claim of passage or avoidance.
6. A comparable record never establishes that a route is clear. Missing or uncomparable data stays visible. No result implies unmapped hazards are absent.
7. Mobile payload: nothing drawn or requested below zoom 10. Tiles load by viewport from the manifest bbox, with bytes and sha256 verified.
8. ODbL credit and link wherever candidates are shown.

## Design

clearances.js (map layer and shared core)

- createStore reads data/clearances/index.json (at most 1 MiB) and validates schema kamptrail-clearances-3, the ODbL attribution sentence, and each tile entry (path matches z/x/y/part, bbox, bytes at most 512 KiB, records, sha256).
- loadTile streams a tile with a byte cap, checks its length and SHA-256 against the manifest, then validates every candidate: identity, geometry inside the tile bbox, raw tags, status, applies_to. A comparable candidate must have a min_inches that its raw tag text re-parses to. An uncomparable one must have no minimum. A tile that fails any check is never drawn, and its area is reported as unknown.
- tilesForView returns nothing below zoom 10. It refuses views needing more than 64 tiles or 4 MiB, so the client asks the visitor to zoom in. Memory holds at most 12 MiB of tiles (LRU).
- compare(candidate, rigMm): rig height comes from the rig profile (whole millimetres). The clearance converts from min_inches to whole millimetres and compares at that resolution: below, equal or above. conflict is true for below and equal. Only state 'comparable' (numeric_only and comparable=true) is compared. Everything else returns not_compared.
- Map layer "Clearance candidates (OpenStreetMap)": the status line counts conflicts, needs-checking and unknown, plus failed tiles, and always says "Unmapped hazards are unknown". It lists the protected states (RI) as not in this dataset. Line style shows the state: red for conflict, blue for above, amber dashed for needs checking, grey dashed for unknown. The popup shows the verdict, status text, every raw tag, applies_to with evidence, "Map view only: not matched to any route", source flags, extract, download and edit dates, the OSM link, and the ODbL credit.
- Attribution: the control, every popup, the route dialog and the Leaflet attribution bar carry the ODbL sentence or credit with a link to https://www.openstreetmap.org/copyright.

route-clearance.js (route context, the road-association contract)

- analyze(route, {rigMm}) loads only the tiles whose bbox meets a route segment (at most 96 tiles, 12 MiB). It finds candidates within 100 m and assigns each an association from exact OSM identity only.
- Segments are listed as missing when their tile failed integrity or the route budget ran out. Rhode Island segments are missing only when RI.json is missing or fails validation (reason ri_pilot_unavailable).

## Rhode Island

The national manifest protects RI (states_protected), so it holds no RI candidates. Production already serves data/clearances/RI.json, so the client keeps reading it for RI and the release keeps packaging it.

- Map: when the view meets the RI box and the manifest protects RI, the store loads RI.json (at most 512 KiB) and validates it with the 2.34.0 pilot rules, unchanged (validatePilot). The status line reports the pilot record count and extract date.
- Route: RI segments scan the pilot records. result.dataset.ri_pilot records use and dates.
- Pilot records are schema 1. They carry no reviewed status, comparable flag or applies_to. They are shown with raw tags and dates as "needs checking", never compared with a rig height, and always unresolved on a route, even with an exact way id. This matches the 2.34.0 pilot behaviour, which made no rig comparison.
- RI is shown as unknown only when RI.json is missing or fails validation. Tests: tests/clearances.test.js (committed file validates, missing and invalid files reject), tests/route-clearance.test.js (valid pilot covers RI, missing, invalid and tampered pilot mark RI segments ri_pilot_unavailable) and tests/browser/clearances.spec.js (desktop and mobile, valid, missing and invalid).
- Offline copy, restored to match 2.34.0:
  - Store: Cache Storage `kamptrail:<scope>:clearance-v1`, keyed by the absolute RI.json URL. A copy is written only after validatePilot passes. The service worker already keeps that cache on activate and never intercepts data/clearances/.
  - Read: the saved copy is size-bounded and run through validatePilot again before use. A copy that fails validation is not shown, and RI is reported unknown.
  - Refresh: fetches use cache no-store with a 15-second deadline. A failed or late refresh keeps the in-memory copy, or else uses the saved copy. Removing the layer cancels the request and uses neither. Retry and the online event force a refresh. Going offline relabels the in-memory copy as saved.
  - Labels: the status line says "Saved snapshot. Rhode Island: N pilot records ... (extract date)". The popup's date line starts "Saved snapshot." and keeps the original extract, download and edit dates. A refresh never makes the saved copy look new.
  - Offline with no manifest: an RI view still shows the saved RI copy and says national data is unavailable. Views outside RI say the data is unavailable and show nothing.
  - Tests: tests/clearances.test.js (cache name and key, the stored copy unchanged, offline read with label and original dates, corrupt, invalid or absent copy, refresh failure and deadline fallback, cancel, and a map-layer harness offline with no manifest). tests/browser/clearances.spec.js has desktop and mobile runs with the service worker controlling and the context offline, including a tampered saved copy becoming unknown.

## Road-association data contract (for R11)

Input, optional on the route object from api/route.php:

```
route.osm = {
  way_ids:  [string|null, ...]  // length = coordinates.length - 1; way_ids[i] is the OSM way driven by segment i
  node_ids: [string|null, ...]  // length = coordinates.length; node_ids[i] is the OSM node at coordinates[i]
}
```

Ids are decimal strings. null means unknown for that segment or vertex. A malformed list is rejected, not guessed.

The current OSRM normalizer (api/_lib/routing.php) requests annotations=distance only. It returns no way or node ids, so today every route has association_method "none" and every nearby candidate is unresolved. OSRM can return annotations=nodes (OSM node ids per vertex). Way ids need a node-pair to way lookup or a provider that returns them. R11 must add one of these server-side before any candidate can count as on the route.

Output, analyze() result, schema kamptrail-route-clearance-1:

| Field | Meaning |
|---|---|
| association_method | exact_osm_identity when the route carries way_ids or node_ids, else none |
| association_limits | Plain statement of what the method can and cannot decide |
| candidates[] | One per candidate within 100 m: id, osm_type, osm_id, distance_m, nearest_segment, leg, segment_basis, association, association_evidence, direction, state, status, applies_to, comparison, route_conflict |
| association | on_route, not_on_route or unresolved |
| route_conflict | true only when association is on_route and the comparison is below or equal |
| direction | not_directional only for an on_route candidate with no forward, backward or lanes tag. Otherwise unresolved |
| missing[] | Segment ranges {from, to, length_m, reason}: tile_failed_integrity, route_tile_budget, region_not_in_dataset:RI |
| summary | on_route, on_route_conflicts, on_route_unresolved_value, unresolved, not_on_route, missing_segments |
| route_clear | Always false. No result establishes a clear route |

Association rules:

- A way candidate is on_route only when a route segment within 100 m of it carries its way id, and its applies_to is way_itself or road_below. Both mean the limit applies to traffic on that tagged way. With applies_to unknown it stays unresolved. If the id appears only on segments farther away, it stays unresolved (route_way_id_matches_only_on_distant_segment).
- A way candidate is not_on_route only when every segment within 100 m carries a non-null way id and none equals it, for example a parallel road. Otherwise it is unresolved.
- A node candidate (barrier, applies_to unknown) is on_route only when a route vertex carries its node id and that vertex itself is within 100 m of the candidate. The reported distance_m is the distance to that vertex. A match only at a vertex farther away leaves it unresolved (route_node_id_matches_only_at_distant_vertex), even when some segment passes nearby. It is not_on_route only when every nearby segment has both node ids and none matches.
- For an on_route candidate, nearest_segment, leg and distance_m come from the match (segment_basis osm_identity_match). For a way that is the matching segment. For a node it is the matching vertex, and the segment is the one starting there (or ending there at the last vertex). Otherwise they come from proximity (segment_basis proximity).
- Without ids every candidate is unresolved with evidence route_has_no_way_ids or route_has_no_node_ids. Distance never changes association.

R11 should avoid only candidates with route_conflict true. Unresolved candidates and missing segments must be disclosed, never silently avoided or ignored.

## Visitor-reported clearances

This reuses the moderated corrections path. No new public write endpoint was added.

- Submission: api/submit.php accepts kind "clearance" with a clearance object: posted text (same syntax as the OSM parser), observed_on, direction (both, one_direction, unsure) and an optional osm_ref. It uses the existing honeypot, minimum time, first-hand confirmation, rate limit and status token. Migration 006_clearance_reports adds a clearance_reports table keyed by submission id. Until the migration runs, clearance submissions and reads return 503 and campsite corrections keep working.
- Moderation: api/admin.php shows the posted value, date, direction and OSM link in the existing queue, with the existing audit log.
- Publication: api/clearance-reports.php?bbox= (at most 25 square degrees, 200 rows) returns only submissions whose status is applied, with structured fields only. It never returns prose, email, token or client hash.
- Display: purple markers and popups say "Moderated visitor report, not OpenStreetMap data", show posted value, seen and published dates, and are never compared with a rig height or tied to a road. Forms open from the control (map centre) or from a candidate popup (linked osm_ref).
- Proof: tests/api.test.js runs PHP's built-in server against a temporary SQLite database. It covers validation, received and accepted not published, applied published with exact public fields, client validation of the server row, rejection unpublishing it, the moderation log, bbox limits, the status page, and migration-pending behaviour.

## Production package

scripts/build-release.js copies data/clearances/index.json and each tile it lists after a bytes and SHA-256 check and the client's own validateTile. It fails on any tile file that is not in the manifest. It packages RI.json after validatePilot. It never packages data/clearances/excluded. dist/clearance-package.json records the totals. tests/release-package.test.js asserts the shipped set equals the manifest plus its tiles.

Built package, data/clearances only: 1,061 files, 44,975,574 bytes (index.json 387,841 bytes, RI.json 119,065 bytes, and the 1,059 tiles listed in the manifest, 44,468,668 bytes). Manifest sha256 ccc58b0561e80dabddf14574fd89e1f76f1ae011dda6a56db5cb26e08e38d273. New API files: api/clearance-reports.php and api/_lib/clearance-reports.php. data/clearances/excluded is not packaged.

Per-view payloads with the client's gating (tilesForView, raw bytes): NYC z12 9 tiles 619 KB, NYC z10 41 tiles 2.17 MB, Chicago z10 29 tiles 1.70 MB, Los Angeles z12 7 tiles 404 KB, Wyoming I-80 z10 2 tiles 128 KB. Below z10 nothing is requested.

## Results

Branch rebased onto origin/main 76da929f (PR #160 merged).

Review-fix round, tested at 4c9f5b15 (Codex findings on PR #163 at 49a12b92). Heavy jobs ran through /home/claude/heavy.sh. Server: PORT=8812 node scripts/serve.js, PID 1126, cwd /home/claude/wt-r10. Chromium 1243 via CHROMIUM_PATH.

| Suite | Result |
|---|---|
| npm test (includes the PHP API harness) | 495 of 495 pass |
| npm run test:python | 404 run, 0 failures, 9 skipped |
| clearances.spec.js, route-clearance.spec.js, routes.spec.js (desktop and mobile) | 25 of 25, run twice, both clean |

Earlier rounds: RI offline copy at 034242a9/3323cde6 (npm test 490 of 490, browser 19 of 19). Rebase at 48a08909 (npm test 486 of 486, test:python 404 with 0 failures). A 76da929f baseline worktree had no failures (npm test 476 of 476, test:python 404, browser 16 of 16), so there are no failures to attribute to main.

During this round: one desktop failure showed a kept popup that would not close. A redraw refreshed the kept popup's content each time, and Leaflet's auto-pan fired moveend and another redraw. Fixed in 4c9f5b15: a kept popup refreshes only when its record, rig height or saved status changes. Two browser test artifacts were also corrected. page.evaluate after going offline was replaced with a Retry click. The RI mock now aborts while offline, because routed requests ignore offline emulation.

Coverage: unit tests cover below, equal and above rig height, each status, empty set, directional and conditional, unit handling, manifest and tile integrity (all 1,059 committed tiles), zoom gating, attribution, visitor-report validation and truncation, road association (no ids, exact nearby ids, distant-only id, parallel road, incomplete ids, road_below, applies_to unknown, barrier nodes at nearby and distant vertices), RI (valid, missing, invalid and tampered pilot) and the RI offline copy (cache name and key, validation on read, saved-snapshot labels including a dropped connection without reload, refresh failure, deadline and cancel). The PHP harness covers clearance-report submission, moderation, the "Apply and publish on map" action, applied-only publication, removal when moved out of applied, and migration gating on isolated SQLite.

## Review findings (Codex, PR #163 at 49a12b92)

| Finding | Fix | Regression test |
|---|---|---|
| HIGH: an OSM id anywhere on the route made a nearby candidate on_route | Association needs the matching way id on a segment within 100 m, or the matching node id at an end vertex of such a segment. A match only farther away stays unresolved (route_way_id_matches_only_on_distant_segment, route_node_id_matches_only_at_distant_vertex). nearest_segment, leg and distance_m come from the matching segment, recorded as segment_basis | tests/route-clearance.test.js: distant match unresolved; nearby match on_route with segment 2 and leg 2 although segment 1 is equally near; adjacent segment without identity unresolved; node id at a distant vertex unresolved and at a nearby vertex on_route |
| MEDIUM: with a popup open, a redraw changed counts but kept old markers, and zoom below 10 left markers | One render step replaces layer, selector and counts together. An open clearance popup stays only while its record is in the new validated result. Its content and style are rebuilt when the record, rig height or saved status changed. Otherwise it is closed. Zoom below 10, an over-budget view and a load failure close the popup and clear everything | tests/browser/clearances.spec.js, desktop and mobile: zoom to 8 with a popup open (popup closed, 0 markers, empty selector, zoom message); change rig height with a popup open (popup kept, verdict and counts updated, selector keeps the record) |
| MEDIUM: RI "Saved snapshot" label lost when the connection dropped without a reload | The saved status lives in the store. The offline event marks the store copy saved. A non-forced read while navigator.onLine is false returns the copy as saved. Reconnecting forces a fresh read | tests/clearances.test.js (same store online then offline; offline event mark; fresh after reconnect); tests/browser/clearances.spec.js, desktop and mobile, one tab online then offline with no reload: control and popup labels, panning keeps the label, reconnect clears it |
| HIGH (second review at 910ce7ff): a node 853 m from its matching vertex was on_route with distance 0 | The node match is measured to the matching vertex itself. It counts only within 100 m, and that distance is reported. The way path already measures to the matching segment, the way's own geometry | tests/route-clearance.test.js: node at 853 m unresolved with no conflict; at 99 m on_route with distance 99; at 101 m (still beside the route) unresolved; way 99 m from its matching segment on_route with distance 99; at 101 m outside the search |
| LOW: truncated visitor reports shown as a complete count | reportsSummary shows "First 200 visitor reports; more are not shown." when the endpoint says truncated, in en, es and fr | tests/clearances.test.js (en, es, fr strings and use of the truncated flag) |
| Moderator wording (approved by Chuck, 2026-11-01 15:11 ET) | For kind=clearance, the applied option in api/admin.php reads "Apply and publish on map". Campsite corrections keep "applied". Publication stays limited to the reviewed structured fields | tests/api.test.js: the label appears for clearance reports only; a report moved from applied to accepted, then to rejected, disappears from api/clearance-reports.php |

## Owner decisions

- RI: the client keeps reading and packaging RI.json while the manifest protects RI (coordinator instruction, 2026-11-01). Rebuilding RI under schema 3 would make RI records comparable and road-associable. That is the open release gate in docs/CLEARANCE_NATIONAL.md.
- Route identity: no candidate can be on_route until the router returns OSM node or way ids (see the contract). Choose the R11 provider path for that.
- Visitor reports: approved by the owner (Chuck, 2026-11-01 15:11 ET). Status applied means published for clearance reports, and the moderator option reads "Apply and publish on map".
- The package adds 44.9 MB of static tiles to the deploy. They are fetched only per view from zoom 10.
