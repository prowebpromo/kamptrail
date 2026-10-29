# Current feature QA plan

- Community: submit with valid photos, reject corrupt/oversized inputs, enforce quota and connection limits, keep pending content private, approve review and photo separately, hide/restore, report/resolve, author edit/re-review/delete, reject another author's code, preserve privacy through service-worker behavior, and verify data survives a deployment.
- Community accessibility: native dialog labels and keyboard controls, hidden spam fields excluded from the accessibility tree, scoped axe scan, 390px layout and unavailable-service retry.
- Community backups: restore a disposable MySQL dump and compare every table, encoded photo bytes and quota accounting. Confirm hosting database backup coverage separately.
- MVUM: vehicle and seasonal designations, unknown/missing coverage, over-dense viewport, stale responses and request failures, toggling/opacity, district source links, keyboard controls and 390px layout.
- Routes: road geometry rather than straight lines, saved-stop order, route corridor rather than point radius, unknown detours, single-click request limits, errors/offline/retry, stale results after itinerary edits, and car-versus-RV limits.
- Carrier coverage: verify official access, redistribution conditions, provider/technology/date fields, coverage unknowns, and bounded regional performance before enabling the feature.
