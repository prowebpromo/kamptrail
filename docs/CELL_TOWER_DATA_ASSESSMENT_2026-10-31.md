# KampTrail cell-tower layer: data source assessment

Date: 2026-10-31. Research only. Nothing downloaded, no terms accepted, no accounts created, nothing imported. The parked FCC modeled-coverage case is separate and unchanged. A tower location never establishes coverage.

Method note: the session allowlist blocked several primary pages (opencellid.org, wiki.opencellid.org, the main fcc.gov ASR page, fcc.gov ULS page, hifld-geoplatform, usa.gov, opendatacommons.org, OSM Overpass policy). Two FCC PDFs and one fcc.gov page failed to load. Items that rest on secondary pages or on background knowledge are marked UNVERIFIED.

## Comparison table

| # | Dataset | Publisher | Status 2026-10-31 | License (as found) | Account or key | Record meaning | Carrier named | Fit |
|---|---|---|---|---|---|---|---|---|
| 1 | Antenna Structure Registration (ASR) public access files | FCC | Live. Weekly and daily zip files | FCC download page states no terms. UNVERIFIED, federal works are normally public domain | None stated | Registered antenna structure (not a cell site) | Owner entity only, often a tower company | Fit, pilot only |
| 2 | ULS cellular/AWS/PCS site data | FCC | Live (same download page) | Same as above. UNVERIFIED | None stated | License location records. Site-level cellular coordinates UNVERIFIED | Licensee | Weak fit, UNVERIFIED |
| 3 | OpenCelliD | Unwired Labs | Online per secondary sources. Official pages not fetchable | CC BY-SA 4.0 (secondary sources) | API token for download | Crowd-sourced estimated cell position | Via MCC/MNC in data. UNVERIFIED | No fit |
| 4 | Mozilla Location Service | Mozilla | Retired. Downloads deleted 2024-04-10 | Not applicable | Keys removed | Crowd-sourced observations | n/a | No fit |
| 5 | HIFLD Open "Cellular Towers" | DHS HIFLD (data from FCC) | Data.gov record shows last update 2022-10-24. HIFLD Open ended, archived 2025-08-26 by Data Rescue Project | usa.gov/government-works on Data.gov record. Archive page states none | None for archive. Successor access UNVERIFIED | FCC ULS tower location records | Licensee field present | No fit as live source |
| 6 | OpenStreetMap mast/tower features | OSMF and contributors | Live | ODbL | None for planet extracts. Overpass limits UNVERIFIED | Volunteer-mapped physical structure | Not reliable | Fit only if owner accepts ODbL |
| 7a | HIFLD Next | Public Environmental Data Partners | Launched Mar 2026, volunteer project | Not stated | Not stated | Mirror of HIFLD Open archive | See #5 | No fit (license unknown) |
| 7b | State GIS mirrors of FCC data (Arkansas, Minnesota) | State agencies | Live, annual updates | Arkansas: "No license information was provided" with as-is disclaimer | None | FCC ASR points, clipped | Not stated | No fit (use FCC direct) |

## Candidate detail

