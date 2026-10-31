# Amenity ownership repair (2.31.0)

Release 2.31.0 repairs R8 amenity ownership. The audit that found the defect is `docs/AMENITY_COVERAGE_AUDIT.md`.

## Acceptance criterion

Approved by the owner. Recorded before any code change. It must not be weakened.

1. Protect amenity ownership at two points: snapshot merging (`scripts/merge_campsite_data.js`; the audit found only fee, charge and access are guarded at L17-18 and L207-251) and index-level reconciliation (`data-quality.js` `normalizeFeature` and `mergeFeatures`, around L80, L132-139 and L204-205). Other elements' observations are kept as attributed member evidence (element id, source, dates) and are never silently assigned to the retained record.
2. Rebuild every affected state snapshot, the national index and the relevant filter metadata from the unchanged retained inputs. Keep the original source dates. Do not combine this repair with identity splits, new admissions or source refreshes. Use the repo's own replay tooling (`scripts/verify-osm-provenance.js --remerge`).
3. Verify that the following stay byte-for-byte unchanged for every listing: listing IDs, coordinates, aliases and legacy_ids, memberships, fees, access classifications and saved-place compatibility. A script diffs before and after and reports every intended amenity change and any unexpected delta, with an unexpected delta failing the check. Rebuild twice and prove the output is deterministic with identical hashes.
4. Make the popup and the filters agree. Replace the unsourced "Amenities reported:" line (`data-loader.js` about L355) with evidence that shows source, scope and date.
   - Keep scope. Recreation.gov campsite records and Forest Service statements stay scoped. One site having toilets does not mean every site does.
   - Amenities from different sites must never combine into a fictional campsite that satisfies both a rig-fit filter and an amenity filter.
   - When filtering, a campground matches an amenity filter only on evidence the popup would show for that campground, at the scope stated.
   - When rig-fit and amenity filters both apply to campsite-level records, they must match within the same campsite record.
   - Explicit negatives, contradictions and unknowns stay visible.
   - A missing date reads "date unknown". Never substitute the rebuild date.
   - Add an explicit "No amenity source for this listing" state.
5. Tests:
   - Cover all 188 borrowed-amenity listings and the 221 listings with Recreation.gov toilet records named in the audit.
   - Produce a fixture or report listing, for each one, the expected inclusion or exclusion under the toilets filter (and water, where relevant) after the fix, with the reason for every remaining exclusion.
   - Do not make every record match just to raise coverage.
   - Unit tests for ownership guards, the scope rules, the same-campsite rig-fit-plus-amenity rule and date-unknown handling. A browser test for the popup evidence.
6. Publish counts in this doc, broken down by source and amenity: join eligibility, actual attached records, known values and filterable evidence. Correct any active "100% coverage" wording in `docs/USFS_SITE_AMENITIES_2.29.0.md`, `docs/replica/features.csv` notes, `docs/replica/parity-queue.md` and `docs/replica/COMPLETION_CONTRACTS.md`. For example, "2,158 of 2,158" becomes the three-count breakdown: 2,158 eligible, 1,448 with records, 1,324 with a known value. No row's status or the score changes.
7. Every new string has a Spanish entry in `locale.js` and a French entry in `locale-fr.js`.
   - Run `npm test`, `npm run test:python`, and the browser specs for features, discovery, usfs-site-amenities, rest-areas and locale.
   - Ignore only the known local failure in `app.spec.js` (mobile map height 493 vs >500).
   - Check the release build.

## Design

### Snapshot merge guard (`scripts/merge_campsite_data.js`)

