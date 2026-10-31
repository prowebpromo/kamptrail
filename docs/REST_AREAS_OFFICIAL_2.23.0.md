# Official rest-area locations, 2.23.0

The opt-in "Official rest areas" map layer now covers five states instead of Texas alone. Each location comes from the managing agency's own published layer and keeps its agency identity, validated coordinates and the original retrieval date. Exact counts and exclusions are in `rest-areas-2.23.0.json`.

## Coverage

| State | Publisher and scope | New locations | Policy applied (overnight parking / sleeping in vehicle / camping, max stay) |
|---|---|---:|---|
| Idaho | Idaho Transportation Department safety rest areas | 27 | unknown / unknown / prohibited |
| Montana | Montana Department of Transportation rest areas it maintains | 49 | allowed with conditions / unknown / prohibited, 12 hours |
| Florida | Florida's Turnpike Enterprise service plazas | 8 | prohibited / unknown / unknown |
| Ohio | Ohio Department of Transportation rest areas and roadside parks | 86 | unknown / unknown / prohibited |
| Texas | TxDOT safety rest areas (unchanged) | 0 (78 existing) | unknown / unknown / unknown, 24 hours |

That makes 170 net new locations, each deduplicated by agency identity and checked for duplicate points, with 248 locations in total. No new location duplicates an existing one, and no existing Texas ID or saved stop changed.

Every location keeps `permission: unknown`. The state policy is shown only for the exact operator and facility class it was reviewed for, from the dated sources in `state-policies.json`. Parking, sleeping, camping, maximum stay and fees stay separate. A listed location never establishes permission. Facility exceptions continue to override only when they tighten a rule. A conflicting exception returns unknown for review.

## Excluded and unresolved

- Montana: 14 parking-only areas and 16 rest areas maintained by cities, tribes or others are outside the MDT scope and were not imported. MDT's records were last edited in 2016. The popup shows that date, and current opening is unknown.
- Idaho: Lost Trail Pass was rejected because its point falls in Montana by Census geometry.
- Ohio: the layer is ODOT's facility inventory, filtered to its rest-area facility type. It has no milepost for most sites and no open or closed status.
- Oregon (not imported): the only layer sits on a personal ODOT staff account with no description, and most of its sites are run by the Oregon Travel Information Council. Publisher and scope are not established.
- Virginia (not imported): VDOT publishes names and mile markers but no coordinates. Geocoding from unofficial sources would not meet the evidence rule.
- No commercial places (Walmart, truck stops, casinos) are included. Those need location-specific evidence.

## Behavior

- The layer loads only when switched on, at zoom 6 or closer, and reports coverage and any region that failed to load.
- Each popup links the agency's place page and its location data, plus the dated state policy sources.
- Saved rest-area stops keep their coordinate identity (`spot:lat,lng`) and name the publisher.
- Offline: rest-area data is not pinned in the offline cache. The layer says to reconnect and keeps permission unknown, as before.
- Rest areas are a separate map layer. They are not mixed into campsite search, nearby or route results.

## Refresh

`scripts/fetch_official_rest_areas.py` refreshes each region from its one reviewed endpoint inside the existing weekly data workflow. A failed, shrunken or truncated source keeps the saved file, and retrieval dates never move backward.

## Checklist effect

The "Overnight parking places" row stays partial. Official locations now cover 5 of 50 states, and commercial overnight places are not covered. Permission remains unknown unless a scoped policy states it.
