# Deterministic browser identity (2.33.0)

Branch `fix/deterministic-browser-identity`, from main `358e07e2` (2.31.0). Kept apart from the rig-tag package (`fix/rig-tag-ownership`, 2.32.0) and the tourism admission package (`candidate/tourism-type-admission`).

## Defect

`data-loader.js` merged each new state into the listings already on the map by calling `DataQuality.cleanAndDedupeGeoJSON([...shown, ...incoming], {state})`. The search index build (`scripts/build-search-index.js`) calls the same function once over all 50 states in alphabetical order, with `preferredIds` and `previousHosts` from the published index. The browser had neither, and its input order was the order in which states finished loading. So the browser could pick a different canonical host than `search-index.json`, and the result changed with load order. Live on 2.31.0 (39 states loaded at once) 10 of 32,229 listings showed under a different id. Examples: `usfs:26736` showed as `osm:way:244588682`, `usfs:5901` as `osm:node:3759671902`, `usfs:9461` as `osm:relation:19325196`. A second run elected Cosby Campground as `ridb:232479` (index `osm:way:1107154601`) and dropped the OSM element's own toilet tag.

## Acceptance criterion

1. After any set of states has loaded, in any order, with any response timing, from network or cache, each listing whose states have all loaded matches its `search-index.json` row: same canonical id, same source-id set (id plus `legacy_ids`), and the same popup claims and filter inputs (fee status, type, amenity filter sets `a` and `s`, rig types, road difficulty, open status, rating, RV signatures). `scripts/check-browser-identity.js` measures this over the whole catalogue. The target is zero differences in every scenario.
2. The result for a set of loaded states does not depend on the order they loaded in. A listing with only some of its states loaded may show a member's own published id. That id is a published alias and resolves to the same listing.
3. If the host data cannot be fetched (network and cache both fail), the browser uses the index build's fixed input order (states sorted alphabetically, records in file order) and never moves an id it has already shown in the session to another listing or demotes it to an alias. These two goals conflict for a listing first shown before its other states load: no-flip wins, so in this fallback only, such a listing can keep a member's id. That id is published and resolves to the same listing. The host file is fetched before any state and cached with the state files, so the fallback needs a first visit where it alone fails.
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
| random order, seed 3 | not run on 2.31.0 | | | | 0 |
| (c) each multi-state listing's states one at a time, both orders (127 state sets, 254 runs, 18,676 listing checks) | 174 | 0 | 6 | 0 | 0 |

Catalogue: 33,370 listings. A "canonical id differs" listing shows under a published alias of its index listing. In every one of those cases the shown id is also in its index row's `legacy_ids`, so the source-id set as a set was the same and only the host changed. "Claims differ" means fee status, type or open status differed (for example `ridb:10150488` showed type `other`, index `established`), caused by the other host's own fields. "Missing" means the index listing had no browser listing at all (`usfs:65184`, `usfs:45432`). Raw results: `docs/identity/before-2.31.0.json`, `docs/identity/after-2.33.0.json`.

## Approach

- `data/campsites/identity-hosts.json`: each canonical id of a multi-record listing mapped to its legacy ids, derived from `search-index.json` (2,747 listings, 2,920 aliases). It is 99,035 bytes raw, 23,062 gzip, 15,911 brotli. The full search index is 8.78 MB raw and 1.88 MB gzip, and it stays lazy. The host file loads in parallel with the other small metadata before any state. It holds no listing data, only ids. Single-record listings never merge, so they need no entry. `scripts/build-search-index.js` writes it beside the index, `scripts/build-identity-hosts.js` regenerates it alone, and a unit test fails if it falls out of step with the committed index.
- `data-loader.js` keeps each loaded state's normalized records and rebuilds the catalogue on every load. It uses the index build's order (states alphabetically, records in file order), the index's `preferredIds` and `previousHosts`, and attaches sidecar evidence before deduplication as the build does. A late sidecar triggers a rebuild. Per-state load time on a 10-state western run rose 3 to 13 percent over 2.31.0 (WY: 6.6 s to 7.1 s in Node on this host). The rebuild is the same function the old merge already ran over everything loaded so far.
- Fallback when the host file fails validation or cannot be fetched or read from cache: see criterion 3.
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
