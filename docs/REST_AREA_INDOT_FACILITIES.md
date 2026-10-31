# INDOT facility-level overnight parking

Date: 2026-10-31. Follows docs/REST_AREA_PERMISSIONS_2.28.1.md, which left Indiana's 17 records all unknown.

## Acceptance criterion

An Indiana rest area or welcome center shows a facility-level overnight-parking rule only when the Indiana Department of Transportation (INDOT) fact page for that facility:

- has location text identical to the KampTrail record (route, mile marker, direction), and
- gives GPS coordinates within 500 m of the record.

The page's own text is shown with its retrieval date and a link labeled "Facility page checked {date}". Sleeping in a vehicle, camping and stay limits stay unknown because the pages do not address them. Facility evidence older than 180 days returns every field to unknown, the same as state policies.

## Result

| Measure | Count |
|---|---|
| Indiana records | 17 |
| Matched to an INDOT facility page | 16 |
| Page states "Overnight Parking: No" | 16 |
| Unmatched (no INDOT page found) | 1 (Auburn Rest Area, I-69 MM 325) |

Two matches have different names on INDOT's page: "Kankakee Welcome Center" is INDOT's `kankakee-rest-area-southbound` page and "Batesville Westbound Welcome Center" is INDOT's `batesville-welcome-center` page. Both match on identical location text and coordinates (290 m and 473 m). Michigan City's page omits the "Location:" label and carries a closure notice dated "June 5th, duration tbd" beside "Status: Open". KampTrail does not show opening status from these pages. Clear Creek's page says "Status: Closed", which is also not shown.

## Interpretation

"Overnight Parking: No" sits in a facility fact list next to items such as "Vending Machines: Yes". KampTrail reads it as overnight parking not permitted at that facility and records `overnight_parking: prohibited`. It is the operator's own statement, not a statute or posted sign. The exact text is shown so visitors can judge it. This reading tightens a field and never grants a permission.

## Implementation

- `scripts/fixtures/rest_area_state_policies.json` gains `exceptions`, one per matched facility, published by `node scripts/build-rest-policies.js`.
- Both validators accept INDOT facility pages only under `https://www.in.gov/indot/resources/maps/welcome-centers-and-rest-areas/<slug>` with no query or fragment.
- Facility exceptions may carry up to four conditions (500 characters each), appended after the state policy's conditions.
- `scripts/match_indot_facility_pages.py` reproduces the capture and match. Its output is reviewed by hand before it enters the fixture.

## Refresh

Facility evidence expires 180 days after capture (2027-04-29). Rerun the matcher before then and review any change, including a page switching to "Yes", which the matcher refuses to record without review.
