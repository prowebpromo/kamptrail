# KampTrail handoff to Codex (November 1, 2026)

From Claude to Codex. Codex continues the work and cross-checks Claude's recent releases. Codex hands back to Claude to finalize, using the return report at the end of this file.

Owner: Chuck Price. Repo: `prowebpromo/kamptrail`. Live site: kamptrail.com (Hostinger, deployed by `.github/workflows/publish-hostinger.yml` on every push to main).

## 1. Current state

| Item | Value |
|---|---|
| main | `a8785f98` (PR #155, release records) |
| Live release | 2.34.0, merge `9c930466` (PR #154), cache `kt-v67` |
| Live search index sha256 | `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a` (33,370 listings) |
| Parity score | 91.7/100, unchanged. Change it only when deployed evidence completes an approved contract in `docs/replica/COMPLETION_CONTRACTS.md` |

Released and verified live since October 31 (records in each doc's "Live acceptance" section):

| Release | PR | What | Record |
|---|---|---|---|
| 2.31.0 | #150 | Amenity ownership. Popup and filters share attributed evidence | `docs/AMENITY_OWNERSHIP_2.31.0.md`. Passed with a documented identity exception: 401 of 404 fixture listings exact |
| data only | #151 | National clearance builder fix. Data stays out of the client | `docs/CLEARANCE_NATIONAL.md`, `docs/CLEARANCE_NATIONAL_REVIEW.md` |
| 2.33.0 | #153 | Deterministic browser identity. Browser elects the index's canonical host in every load order; stored ids never rewritten | `docs/DETERMINISTIC_IDENTITY.md`. 0 differences in every tested order. Closes the 2.31.0 exception |
| 2.34.0 | #154 | Rig suitability (tents, caravans, motorhome) from each listing's own source | `docs/RIG_TAG_OWNERSHIP_2.34.0.md`. 245/245 listings match on desktop and mobile, forward and reversed |

Acceptance scripts and raw outputs: `scripts/acceptance/` and `docs/acceptance/`.

## 2. Owner rules (standing, do not relax)

Release gate
- Merge only after CI passes on the exact PR head SHA. Pass that SHA to the merge call.
- After each deploy, run live acceptance on desktop and mobile against kamptrail.com and record it in the release doc before calling the release done. Report partial results as partial (for example "401 of 404"), never as a pass.
- One release at a time. Wait for the Hostinger publish and confirm `release.json` shows the merge SHA before the next merge.
- No rollback or restart without evidence that requires it.

Data and evidence policy
- Evidence from a different OSM element never classifies a listing. Agency or Recreation.gov evidence about the listing's own record may, with attribution.
- Absorbed elements' values (fee, access, amenities, rig keys, tourism) stay as attributed member evidence. They are never assigned to the retained listing.
- Borrowed restrictive access stays a held exclusion until reviewed. Never newly publish a record because borrowed evidence was removed.
- A name match within 300 m is candidate-matching evidence only. It never classifies or publishes another record.
- Keep explicit negatives, conflicts and unknowns visible. Never infer suitability from another merged element.
- Policies must hold at every layer: the snapshot merge (`scripts/merge_campsite_data.js`) and the index and browser merge (`data-quality.js` `normalizeFeature`, `mergeFeatures`, `cleanAndDedupeGeoJSON`).
- National clearance data stays out of the production package and client until the revised builder, schema and client pass together. Confirm with the built package, not a hidden layer.

Identity
- Any id ever published (canonical or legacy) must keep resolving. Never rewrite a stored id (saved stops, trip planner, share links, reviews, corrections, permission reports).
- Use the same canonical-host rules in the browser and the index (`data/campsites/identity-hosts.json`, built by the index build; a test fails if they drift).
- Zero published reviews does not prove pending submissions or other references are absent. State what you could not inspect.

Working method
- Measure before claiming. Separate verified fact from inference and unknowns. Never imply verification you did not perform.
- Have work that touches production data checked by a reviewer that did not build it.
- Push checkpoints before every memory-heavy job and after each completed change. Confirm the remote has your commit before a risky job.

## 3. Open work, in priority order

### 3.1 Cross-check Claude's recent releases (start here)
Re-verify independently, with your own scripts, not the committed acceptance scripts:
1. 2.34.0 live: the 237 changed listings differ from 2.33.0 only in the index rig field `m.r`; all ids, count and other fields unchanged; Tents 5,963 to 5,783 and Trailers 2,989 to 2,848 on the live map.
2. 2.33.0 live: browser canonical id and source-id set equal the index for all 33,370 listings in at least two load orders, including reversed; `identity-hosts.json` 404 gives 0 wrong merges and converges after it loads.
3. Clearances: the production package (`node scripts/build-release.js`, output in `dist/kamptrail`) contains only `data/clearances/RI.json` under `data/clearances`; no client file references national tiles or the v3 schema; live `data/clearances/index.json` returns 404.
4. Report any disagreement with a listing id and evidence. Do not fix a released package silently.

### 3.2 Tourism, type and admission candidate (NOT approved, do not merge)
Branch `candidate/tourism-type-admission`, head `c109f339`. Doc: `docs/TOURISM_TYPE_ADMISSION_CANDIDATE.md`. Ledger: `docs/candidates/tourism-type-admission.json` and `.csv` (734 records). Verifier: `scripts/verify-tourism-type-admission.js`.

What it proposes: stop copying `tourism` and type from absorbed elements at both layers; 33,370 to 33,339 listings (31 withdrawn from discovery with a legacy page); a new "Lookout, cabin or other lodging" type for 10 listings; L230 promotion limited to verified identity; website-link identity only when the link names the host's own facility id (44 of 51 hosts).

Claude's review finding (owner has not ruled):
- It also upgrades 78 listings from Other (64 to Campground, 14 to Dispersed). 51 rest only on the first sentence of the Recreation.gov description, overriding a facility type that was not campground. About 10 of the 51 are areas that only mention campgrounds, for example `ridb:243747` Francis Marion National Forest, `ridb:249589` Lakewood - Laona District, `ridb:270862` Slim Buttes Land Unit, `ridb:237173` Tobacco Area, `ridb:10074565` East Fork Recreation Area, `ridb:264659` Tahkenitch Area, `ridb:257101` Silver Reef Trail and Red Cliffs Dinosaur Tracksite.
- Claude's recommendation: description wording never upgrades a type. Upgrades need the listing's own name (23 cases) or structured type plus its own campsite records. The 51 keep their current label and go on a review list.
- The branch predates 2.33.0 and 2.34.0. It needs a rebase onto main, a rebuild, its verifier, a load-order check, and a new version number above 2.34.0 before any release.

### 3.3 Owner decisions pending (ask Chuck; do not decide)
1. Count an absorbed OSM element's website link to the same Recreation.gov facility id as exact identity? In 2.34.0, 18 such Recreation.gov listings are treated as members and lose Tents 18, Trailers 15, RV 2.
2. Tourism candidate: approve the 31 withdrawals with legacy pages, the lodging type for 10 listings, and the website identity rule. Accept or reject the restriction on the 51 description-only upgrades.
3. Approve a follow-up package that stores Recreation.gov's raw `FacilityTypeDescription` and its `LastUpdatedDate` per facility. Today `scripts/fetch_recreation_gov_data.py` (around L114-122) maps the type and drops the raw value, so agency classification cannot be cited with field, value and source date.

### 3.4 Scheduled and dated items
- 2026-11-02, 3:00 to 3:20 pm Eastern: physical-phone offline acceptance. Needs Chuck's phone.
- 2026-11-03: first scheduled run of `refresh-national-clearances.yml` against the fixed builder. Check the run. Guards keep prior data on fetch failure, sharp shrink or a mostly failed run. RI is protected and never downloaded. Confirm an unchanged rerun commits nothing and nothing reaches the client.
- 2026-11-23: USFS fee-recheck backstop (existing task).
- 2026-11-29: reviewed fee overrides from 2.11.1 need rechecking (`docs/FREE_CAMPING_REVIEW_2026-10-30.md`).

### 3.5 Known issues and follow-ups
- Flaky browser test: `tests/browser/rest-areas.spec.js:68` (INDOT facility popup). It failed once on the publish of `358e07e2` because the popup still showed a Texas rest area from the previous view, then passed on rerun with no code change. Make it wait for the Indiana popup; do not loosen its assertions.
- Playwright server reuse: `playwright.config.js` reuses any server already on 127.0.0.1:8765. With several checkouts, a stray server serves the wrong code. Before a browser run, confirm the server's working directory, or set `BASE_URL` to your own server on a free port. Consider `reuseExistingServer: !process.env.CI` plus a port override.
- CI time: the test job limit was raised from 15 to 25 minutes in 2.33.0 (main's run had reached 15:03). The browser suite takes about 10 minutes.
- Performance: 2.33.0 rebuilds the loaded catalogue on each state load, 3 to 13% slower per state than 2.31.0 (package measurement). Not compared on a real phone yet.
- Identity fallback: without the host file, 2,490 listings show duplicate markers until it loads. Accepted by design; it retries every 30 s, on reconnect and on each state load.
- Clearance client (later package): city views at zoom 8 are still large (New York 7.8 MB). Do not draw candidates below about zoom 10. Route semantics are in `docs/CLEARANCE_NATIONAL.md` (a comparable record never proves a route clear; clearance equal to rig height is never clear). `applies_to` is unknown for barrier nodes.
- Provenance debt: inherited `operator` (374) and `website` (325). A test guards client reads (`tests/rig-ownership.test.js`). Not moved to member evidence yet.
- Open PRs not touched in this session: #77 (FCC downloads), #80 (FreeRoam parity audit).

## 4. Useful commands

```bash
npm test
npm run test:python
npx playwright test tests/browser/<spec>.js      # check which server answers on 8765 first
node scripts/build-release.js                     # production package in dist/kamptrail
node scripts/verify-osm-provenance.js --remerge   # replay merges from retained inputs
curl -s https://kamptrail.com/release.json        # deployed source commit
```

The GitHub GraphQL API is not available from some sandboxes; use the REST API (`gh api repos/prowebpromo/kamptrail/...`).

## 5. Return report to Claude

When handing back, give:
1. The main SHA, live release and live search-index sha256 at hand-back.
2. Each PR merged: number, exact head SHA that passed CI, merge SHA, and the live acceptance result with its record location.
3. Cross-check results from 3.1, including any disagreement with ids and evidence.
4. Branches pushed but not merged, with head SHAs and status.
5. Owner decisions received, quoted, with date.
6. Anything you could not verify, and why.
7. Score, and the evidence for any change.
