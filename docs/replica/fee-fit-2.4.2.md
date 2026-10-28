# 2.4.2 fee and site-fit corrections: before and after

Full-data check on 2026-10-28 with the same campsite snapshots: 34,821 deduplicated records after runtime cleanup. Before is main at 153b097. After is this release.

## Source records (before deduplication)

Each source file is counted on its own. One campground can appear in several sources.

| Source | Records | free | conditional | paid | unknown |
| --- | --- | --- | --- | --- | --- |
| USFS before | 4,481 | 651 | 72 | 2,937 | 821 |
| USFS after | 4,481 | 669 | 41 | 2,800 | 971 |
| BLM before | 843 | 169 | 20 | 220 | 434 |
| BLM after | 843 | 169 | 13 | 217 | 444 |
| Recreation.gov facility summaries before | 1,425 | 29 | 0 | 163 fee text + 1,196 reservable only | 37 |
| Recreation.gov facility summaries after | 1,434 | 37 | 3 | 372 | 1,022 |

The Recreation.gov after-count is rebuilt from the campsite-level RIDB export downloaded 2026-10-28. Reservability is no longer a fee. Paid from fee text rises because the shared classifier now reads amounts and charge statements the old narrow rule missed.

## Deduplicated listings (what the map shows)

| Status | Before | After |
| --- | --- | --- |
| free | 2,234 | 2,258 |
| conditional | 95 | 57 |
| paid | 9,812 | 8,885 |
| unknown | 22,680 | 23,621 |

## What changed and why

| Change | Records | Example wording |
| --- | --- | --- |
| paid → unknown: Reservability or a pointer to Recreation.gov is not camping-fee evidence | 953 | Starrigavan Campground: "Reservable on Recreation.gov" / GRANITE CREEK: "Reservable on Recreation.gov" |
| conditional → paid: Camping is charged. Free applies only to something else | 36 | South Fourche Recreation Area: "Day Use: Free Campground: $5/night" / Spring Lake Recreation Area: "Campground - $15/site/day. Day Use - $4/vehicle/day. Day Use Boat Ramp- $4.00/day (Boat ra" |
| unknown → free: Explicit no-charge wording now recognized | 12 | Margies Cove West Trailhead: "Recreation.gov fee description" / Horse Mountain Primitive Camp: "Recreation.gov fee description" |
| paid → free: "No fee to camp" was misread as a camping fee | 12 | Honeymoon Campground: "There is no fee to camp." / Fr 9350 Campground: "There is no fee to camp here" |
| conditional → free: "No fee to camp" was misread as a camping fee | 5 | Blue Crossing Campground: "There is no fee to camp at Blue Crossing Campground." / Upper Blue Campground: "There is no fee to camp at Upper Blue Campground." |
| free → unknown: Free applies to day use, admission or services, not camping | 3 | Bear Creek Lake Recreation Area: "None for Day Use" / Canyons of the Ancients National Monument: "Monument access and visitor information and services is free. The Visitor Center has a sma" |
| unknown → paid: States a fee without an amount | 3 | Idlewild Campground: "There is a fee. Check the campground table for more information." / Lower Penstemon Campground: "This is a fee campground. Fee envelopes and a collection box are provided near the entranc" |
| free → conditional: Free only in some seasons | 2 | Clints Well Campground: "Fee-free after September 29." / Kehl Springs Campground: "Fee-free until October 27, 2024" |
| paid → conditional: Free camping in some seasons or sites, with a charge otherwise | 1 | John Day Wild and Scenic River: "No use fees outside of high season. One fee campsite within WSR corridor (Service Creek at" |


## Changed examples

