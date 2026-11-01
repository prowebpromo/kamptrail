# Tourism, type and admission candidate (revision 2)

Candidate only. Nothing here is merged, versioned or released. Every listed change is flagged `separate_review` in the ledger. Branch `candidate/tourism-type-admission`, baseline origin/main `afdfb3f9` (2.31.0). No rig key is read differently (see "Rig keys").

Ledger: `docs/candidates/tourism-type-admission.json` and `.csv` (version 2, one deduplicated record per id). It covers groups A, B, C, the website-linked set W and the three OSM elements, plus every other listing whose type, publication or evidence changes. Final counts are in the ledger header (`venn`, `change_kinds`, `proposed_by_evidence`). This document explains the rules behind them.

## Policy implemented

A listing is classified only from its own record or from a record with a verified exact identity. Evidence from a different OSM element never classifies a listing. The policy holds at every layer that merges records:

| Layer | File | Rule |
| --- | --- | --- |
| Snapshot merge | `scripts/merge_campsite_data.js` `ownClassification` | `tourism` of a distinct absorbed element is removed from the retained record. It is kept on that member's `member_evidence[].fields`, with element id, source and dates. A different record never lends its type. A description copied from another record is marked `description_source_record_id`. |
| Index and browser normalization | `data-quality.js` `normalizeFeature` | `tourism` on a record without its own `osm_id` is ignored. This covers old snapshots and offline copies. Copied description text never classifies. |
| Index and browser reconciliation | `data-quality.js` `mergeFeatures` (was L230) | Camping classification moves only between exact identities: the same record, or the same Recreation.gov facility id published by an agency (`blm-facility:N` for `ridb:N`). A name match within 300 m is candidate matching only. It still merges the identity (alias kept), but it never classifies or publishes. Type is never copied from the other record. |
| Publication | `data-quality.js` `cleanAndDedupeGeoJSON`, `withheldMembers` | An OSM element absorbed into a host that is not a classified campsite is withheld with that host. This applies across state files and in the browser. It never publishes on its own because its host lost a borrowed classification. An element that was already its own published listing keeps it. |

The browser runs the same code (`data-loader.js` `mergeLoaded` passes the sidecars and the withheld set). Tests prove this at both layers: `tests/tourism-type-admission.test.js`, "runtime merging never restores borrowed classification" and the snapshot-merge tests.

## Own-source evidence, three kinds kept apart

| Kind | Where it lives offline | Used for |
| --- | --- | --- |
| Structured classification | Recreation.gov `type` in `data/campsites/{ST}.geojson`. It is mapped from RIDB `FacilityTypeDescription` by `scripts/fetch_recreation_gov_data.py` L114-122. The raw value is not kept. Also Forest Service `site_type` (`usfs-site-amenities.json`) and BLM layer 8 membership. | Campground, Dispersed or Backcountry only together with the facility's own overnight campsite records. Otherwise it is shown as evidence only. |
| Overnight campsite records | `ridb-sites.json` `t` and `ridb-amenities.json` `sites`, both from the RIDB full export (Campsites, TypeOfUse=Overnight), sha `13afd4dc...`, retrieved 2026-10-30. | Corroborates the structured type: evidence `ridb_facility_type_overnight_sites`. |
| Descriptive wording | Own FacilityName, then the first sentence of the own FacilityDescription. | Classifies a facility whose structured type is `other`. The ledger stores `type_evidence` {kind, field, value, record id, date}. "Dispersed", "primitive" or "yellow post" in the wording gives Dispersed. |

Structured facility type is not available offline. Missing: the raw `FacilityTypeDescription` and its RIDB `LastUpdatedDate` for each facility. Proposal: write `facility_type_description` and `facility_last_updated` in `convert_to_geojson` (`scripts/fetch_recreation_gov_data.py`), or read `Facilities.csv` from the export in `scripts/build_ridb_sites.py` and add an `ft` field to `ridb-sites.json`. It was not downloaded here. Missing classification is never shown as camping being unavailable. The withdrawal message says "Camping may still be available. It is not verified."

## 1. The 45 relabels of revision 1

All 45 are Recreation.gov listings whose own structured type is `other`, and none has its own overnight campsite records.