- `AMENITY_TAG` names the amenity-type OSM keys: `toilets`, `toilets:*`, `drinking_water`, `shower`, `sanitary_dump_station`, `power_supply`, `bin`, `openfire`, `fireplace`, `firepit`, `picnic_table`, `bbq`, `water_point` and the other water, waste and fire keys found in the retained extract, plus `check_date` and `check_date:*`.
- `osmTag` now covers fee, charge, access and these keys. The existing `ownedOsmField` and `memberEvidence` path does the rest. When a distinct OSM element is absorbed, the kept record keeps only its own values. The absorbed element's values go to `member_evidence[]` with `source_record_id`, `source`, `retrieved_at`, `source_updated_at` and `source_url`. A survey date travels inside `fields` with its element.
- An `amenities` array is no longer unioned across different records. The same record seen twice still unions. No retained input has a non-empty array, so this changes no data.
- Fee and access behaviour is unchanged. The fee-evidence builder in `normalizeFeature` still reads only fee and access keys from member evidence.

### Index-level guard (`data-quality.js`)

- `normalizeFeature` derives OSM amenities only for the listing's own element (`osm:*` id with its own `osm_id`). A Recreation.gov host that inherited `tourism=*` is no longer read as OSM for amenities. Its type and admission do not change.
- New fields: `osm_amenity_tags` (the own element's amenity keys, verbatim), `amenity_record` (a non-OSM record's own amenity list with its source), `amenity_members` (attributed observations of other merged records). `amenity_negatives` is deduplicated and no longer grows on each pass.
- `mergeFeatures` no longer unions `amenities` or `amenity_negatives` from another record. The other record's own observation and its members are added to `amenity_members`, keyed by record id.
- `amenityEvidence(p)` is the single evidence model. Every statement carries source, record id, scope and date. Scopes: `element`, `listing_record`, `site_record` (Forest Service) and `campsite_records` (Recreation.gov, "N of M records, not every site"). The date is an observation date (OSM `check_date`, Forest Service `infra_last_update`) or `null`, shown as "date unknown". Retrieval dates are shown separately and labelled. A rebuild date is never used.
- Per filter amenity the status is `present`, `absent`, `conflict`, `unrecognized` or `unknown`. A campground-wide statement that disagrees with another statement is a conflict. Forest Service records that disagree give a conflict, never a label. Member observations are shown and never used, for or against.
- `amenityMatches` is what `applyFilters` uses. A listing matches only on `present` evidence. With a length or hookup filter on, Recreation.gov campsite-record counts never count, because the sidecar holds counts per facility and cannot show that the fitting campsite is the one with the amenity. Campground-wide evidence still combines with a fitting campsite.

### National index and route filters

- `scripts/build-search-index.js` attaches the two amenity sidecars exactly as the map does. `m.a` now holds amenities with campground-wide evidence. New `m.s` holds amenities named on Recreation.gov campsite records. `amenity_version: 1` marks the format.
- `routes.js` rebuilds `amenity_filter` from `m.a` and `m.s`, so route results apply the same rule. A saved index without `amenity_version` reports filter details as unavailable when an amenity filter is on.

### Popup (`data-loader.js`)

The "Amenities reported:" line is replaced by an "Amenity evidence:" block:

- one row per filter amenity (Toilets, Drinking water, Dump station, Showers) with its status and every statement as source · scope · value · date
- the own OSM element's amenity tags verbatim, with "Survey: {date or date unknown}" and "Retrieved: {date}"
- a collapsed "Merged elements, not used for this listing (N)" list, each with element link, tags, survey and retrieval dates
- a note when a length or hookup filter is on and campsite-record amenities are present
- "No amenity source for this listing." when no source states anything about amenities

The Recreation.gov and Forest Service detail sections are unchanged.

## Rebuild and verification

Inputs: retained `data/opencampingmap/*.geojson`, `data/campsites/{ST}.geojson`, agency files and sidecars, all unchanged (hash-checked). No identity split, admission change or source refresh.

```
node scripts/verify-osm-provenance.js --baseline=<origin/main checkout> --report=<out> --remerge
node scripts/build-search-index.js
node scripts/verify-amenity-ownership.js --baseline=<origin/main checkout> --report=<out> --cases=tests/fixtures/amenity-ownership-cases.json
```

