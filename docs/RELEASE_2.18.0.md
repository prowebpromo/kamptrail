# KampTrail 2.18.0: source-reported heights, visit-month reports and camping care

Prepared October 30, 2026. This candidate builds on the complete 2.16 campsite-amenity and 2.17 rig/terrain packages. It preserves current main's state-label correction, tutorial pages and offline navigation protection. Every declared runtime module and first-party asset URL uses 2.18.0. The shell generation is `kt-v45`; existing saved-data, trip and map-cache identities remain separate.

## New behavior

- An opt-in Rhode Island layer displays 254 exact OpenStreetMap ways with their original line geometry and dated source evidence. The reviewed asset has 1,742 vertices, 239 parsed numeric `maxheight` values and 15 unknown values. It has no physical-height tags. Unparsed, conditional and missing values remain unknown. This regional map does not establish clearance coverage, current signs, safe passage or route enforcement. Source bytes, containment, quarantine, units and limits are documented in `CLEARANCE_RI_PILOT.md`.
- Reviews offer descriptive condition-report counts by actual calendar visit month across explicitly displayed years. Only published, exact-place observations contribute. Missing condition fields, unusable dates, invalid data and unavailable/expired summaries stay explicit. The counts do not create numeric subscores, current conditions, permission votes or a carrier rollup. See `SEASONAL_OBSERVATIONS.md`.
- One shared camping-care checklist is available in About and from a map-spot action, with keyboard focus and links to the checked BLM, USFS and Leave No Trace sources. Local camping, fire, vehicle and waste rules still control. Source receipts are in `camping-care-sources.json`.

## Review-only national service preparation

The manual national-review workflow validates a successful, exact-repository source run, all 50 state checkpoint ZIPs and the complete candidate. It checks archive digests, safe paths, native-download equality, source identity/date/loss guards and unchanged delivery limits. It creates a review branch only. It never pushes `main` or `hostinger`, merges, deploys, changes credentials or promotes a partial set as national.

Output paths reject symlinks, including dangling links, before tracked writes. Main is checked before and after branch creation. Those refs cannot be checked and created as one atomic transaction. A detected change leaves the branch intact and marks it not ready. A Git failure requires remote-state inspection before retrying. See `NATIONAL_SERVICES_REVIEW_BRANCH.md`.

The existing accepted services snapshot remains `3229270a46978b58db5cb7d8`, with 7,340 identities in 698 shards. National imports and their eventual source-data PR are separate. This feature release alone makes no national seven-category service claim and changes no production source files.

The completed staging run `41098691497` contains all 50 states and 254,149 unique service identities in 1,138 shards. Its complete snapshot is `d05ed287cff1c41ac3c6ab2e`; an independent rebuild matched all 1,142 candidate files byte for byte. The manifest is 349,801 bytes and the largest shard is 481,532 bytes / 1,499 rows, within the existing limits. These are staged source records, not campsite counts or inspected physical places. No staged bytes are accepted by this release. The larger-source status UI displays the actual state count and retrieval-date range while retaining item-level evidence and the complete coverage array.

## Verification

The Lighthouse workflow now passes its existing warning policy through the action's supported `configPath` input and uses the same Node 22 major as regression CI. The invalid `assertions` action input is removed. The configured score findings remain warnings, not a new hard performance gate.

No database migration is required. Before merge, require the complete Node, Python, native PHP/MySQL, browser, package and Lighthouse checks on the current candidate. Local browser discovery or a missing executable is not a browser pass. Preserve the original popup/share/link regression and normal mobile summary, scroll and Close interactions. After publication through `main` to the tested `hostinger` branch, verify the exact release source, health, all new native UI flows, source dates, cache upgrade and unchanged accepted service snapshot. Update the feature checklist only from verified shipped behavior.

Local integrated checks before publication completed 285 Node tests (230 passed, 55 PHP-dependent skips), 212 Python tests (six optional skips), package generation and discovery of 123 browser tests. The final clearance loader correction adds three focused tests: a timed-out refresh keeps valid dated evidence, a cold timeout can use a validated dated cache, and removing the layer rejects cancelled or late responses. Its eight focused tests passed. Full exact-head CI remains required after this correction.

The initial integrated CI run `41110987133` passed all 288 Node tests with native PHP, MySQL/restore checks and 212 Python tests (eight optional skips). It passed 122 of 123 browser cases. The camping-care mobile regression caught the layer toggle covering the spot popup's native Close control after dialog focus returned. The correction hides the top-right map controls while that spot popup is open, matching the existing campsite and height-popup behavior. The regression retains its normal click and verifies controls are restored after closing. A new exact-head full run is required.

The forecast publisher also gains bounded confirmation of a newly replaced public pointer when the exact previous validated bytes remain briefly visible. It requires exact new bytes, preserves the alternate pointer, checks source expiry and never repeats the mutation. The observed scheduled-run failure, eventual digest proof and verification limits are documented in `FORECAST_OPERATIONS_2.13.md`.