- 31 stay published on their own descriptive wording, with attribution: 30 Campground (27 from FacilityName, 3 from the description) and 1 Dispersed (`ridb:255262` Wolf Flats, "a dispersed, undeveloped camping area").
- 14 are withdrawn, because no own source supports camping. Their earlier classification was borrowed.

The proposal was not forced to 31 and 14. It came out that way under the rules.

## 2. The 25 borrowed-tag-only listings

- 14 have their own structured type `established` and their own overnight records:
  - 11 stay Campground, for example `ridb:232662` (41 records) and `ridb:234761` (also USFS `CAMPGROUND`).
  - 3 fire lookouts stay published as "Lookout, cabin or other lodging": `ridb:234149`, `ridb:234159`, `ridb:234185`. They are never called a campground and are not removed for being lookouts.
- 11 have neither and are withdrawn.

The withdrawal applies to campsite discovery only. Each withdrawn listing has an entry in `data/campsites/withdrawn.json` with id, aliases, point, own source link and the reason. A shared `#site=` link opens a notice that explains the unverified classification (Spanish and French included). The 4 restrictive-access holds are unchanged.

## 3. The three absorbed OSM elements

| Element | Host | Finding | Outcome |
| --- | --- | --- | --- |
| `osm:way:368988012` Lake Wedington (`caravan_site`, capacity 18) | `ridb:234586` | Same name, 26 m. A representation of the same facility. The host qualifies on its own (25 overnight records). | Stays an alias of `ridb:234586`. Not published separately. |
| `osm:relation:13942065` River Forks | `ridb:247915` (withdrawn) | Same name, 130 m. The element's website is Hall County, so no Recreation.gov id, and identity is not verified. | Withheld with its host. It resolves through the host's `withdrawn.json` entry. Publishing it separately needs owner review. |
| `osm:way:941066426` Daisy State Park | `ridb:247835` (withdrawn) | Same name, 94 m. No identifier. | Same as River Forks. |

The same check found `osm:way:456269017` Don Carter State Park. It is already its own published listing in NC and stays published. Its GA host `ridb:247922` is withdrawn.

## 4. The 43 L230 promotions

| Rule | Count | Outcome |
| --- | ---: | --- |
| Exact identity, same facility id (`blm-facility:N` for `ridb:N`), promoted now | 12 | All stay published. 10 also have own overnight records. 2 (`ridb:262781`, `ridb:273310`) qualify only through the exact identity and show their own type, Campground. |
| Exact identity, same facility id, only after the A guard | 2 | Published on own overnight records (`ridb:250031`, `ridb:252280`). |
| Name within 300 m only, promoted now | 26 | 9 stay published on their own structured type and overnight records, for example `ridb:232421` (also USFS `CAMPGROUND`), `ridb:233178` Shaw House (lodging). 17 are withdrawn. |
| Name within 300 m only, only after the A guard | 3 | 1 published on own evidence (`ridb:233931`). 2 withdrawn (`ridb:244321`, `ridb:249674`). |

12 + 2 + 26 + 3 = 43. All 43 are reconciled per record in the ledger. Every name-only promoter stays an alias, so its identity merge is kept apart from classification. `ridb:232162` Trout Pond is the one name-only case whose own RIDB description links the same Forest Service record id (`recid=73999`). It is published on its own records and does not need that link.

## 5. Count reconciliation with the 2.32.0 audit

Both counts come from the same baseline. `count_reconciliation` in the ledger has the ids.

- **Inherited tourism, 592 against 667.**
  - 2.32.0 counts a published canonical record whose `tourism` differs from its own row: 592.
  - Revision 1 counted a listing if any of its ids, alias included, has a snapshot row with tourism it does not own: 667 = the 592 plus 75 more.
  - Of the 75, 69 have a canonical record that carries its own tag, while an alias row inherited one (for example `osm:way:160222816`). The other 6 have a canonical record with no tourism at all (for example `ridb:265238`).
  - Snapshot rows affected: 703.
