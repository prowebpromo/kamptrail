# Rig-tag ownership repair (2.34.0)

Release 2.34.0 applies the 2.31.0 amenity ownership rule to rig suitability. The audit is `docs/RIG_TAG_OWNERSHIP_AUDIT.md`. It was first built as 2.32.0 on 2.31.0 and is rebased on main 16fcc1b (2.33.0, deterministic browser identity), keeping main's identity code (`identity-hosts.json`, the per-load catalogue rebuild, stored ids not rewritten) unchanged.

## Rule

- Rig-suitability keys are guarded at snapshot merge (`scripts/merge_campsite_data.js` `RIG_TAG` in `osmTag`) and at index reconciliation (`data-quality.js` `normalizeFeature` and `mergeFeatures`). The keys are `tents`, `caravans`, `motorhome`, `capacity*`, `backcountry`, `group_only`, `static_caravans`, `horse`, `maxlength` and `maxtents`, each with its `:*` subkeys.
- `tents`, `caravans` and `motorhome` are read only from the listing's own OSM element. A Recreation.gov host has no own OSM element in the retained data, so it shows no OSM rig values. An agency record's own `rig_friendly` list (Forest Service "RV Camping") is that record's own evidence.
- An absorbed element's rig tags, and another record's rig list, are kept as attributed member evidence (`member_evidence` in snapshots, `rig_members` in the catalogue). They are listed in the popup as "not used" and never count for or against a filter.
- Explicit negatives (`tents=no`, `caravans=no`) and unrecognized values (`only`, numbers) stay visible. Unknown stays unknown.
- A Recreation.gov facility joined by an exact `ridb:` id or alias that lists 0 RV-type sites of a non-zero total, against an own `caravans=yes` or `motorhome=yes`, shows "sources disagree". Neither value is picked and the Trailers filter does not match. Recreation.gov never adds a category. In the current data no listing meets this condition.
- The popup's "Rig types reported:" block and the Tents and Trailers filters use one model, `DataQuality.rigEvidence`. The index's `m.r` is `rigFilterSet`, so route filters match too.

## Rebuild

From the unchanged retained inputs, with the original source dates, using the repo's replay tooling:

```
node scripts/verify-osm-provenance.js --baseline=<origin/main checkout> --report=<out> --remerge
node scripts/build-search-index.js
node scripts/verify-rig-ownership.js --baseline=<origin/main checkout> --report=<out> \
  --cases=tests/fixtures/rig-tag-ownership-cases.json --csv=tests/fixtures/rig-tag-ownership-cases.csv
```

- `verify-osm-provenance.js`: all assertions true. Fee changes 0, access changes 0, held exclusions 4, listing count 33,370.
- 44 of 50 snapshots changed. 1,003 rows moved 829 tag instances to member evidence (tents 209, caravans 205, capacity 118, backcountry 72, group_only 68, static_caravans 39, capacity:pitches 26, capacity:tents 24, horse 23, capacity:caravans 20, motorhome 18, capacity:persons 6, capacity:cabins 1). `coordinate-index.json` is unchanged. `search-index.json` changed only in `m.r` (237 listings).
- After the rebase, the replay on 2.33.0 reproduced the 50 snapshots and `search-index.json` byte for byte. `identity-hosts.json` is rebuilt by the index build and changes only its `index_sha256`. Its 2,747 host entries are identical to main.
- Determinism: a second rebuild in a separate fresh checkout produced identical SHA-256 for all 50 snapshots, `search-index.json`, `coordinate-index.json` and `identity-hosts.json` (`9f83fc564ec2240a13412cc49950782966e0ffa9c12915b3022214381eed4e58`). `search-index.json`: `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`. Verifier output digest: `66ee9f6a5b5c59a75f3bd0a896d965623ba31932e8cc618edca5d4da50668b4e`.

## Verifier

`scripts/verify-rig-ownership.js` allows exactly these changes: rig tags removed from a row that does not own them, the same values added to member evidence on a member that owns them in the retained extract, `rig_friendly` losing categories its own sources do not state, and the rig evidence fields. It recomputes each listing's expected state from the retained OSM extract and agency files, independently of the guard, and fails on any delta in IDs, coordinates, aliases and legacy_ids, state partitions, memberships (`source_ids`), listing type, camping classification, fees, fee evidence, access, admission, amenity evidence, sidecar joins or the resolution of 36,290 saved-place IDs. It also fails if a filter gains a listing or a borrowed value has no member source. **Unexpected deltas: 0.**

## Intended changes

All counts are over the 33,370 published listings. They match the audit.

### Filter changes (237 listings)

| Filter | Before | After | Removed | Added |
| --- | ---: | ---: | ---: | ---: |
| Tents | 5,963 | 5,783 | 180 | 0 |
| Trailers and caravans | 2,989 | 2,848 | 141 | 0 |
| RV (index `m.r` only, no UI filter) | 242 | 187 | 55 | 0 |

- 200 listings change a Tents or Trailers filter result. By class: ridb 177, osm 56, usfs 4 (all 237).
- Every list is in `tests/fixtures/rig-tag-ownership-cases.json` (`tents_before`/`tents_after`, `trailers_before`/`trailers_after`).

### Popup changes

- 245 fixture listings change their rig line: the 237 above plus 8 contradiction cases that keep their filter result but now show the own negative and list the merged element as not used. 45 of the 245 change only the popup: 37 lose a borrowed RV label and the 8 contradiction cases.
- Outside the fixture, the rig line wording changes without any filter change on 6,770 listings with own rig data ("Tents" becomes "Tents: reported"). 2,566 of them now also show an own explicit `no` or unrecognized value that was hidden before. 570 listings list merged rig tags as not used without any change to their own values. 814 listings carry rig members in total.
- Where no own source states anything, the block reads "No rig source for this listing." with the merged elements below it (`ridb:232324`, `ridb:274260`). The fixture's `popup_after` is then empty.

