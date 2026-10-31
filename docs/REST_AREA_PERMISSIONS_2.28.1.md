# Rest-area permission evidence, 2.28.1

Owner priority, 2026-10-31: improve overnight-permission evidence for the 586 rest areas already mapped before adding more locations.

## Method

Research covered all 13 states from primary sources only: state statute, state administrative code, or the managing agency's own page. Each candidate rule was then checked against raw text captured from the official page on 2026-10-31, with a SHA-256 hash and retrieval date. Text seen only on a mirror or in a summary was not used. Parking, sleeping in a vehicle and camping stay separate, and a duration limit is never treated as permission.

## Changes

| State | Overnight parking | Sleeping in vehicle | Camping | Maximum stay | Source |
|---|---|---|---|---|---|
| Washington (WSDOT) | unknown | unknown | unknown (rule shown as condition) | condition: 8 hours within 24 | RCW 47.38.020, Washington Legislature |
| South Dakota (SDDOT) | unknown | unknown | prohibited | none stated | SDCL 31-7-15, South Dakota Legislature |
| Nevada (NDOT) | unknown | unknown | unknown | condition: 18 hours in any 2-week period | NAC 408.595, Nevada Legislature |

- Washington: the statute bars stopping, standing or parking over 8 hours within 24 hours, and camping or maintaining "a camp, tent, or other sleeping accommodation or facility", except where WSDOT specifically authorizes it. Following the 2026-10-30 convention, the authorization exception is not flattened into a blanket prohibition, so camping stays unknown and the full rule shows as a condition. The statute does not name sleeping in a parked vehicle. Shorter posted zones, the commercial-vehicle allowance and the 48-hour disabled-vehicle limit, itself subject to authorization, are conditions.
- South Dakota: the statute covers rest areas on and adjacent to the interstate system. All 21 imported SDDOT rest areas carry I-90 or I-29 route codes. A future non-interstate record would fall outside the statute, which the condition states.
- Nevada: the regulation limits "parking, camping or occupancy" to 18 hours in any 2-week period. That is a rolling total, so it is a condition, not a per-visit stay limit, matching how Oregon's and Idaho's windowed limits are recorded. It neither grants nor prohibits any activity, so all three stay unknown. Whether NDOT welcome stations are "safety rest areas" under the regulation is not stated.

## Not changed, and why

- California: 21 CCR 2205 appears to prohibit camping and limit stays to 8 hours in 24, but the official regulation site could not be read. Only a mirror was available, so California stays unknown.
- Michigan: MDOT's page labels its rest-area rules as proposed, and the rule text retrieved had no filing date. No adopted rule was retrieved, so Michigan stays unknown.
- Indiana: individual INDOT rest-area pages show "Overnight Parking: No", but the site list loads by script and the two pages found do not map cleanly to the 17 imported records. Next step: match each INDOT page to its record and add facility-level exceptions.
- Kansas and Iowa: no rule found. Kansas law lets KDOT adopt rest-area rules, and no adopted rule was found.
- Texas, Montana, Florida, Idaho and Ohio: rechecked. No unknown field could be resolved from a primary source, and no rule was superseded. Idaho's route-dependent 10 and 16-hour limits and Ohio's three-hour unattended-vehicle rule remain qualified conditions.

## Release

The three new source URLs are added to the exact-URL allowlist in both policy validators. Because that changes the client validator, this ships as 2.28.1 with service-worker cache `kt-v60`.
