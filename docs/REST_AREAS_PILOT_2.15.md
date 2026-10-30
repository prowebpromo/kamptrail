# Official rest-area locations — 2.15 pilot

Status: implemented on the permission release branch; production deployment and migration005 remain gated by production backup verification. This document is not evidence of a live release.

The importer retrieved TxDOT's official location table on October 30, 2026. Its 90 rows contain 78 rest areas and 12 travel information centers. Only the 78 rest-area rows enter this pilot. The page's introductory count differs from the table, so the importer reports the actual parsed rows rather than using that introduction as a count assertion. The two source document hashes, exact retrieval times, exclusions and sample records are in `REST_AREAS_PILOT_2.15.json`.

Sources:

- Location table: https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-list.html
- Visitor duration context: https://www.txdot.gov/discover/rest-areas-travel-information-centers/safety-rest-area-map.html

Every point retains its official detail URL, exact source label, direction/location text and coordinates. Census point containment must unambiguously place every imported point in Texas. A local source key derives from the exact official URL and label because the table supplies no native facility ID. It is not an OSM alias. No proximity or name-only merge changes a campsite identity. The canonical overnight-report place remains the exact map spot, rounded consistently to five decimal places.

The duration page describes stays of up to 24 hours. This is stored separately from overnight-occupancy evidence. All 78 imported locations have **unknown overnight permission**. No source statement about restrooms being open 24 hours, vehicle parking, commercial drivers, or a visitor time limit becomes permission to sleep overnight. Current opening, available spaces, fees and RV fit are not established by this import. No nationwide rest-area coverage is claimed.

The opt-in layer loads only when requested and limits visible markers to the map view. Dated popups link to both relevant source pages. Saved stops retain a labeled source snapshot and open the same scoped permission dialog used for other map spots. The importer fails on changed/ambiguous headers, malformed or duplicate records, unapproved links, invalid/outside-state coordinates and unreviewed source shrink. Failed refreshes preserve the prior catalogue and publish a failed source status. The weekly refresh keeps its existing rebase/retry save behavior.

Static rest-area data remains separate from the campsite catalogue, elevation sidecars, volatile forecast channel and OSM services database. Generic service-worker caching cannot pin it. Offline/failed loads remain explicitly unavailable or unknown. Marker replacement waits while a popup is open.

The feature checklist remains at the verified 2.14 baseline until production deployment and live checks. Rest-area availability and overnight-allowed reports must be reported separately. The Texas pilot does not complete the historical national overnight-parking row.