### Cases

`tests/fixtures/rig-tag-ownership-cases.json` and `.csv` list all 245 listings (237 changed plus 8 contradictions), each with its own values, borrowed values with the member id, before and after rig line, before and after Tents and Trailers inclusion and the own-source evidence for the after-state. `tests/rig-ownership.test.js` checks every row against the committed index.

- Audit examples: `ridb:232324`, `ridb:274260`, `osm:node:11810571792`, `usfs:26883`, `ridb:242362`.
- Contradictions: `osm:way:259289402` and 7 more (see the audit).
- The 5 Recreation.gov listings that showed Trailers from a borrowed value while listing 0 RV-type sites (`ridb:234759`, `ridb:266136`, `ridb:266135`, `ridb:233162`, `ridb:233818`) now show no rig source and leave both filters.

## Browser identity and load order

On 2.33.0 the browser elects the index's canonical hosts from `identity-hosts.json`. `docs/RIG_TAG_LOAD_ORDER_2.34.0.md`: across 84 scenarios all 245 affected listings keep the same source identities, rig line and Tents and Trailers outcome, and match the fixture. `usfs:24878` and `usfs:9461` now match the index. Before the rebase, 18 listings varied with load order and these 2 always differed.

The verifier also fails if `identity-hosts.json` is not the one derived from the committed index, or if its host membership differs from main.

## Provenance debt

Operator and website are deferred. Measured on main afdfb3f:

| Value | Published listings with a value taken from another merged record | Own record has none |
| --- | ---: | ---: |
| `operator` | 374 | 374 (ridb 344, osm 30) |
| `website` | 325 | 325 (ridb 291, osm 26, usfs 8) |

Guard chosen: a test (`tests/rig-ownership.test.js`, "provenance debt guard") asserts that no campsite client code reads `operator`, and that `website` is read only as the fallback after `source_url` at two known sites (`data-loader.js` popup link, `spot-info.js` fee-evidence panel), plus code comments at every read site (those two, the `data-quality.js` source_url fallback and the `mergeFeatures` fill). The test found the `spot-info.js` site on its first run. Every published listing has a normalized `source_url` from its own record, so the inherited website is never shown. The 5 listings whose `source_url` equals `website` are agency records whose own URL it is.

Why not move inherited values to member evidence in the index normalizer: that changes the normalized catalogue for about 700 listings in a release meant to change only rig data, and `mergeFeatures` refills `website` from other records at a later step, so a normalizer-only move would be partial. The test guard changes no data and fails as soon as any UI starts showing either field.

## Owner decisions pending (measured, not changed)

| Item | Measured |
| --- | ---: |
| `tourism` inherited from a merged record | 592 listings |
| Borrowed listing type (`mergeFeatures` near L223/L230: `other` to `established` 92, `other` to `dispersed` 6) | 98 listings |
| L230 promotion: listings published only because a merged record is classified as a campsite | 38 listings (the brief said 43) |
| Operator and website values themselves | 374 and 325 |
| 18 Recreation.gov listings whose absorbed OSM element links the same facility by `website` | kept as members as built, so they lose Tents 18, Trailers 15, RV 2. The owner has not decided whether that link counts as identity. |

## Tests

- New: `tests/rig-ownership.test.js` (merge guard, own-element reading, members unused, negatives, Recreation.gov conflict, index, fixture recompute, provenance-debt guard) and `tests/browser/rig-evidence.spec.js` (popup rig evidence and filter agreement in English, Spanish and French).
- New strings have Spanish (`locale.js`) and French (`locale-fr.js`) entries.
- `npm test`: 468 of 468 pass (one guard test failed first on a stale version regex after the renumber, fixed and rerun). `npm run test:python`: 397 OK, 9 skipped.
- Browser, served from this worktree on 127.0.0.1:8795: `features`, `amenity-evidence`, `discovery`, `rig-profile`, `locale`, `identity`, `saved-stops`, `rig-evidence` pass (56 of 57 with `app.spec.js`). `app.spec.js` fails only on the known mobile map height (493 vs >500).
- `npm run build` (search index, services, permissions, release) succeeds and leaves committed data unchanged.

Release 2.34.0, service-worker cache `kt-v67`.

## Live acceptance (November 1, 2026)

Result: **passed with no exceptions.** Checked on kamptrail.com against merge `9c930466` (PR #154), search index `83e6f21c`. All 245 fixture listings (`tests/fixtures/rig-tag-ownership-cases.json`) loaded in four runs: desktop (1440x1000) and mobile (390x844), each with the affected states loaded forward and reversed. Script: `scripts/acceptance/live-2.34.0-rig-check.js`. Raw output: `docs/acceptance/2.34.0-live-output.txt`.

| Check | Desktop forward | Desktop reversed | Mobile reversed | Mobile forward |
|---|---|---|---|---|
| Browser id equals index id | 245/245 | 245/245 | 245/245 | 245/245 |
| Rig line matches fixture | 245/245 | 245/245 | 245/245 | 245/245 |
| Tents filter matches fixture | 245/245 | 245/245 | 245/245 | 245/245 |
| Trailers filter matches fixture | 245/245 | 245/245 | 245/245 | 245/245 |
| Page errors | 0 | 0 | 0 | 0 |

Before merge, the search index was compared independently with main: the same 33,370 ids, and only the rig field (`m.r`) differs, on exactly 237 listings. identity-hosts.json kept the same 2,747 hosts, with its recorded index hash updated.

Owner decision still pending and kept conservative here: 18 Recreation.gov listings whose absorbed OSM element links the same facility by website are treated as members.
