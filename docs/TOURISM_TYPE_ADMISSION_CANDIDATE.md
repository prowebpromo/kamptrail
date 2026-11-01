# Tourism, type and admission candidate

Candidate only. Nothing here is merged, versioned or released. The owner reviews the listing changes first.

Branch `candidate/tourism-type-admission`, from origin/main `afdfb3f9` (live 2.31.0). It changes no rig key (`tents`, `caravans`, `motorhome`, `rig_friendly`), so it can be rebased onto 2.32.0.

Per-record table: `docs/candidates/tourism-type-admission.json` and `.csv`. There are 104 records, one per listing whose outcome a group rule decides. The JSON also holds the blanket-guard measurement, the Venn counts, the proposal and the L182 identity scope.

## The three groups, re-measured

All counts are over the 33,370 published listings. The baseline rebuild reproduces the committed `search-index.json` byte for byte.

### A. Inherited `tourism`

- Cause: `scripts/merge_campsite_data.js` L213 (`...secondary` under `...primary`). It copies `tourism=*` from an absorbed OSM element onto the Recreation.gov host. Only fee, charge, access and amenity keys are guarded (L22-23, L246-249). None of the 4,495 raw Recreation.gov rows carries `tourism`. 703 snapshot rows inherit it, every one from a named member.
- Effect, three rules:
  - `data-quality.js` L105 makes such a row `osm`.
  - L151 then defaults its missing type to `established` (Campground).
  - L30 counts the tag as `osm_campsite_tag` camping evidence, which publishes it (L309).
- 667 published listings carry an inherited tag. For 606 of them nothing visible depends on it.
- Blanket guard (drop inherited `tourism` before classification). The audit numbers are confirmed:
  - 25 listings unpublished.
  - 3 absorbed elements surface under their own ids: `osm:way:368988012` (now an alias of `ridb:234586`), `osm:relation:13942065` (of `ridb:247915`) and `osm:way:941066426` (of `ridb:247835`).
  - 32 type labels shift: 30 Campground to Other, 2 to Dispersed (`ridb:249674`, `ridb:244321`, through the L230 promotion).
  - Not in the audit: 4 aliases detach (`ridb:232604`, `ridb:10007130`, `ridb:232006`, `ridb:234421`) and 5 listings would then rest on the L230 promotion.
  - The 61 listings with a changed outcome are this union.

### B. Borrowed type

- The audit placed this in `data-quality.js` near L223. It is in fact `scripts/merge_campsite_data.js` L223-224: the snapshot merge falls back to `secondary.type`.
- 2 listings:
  - `ridb:10076131` Carr Lake Campsites: own type `other`, lent `established` by `ridb:273356`.
  - `ridb:248261` Potato Hills Central: own type `other`, lent by `ridb:233590`.
- Both stay published on their own evidence (facility name and own description).

### C. Index-level promotion (`data-quality.js` L230)

- 38 listings are published today only because `mergeFeatures` promotes an unverified record when a merged record is a campsite:
  - 26 by a Forest Service record matched on name and distance.
  - 12 by the same facility id (`blm-facility:N` for `ridb:N`, an exact identity).
- 5 more would depend on it under the blanket A guard, which makes 43 in all. The audit's 43 counted both.
- No other C listing's type was copied from the promoter, because host type `other` was already overwritten.

## Overlaps

| Set | Listings |
| --- | ---: |
| A (carries inherited tourism) | 667 |
| A with an outcome change | 61 |
| B | 2 |
| C (38 now + 5 after A guard) | 43 |
| A∩B | 0 |
| B∩C | 0 |
| A∩C | 5 (`ridb:249674`, `ridb:244321`, `ridb:250031`, `ridb:233931`, `ridb:252280`) |
| A∩B∩C | 0 |
| A only / B only / C only | 662 / 2 / 38 |
| A∪B∪C | 707 |
| Records in the table (A outcome ∪ B ∪ C) | 104 |

## Implemented on the branch