| ID | Listing | Source wording | Old | New |
| --- | --- | --- | --- | --- |
| ridb:233994 | Starrigavan Campground | Reservable on Recreation.gov | paid | unknown |
| ridb:234112 | GRANITE CREEK | Reservable on Recreation.gov | paid | unknown |
| ridb:234504 | MENDENHALL CAMPGROUND | Reservable on Recreation.gov | paid | unknown |
| usfs:10773 | South Fourche Recreation Area | Day Use: Free Campground: $5/night | conditional | paid |
| usfs:43487 | Spring Lake Recreation Area | Campground - $15/site/day. Day Use - $4/vehicle/day. Day Use Boat Ramp- $4.00/day (Boat ramp free on west side of lake). | conditional | paid |
| ridb:202267 | Owl Creek Campground | The fee for overnight use, with two vehicles per night, is currently $5. Per additional vehicle is $2. The Senior and Ac | conditional | paid |
| ridb:274335 | Margies Cove West Trailhead | Recreation.gov fee description | unknown | free |
| ridb:262796 | Horse Mountain Primitive Camp | Recreation.gov fee description | unknown | free |
| ridb:264294 | Jouflas Campground | no use fee | unknown | free |
| ridb:241562 | Honeymoon Campground | There is no fee to camp. | paid | free |
| usfs:44651 | Fr 9350 Campground | There is no fee to camp here | paid | free |
| usfs:44667 | Granville Campground | There is no fee to camp. | paid | free |
| usfs:44717 | Blue Crossing Campground | There is no fee to camp at Blue Crossing Campground. | conditional | free |
| usfs:44727 | Upper Blue Campground | There is no fee to camp at Upper Blue Campground. | conditional | free |
| usfs:41512 | Shirley Creek Campground | No fee for camping. | conditional | free |
| ridb:241301 | Bear Creek Lake Recreation Area | None for Day Use | free | unknown |
| blm-area:3114 | Canyons of the Ancients National Monument | Monument access and visitor information and services is free. The Visitor Center has a small admission fee. | free | unknown |
| usfs:63484 | Diamond Lake Resort | Contact Diamond Lake Resort for current fees for lodging, recreation & equipment rentals (541) 793-3333 Diamond Lake Res | free | unknown |
| ridb:241252 | Idlewild Campground | There is a fee. Check the campground table for more information. | unknown | paid |
| usfs:5771 | Lower Penstemon Campground | This is a fee campground. Fee envelopes and a collection box are provided near the entrance. | unknown | paid |
| ridb:255188 | Spring Recreation Site | Recreation.gov fee description | unknown | paid |
| usfs:54902 | Clints Well Campground | Fee-free after September 29. | free | conditional |
| usfs:54916 | Kehl Springs Campground | Fee-free until October 27, 2024 | free | conditional |
| blm-area:16830 | John Day Wild and Scenic River | No use fees outside of high season. One fee campsite within WSR corridor (Service Creek at $5 per night). Three campsite | paid | conditional |

## Probes from the audit

| Wording | Before | After |
| --- | --- | --- |
| Camping is not free. | free | paid |
| Free drinking water is available. | free | unknown |
| Blank fee, reservable on Recreation.gov | paid | unknown, reservable shown as information |
| For current fees, please go to Recreation.gov | paid | unknown |

## Joint site fit: rig length and hookups on one campsite

A filter for 40 ft + electric matched 332 campgrounds before and 324 after. Each of the 8 removed campgrounds has long sites without power and powered sites that are shorter. None was added.

| Campground | Relevant site signatures [length ft, hookup bits, sites] |
| --- | --- |
| WARM RIVER (ridb:232223) | [[30, 3, 2], [40, 0, 4], [45, 0, 1]] |
| SMOKEMONT CAMPGROUND (ridb:232486) | [[30, 1, 1], [35, 1, 1], [40, 0, 73]] |
| Simax Group Camp (ridb:232779) | [[25, 1, 1], [40, 0, 1]] |
| RANCHERIA (ridb:232815) | [[40, 0, 7], [41, 0, 4], [42, 0, 2], [43, 0, 1], [44, 0, 1], [45, 0, 1]] |
| Hellgate Campground (ridb:249999) | [[0, 1, 2], [40, 0, 11], [41, 0, 1], [45, 0, 2], [46, 0, 1], [47, 0, 1]] |
| YAVAPAI CAMPGROUND (ridb:251964) | [[37, 1, 1], [40, 0, 12]] |
| Kentuck Lake Campground (ridb:255124) | [[30, 1, 1], [35, 1, 1], [40, 0, 12]] |
| White Sandy Campground (ridb:261822) | [[0, 1, 1], [50, 0, 1], [60, 0, 11]] |

Hookup bits: electric 1, water 2, sewer 4. Unit tests cover a synthetic 50 ft unpowered site plus a 20 ft powered site (no match for 40 ft + electric) and a single 45 ft powered site (match).
