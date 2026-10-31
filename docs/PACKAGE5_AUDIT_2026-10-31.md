# Remaining amenity, condition and filter gaps: audit, 2026-10-31

Each gap was audited against the committed data and the live sources before any coding. Only French met its acceptance criterion with honest data (see `FRENCH_UI_2.25.0.md`). The rest stay partial, with the reason recorded so later work does not repeat the check.

## Broader USFS/BLM amenities (should, partial)

Acceptance criterion: an agency-published, per-place amenity field joined by exact identity, with counts, unknowns and source dates kept.

Findings:
- USFS EDW Recreation Opportunities and Recreation Area Activities publish no structured amenity fields. Fields checked: description, fee, hours, reservation, restrictions, accessibility, activity names. Amenities appear only inside free text. Parsing prose would infer amenities, which the evidence rules do not allow.
- BLM National Recreation Sites layers 2 and 8 publish no amenity fields either. Layer 8's `FacilityID` is the Recreation.gov facility ID. All 166 checked IDs matched the Recreation.gov export by exact name.
- All 300 search-index listings with a BLM facility ID already carry the matching `ridb:` identity (234 as the primary ID, 66 as a legacy alias), so they already receive Recreation.gov amenity evidence. Live checks confirmed it. A BLM-to-RIDB join would add zero listings, so none was shipped.

Result: no change. A further gain needs a new structured agency source. Neither publisher offers one today.

## Filter by road difficulty (could, partial)

Acceptance criterion: a control backed by place-specific road evidence with provenance.

Findings: none of the 64,280 features in the published `*_merged.geojson` state files carries a source `road_difficulty` value. MVUM road attributes describe individual roads, and the road that reaches a campsite is not known. A campsite-level rating would be an inference. The moderated same-visit road reports from 2.9 remain the only honest basis.

Result: no change.

## Fire weather and closures (could, partial)

Acceptance criterion: a dated map overlay of official fire-weather warnings, clearly separate from closures.

Findings: NWS Red Flag Warnings and Fire Weather Watches are public. Point alerts already show them where issued. On 2026-10-31 there were zero active alerts, so polygon and zone geometry could not be checked against live data. A later recheck the same day could not connect to the NWS alerts API from that research session. That is a failed check in the session, not a production limitation, and it neither confirms nor contradicts the zero-alert finding. No national closure dataset was found.

Result: deferred until live alerts can be used to test the zone geometry handling. Closures stay absent.

## Crowds, noise, shade, seasonal and review sub-scores (could, partial)

Findings: the inputs shipped in 2.19.0. Coverage depends on real visitor ratings. No ratings were created, and no safety score will be inferred.

Result: no change until real submissions exist.

## Cell-tower locations (could, no)

See `CELL_TOWER_DATA_ASSESSMENT_2026-10-31.md`. The FCC Antenna Structure Registration files are the best fit for a regional pilot, and registered structures are not cell sites. A follow-up check (addendum in that file) partly verified the download page and record types. Reuse terms, structure type, height, status and datum fields remain unresolved. Nothing was imported, and the layer stays parked.
