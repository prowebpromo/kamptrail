# Tourism integration — November 15, 2026

## Owner decisions and evidence

Chuck Price's November 15 answer was: **“Apply the 24 supported classifications; retain 12 under review (Recommended)”**. It applies 23 Campground labels and Dispersed for Kiwanis (`ridb:10069432`). The exact facility IDs, own-record field and quote, source URL, research consultation date, retained API retrieval date and unresolved IDs are in `tourism/decision-ledger-2026-11-15.json`. The ledger binds the independently prepared `tourism/official-source-review-2026-11-15.json` by SHA-256. Consultation dates are research dates, not source publication/update dates or API download dates.

The November 1 decisions remain in their original ledger. The 12 unresolved records keep their previous holds or pending Other status. The nine proposed withdrawals remain listed with their pending notices. No new withdrawal or historical reactivation is authorized by this work. Four borrowed restrictive-access holds remain exclusions. Negative/access checks precede reviewed labels.

The newly approved 24 labels and their existing admission survive a later retrieval only when the exact reviewed name or description quote remains in the facility's own record. Changed/missing or borrowed wording returns them to Other pending review. The other November 1 admission date bindings remain in force. A name-and-point match still cannot transfer an agency's classification.

A dated Shaw House closure remains while the own closure wording persists. Its original September 10 notice date is preserved; its retrieval attribution uses the actual supporting own-record retrieval. If the wording is absent or borrowed, the previous dated closure remains an **earlier agency notice**, with its original source retrieval date and an explicit unverified-current-status notice. A new download alone cannot prove reopening.

## Integration scope

The feature is ported onto main `3d0f5f4d88832078f9d63a012ec7a6e9203aa5a5` (2.47.1), retaining current UI architecture, forecast repair, Node 24 CI, PWA/cache structure, historical registry and hash-bound admission. The eight reviewed lodging labels and the multi-cabin notice are retained from the earlier draft. Tourism/type/description ownership applies at snapshot, index and browser layers. The browser and index receive the same own overnight-site sidecars and cross-state withheld-member set.

The old draft's source-only fixture workflow, obsolete withdrawn-listing resolver, empty replacement registry, old generated datasets and mobile CSS changes are excluded. The existing historical resolver owns saved links and shared aliases. Ownership regression helpers now pass the same overnight sidecars as production; original source fixtures and their expected amenity/rig outcomes are retained. Snapshot provenance expectations additionally require the tourism tag to remain on its attributed donor.

## Verification status

Source checkpoint only: 109 focused loader/history/agency/merge/locale/override/tourism checks passed before the new decision ledger; a separate 126 data-quality/index/provenance/ownership checks passed after adapting sidecars and tourism member attribution. The November 15 decision and closure continuity tests pass. Final rebuild, exact generated-data comparison, complete production checks, browser acceptance and live deployment verification are still required. No release is claimed at this checkpoint.