- `verify-osm-provenance.js`: all assertions true. Fee changes 0, access changes 0, held exclusions 4 (unchanged), listing count 33,370.
- Replaying the unchanged code first reproduced every snapshot byte for byte, so every later difference comes from this repair.
- 43 of 50 state snapshots changed. 502 rows lost 810 tag instances to member evidence (toilets 170, drinking_water 186, power_supply 101, sanitary_dump_station 93, shower 82, picnic_table 48, openfire 46, toilets:disposal 25, others 59). `search-index.json` changed only in `m.a`, `m.s` and `amenity_version`. `coordinate-index.json` is unchanged.
- `verify-amenity-ownership.js` checks every snapshot row, index row and published listing. Allowed: amenity tags removed from a row that does not own them, the same values added to member evidence on a member that owns them in the retained extract, and the amenity fields listed above. Everything else (IDs, coordinates, aliases and legacy_ids, state partitions, `source_ids`, fees, fee evidence, access, admission, type, rig data, sidecar joins and resolution of 36,290 saved-place IDs and aliases) must be identical. **Unexpected deltas: 0.**
- Determinism: two independent rebuilds (this worktree and a separate fresh checkout of the base commit, same code and inputs) produced identical SHA-256 for all 50 snapshots, `search-index.json` and `coordinate-index.json`. Rebuilding the index again on its own output is also identical.
  - `search-index.json`: `84d331e19947e88e5c309fe3de54ae66a2c24446268997bc8fff028c3cf4a0c9`
  - digest of all output hashes: `136647d92c33ae0e0b71195f9ad0ac7f8688c098d89fa2ee9bbf8be3ad8ab9e6`

## Intended amenity changes

- 1,167 published listings change amenity evidence or filter results. 191 lose at least one shown value that they did not own. 398 now carry attributed member observations.
- Filter results, no other filter on, before and after: Toilets 2,856 to 3,517, Drinking water 1,831 to 2,255, Dump station 1,261 to 1,266, Showers 1,106 to 1,134. Borrowed values leave, Recreation.gov and Forest Service evidence joins.

## The 188 and 221 cases

`tests/fixtures/amenity-ownership-cases.json` lists all 404 listings, one per line, with the before state and the expected toilets, water and toilets-with-length-filter outcome and reason. `tests/amenity-ownership.test.js` recomputes every row from the committed data.

- Borrowed-amenity listings: **191**, not 188. The audit's load-order simulation hosted 3 `usfs:` listings on their absorbed OSM element. The published index hosts them on the `usfs:` record, so their OSM values are borrowed too (ridb 149, osm 36, usfs 6). The ridb and osm counts match the audit exactly. The audit kept no id list, so the match is by definition and class count.
  - Toilets: 61 included (Forest Service site record 54, Recreation.gov campsite records 8, own element 2), 88 no amenity source, 37 no toilet statement, 5 unrecognized value. Before: 147 matched.
  - Water: 43 included, 88 no amenity source, 48 no water statement, 11 explicit negative, 1 unrecognized value. Before: 96 matched.
- Recreation.gov toilet-record listings: **221**. Before, 209 were hidden by the Toilets filter.
  - Toilets: 219 included. 2 excluded, sources disagree: `ridb:234257` (Forest Service records say flush and vault) and `ridb:234553`.
  - Water: 117 included, 88 no water statement, 15 explicit negative (Forest Service says no water or not for drinking), 1 unrecognized value.
  - Toilets with a 20 ft length filter: 60 included on campground-wide evidence, 159 excluded because campsite-record counts cannot be tied to the fitting campsite, 2 sources disagree.

## Published counts

Counted over the 33,370 published listings. Eligible: a join path exists (OSM: the listing is its own OSM element. Recreation.gov and Forest Service: an exact `ridb:` id or alias). Attached: a record with this field exists. Known: yes or no (Recreation.gov: reported or explicit negative. Forest Service: a class other than unknown, no conflict). Filterable: the listing matches the filter through this source.

