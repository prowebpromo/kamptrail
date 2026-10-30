# KampTrail 2.16.0: qualified campsite amenity details

Release candidate prepared October 30, 2026. This release adds Recreation.gov campsite-record amenity details and advances every application version handshake to 2.16.0. Its 2.15.1 predecessor declares `kt-v42`, so this release advances the worker shell to `kt-v43`. Persistent saved data, routes and chosen offline map areas retain their existing cache identities. No rig-profile or route-terrain features are included.

## Added behavior

Relevant campsite popups have an optional Recreation.gov records panel for toilet, drinking-water, shower, dump-station and picnic-table mentions. It retains exact facility identities, distinct record counts, seasonal/peak-season/coin/hand-pump/accessibility qualifiers, explicit negatives, conflicts and unknowns. It links the source facility and export and distinguishes export retrieval from unknown individual amenity update dates.

These details do not change fees, RV fit, amenity-filter matches, overnight permission or services-map eligibility. Missing or slow amenity evidence does not delay campground loading. Validated saved evidence can appear offline with its original source dates. Source proof, counts, rebuild instructions and the Camp Gateway–Brooklyn acceptance example have one home in [RIDB_AMENITY_EVIDENCE.md](RIDB_AMENITY_EVIDENCE.md).

## Measured candidate data

| Dataset | Measured scope in this release |
| --- | --- |
| Existing campsite catalogue | 33,286 publishable places across 50 states; source data unchanged |
| New RIDB details | 2,163 exact facility IDs, including 143 alias-only IDs; 53,693 overnight campsite records |
| Positive mapped amenity mentions | 1,031 facility IDs have at least one positive mention; counts describe records and do not guarantee campground-wide facilities |
| Existing services | 7,340 exact identities in 698 shards; 2,981 Utah pilot identities plus 4,359 retained legacy identities |
| Existing official rest areas | 78 Texas locations; imported overnight permission remains unknown |

The services snapshot remains `3229270a46978b58db5cb7d8`. Seven-category service imports remain a Utah pilot in this release. National state imports are a separate artifact-only staging operation. This candidate promotes no national source files and makes no nationwide seven-category services claim. All existing delivery ceilings remain unchanged.

## Release gate

The existing popup/share/link regression remains byte-for-byte unchanged. Full local Node/Python/build checks follow the version bump. GitHub must pass the complete browser suite, real PHP/MySQL checks, package build and Lighthouse before merge. Publication must follow `main` → **Publish Hostinger release** → `hostinger` branch → Hostinger. After publication, verify the exact `release.json` source commit, health, a real qualified amenity popup, cache upgrade and unchanged service snapshot. No database migration is required by this package.

Earlier version-bump preparation passed locally: Node 230 tests, 184 passed with 46 PHP-dependent skips; Python 192 tests with seven optional skips; `npm run build`; and `git diff --check`. No browser attempt was repeated after the prior missing-Chromium result. These local skips and the unavailable browser remain GitHub release gates.

## Current-main integration and popup verification

This candidate incorporates main `b2f29826ab013e7f245aee4c53c88142a2d2b08c`, including normalized-source handoff proof and the separate tutorial page. Snapshot membership remains a loading hint rather than source state evidence. Missing state labels stay unknown, and only an exact-identity duplicate can supply an explicitly reported state. The inherited data-quality, runtime-loader and search-index regressions remain active.

Campsite popups now have a keyboard-scrollable height bound derived from the map, including after native amenity-detail expansion. Marker and map-level popup paths use the same bounded width and autopan padding. Map controls hidden during the popup return after its normal Close action. The mobile amenity regression retains an unforced summary click and checks initial/expanded bounds, keyboard scrolling and Close behavior. The existing popup-redraw regression is unchanged.

Current integrated verification: Node 239 tests, 193 passed and 46 PHP-dependent skips; Python 194 tests with seven optional skips; release build, syntax and diff checks passed. Independent review verified two fixes: raw serialized flags cannot confer amenity trust, and delayed evidence refreshes after popup closure without rebinding mobile popup options or replacing active controls. GitHub browser/PHP/MySQL/Lighthouse checks on the final head remain release gates. Local Chromium is unavailable; automatic approval review blocked a further attempt that contacted npm, so no additional local browser attempt is made.
