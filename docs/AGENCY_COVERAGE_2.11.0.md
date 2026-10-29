# Agency camping evidence — 2.11.0

This release improves evidence and placement of public camping records. It does not establish national free-camping completeness or current access permission for every listing.

- Join Forest Service secondary camping activities to their official recreation records, with explicit on-site camping eligibility. Preserve primary camping categories and quarantine invalid locations and ineligible secondary records.
- Use narrowly scoped BLM facility wording where the dedicated fee field is empty. Keep general camping permits separate from fire permits, commercial/group permits and permits for adjacent land. Seasonal or temporary fee waivers remain conditional.
- Preserve complete public source wording, field, record identity, source link, retrieval date and available source-update date. The popup's Fee evidence disclosure works from already-loaded data, including offline. Dates describe source records, not an assertion that someone visited the campsite.
- Retain contradictory evidence. Broad Canyon's current official page says $5/night while the structured feed says no fee; it is unknown with a conflict, never confirmed free. A proposed fee by itself does not establish an implemented charge.
- Validate agency coordinates against pinned Census BAS 2026 state polygons. Preserve the original state value and assignment provenance. Border ambiguity and unsupported coordinates are explicitly quarantined. This correction covers the agency supplement, not every legacy source record.
- Put reported closures immediately below popup titles and retain closure notices in along-route results. A free fee status does not imply the campground is open. No new default closure filter is introduced.

The Census geometry is pipeline-only. It and raw source snapshots are excluded from the browser release. Agency snapshots, full fee evidence and compact search metadata are shipped through the existing zoom-gated loader.

See the dated free-camping update for measured source changes, merged-catalogue counts, identity changes and remaining limitations. See the dated Replica audit and parity queue for remaining functionality; this release is not a claim of full FreeRoam parity.

Release gates: source-contract and fee regressions; complete source imports; polygon and quarantine tests; merged map/search identity review; unit suites; browser evidence, closure, mobile and accessibility checks; production version and representative live popup verification. A skipped PHP-dependent local test is not a passed PHP check—CI must exercise those checks.

FreeCampsites.net is not imported. Its published terms prohibit automated harvesting and require written authorization for redistribution. Its directory also includes inexpensive paid camping; directory membership alone would not prove free camping.