| Amenity | Source | Eligible | Attached | Known | Filterable |
| --- | --- | ---: | ---: | ---: | ---: |
| Toilets | OSM own element | 28,618 | 3,388 | 3,121 | 2,711 |
| Toilets | Recreation.gov campsite records | 2,158 | 1,446 | 221 | 219 |
| Toilets | Forest Service site records | 2,158 | 676 | 654 | 652 |
| Toilets | Any source | 33,370 | | | 3,517 (3,358 campground-wide) |
| Drinking water | OSM own element | 28,618 | 2,981 | 2,905 | 1,734 |
| Drinking water | Recreation.gov campsite records | 2,158 | 1,446 | 120 | 120 |
| Drinking water | Forest Service site records | 2,158 | 601 | 568 | 436 |
| Drinking water | Any source | 33,370 | | | 2,255 (2,165 campground-wide) |
| Dump station | OSM own element | 28,618 | 2,084 | 1,933 | 1,230 |
| Dump station | Recreation.gov campsite records | 2,158 | 1,446 | 36 | 36 |
| Dump station | Any source | 33,370 | | | 1,266 (1,230 campground-wide) |
| Showers | OSM own element | 28,618 | 2,282 | 2,210 | 1,090 |
| Showers | Recreation.gov campsite records | 2,158 | 1,446 | 45 | 44 |
| Showers | Any source | 33,370 | | | 1,134 (1,090 campground-wide) |

"Campground-wide" is the evidence that can combine with a length or hookup filter. The Forest Service layer has no dump or shower field.

Recreation.gov-linked listings, three separate counts: **2,158 eligible, 1,448 with records, 1,324 with a known value.** 866 of them have at least one filterable amenity. 710 eligible listings have a sidecar entry with no overnight records, which is not evidence.

25,654 listings show "No amenity source for this listing."

## Judgment calls

- Member observations are shown but never used, either to include or to exclude. A merged site node that says `drinking_water=no` does not veto the campground's own `yes`. Both are visible.
- Recreation.gov evidence joined through a `ridb:` alias on an OSM or `usfs:` host is used, as in 2.29.0. The facility id is an exact identity. A merged OSM element is not.
- With a length or hookup filter on, Recreation.gov campsite-record amenities never match, even when every record mentions the amenity. The two sidecars are separate builds, so a same-record join cannot be shown.
- OSM values other than yes or no (`toilets=vault`, `shower=customers`) are shown verbatim as "value not recognized" and do not match.
- The rig-type filter (tents, trailers, RVs) is element-level OSM data, so it is not treated as a campsite record.

## Limits and follow-ups

- OSM `tents`, `caravans` and `motorhome` tags are still inherited in snapshot merges. They are rig data, not amenities, so this repair leaves them unchanged. They need the same guard in a separate change.
- A device that saved old state snapshots for offline use shows the old inherited tags as the element's own until it reconnects.
- Retrieval dates are fetch dates. Only `check_date` is an OSM survey date (about 300 listings).

## Tests

- `npm test`: all pass except `tests/api.test.js` "migrations, submission, ..." which also fails on unchanged origin/main in this environment (no MySQL).
- `npm run test:python`: 319 tests OK, 6 skipped.
- Browser: `features`, `discovery`, `usfs-site-amenities`, `rest-areas`, `locale`, the new `amenity-evidence`, plus `ridb-amenities`, `routes`, `fee-evidence` and `rig-profile` pass. `app.spec.js` fails only on the known mobile map height (493 vs >500).
- `npm run build` (search index, services, permissions, release) succeeds and leaves committed data unchanged.
- New: `tests/amenity-ownership.test.js` (ownership guards, scope rules, same-campsite rule, date unknown, no-source state, fixture recompute) and `tests/browser/amenity-evidence.spec.js` (popup evidence and filter agreement in English, Spanish and French).

Release 2.31.0, service-worker cache `kt-v64`.
