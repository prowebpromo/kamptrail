# Deterministic browser identity (2.33.0)

Branch `fix/deterministic-browser-identity`, from main `358e07e2` (2.31.0). Kept apart from the rig-tag package (`fix/rig-tag-ownership`, 2.32.0) and the tourism admission package (`candidate/tourism-type-admission`).

## Defect

`data-loader.js` merged each new state into the listings already on the map by calling `DataQuality.cleanAndDedupeGeoJSON([...shown, ...incoming], {state})`. The search index build (`scripts/build-search-index.js`) calls the same function once over all 50 states in alphabetical order, with `preferredIds` and `previousHosts` from the published index. The browser had neither, and its input order was the order in which states finished loading. So the browser could pick a different canonical host than `search-index.json`, and the result changed with load order. Live on 2.31.0 (39 states loaded at once) 10 of 32,229 listings showed under a different id. Examples: `usfs:26736` showed as `osm:way:244588682`, `usfs:5901` as `osm:node:3759671902`, `usfs:9461` as `osm:relation:19325196`. A second run elected Cosby Campground as `ridb:232479` (index `osm:way:1107154601`) and dropped the OSM element's own toilet tag.

## Acceptance criterion

1. After any set of states has loaded, in any order, with any response timing, from network or cache, each listing whose states have all loaded matches its `search-index.json` row: same canonical id, same source-id set (id plus `legacy_ids`), and the same popup claims and filter inputs (fee status, type, amenity filter sets `a` and `s`, rig types, road difficulty, open status, rating, RV signatures). `scripts/check-browser-identity.js` measures this over the whole catalogue. The target is zero differences in every scenario.
2. The result for a set of loaded states does not depend on the order they loaded in. A listing with only some of its states loaded may show a member's own published id. That id is a published alias and resolves to the same listing.
3. If the host file is unavailable (404, timeout, invalid content, and nothing valid in cache), the browser makes no merge the index would not make and no host election that depends on load order. It never moves or demotes an id already shown. Records join only by their own id when the same record appears in two state files. Nearby records of one place can show as separate markers, which is accepted. The file is retried every 30 s, on reconnect and on each state load. When it arrives the catalogue is rebuilt once and converges to the index. Every id shown or stored in the meantime is one of its listing's published ids and keeps resolving to it.
4. Every id ever published, canonical or legacy, resolves to the same listing: saved stops in `localStorage` (`kt_trip`), `#site=` share links, review and correction links, and reviews and contributions keyed by `campsite_id`. Resolution never rewrites a stored id.
5. No change to `search-index.json`, listing ids, coordinates, fees, access, amenities or rig data.

## Measured before the fix (2.31.0 code, current data)

Script: `node scripts/check-browser-identity.js` (runs the real `data-loader.js` in a VM, one state per load call). Pairs scenario: for each of the 127 distinct state sets of multi-state listings, load those states one at a time in both orders and check only those listings.

| Scenario | 2.31.0 canonical id differs | source-id set differs | claims differ | missing | 2.33.0 (all columns) |
|---|---|---|---|---|---|
| (a) all 50 states, default order | 10 | 0 | 0 | 0 | 0 |
| (b) reversed order | 178 | 0 | 6 | 2 | 0 |
| random order, seed 1 | 142 | 0 | 3 | 2 | 0 |
| random order, seed 2 | 62 | 0 | 3 | 2 | 0 |
| random order, seed 3 | 141 | 0 | 6 | 2 | 0 |
| (c) each multi-state listing's states one at a time, both orders (127 state sets, 254 runs, 18,676 listing checks) | 174 | 0 | 6 | 0 | 0 |

### Host file failure on a first visit (`node scripts/check-browser-identity.js --scenarios fail:<mode>:<order>`)

All 50 states load one at a time while `identity-hosts.json` fails. After every load the check counts wrong merges (a listing that holds records of two index listings) and flips (an id shown as a listing id that later stops being one). Then the file is served, the browser retries and reconciles, and the result is compared with the index.

| Scenario | 2.31.0 wrong merges | 2.31.0 flips | 2.33.0 wrong merges | 2.33.0 flips | 2.33.0 duplicate markers during fallback | 2.33.0 after reconcile (shown ids resolving elsewhere / any index difference) |
|---|---|---|---|---|---|---|
| 404, default order | 0 | 0 | 0 | 0 | 2,490 | 0 / 0 |
| 404, reversed | 2 | 0 | 0 | 0 | 2,490 | 0 / 0 |
| 404, random seed 1 | 2 | 0 | 0 | 0 | 2,490 | 0 / 0 |
| timeout, random seed 2 | not run | | 0 | 0 | 2,490 | 0 / 0 |
| corrupt JSON, random seed 3 | not run | | 0 | 0 | 2,490 | 0 / 0 |