- **Borrowed type, 98 against 2.** These are different layers.
  - 2.32.0 compares the published type with the host's own record normalized alone: 98 (other to established 92, other to dispersed 6).
  - By cause: 57 come from the inherited tag making L151 default to Campground (for example `ridb:243195`), 39 from L230 copying the promoter's type (for example `ridb:243218`), and 2 from the snapshot merge (`ridb:10076131`, `ridb:248261`, the revision 1 count).
  - Of the 39 index-layer cases, 38 are group C and 1 is `ridb:255118`, the same facility id as `blm-facility:255118`.
  - The candidate applies the policy at all three.
- **L230 promotion:** 38 now in both audits. 43 includes the 5 that depend on it only after the A guard.
- **Website-linked members.**
  - Rule: an exact identity holds only when the absorbed element's own `website` names a Recreation.gov facility id equal to the host's (`/camping/campgrounds/N`, `/camping/poi/N` or `facilityId=N`).
  - A legacy `parkId` or a slug URL is not exact. A website alone never classifies.
  - Measured: 51 hosts have a recreation.gov member website. 44 are exact, 6 have a legacy parkId only, and 1 has no id.
  - The 18 in the 2.32.0 doc are the subset that loses rig data (rig tags yes). I count 22 exact or no-id hosts with such tags, 21 of them exact.
  - The 2.32.0 doc gives no id list, so the 18 could not be matched id for id. All 51 are in the ledger as group W with their basis. This exact-identity rule does not change any rig data here.

## Rig keys

Rig keys (`tents`, `caravans`, `motorhome`) belong to 2.32.0. They are read exactly as before: the old "host holds a campsite tag" test now reads that tag from the member's attributed evidence (`kt_rig_osm`). The verifier fails on any change in the rig metadata `m.r`.

## Identity and contributions

- All 36,290 baseline ids and aliases resolve to the same listing, or to a `withdrawn.json` entry. 0 move host.
- Browser runtime identity (data-loader.js L182) is reported per record: all states, reversed order, and every order of the record's own states. 93 of the 734 records depend on load order (`depends_on_load_order`), 25 of them in groups A, B, C, W or the OSM elements. None of the 43 promotions does. They wait on fix/deterministic-browser-identity, which lands before this candidate deploys. L182 is not changed here.
- Contributions: production reports 0 published reviews, so 0 observations and 0 photos.
- Not inspected: pending and rejected reviews, pending photos, `api/submit.php` corrections, permission observations, external bookmarks and shared links. Withdrawn ids stay resolvable for that reason.

## Rebuild and verification

```
bash scripts/tourism-type-admission/run-all.sh <origin/main checkout> <out>
```

This replays every state merge, rebuilds the index (identity hints seeded from the released index), writes `withdrawn.json` and the ledger, rebuilds a second time and compares digests, then runs `scripts/verify-tourism-type-admission.js`.

The verifier fails on any snapshot, index or catalogue difference not listed in the ledger, and on any change to the following: fee, access, holds, coordinates, aliases, rig metadata, sidecars or raw inputs. It also fails on a withdrawal without a legacy entry, or an index that does not rebuild byte for byte.

## Open questions for the owner

1. Approve the 31 withdrawals listed in `withdrawn.json`, or keep any with wording evidence the rules do not accept.
2. Should River Forks and Daisy State Park publish as their own OSM listings after identity review?
3. Approve the new type "Lookout, cabin or other lodging" (10 listings).
4. Add raw `FacilityTypeDescription` and `LastUpdatedDate` to the RIDB import, as proposed above.
5. Is the website exact-identity rule acceptable for 2.32.0 rig ownership?

## Results

- 33,370 listings before, 33,339 after: 31 withdrawn, 0 newly published.
- Type changes: other to established 64, other to dispersed 14, established to lodging 10, established to dispersed 1.
- The rebuild is deterministic (digest `cc48b3f3...cb6f`, two independent replays). The verifier reports 0 unexpected deltas, 36,290 saved ids checked and 4 access holds unchanged.
- Rig metadata, fees, access, aliases and coordinates are unchanged.

## Tests

- `npm test`: 466 of 466 pass, including `tests/tourism-type-admission.test.js` (15 tests).
- `npm run test:python`: 363 OK, 9 skipped.
- Browser specs (features, discovery, saved-stops, fee-evidence, amenity-evidence, usfs-site-amenities, ridb-amenities, locale, routes, rig-profile, app): 68 passed, 1 failed. The failure is the known `app.spec.js` mobile map height (493 vs >500).

