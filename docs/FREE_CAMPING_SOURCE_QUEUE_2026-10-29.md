# Official free-camping source queue

Checked: **2026-10-29 UTC**. Read-only research using bounded public API requests and official pages; no imports, scraping pipeline, authentication, or agency outreach. Counts describe source records, not deduplicated public camping locations. Local proximity comparisons used the refreshed state merged files in this worktree and a 300-metre radius; they are screening estimates, not the production deduplication result.

## Priority and readiness

| Priority | Source | Verified inventory | Expected gain and readiness |
| --- | --- | --- | --- |
| 1 | Southwest Florida Water Management District (SWFWMD) | 58 camping points; 31 district-managed and 27 partner-managed | Roughly 20 possible additional camping locations after existing-marker and within-source consolidation. Not a final count. Free camping requires a free reservation/permit, so retain conditional access requirements. Check dated closures before publication. |
| 2 | New York DEC, OpenNY publication | 1,456 `PRIMITIVE CAMPSITE` records | Potentially substantial, but no defensible net-new estimate yet. Reuse conflict remains unresolved; do not import until the applicable grant is clear. Per-unit fee and closure evidence required. |
| 3 | Missouri Department of Conservation (MDC) | 620 camping points: 584 primitive and 36 designated | Not deduplicated. Current free policy becomes a general paid-permit requirement in March 2027. GIS redistribution permission remains unresolved. |
| 4 | Florida Fish and Wildlife Conservation Commission (FWC) | Available camping-amenity layer represents entrances | No import-ready campsite gain from entrance coordinates. Actual campsite geometry and total access costs must be established first. |

## SWFWMD: best near-term candidate

### Feed and fields

