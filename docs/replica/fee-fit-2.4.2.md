# 2.4.2 fee and site-fit corrections: before and after

Full-data check on 2026-10-28 with the same campsite snapshots: 34,821 deduplicated records after runtime cleanup. Before is main at 153b097. After is this release.

## Fee status totals

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