2.31.0 has no host file, so its default-order row is its normal behavior, and timeout and corrupt behave like 404 there. Its wrong merges were `usfs:65184` (Bird Creek, NV) folded into `ridb:234209`/`osm:way:1236741631`, and `usfs:45432` folded into `ridb:232821`/`osm:way:352429507`. In the 2.33.0 fallback the same 2,490 index listings (the multi-record listings whose records sit within merge range) show as two or more markers. That is the accepted cost of never guessing. All 35,959 ids shown during the fallback are published ids, and after reconcile each one resolves to its index listing. Raw: `docs/identity/before-2.31.0-host-file-failure.json`, `docs/identity/after-2.33.0-host-file-failure.json`.

Catalogue: 33,370 listings. A "canonical id differs" listing shows under a different id than its index row, and the source-id check is skipped for it. In all 38 recorded examples (up to five per scenario) the shown id is one of that row's own `legacy_ids`, so only the host changed. "Claims differ" means fee status, type or open status differed (for example `ridb:10150488` showed type `other`, index `established`), caused by the other host's own fields. "Missing" means the index listing had no browser listing at all (`usfs:65184`, `usfs:45432`). Raw results: `docs/identity/before-2.31.0.json`, `docs/identity/after-2.33.0.json`.

## Approach

- `data/campsites/identity-hosts.json`: each canonical id of a multi-record listing mapped to its legacy ids, derived from `search-index.json` (2,747 listings, 2,920 aliases). It is 99,035 bytes raw, 23,062 gzip, 15,911 brotli. The full search index is 8.78 MB raw and 1.88 MB gzip, and it stays lazy. The host file loads in parallel with the other small metadata before any state. It holds no listing data, only ids. Single-record listings never merge, so they need no entry. `scripts/build-search-index.js` writes it beside the index, `scripts/build-identity-hosts.js` regenerates it alone, and a unit test fails if it falls out of step with the committed index.
- `data-loader.js` keeps each loaded state's normalized records and rebuilds the catalogue on every load. It uses the index build's order (states alphabetically, records in file order), the index's `preferredIds` and `previousHosts`, and attaches sidecar evidence before deduplication as the build does. A late sidecar triggers a rebuild. Per-state load time on a 10-state western run rose 3 to 13 percent over 2.31.0 (WY: 6.6 s to 7.1 s in Node on this host). The rebuild is the same function the old merge already ran over everything loaded so far.
- Fallback without the host file: `radiusMeters:-1` is passed to `cleanAndDedupeGeoJSON`, so no proximity match is possible and only same-id records join. The shared function is not changed, so the index build output cannot change.
- Ids are never rewritten. `getCampsiteById` finds a listing by any published id, including while only some of its states are loaded. Saved stops keep their stored id and only refresh the location snapshot. New stops, share links, correction reports, review submissions and permission reports use `KampTrailData.publishedId` (the index id). The review API reads published reviews by every published id of a listing (`kc_site_ids`), and `KampTrailDiscovery.summary` does the same on the client. Stored `campsite_id` values are not changed.
- No change to `search-index.json` or to any listing id, coordinate, fee, access, amenity or rig value.

## Stored references and what was not inspected

Ids stored anywhere are kept as stored. Nothing in this package rewrites or migrates a stored id. Zero published reviews does not show that pending submissions or other references are absent, so no reference is assumed absent.

Inspected in code and covered by tests:
- Saved stops (`localStorage` `kt_trip`): the stored id is kept and the stop resolves through `getCampsiteById`. 2.31.0 rewrote it to whichever id the browser showed; that rewrite is removed (`trip-planner.js` `getSite`).
- Share links `#site=`: any published id opens the listing; new links carry the index id.
- Reviews (`community_reviews.campsite_id`, any status): stored id kept. Published reads cover every published id of the listing (`kc_site_ids`, community test). New reviews send the index id.
- Corrections (`submissions.campsite_id`) and GitHub correction links: new ones send the index id; stored rows are untouched.
- Permission reports (`permission_reports.place_key/place_id`): new ones send the index id. The server checks place ids against `api/_data/permissions`, which `scripts/build-permissions.js` builds from index canonical ids only, so 2.31.0 browsers that showed a legacy id could not have stored one there.
- Camper discovery summaries: matched through every published id of a listing.