- [Camping layer metadata](https://services1.arcgis.com/gdr0FcZCwx1BmrQk/arcgis/rest/services/RecreationGuide/FeatureServer/4)
- [Query endpoint](https://services1.arcgis.com/gdr0FcZCwx1BmrQk/arcgis/rest/services/RecreationGuide/FeatureServer/4/query)
- Dataset description identifies **camp sites**, not entrances.
- Verified count queries: `1=1` returns **58**; `PARTNERSITE IS NULL` returns **31**; `PARTNERSITE = ''` returns **0**.
- Request `outSR=4326`. Retain `OBJECTID`, `CAMP_SITE_NAME`, `CAMP_TYPE_TXT`, `LAND_PROJECT_NBR`, `LAND_PROJECT_NAME`, `PROJECT_ALTERNATE_NAME`, `PARTNERSITE`, `MAPURL`, `GIS_UPDATE_DT`, `ADA_ACCESSIBLE_FLG`, `WATER_AVAILABLE_TXT`, `TABLES_AVAILABLE_FLG`, `FIRE_RINGS_FLG`, `GRILLS_AVAILABLE_FLG`, `RESTROOM_TYPE_TXT`, and `FLORIDA_TRAILS_FLG`.
- There is **no fee or closure field**. `GIS_UPDATE_DT` concerns the GIS feature, not fee-policy freshness. Many dates are old. Keep retrieval time separate from source-update time.
- Use the layer ID and `OBJECTID` as source provenance, retain the land-project join, and detect identifier/geometry changes between snapshots. No long-term object-ID stability guarantee was verified.
- Check counts and transfer limits before replacing a snapshot. Do not silently publish a partial response.

### Fee, access, and closure evidence

[Official camping rules](https://www.swfwmd.state.fl.us/recreation/camping) require a **free reservation** and valid camping permit/Special Use Authorization before arrival. Reservations must be made no later than the preceding day. Limits are seven consecutive days and 30 days per calendar year. Groups of 25 or more require a special recreational-use reservation. Preserve the requirement as conditional access; do not equate a no-cost permit with unrestricted camping.

The rules distinguish tent-oriented primitive camping, foot/water-access backcountry camping, and equestrian camping. Do not infer general RV access, hookups, or generator permission from the existence of a camping point. The 27 partner-managed records cannot inherit district camping or fee policy.

[Current closure list](https://www.swfwmd.state.fl.us/recreation/closed-recreation-sites), checked October 29, lists:

| Property | Published closure interval | Reason |
| --- | --- | --- |
| Alston Tract | October 27–29, 2026 | Hunting |
| Lake Panasoffkee | October 25–30, 2026 | Hunting |
| Potts Preserve | October 29–November 1, 2026 | Hunting; listed address identifies equestrian camping |
| Chito Branch Reserve | October 27–29, 2026 | Hunting; not a reason to discard unrelated campsite records |

These are dated restrictions, not permanent closures. Preserve their stated scope; do not infer a precise reopening time from a date-only interval.

[Flying Eagle Preserve](https://www.swfwmd.state.fl.us/recreation/flying-eagle-preserve) identifies separate equestrian and primitive camping, free reservations, and **future** hunting closures beginning November 6–10, November 12–17, and November 26–29, 2026, with additional later dates. Its global “4 recreation sites are closed” banner does **not** establish that Flying Eagle is currently closed. Recheck the property schedule for travel dates.

### Reuse evidence and estimated gain

[Official GIS/Open Data page](https://www.swfwmd.state.fl.us/resources/data-maps/gis-maps-survey) expressly offers downloadable GIS data for governmental agencies, private businesses, and the public. [District privacy/disclaimer page](https://www.swfwmd.state.fl.us/about/privacy) supplies accuracy/liability limitations. No dataset-specific redistribution prohibition was found; the service item's licence/access-information fields were blank. This is evidence of an official public data offering, **not** a verified CC0 or other named licence. Preserve district attribution and provenance and document the applicable terms before implementing.

Among the 31 district records, six had an existing marker within 300 metres. Several remaining records are nearby subareas of the same campground, and some are group-oriented. Therefore 25 unmatched source points should not be advertised as 25 new campgrounds. Approximately **20** additional locations is a planning estimate, before final deduplication and closure/access checks.

Examples without an existing marker within 300 metres in the bounded comparison: High Bluff, Tillman, Trail Ford, Mott Hammock, Eastern Amberwing, Holly Tree, Compressco 1, McNeil, Washburn, and Oakridge. A name on this list does not certify current availability or vehicle suitability.

## New York DEC: larger inventory, unresolved reuse conflict

### Publication and field contract

- [OpenNY dataset](https://data.ny.gov/d/yvkb-z58x)
- [Socrata JSON endpoint](https://data.ny.gov/resource/yvkb-z58x.json)
- [Dataset metadata](https://data.ny.gov/api/views/yvkb-z58x.json)
- [Owner's overview attachment](https://data.ny.gov/api/views/yvkb-z58x/files/905634ed-548d-4f74-bce3-3c1ce06b5df6?download=true)
- [Owner's data dictionary](https://data.ny.gov/api/views/yvkb-z58x/files/ebdbd480-3234-4936-83ce-fac9edf134d8?download=true)

Verified asset counts: **1,456 `PRIMITIVE CAMPSITE`**, 792 `CAMPSITE`, 14 `ACCESSIBLE CAMPSITE`, and three `CAMPGROUND`. Do not include the other categories as free by inference. They include developed paid camping.

Fields are `facility`, `name`, `asset`, `latitude`, `longitude`, `location`, and `georeference`. Socrata `:id` is queryable, but its persistence through publisher replacements was not verified. There is no published DEC asset UID in this feed, no per-row fee or closure field, and no verified per-row update time.

The API reports `rowsUpdatedAt=1735102253`, or **2024-12-25T04:50:53Z**. Newer catalogue metadata dates must not be presented as fresh campsite observations. The owner describes updates as “As needed” and warns that locations are approximate and incomplete.

### Permission conflict: hold import

[OpenNY terms landing page](https://data.ny.gov/dataset/OPEN-NY-Terms-Of-Use/77gx-ii52) and its [terms PDF](https://data.ny.gov/download/77gx-ii52/application/pdf) allow use/reuse of OpenNY content and say preapproval and attribution are not generally required. They also retain content-specific terms, protect third-party material, and include a supersession clause concerning earlier agreements for OpenNY content. The PDF itself says last modified **March 8, 2013**; a newer landing-page date is not the terms' effective date.

However, [DEC's legacy ArcGIS metadata](https://www.arcgis.com/sharing/rest/content/items/53f20396032e48879a5cfdce14fbd0bf/info/metadata/metadata.xml?format=default&output=html) expressly restricts distribution outside DEC without permission and disallows secondary distribution. The related [legacy primitive-campsite service](https://gisservices.dec.ny.gov/arcgis/rest/services/dil/dil_land_assets_prm_cmp/MapServer/0) has **2,079** points. That count belongs to the legacy service, **not** the OpenNY publication.

OpenNY attributes the dataset to DEC, but its licence field is null. The owner overview contains accuracy limitations, not an express statement resolving the older restriction. Publication through another endpoint must not automatically be treated as overriding a dataset-specific restriction. **No import until the applicable owner grant is clear.** No permission request was sent. Do not enrich the OpenNY records with restricted legacy-service fields as a workaround.

### Free policy and gain limits

[DEC primitive-camping rules](https://dec.ny.gov/things-to-do/camping/primitive) establish general camping and permit restrictions, not proof that every mapped primitive campsite is free or suitable for a vehicle.

Useful unit-specific evidence:

- [Moose River Plains Complex](https://dec.ny.gov/places/moose-river-plains-complex): published free fee policy and roadside camping, but **campsites 1–20 closed** due to the Payne Brook bridge failure when checked. The page describes 116 campsites; OpenNY has 81 primitive records for the camping area, indicating incomplete or differing inventory coverage.
- [Saranac Lakes Wild Forest](https://dec.ny.gov/places/saranac-lakes-wild-forest): free unit policy; distinguish separate developed campgrounds and applicable restrictions.
- [William C. Whitney and Round Lake wildernesses](https://dec.ny.gov/places/william-c-whitney-wilderness-and-round-lake-wilderness): free unit policy, with backcountry access and restrictions.
- [Stoney Pond State Forest](https://dec.ny.gov/places/stoney-pond-state-forest): free fee policy, 17 designated campsites, seasonal permit/reservation requirements, and tent-only sites 16 and 17. Preserve its specific rules rather than applying a statewide default.
- [Taylor Pond Wild Forest](https://dec.ny.gov/places/taylor-pond-wild-forest): counterexample; some primitive sites associated with the campground require overnight fees during its operating season.

A bounded sample of 60 Moose River Plains points had 54 without a current marker within 300 metres. This is **not** an expected gain: closed sites, numbered sub-sites, and duplicate/facility aggregation require review. No statewide net-new estimate is justified yet.

## Missouri MDC: current free camping, general fee coming in March 2027

- [Camping service](https://gisblue.mdc.mo.gov/arcgis/rest/services/Infrastructure/Camping/MapServer)
- [Camping point layer](https://gisblue.mdc.mo.gov/arcgis/rest/services/Infrastructure/Camping/MapServer/0)
- [Query endpoint](https://gisblue.mdc.mo.gov/arcgis/rest/services/Infrastructure/Camping/MapServer/0/query)

Verified count: **620** points, comprising **584 Primitive Camping Area** and **36 Designated Camping Area** records. Fields: `OBJECTID`, `Type`, `Area_ID`, `Area_Name`, plus point geometry. Request `outSR=4326` rather than interpreting native projected coordinates as longitude/latitude. The service advertises a 1,000-record cap. Count/completeness checks still apply.

No fee, closure, source-page URL, or update field was found. Join authoritative area rules through `Area_ID`; do not fabricate URLs from names. Multiple points can belong to the same conservation area. These 620 records do not mean 620 distinct new public campgrounds, and no local deduplication estimate was completed.

[Current MDC camping guidance](https://mdc.mo.gov/discover-nature/activities/camping) describes free camping, generally first-come/first-served, with area-specific restrictions and permits. Check hunting-season closures, group requirements, and each area's rules.

[Official October 26, 2026 announcement](https://mdc.mo.gov/newsroom/campers-will-need-permits-camp-mdc-areas-starting-march) reports final commission approval on October 23. **Starting in March 2027**, ordinary campers must buy a **$5 permit covering up to five days and ten people**, even if fewer days or people are involved. Groups exceeding ten additionally need a Special Use Permit and camping permit. This is **not group-only**. The announcement does not specify the exact day in March; do not invent March 1 as the legal effective date. Each person is limited to three consecutive and six annual camping permits under the announced rules.

Any future importer needs a dated fee-policy transition and must not continue labelling these sites unconditionally free after the new requirement takes effect. The current-free opportunity is short-lived.

[MDC terms](https://mdc.mo.gov/terms-use) restrict reproduction of website text, images, and videos without written permission. No independent affirmative redistribution grant for this GIS layer was verified. Do not copy descriptions or assume a public endpoint grants a licence. Permission status is **unresolved**, not a finding that all factual GIS reuse is prohibited. No outreach was sent.

## FWC: do not convert entrances into campsites

The [WMA amenities layer](https://gis.myfwc.com/mapping/rest/services/Projects_FWC/WMA_Amenities/MapServer/0) includes `EntranceID`, `NAME_WMA`, `NAME_ENT`, `Camping`, `EntryFee`, `WEBSITE`, `Regulations`, `LAT_dd`, and `LON_dd`. Its points represent entrances. A camping flag describes an amenity associated with the area; it does not locate a legal overnight site.

[FWC camping guidance](https://myfwc.com/recreation/camping/) says requirements vary by property. [Public-land-use permit guidance](https://myfwc.com/license/public-land-use/) identifies WMAs requiring daily-use or management-area permits; the annual option is $26.50. Thus a no-cost camping permit does not establish zero total access cost. [Three Lakes camping guidance](https://myfwc.com/recreation/lead/three-lakes/things-to-do/camping/) illustrates seasonal, reservation, and hunt-related restrictions.

The inspected FWC GIS metadata describes public-domain/unrestricted use with attribution and metadata retention, but that does not resolve the geometry and fee problems. This layer is unsuitable for creating campsite markers. A future package needs actual designated-campsite geometry, source-specific reuse evidence retained with it, and a complete access-cost check.

## Follow-up acceptance criteria

1. Establish applicable data-reuse terms and retain the exact source/version; do not use endpoint accessibility as permission evidence.
2. Require actual camping-location geometry and official onsite camping evidence; exclude entrances, parking, trailheads, and administrative centroids.
3. Keep full fee evidence, mandatory permits/reservations, group and vehicle restrictions, current closures, scheduled closures, and effective dates separate.
4. Count distinct source records and validate completeness before replacing a snapshot; retain the previous snapshot on failure.
5. Compare against existing merged markers and within-source sub-sites before claiming gains. Report net new public free/conditional camping locations separately from raw inventory and closed records.
6. None of these research results authorizes a bulk crawler, prohibited-site scraping, or agency outreach.
