# Rig-tag ownership audit (for 2.34.0)

Read-only audit of origin/main at afdfb3f (live release 2.31.0). Measured 2026-10-31 from the committed snapshots, the retained OSM extract (`data/opencampingmap/*.geojson`), the Recreation.gov inputs and sidecars and the agency files. No app code or data was changed for this audit.

A first version of this audit was lost in a container restart before it was pushed. Every number below was measured again from the data. Where it differs from the lost figures, the measured value is used and the difference is listed in "Differences from the lost audit".

## Method

- The published catalogue is built exactly as `scripts/build-search-index.js` builds it: every state snapshot plus agency records, `publicationCandidates`, `normalizeFeature`, `attachSiteDetails` and the amenity sidecars, then `cleanAndDedupeGeoJSON` with the committed index's `preferredIds` and `previousHosts`. It has **33,370 listings**, the same as `search-index.json`.
- A listing's own rig values are the `tents`, `caravans` and `motorhome` tags on its own OSM element in the retained extract (only `osm:*` listings have one), plus its own source record's `rig_friendly` list (agency records). A Recreation.gov listing has no own OSM element in the retained data: every OSM element merged into one was matched by name and distance, not by identity.
- A value is borrowed when the published `rig_friendly` holds a category (`tent`, `trailer`, `rv`) that the listing's own sources do not state as `yes`.
- Each borrowed value is traced to its path: the snapshot merge (`scripts/merge_campsite_data.js` keeps `...secondary` keys, so an absorbed element's `tents`/`caravans`/`motorhome` land on the kept row) or index reconciliation (`data-quality.js` `mergeFeatures`, `p.rig_friendly = [...p.rig_friendly, ...q.rig_friendly]`, about L246).

## Findings

| Measure | Value |
| --- | ---: |
| Published listings | 33,370 |
| Listings that show at least one borrowed rig value | **237** (ridb 177, osm 56, usfs 4) |
| ... borrowed Tents | 180 |
| ... borrowed Trailers and caravans | 141 |
| ... borrowed RV | 55 |
| Listings whose Tents or Trailers filter result changes | 200 |
| Listings where only the popup RV label changes (no UI filter for `rv`) | 37 |
| Tents filter, before and after | 5,963 to **5,783** |
| Trailers filter, before and after | 2,989 to **2,848** |
| RV (index `m.r`, no UI filter), before and after | 242 to 187 |
| Listings with a borrowed value from the snapshot merge | 195 |
| Listings with a borrowed value from the `mergeFeatures` union | **43** (1 also has a snapshot-merge value) |

Paths in detail:

- Snapshot merge: 195 listings. The absorbed element's own tags (for example `tents=yes`, `caravans=yes`) are written onto the kept row as if it carried them. 170 kept Recreation.gov rows carry `tents`, 168 `caravans` and 18 `motorhome` that way. OSM-hosted merged rows carry 412 `tents`, 299 `caravans` and 1 `motorhome`, most of them their own.
- `mergeFeatures` union: 43 listings. 38 gain `rv` from another record's `rig_friendly` list, mostly a Forest Service agency record whose own list is `["rv"]` because its camping activity is "RV Camping". 5 gain `tent` or `trailer` from an absorbed OSM element at index level: `usfs:26883`, `usfs:80159`, `usfs:24878`, `usfs:9461` and `ridb:239840`.

### Audit examples

| Listing | Before | After | Own source | Borrowed from |
| --- | --- | --- | --- | --- |
| `ridb:232324` Williwaw Campground | Tents, Trailers | none | Recreation.gov: 19 of 52 sites list RV or trailer equipment | `osm:way:851627950` tents=yes, caravans=yes |
| `ridb:274260` West Fork Campground | Tents, Trailers | none | Recreation.gov: no campsite records | `osm:way:430531631` tents=yes, caravans=yes |
| `osm:node:11810571792` Backcountry Campsites | Tents | none (caravans=no stays) | own element: caravans=no | `osm:node:13131564112` tents=yes |
| `usfs:26883` Upper Payette Lake Campground | Tents, Trailers, RV | none | Forest Service record: no rig list | `osm:way:1539329187` tents, caravans, motorhome=yes (index union) |
| `ridb:242362` Green Springs Campground | Tents, Trailers, RV | none | Recreation.gov: no site summary | `osm:way:1530938473` tents=yes, caravans=yes (snapshot), `rv` from a merged record list (index union) |

### Contradictions

8 listings whose own element and a merged element give opposite explicit values. Today the popup shows only the host's value and the other is invisible. None of them changes rig_friendly, because the host's own value already wins.

- `osm:way:259289402` Pine Springs Campground: own tents=yes, caravans=no. Merged `osm:way:1266999095` (a separate outline of the RV loop): tents=no, caravans=yes.
- `osm:node:13056873568`, `osm:way:1559023868`, `osm:node:1060578769`, `osm:way:658222902`, `osm:way:623770855`, `osm:way:1369809170`, `osm:way:1300622137`.

These are different mapped elements (a tent loop and an RV loop), not a disagreement about one element. They stay as attributed member evidence. They are not listing-level conflicts.

### Recreation.gov counts versus a borrowed Trailers value

5 Recreation.gov listings show Trailers only from a borrowed `caravans=yes`, while their own Recreation.gov campsite records list 0 RV or trailer sites: `ridb:234759` Groom Creek Horse Camp (0 of 35), `ridb:266136` Grapevine Group (0 of 9), `ridb:266135` Frazier Group (0 of 1), `ridb:233162` Gray Pine Group (0 of 1), `ridb:233818` Cayuse Horse Camp (0 of 14).

No OSM-hosted listing with a Recreation.gov alias has both an own `caravans`/`motorhome` tag and a Recreation.gov site summary that disagrees with it (136 OSM listings carry a `ridb:` alias, 1 has a site summary). So no Recreation.gov-versus-own-tag conflict exists in the current data. The repair still implements the rule.

### Exact-identity candidates (owner decision pending)

18 of the 177 Recreation.gov listings absorbed an OSM element whose `website` names the same Recreation.gov facility ID (for example `ridb:232330` and `osm:way:840370810`). That link is an exact identity statement made by an OSM mapper. Under the 2.31.0 rule a merged OSM element is not the listing's own element, so these 18 lose their values too (Tents 18, Trailers 15, RV 2). Treating them as own elements would be a separate identity decision.

### Unchanged by this repair

- Explicit negatives on own elements: 2,475 listings carry a `tents`, `caravans` or `motorhome` value of `no`. 494 have no `yes` at all. 113 carry an unrecognized value (`only`, numbers, `unknown`, `designated`).
- Other rig-suitability keys inherited at the snapshot merge (`capacity*`, `backcountry`, `group_only`, `static_caravans`, `horse`, `maxlength`, `maxtents`) are not read by any client code today. The guard moves them too, so they cannot start leaking later.

## Browser identity (pre-existing, not part of this repair)

`data-loader.js` L182 merges loaded states without the index's `preferredIds` and `previousHosts`. 2 of the 237 changed listings are elected under a different canonical id in the browser: `usfs:24878` shows as `osm:way:334210652` and `usfs:9461` shows as `osm:relation:19325196`. Live acceptance must look them up by alias.

## Provenance debt and owner decisions (measured, not changed)

| Item | Published listings affected |
| --- | ---: |
| `operator` value taken from another merged record | 374 |
| `website` value taken from another merged record | 325 |
| `tourism` value taken from another merged record | 592 |
| Listing type differs from the host's own record (`other` to `established` 92, `other` to `dispersed` 6), the borrowed type near `data-quality.js` L223/L230 | 98 |
| Listings published only because L230 promotes an unverified record to `campsite` from a merged record | 38 |

The lost audit gave 376 for operator and 43 for the L230 promotion. Both were measured again: 374 and 38.

## Differences from the lost audit

| Measure | Lost audit | Measured | Note |
| --- | ---: | ---: | --- |
| Listings changed | 180 | 237 | 180 equals the measured count of listings that lose Tents. The lost total did not include Trailers-only (18) and RV-only (37) changes, plus 2 other mixes. |
| Tents filter after | 5,802 | 5,783 | 19 lower. Consistent with the lost audit keeping some exact-identity listings (the 18 above) and the index-union tent values (5). Not reproduced. |
| Trailers filter after | 2,859 | 2,848 | 11 lower. Same cause as Tents. |
| `mergeFeatures` union listings | 53 | 43 | 38 RV from record lists and 5 tent or trailer from OSM. |
| Listing count | 33,370 | 33,370 | Same. |
| Audit examples | 5 | 5 | The lost list was not kept. Five examples are chosen again above. |
| Contradiction `osm:way:259289402` | yes | yes | Plus 7 more. |
| ridb Trailers with 0 RV sites | 5 | 5 | Same. |
| Inherited operator | 376 | 374 | |
| L230 promotion | 43 | 38 | |