### 1. FCC Antenna Structure Registration (ASR)
- Name: ASR database public access files, part of "Public Access Files - Database Downloads".
- Publisher: Federal Communications Commission.
- URL: https://www.fcc.gov/node/215180 (fetched OK). Describes ULS and ASR zip downloads.
- Availability: live. Files come as weekly transactions plus a six-day sequence of daily transactions. Some files are very large. The page states no terms of use.
- License: none stated on the page. UNVERIFIED whether the FCC site terms add conditions. Confirm on the FCC site terms page before launch (not retrieved).
- Record count: not stated. UNVERIFIED.
- Meaning: a registered structure. ASR covers structures that meet FAA or FCC notification thresholds. Many cell sites on rooftops or short poles are absent. Many ASR towers carry no cellular antennas (broadcast, microwave, paging).
- Accuracy: Arkansas state mirror says the data is as-is and not authoritative for engineering, legal, or site-specific use (https://catalog.data.gov/dataset/asr-towers-fcc-point). The FCC coordinate accuracy rule is UNVERIFIED here.
- Carrier: owner entity only. Owner is often a tower company, not the carrier serving users.
- File and field layout: UNVERIFIED. The FCC ASR documentation PDF (https://FCC.gov/sites/default/files/pubacc_asr_intro.pdf) failed to load.

### 2. FCC ULS cellular/AWS/PCS site data
- Same download page as above: https://www.fcc.gov/node/215180.
- The NASA-hosted HIFLD copy of FCC data lists fields licensee, callsign, locnum, lat_dms, lon_dms, locadd, towreg, structype (https://maps.nccs.nasa.gov/mapping/rest/services/hifld_open/communications/MapServer/3). It says the points come from the FCC ULS database. This shows location records exist in ULS.
- UNVERIFIED: whether current cellular, AWS, and PCS licenses carry per-site coordinates. Those services are mostly licensed by geographic market, so site-level data is likely thin or absent. Do not plan on this source.
- Carrier: licensee name is in the record.

### 3. OpenCelliD
- Publisher: Unwired Labs. Official site https://opencellid.org/ was blocked by the allowlist, so license text is unverified from the primary page.
- License per secondary sources: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). Sources: https://en.wikipedia.org/wiki/OpenCelliD and https://source.coop/smartmaps/opencellid (redistributor page: "CC-BY-SA-4.0", attribution to opencellid.org, original download needs an API token).
- Unwired Labs blog says the database "stays open" and downloads continue (https://unwiredlabs.com/blog/?p=226). It states no license.
- Count: about 35.5 million cells in 2017 (Wikipedia, stale). Current count UNVERIFIED.
- Meaning: crowd-sourced estimated cell positions from device measurements. Not a surveyed tower location. One tower can appear as many cells, and positions can be far off.
- Obligations: attribution, share-alike on adapted material, account and token to download. Rate limits and commercial terms UNVERIFIED.
- Verdict: needs an account and carries share-alike. Both need owner approval, and the data quality fits the purpose poorly.

### 4. Mozilla Location Service
- Retired. Schedule from https://discourse.mozilla.org/t/retiring-the-mozilla-location-service/128693 (fetched OK):
  - 2024-03-13 new API keys stop.
  - 2024-03-27 submissions stop and new cell exports end.
  - 2024-04-10 cell data downloads deleted.
  - 2024-06-12 third-party API keys removed.
  - 2024-07-31 Ichnaea repository archived (Apache License 2.0 code only).
- No data available. No fit.

### 5. HIFLD Open "Cellular Towers"
- Name: Cellular Towers. Publisher: HIFLD, DHS. Contact edmo@hq.dhs.gov.
- URL: https://catalog.data.gov/dataset/cellular-towers (fetched OK). License link: https://www.usa.gov/government-works (not fetched). Last updated 2022-10-24. No data file link, no record count, no accuracy notes.
- Archive: https://portal.datarescueproject.org/datasets/hifld-open-cellular-towers/ says source is the FCC, archived 2025-08-26, no dataset license stated, known errors in latitude, longitude, ground elevation, and frequency data, intended for GIS planning not engineering. Archive file is on DataLumos project 238960.
- HIFLD Open was deprecated. See https://www.napsgfoundation.org/navigating-the-hifld-transition/ (exact end date not stated on the page). HIFLD Secure needs Login.gov and a profile.
- Successor HIFLD Next (https://www.fgdc.gov/ngac/meetings/August_2026_Public_Meeting/HIFLDNext_LightningTalk_Aug2026): volunteer project, launched March 2026, license not stated, archived data not guaranteed trustworthy.
- Verdict: stale snapshot of FCC data. Go to the FCC directly.

### 6. OpenStreetMap
- Tags: man_made=mast, tower:type=communication, communication:mobile_phone=yes (https://wiki.openstreetmap.org/wiki/Key:communication:mobile_phone, fetched OK). The tag marks that a feature carries mobile phone antennas. Antennas on other structures use man_made=communications_tower, tower, chimney, water_tower, or power=tower plus the tag. Small rooftop antennas may be separate man_made=antenna nodes.
- License: "Open Data Commons Open Database License" (ODbL). https://www.openstreetmap.org/copyright (fetched OK). Requires crediting OpenStreetMap and making clear the data is under ODbL. Altered or built-on data may be distributed only under the same license.
- Practical effect: a KampTrail table of tower points extracted from OSM is likely a derived database that must be offered under ODbL. Whether a rendered map layer counts as a "produced work" with lighter duties is UNVERIFIED here. Get a legal read.
- Meaning: volunteer-mapped. Coverage is uneven. Carrier tags (operator, network) are not covered on the fetched wiki page, so carrier data is not reliable.
- Counts: use taginfo per region. UNVERIFIED.
- Overpass API fair-use limits: UNVERIFIED. Use regional Geofabrik extracts only if the owner approves ODbL.

## Recommendation

Best fit: FCC ASR public files, with a regional pilot. It is government data, needs no account or key on the pages reviewed, and records a real surveyed structure. It does not tell users where service exists, and it is incomplete. The layer must say so.

Obligations if the FCC page and site terms are confirmed to impose none:
- Credit line: "Source: FCC Antenna Structure Registration public data, retrieved [date]." Credit is a courtesy, not a verified requirement. UNVERIFIED.
- No share-alike, no fee, no account on the pages reviewed.

Required on-screen text, shown when the layer is toggled on and in the legend and every popup:
- Layer label: "FCC-registered antenna structures".
- Banner: "A tower on this map does not mean cell service. Registered structures include broadcast, radio, and other towers. Many cell sites are not registered. Service depends on carrier, band, terrain, and tower equipment. Check your carrier's coverage map."
- Popup fields: registration number, structure type, height if present, and the data retrieval date. Do not show the owner as a carrier. Do not use phone or signal icons. Use a neutral mast marker. No coverage circles, no "bars" wording, no "best carrier" ranking.
- Layer off by default.

Smallest safe import scope:
1. One pilot: New York State, or the Adirondack and Catskill campgrounds region.
2. Import only structure id, lat, lon, structure type, height, status. Skip owner names and street addresses.
3. Filter to active (constructed or granted) registrations.
4. Store in one MySQL table with a source_date column. Serve as a cached GeoJSON bounding-box query. Cap points per response and cluster at low zoom.

Update process:
1. Owner-approved monthly cron on the host. FCC publishes weekly. Monthly is enough for this use.
2. Fetch the weekly full file, validate row counts against the last import (reject a swing over 10 percent), load to a staging table, swap on success.
3. Show "data as of" date in the layer panel.
4. Avoid weekend runs unless fully automated, which a cron job is.
5. Remove structures marked dismantled or cancelled.

Blockers needing owner approval:
- Confirm FCC data terms. The FCC terms page and ASR documentation were not retrievable here. Confirm there is no acceptance step before any download.
- Approve the on-screen disclaimer wording and the neutral marker design.
- Approve the pilot region and the monthly cron.
- Do not use OpenCelliD (account and token, CC BY-SA share-alike). Do not use OSM unless the owner accepts ODbL share-alike on the tower table.
- Legal review of liability if a user infers coverage from a tower marker (campers in backcountry, safety context).
- Verify the ASR file layout and the coordinate datum and accuracy rule before building the importer.

## Sources
- https://www.fcc.gov/node/215180
- https://catalog.data.gov/dataset/asr-towers-fcc-point
- https://catalog.data.gov/dataset/cellular-towers
- https://maps.nccs.nasa.gov/mapping/rest/services/hifld_open/communications/MapServer/3
- https://portal.datarescueproject.org/datasets/hifld-open-cellular-towers/
- https://www.napsgfoundation.org/navigating-the-hifld-transition/
- https://www.fgdc.gov/ngac/meetings/August_2026_Public_Meeting/HIFLDNext_LightningTalk_Aug2026
- https://discourse.mozilla.org/t/retiring-the-mozilla-location-service/128693
- https://en.wikipedia.org/wiki/OpenCelliD
- https://source.coop/smartmaps/opencellid
- https://unwiredlabs.com/blog/?p=226
- https://www.openstreetmap.org/copyright
- https://wiki.openstreetmap.org/wiki/Key:communication:mobile_phone
- https://iftdss.firenet.gov/firenetHelp/help/pageHelp/content/10-mapstudio/reflayermetadata/infrastructure/commtwr_m.htm

## Addendum, 2026-10-31: FCC ASR follow-up verification

Research only. Nothing downloaded, no terms accepted, no accounts created, nothing imported. The cell-tower layer stays parked.

### What an ASR record identifies

An ASR record is a registered antenna structure: a tower or other structure tall enough, or close enough to an airport, to require FAA or FCC notification. It is not a cell site and not evidence of cellular service. Many registered structures carry only broadcast, microwave, paging or other non-cellular antennas. Many cell sites (rooftops, short poles, small cells) are below the registration threshold and are absent. The owner field names the structure owner, often a tower company, not a carrier serving users. Any KampTrail wording must call these "FCC-registered antenna structures", never "cell towers", and must not imply carrier coverage.

### Verification status

| Item | Status | Basis |
|---|---|---|
| Reuse terms on the download page | Partly verified | The ULS/ASR download page states no license, attribution rule, acceptance step or redistribution limit. Archived FCC web policy pages (2012, 2020) state none either. |
| Reuse terms overall | Unresolved | The current FCC website terms page was not retrieved. An absence of stated terms is not proof that none apply. Owner or counsel confirmation is still required before import. |
| Click-through or account on download | Partly verified | The page text describes plain zip downloads and mentions no agreement or login. Page text cannot show a script-driven prompt. Confirm on first manual visit. |
| Record types | Partly verified | FCC intro document (2013 archive): RA registration, EN names and addresses, CO coordinates, RE remarks, SC special conditions, HS history. Pipe-delimited, joined on registration number. |
| Coordinates | Partly verified | CO holds latitude and longitude as degrees, minutes, seconds (state GIS metadata). Hemisphere field not confirmed. |
| Structure type, overall height, status fields | Unverified | The current field-definition document did not load. Do not build the importer until these are confirmed. |
| Datum and accuracy | Unverified at the FCC | One state repackaging is NAD83. That is the state's statement, not the FCC's. No positional accuracy figure found. |
| Cadence | Partly verified | Weekly complete files and daily transaction files exist. Weekly file size not stated. |
| Cellular or carrier field | Unverified | No such field found in readable record types. Field-level definitions did not load, so absence is not confirmed. |

### Session limits recorded, not product limits

- Several fcc.gov PDFs and pages failed to load from this research session. That is a tool access failure in this session, not evidence about the FCC data.
- The NWS active-alerts API was not reachable from this session on 2026-10-31, so the fire-weather zone geometry check in `PACKAGE5_AUDIT_2026-10-31.md` was not run. This is a failed check in this session, not a verified production limitation. Production alert display is unchanged and was not retested here.

### Still required before any import

1. Owner or counsel confirmation of FCC reuse terms.
2. Field-level confirmation of structure type, height, status, hemisphere and datum from the current FCC documentation.
3. Owner approval of on-screen wording, marker design, pilot region and update schedule, as listed above.

### Sources

Arkansas Geographic Information Office. (2017). *ASR towers FCC (point) metadata*. https://gis.arkansas.gov/metadata/HTML/asdi.utilities.TOWER_FCC_export.html

Federal Communications Commission. (n.d.). *ULS and ASR public access files download page*. https://www.fcc.gov/node/215180

Federal Communications Commission. (2012). *FCC web policies* [Archived]. https://webarchive.library.unt.edu/web/20121002063145/http://www.fcc.gov/webpolicies.html

Federal Communications Commission. (2013). *ULS database public access files* [Archived]. https://webarchive.library.unt.edu/web/20130214225916/http://wireless.fcc.gov/uls/documentation/towintro-1.doc

Federal Communications Commission. (2020). *Website notices* [Archived]. https://webarchive.library.unt.edu/web/20201218004741/https://www.fcc.gov/website-notices