1. `data-quality.js` L151-154: the Campground default needs the record's own campsite tag. A Recreation.gov row without its own `osm_id` that inherited `tourism` defaults to `other`, its own type. Admission does not change.
2. `scripts/merge_campsite_data.js` L244-246: a different absorbed record never lends its type. The same record seen twice still fills a missing type.

Result: 45 listings change type, all Campground to Other (43 group A, 2 group B). The list is under `proposal` in the JSON. 11 of the 43 are among the 25 that a blanket guard would unpublish.

Nothing is newly published or unpublished. IDs, coordinates, aliases and legacy_ids, fees, access, access holds (4), admission and the coordinate index are unchanged. Only the MI and OK snapshots change, each one `type` field to `null`.

Not implemented, because the evidence does not settle them (see the open questions):

- The 25 unpublications.
- The 3 surfacings.
- Any change to L230.

## Saved links, aliases and contributions

- Saved stops (`kt_trip` in localStorage) store the listing id and resolve through `getCampsiteById` (`data-loader.js` L553), matching `id` or `legacy_ids`.
- Community reviews and observations are keyed by `community_reviews.campsite_id`. Photos join through `review_id`.
- All 36,290 index ids and aliases resolve to the same listing as before.
- Production `api/community-discovery.php` (read 2026-10-31) reports 0 published reviews. That means 0 published observations and 0 published photos for any id.
- Not checked: pending or rejected reviews, and `api/submit.php` corrections. These need database access. The repo has no local contribution data.
- Type-only changes do not touch identity. A saved stop keeps a stale cached `feature` copy until the listing loads again.

## Identity caveat (data-loader.js L182, not fixed here)

`mergeLoaded` dedupes in the browser without `preferredIds` or `previousHosts`, so the browser can elect a different canonical id than `search-index.json`.

Measured scope across the catalogue:

- All 50 states loaded: 10 listings differ, for example `usfs:26736` shows as `osm:way:244588682` (in MN, not MI).
- Single-state loads: 11 listings differ, and 174 listing-state pairs cannot be found because their host row is in another state.

The 104 records:

- 92 resolve to the same id in the browser.
- 12 multi-state records return no hit when only a non-host state is loaded. Examples: `ridb:234586` when only MO or TX is loaded, where `osm:way:368988012` shows instead. They resolve once the host state loads.
- None differs once its host state is loaded.
- The per-record values are in `identity`.

## Migration plan

1. Review the 45 type relabels in the table.
2. Merge after 2.32.0, rebase, then replay with `node scripts/verify-osm-provenance.js --baseline=<main> --report=<out> --remerge` and `node scripts/build-search-index.js`.
3. Run `node scripts/verify-tourism-type-admission.js --baseline=<main>`. It lists every delta against `proposal` and fails on anything else. It also fails on index bytes that do not rebuild identically, and on any admission, fee, access, hold or saved-link change.
4. Bump the service-worker cache so offline devices drop old snapshots.
5. If the owner later unpublishes any of the 25 or separates a surfaced element, add the old id to the kept listing's `legacy_ids` before publishing.

Determinism: two replays gave identical snapshot digests. The rebuilt `search-index.json` is `52d657cb...e53f`. The verifier output digest is `e64305fa...e12f`.

## Open questions for the owner

1. The 25 listings whose only campsite tag is borrowed: unpublish, keep, or admit on the Recreation.gov record itself? 14 have own type `established`. 3 are lookouts (`ridb:234149`, `ridb:234159`, `ridb:234185`).
2. If any are unpublished, should the 3 absorbed elements publish under their own ids (with the ridb id kept as an alias), or stay absorbed?
3. Is L230 promotion acceptable?
   - 12 cases rest on the same facility id.
   - 26 rest only on a name and 300 m match with a Forest Service record.
   - Should the promoter's type keep overwriting `other`?
4. Should the snapshot merge stop copying `tourism` altogether? This is not done here, to stay clear of the rig-key change.
5. L182: give the browser merge the index's identity hints, as a separate change.

## Tests

See the report on the branch head commit.
