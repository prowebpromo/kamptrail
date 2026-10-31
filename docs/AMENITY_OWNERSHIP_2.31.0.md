# Amenity ownership repair (2.31.0)

Release 2.31.0 repairs R8 amenity ownership. The audit that found the defect is `docs/AMENITY_COVERAGE_AUDIT.md`.

## Acceptance criterion

Approved by the owner. Recorded before any code change. It must not be weakened.

1. Protect amenity ownership at two points: snapshot merging (`scripts/merge_campsite_data.js`; the audit found only fee, charge and access are guarded at L17-18 and L207-251) and index-level reconciliation (`data-quality.js` `normalizeFeature` and `mergeFeatures`, around L80, L132-139 and L204-205). Other elements' observations are kept as attributed member evidence (element id, source, dates) and are never silently assigned to the retained record.
2. Rebuild every affected state snapshot, the national index and the relevant filter metadata from the unchanged retained inputs. Keep the original source dates. Do not combine this repair with identity splits, new admissions or source refreshes. Use the repo's own replay tooling (`scripts/verify-osm-provenance.js --remerge`).
3. Verify that the following stay byte-for-byte unchanged for every listing: listing IDs, coordinates, aliases and legacy_ids, memberships, fees, access classifications and saved-place compatibility. A script diffs before and after and reports every intended amenity change and any unexpected delta, with an unexpected delta failing the check. Rebuild twice and prove the output is deterministic with identical hashes.
4. Make the popup and the filters agree. Replace the unsourced "Amenities reported:" line (`data-loader.js` about L355) with evidence that shows source, scope and date.
   - Keep scope. Recreation.gov campsite records and Forest Service statements stay scoped. One site having toilets does not mean every site does.
   - Amenities from different sites must never combine into a fictional campsite that satisfies both a rig-fit filter and an amenity filter.
   - When filtering, a campground matches an amenity filter only on evidence the popup would show for that campground, at the scope stated.
   - When rig-fit and amenity filters both apply to campsite-level records, they must match within the same campsite record.
   - Explicit negatives, contradictions and unknowns stay visible.
   - A missing date reads "date unknown". Never substitute the rebuild date.
   - Add an explicit "No amenity source for this listing" state.
5. Tests:
   - Cover all 188 borrowed-amenity listings and the 221 listings with Recreation.gov toilet records named in the audit.
   - Produce a fixture or report listing, for each one, the expected inclusion or exclusion under the toilets filter (and water, where relevant) after the fix, with the reason for every remaining exclusion.
   - Do not make every record match just to raise coverage.
   - Unit tests for ownership guards, the scope rules, the same-campsite rig-fit-plus-amenity rule and date-unknown handling. A browser test for the popup evidence.
6. Publish counts in this doc, broken down by source and amenity: join eligibility, actual attached records, known values and filterable evidence. Correct any active "100% coverage" wording in `docs/USFS_SITE_AMENITIES_2.29.0.md`, `docs/replica/features.csv` notes, `docs/replica/parity-queue.md` and `docs/replica/COMPLETION_CONTRACTS.md`. For example, "2,158 of 2,158" becomes the three-count breakdown: 2,158 eligible, 1,448 with records, 1,324 with a known value. No row's status or the score changes.
7. Every new string has a Spanish entry in `locale.js` and a French entry in `locale-fr.js`.
   - Run `npm test`, `npm run test:python`, and the browser specs for features, discovery, usfs-site-amenities, rest-areas and locale.
   - Ignore only the known local failure in `app.spec.js` (mobile map height 493 vs >500).
   - Check the release build.