Not inspected (no access from this branch):
- The production MySQL database: pending, rejected and hidden reviews, `submissions` rows, permission reports and their audit rows, and their `campsite_id`/`place_id` values. How many are keyed to a legacy or browser-only id is unknown. The read path above covers published reviews under any published id. Moderator views (`api/admin.php`) show the stored id as stored.
- Saved stops and saved permission-report codes in visitors' browsers.
- Share links already sent, and links in GitHub issues.
- Ids that browsers showed on 2.31.0 or earlier but that were never in a published index. A listing can only show an id its own records carry, and every record id is canonical or legacy in the current index, so such ids resolve for the current catalogue. Ids from listings removed from the catalogue since are not covered by this package.
- Other agents' branches (`fix/rig-tag-ownership`, `candidate/tourism-type-admission`). If either changes which records publish, `identity-hosts.json` must be rebuilt with the index (the index build writes it, and a unit test fails when they differ).

## Tests (HEAD of this branch)

- `npm test`: 461/461 pass, including `tests/deterministic-identity.test.js` (index election for the measured cases in both orders, Cosby's own toilet evidence, delayed and parallel loads, fallback, alias resolution, late sidecars) and a community API test showing a review stored under `ridb:232479` is found through `osm:way:1107154601`, stored id unchanged.
- `npm run test:python`: pass.
- Browser (`CHROMIUM_PATH` set to the installed Chromium): `tests/browser/identity.spec.js` passes 4/4 (the fourth: a 404 host file on a first visit, with wrong-merge and flip checks after each of 4 states, a saved stop and a correction keeping their ids, and convergence after the file arrives). It covers 4 loading orders and 2 delayed-response runs on real NC, TN, CA and NV data; every loaded listing's id and source-id set is checked against the index, along with popup claims and amenity and rig filter outcomes for the measured cases; a second offline visit served by the service worker cache, in the other order; and saved stops, share links, a review summary and a correction submitted through a legacy id. Across 16 related specs, 92 passed. After the fallback change: 8 specs including the new host-file-failure spec, 50 passed. The one other failure is the known `app.spec.js` mobile map height (493 vs >500).
- `npm run build`: passes. `search-index.json` and `coordinate-index.json` are byte-identical to main, and the release contains `identity-hosts.json`.

## Live acceptance (November 1, 2026)

Result: **passed with no exceptions.** Checked on kamptrail.com against merge `16fcc1bb` (PR #153), search index `7f0d331a` (unchanged from 2.31.0). Every scenario compares all 33,370 index listings with the browser by canonical id and sorted source-id set. Scripts: `scripts/acceptance/live-2.33.0-identity-check.js` and `scripts/acceptance/live-2.33.0-saved-stops-check.js`. Raw output: `docs/acceptance/2.33.0-live-output.txt`.

| Scenario | Differences from index | Wrong merges |
|---|---|---|
| Desktop, all states reversed, one at a time | 0 | 0 |
| Desktop, random order (seed 7) | 0 | 0 |
| Desktop, TX delayed 4 s, all states in one batch | 0 | 0 |
| Mobile (390x844), random order (seed 424242) | 0 | 0 |
| identity-hosts.json returns 404, desktop and mobile | 0 after the file loads | 0 |

During the 404 fallback, 2,490 listings showed duplicate markers by design and 26 showed under another of their own ids. All 35,959 ids shown during the fallback opened the correct listing after the file loaded.

A saved stop stored as `ridb:232479` kept that stored id across reloads in both NC>TN and TN>NC order and opened Cosby Campground (`osm:way:1107154601`) every time. A cached offline second visit with the service worker on, in reversed order, gave the same identity and the same toilet evidence as online.

This closes the identity exception recorded for 2.31.0 (`docs/AMENITY_OWNERSHIP_2.31.0.md`).

Before merge, a separate agent reviewed commit 1fa0a252 from a fresh checkout with its own whole-catalogue script and recommended merge. The merged head e8b6d4fd differs from it only by raising the CI job limit from 15 to 25 minutes.

# Partial-load identity (2.35.0)

Branch `fix/partial-load-identity`, from main `041ff76c` (2.34.0, service-worker cache `kt-v67`). Release 2.35.0, cache `kt-v68`.

## Defect

Live on 2.34.0 with `identity-hosts.json` present. Bird Creek Campground has two separately published index listings about 400 m apart: `usfs:65184` (NV only, no legacy ids) and `osm:way:1236741631` (CA and NV, legacy `ridb:234209`). With only NV loaded the browser showed one listing `ridb:234209` with legacy ids `[ridb:234209, usfs:65184]`, and `getCampsiteById` returned it for both `usfs:65184` and `osm:way:1236741631`. After CA also loaded, in either order, both resolved correctly.

Cause: the proximity same-name match in `cleanAndDedupeGeoJSON` prefers a candidate that is the record's published host, but when that host has not loaded it falls back to the first same-name candidate in range (`first`), which can belong to another index owner. 2.33.0 acceptance compared only listings whose states had all loaded, so it never looked at this checkpoint. A visitor near Ely, NV may never load CA.

## Acceptance criterion

With the host file present, at every loading checkpoint (after each state load, any set of states, any order):

1. No wrong merge: no browser listing holds ids (id plus `legacy_ids`) of more than one index owner, and every id it holds is published.
2. No wrong resolution: every published id of a listing with at least one loaded state either resolves to nothing (its record is not loaded yet) or resolves to a listing whose ids all belong to its own index owner.
3. Every published id of a listing whose states have all loaded resolves.
4. A record whose index host has not loaded stays its own marker, or joins only records of its own index owner. It never borrows another owner.
5. 2.33.0 criteria still hold: full-load census equals the index in any order, and the host-file failure fallback makes no wrong merge and converges after retry.
6. Stored ids are not rewritten. `search-index.json`, `coordinate-index.json`, `identity-hosts.json` and all listing data stay byte-identical to main.

Measured by `scripts/check-partial-identity.js` in Chromium against the real app served from the branch worktree, with the host file served. Scope: each of the 50 states loaded alone, and each of the 102 state pairs that share a multi-state listing, in both orders (204 runs, 408 checkpoints).

## Measured before and after (Chromium, host file served)

Server: `PORT=8797 node scripts/serve.js` started from this worktree (process cwd checked with `readlink /proc/<pid>/cwd`). Browser: Chrome for Testing 153 via Playwright. A checkpoint is one state load. Raw: `docs/identity/before-2.34.0-partial-load.json` and `docs/identity/after-2.35.0-partial-*.json`.

| Scenario | Checkpoints | 2.34.0 checkpoints with a wrong merge | 2.34.0 wrong merges / wrong resolutions (sum) | 2.35.0 wrong merges / wrong resolutions / unresolved |
|---|---|---|---|---|
| Each of 50 states alone | 50 | 1 (NV) | 1 / 3 | 0 / 0 / 0 |
| 102 state pairs sharing a multi-state listing, both orders (204 runs) | 408 | 10 (every checkpoint with NV loaded and CA not: NV>AZ, NV>OR and NV>UT after each state, AZ>NV, OR>NV, UT>NV and NV>CA after NV) | 10 / 30 | 0 / 0 / 0 |

The only defect found on 2.34.0 was Bird Creek: one listing `ridb:234209` holding `usfs:65184`, with `usfs:65184`, `osm:way:1236741631` and `ridb:234209` all resolving to it. No other pair of index owners merged at any checkpoint.

### Bird Creek at the previously failing checkpoint (`node scripts/check-bird-creek-checkpoints.js`)

Run on 2026-11-01 in Chrome 153.0.8010.12, service workers blocked, `/api/**` answered 404, host file served. 2.34.0 from a 76da929f checkout on port 8821 (UTC 18:25:40 to 18:25:53). 2.35.0 from this branch on port 8822 (UTC 18:25:54 to 18:26:06). Each server's cwd was checked. Raw: `docs/identity/bird-creek-checkpoints-2.34.0.json`, `docs/identity/bird-creek-checkpoints-2.35.0.json`.

Expected, from `search-index.json`: two listings. `usfs:65184` (NV, ids `usfs:65184`) and `osm:way:1236741631` (CA and NV, ids `osm:way:1236741631`, `ridb:234209`). The `ridb:234209` record is in the NV file, and the `osm:way:1236741631` record is in the CA file.

| Version | Order | Checkpoint | Bird Creek listings in the browser (id: id set) | `usfs:65184` resolves to | `osm:way:1236741631` resolves to | `ridb:234209` resolves to | Result |
|---|---|---|---|---|---|---|---|
| 2.34.0 | NV>CA | after NV | `ridb:234209`: `ridb:234209`, `usfs:65184` | `ridb:234209` (wrong listing) | `ridb:234209` (merged with `usfs:65184`) | `ridb:234209` (merged with `usfs:65184`) | FAIL, 1 wrong merge, 3 wrong resolutions |
| 2.34.0 | NV>CA | after CA | `osm:way:1236741631`: `osm:way:1236741631`, `ridb:234209`. `usfs:65184`: `usfs:65184` | `usfs:65184` | `osm:way:1236741631` | `osm:way:1236741631` | PASS |
| 2.35.0 | NV>CA | after NV | `ridb:234209`: `ridb:234209`. `usfs:65184`: `usfs:65184` | `usfs:65184` | `ridb:234209` (own listing, CA host not yet loaded) | `ridb:234209` | PASS, no merge across listings |
| 2.35.0 | NV>CA | after CA | `osm:way:1236741631`: `osm:way:1236741631`, `ridb:234209`. `usfs:65184`: `usfs:65184` | `usfs:65184` | `osm:way:1236741631` | `osm:way:1236741631` | PASS, matches the index |
| both | CA>NV | after CA | `osm:way:1236741631`: `osm:way:1236741631` | not loaded (NV) | `osm:way:1236741631` | `osm:way:1236741631` | PASS, partial id set until NV loads |
| both | CA>NV | after NV | as after NV>CA | `usfs:65184` | `osm:way:1236741631` | `osm:way:1236741631` | PASS, matches the index |

Rule applied at every checkpoint: a published id may resolve only to a browser listing whose ids all belong to that id's index listing, and no browser listing may mix two index listings. A listing whose states have not all loaded may still show under a member id (`ridb:234209` before CA) or with a partial id set. That is recorded, not counted as a failure. Once all its states have loaded, the canonical id and full id set must match the index.

2.35.0 full-load census against `search-index.json` (all 33,370 listings, with every checkpoint along the way checked as above):

| Order | Checkpoints with a wrong merge or resolution | Differences from the index (missing, split, canonical id, source-id set) |
|---|---|---|
| Default | 0 of 50 | 0 |
| Reversed | 0 of 50 | 0 |
| Random, seed 1 | 0 of 50 | 0 |
| Random, seed 2 | 0 of 50 | 0 |
| Host file 404 during all 50 loads (seed 3), then served and retried | 0 wrong merges, 0 wrong resolutions during the fallback | after retry: hosts `published`, 0 wrong merges, 0 wrong resolutions, 0 unresolved of 36,290 ids, 0 differences from the index |

## Fix

`cleanAndDedupeGeoJSON` takes a new option, `ownerOnly`. When it is set and `previousHosts` is present, a proximity same-name candidate is skipped unless both records have the same index owner (the record's published host, else its own id). A record whose host has not loaded therefore stays its own marker, or joins only its own owner's records. Same-id joins (one record in two state files) are unchanged. `data-loader.js` sets `ownerOnly` only on the options built from a valid `identity-hosts.json`. The index build (`scripts/build-search-index.js`) does not set it, so the build output cannot change. The fallback without the host file still passes `radiusMeters:-1` and is unchanged.

At full load the result equals 2.33.0: every multi-record listing in the index is formed from records that all share one owner, and the index's own election (preferred ids, previous hosts) still picks the host among them.

No stored id is rewritten. `search-index.json`, `coordinate-index.json`, `identity-hosts.json` and every listing file are byte-identical to main `041ff76c`.

## Tests (2.35.0)

- At the PR head after rebasing onto main 76da929f: `npm test` 478/478, `npm run test:python` 404 run, OK, 9 skipped.
- Before the rebase, `npm test`: 471 tests. The new `tests/deterministic-identity.test.js` cases cover the general rule (synthetic same-name records of two owners, the host arriving in either input order, same-id joins, and the index-build path still merging without `ownerOnly`) and Bird Creek on real NV and CA data in both orders, with every listing holding one index owner after each load. A first full run found two errors of my own (a version string and a fixture name), both fixed. Rerunning the two files afterwards passed 13/13.
- `npm run test:python`: pass.
- Browser, on the 8797 worktree server (`identity`, `saved-stops`, `features`, `discovery`, `amenity-evidence`, `rig-profile`, `rest-areas`, `app`): 57 passed, 1 failed. The failure is the known `app.spec.js` mobile map height (493 vs >500). `identity.spec.js` includes the two new partial-load tests, NV before CA and CA before NV.
- `npm run build`: passes. The release has `identity-hosts.json`, cache `kt-v68` and version 2.35.0. `search-index.json`, `coordinate-index.json` and `identity-hosts.json` hashes equal main's.
