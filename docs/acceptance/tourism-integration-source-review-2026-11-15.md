# Independent tourism integration review

Source checkpoint reviewed: `d0c2c64e7c8ea07ffbfd739a7878a6df4fdd9547`, compared with current-main baseline `3d0f5f4`. Read-only review; no source changes made.

## Concrete source finding

**P2 — A fully renamed approved facility can disappear instead of returning to pending review.** In `data-quality.js`, the `reviewed && ... && discoverable(p)` condition skips the evidence-binding fallback when changed own wording also removes all admission heuristics. Reproduced exact own record `ridb:10076892`, renamed `Ring Mill Recreation Area`, raw type `other`, own description `The recreation area includes three camp sites.`, schema 3 and a fresh source date. `normalizeFeature` produces `unverified_camping_record` with no type evidence; `cleanAndDedupeGeoJSON` publishes zero records. The owner-approved policy requires changed/missing wording to become Other/pending. Existing tests rename by appending words to a name that still contains Campground, so they do not cover this case. Recommended correction: process evidence-bound exact own-record IDs even after admission heuristics stop matching, while retaining the prior negative/access and historical-reservation gates.

Reported to the coordinator and integrator immediately. **Resolved in `55956c3350705bd3fd6f669cb346f9a98d8a38ff`.** Independently inspected the two-line source/test delta and reran the original counterexample: it now publishes exactly one Other record with `published_pending_review` and `owner_review_evidence_changed`. New tests cover a wholly non-camping renamed name and preserve private/no/military/access-hold/camping-no/disused exclusions. No other concrete source bug was found in this source review pass.

## Source review completed

- The new ledger has the authorized 23 Campground and one Kiwanis Dispersed records; its source evidence is hash-bound and preserves consultation dates separately from source retrieval dates. Twelve unresolved identities/admissions remain pending/held.
- Type/name/description classification remains attributed to the own source or verified shared facility ID. Snapshot donor tourism/type/activity is not promoted to the host. Copied descriptions carry donor identity.
- Negative and restrictive-access gates precede reviewed-label overrides. The existing four access holds are not removed by the source patch.
- Shaw House retains its original dated closure; missing/borrowed current wording is rendered as an earlier notice with current status unverified. The two lodging point pins remain explicit; ordinary points follow source geometry.
- Current-main history filtering remains before index/browser classification. The historical registry, resolver and continuity checker are not replaced by the old empty tourism draft registry. Final validation must compare both prior active IDs and the complete prior historical registry.
- Browser state normalization and index construction now both receive own overnight sidecars and a cross-state withheld-member set. Final data parity remains to be measured.

## Final fresh-data review checklist

1. Bind the review to an exact integration source hash and fresh workflow artifact/run; record generated index/identity/coordinate/history hashes.
2. Compare every prior canonical and legacy ID with its final host or historical notice, supplying both current and previous `withdrawn.json` to the continuity checker. Verify no retired identity appears in active index or state/agency publication results and no history row changed or disappeared.
3. Check all 24 approved classifications, all 12 unresolved statuses, nine pending-withdrawal notices, eight approved lodging records and all four restrictive-access holds against their exact own evidence.
4. Confirm full browser-normalization/index type and point parity, with the same overnight sidecars, history reservations and identity options; inspect new/missing/type-change counts and unexpected admissions.
5. Verify Shaw House's actual fresh closure state and provenance dates; verify White Mountains' count/point notice against its own overnight sidecar.

The final-data review has not yet run; the independent reviewer is awaiting the fresh integration candidate.
