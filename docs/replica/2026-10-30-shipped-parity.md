# KampTrail shipped feature audit — October 30, 2026

KampTrail scores **89.9/100** on the frozen feature checklist: **98/109 weighted points, 61 scored rows, all 13 must-haves complete**. The replica-diff `parity.py` tool reproduced this result without matrix warnings. Weights remain must=3, should=2, could=1, partial=half; skip and original=no rows remain excluded. The score was 84.9 at the reviewed 2.14 baseline.

This is a feature comparison against archived descriptions and reviews. The original app remains unavailable, so layout and current side-by-side behavior cannot be compared. No layout score is asserted.

## Verified release and evidence

Production 2.19.0 resolves to source `5f42a4e45473e3eab0f6cdeda22b5fc1d6420f6f`. Its final regression run [41122103645](https://github.com/prowebpromo/kamptrail/actions/runs/41122103645) passed native PHP/MySQL, backup restore, Node/Python, build and all 140 browser tests. [Lighthouse run 41122103716](https://github.com/prowebpromo/kamptrail/actions/runs/41122103716) passed. Live release identity and the private-config-backed API health check were verified without reading configuration values.

- National services are published: **254,149 OSM source identities, 1,138 shards, all 50 state extracts**. Snapshot `d05ed287cff1c41ac3c6ab2e`; public manifest SHA-256 `bcc1b1691c19bd780510d3858bf050bbc548383a1ee20949851f30c570944366`. Source headers are **2026-10-28T21:21:02Z**, distinct from actual October 30 retrievals. The native About table shows seven active source rows and 50-of-50 extract coverage. Source identities are not additional campsites or independently inspected physical businesses. Categories overlap; access, potability, opening, RV suitability and overnight permission require explicit evidence.
- Spanish first-party tools are live. Native selection persists through reload, while original source names remain unchanged. French is absent, so the combined es/fr row stays partial.
- The optional review form exposes 1–5 quietness, shade-satisfaction and personal-comfort fields. Seasonal cohorts need at least three qualifying ratings per aspect, and combined numeric/categorical filters use the same visit. No production averages were manufactured; broader original numeric coverage stays partial.
- Campsite videos now earn the completed video row: one external YouTube attachment follows required-review moderation. Native form wording and the optional ID/URL field were verified with zero automatic third-party iframes. CI covers explicit Play, fresh publication checks, stale/deleted/unpublished media and exact-snapshot moderator decisions. The empty live form was closed without submission; this audit does not claim live playback of an absent approved attachment. Video file uploads are not implemented.
- Ordinary native layer/Offline clicks work with services, rest-area and height panels active. The 254-record Rhode Island height pilot and route-proximity display remain partial; proximity to route geometry does not prove the driven road, direction or safe clearance. Rig profiles and dated sampled terrain charts are reference displays; the car router does not enforce vehicle limits.

The CSV status change relative to the merged 2.19 candidate is **Campsite videos: no → yes**. Other changed rows replace candidate wording or stale service totals with the actual released scope and evidence; no additional status credit is granted.

## Still partial or absent

| Row or area | Status | Remaining scope |
| --- | --- | --- |
| FCC carrier overlay | No | Authentication blocked pending FCC guidance; enablement is not successful access |
| Observed cell-signal filter | Partial | Dated observations exist; modeled carrier coverage absent |
| Overnight places | Partial | 78 Texas rest-area records; permission unknown; commercial and other-state coverage incomplete |
| Overnight allowed voting | No | Moderated dated reports are not permission voting |
| Broader amenities | Partial | Exact RIDB campsite-record mentions; broader agency facility inventory incomplete |
| Low clearances | Partial | Rhode Island pilot only; no RV-safe routing |
| Vehicle-constrained route settings | No | No enforcement of height, weight, length or highway avoidance |
| Seasonal/condition numeric coverage | Partial | Three explicit aspects; broader original axes not established |
| Languages | Partial | English/Spanish; French absent; source/visitor language retained |
| Road difficulty | Partial | Moderated same-visit approach-road reports |
| Fire/weather layers | Partial | Dated perimeters/smoke and issued alerts; broader fire-risk context incomplete |
| Cell tower locations | No | Not implemented; towers would not prove service |

## Qualified amenity source addition

The subsequent [2.20 source package, PR110](https://github.com/prowebpromo/kamptrail/pull/110), adds six details-only groups to the same canonical RIDB export: fire pits/rings, grills, trash collection, food lockers, tent pads and the separately labeled mixed Grills/Fire Ring field. All original five groups, 2,163 exact facility IDs and 53,693 overnight campsite records remain unchanged. Positive mapped evidence increases from 1,031 to 1,088 existing facility IDs: 57 improved evidence matches, **zero new locations**. Counts describe records, not fixture totals or every site. Conflicts override positives; accessible-grill wording does not establish accessible camping, and a fire fixture does not establish permission to light a fire.

The original export was retrieved **2026-10-30T16:33:49.112988+00:00**, with HTTP Last-Modified **2026-10-29T18:46:42Z**. Individual attribute update dates remain unknown. Exact-head [regression 41130480752](https://github.com/prowebpromo/kamptrail/actions/runs/41130480752) passed 331 Node tests, 238 Python tests (eight optional skips), 140 browser tests, native PHP/MySQL, backup restore and packaging; [Lighthouse 41130480131](https://github.com/prowebpromo/kamptrail/actions/runs/41130480131) passed. Production publication and representative qualified-detail checks are recorded in PR110 after deployment. This extends a partial amenity capability and adds no parity points. The score remains 89.9.

The 104 named Utah OSM campsites absent from the October 29 refresh have not been individually traced. This audit does not count them as replaced or new places.
