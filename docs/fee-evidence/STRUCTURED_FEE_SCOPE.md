# Structured USFS fee corrections from the frozen pilot

This change addresses two source-field/parser gaps found in the fixed pilot and includes source/agency/search outputs from the reviewed actual provider fetch. It does not extend the manual-review batch, add maintained page overrides or change expiry policy.

## Result on a complete actual provider fetch

On October 30, 2026, the existing complete USFS fetcher collected 4,632 joined source rows using its normal count-before/count-after, ordered pagination, object-ID uniqueness and secondary-activity join checks. Sixteen actual HTTP response receipts record request URLs, retrieval timestamps, HTTP status, byte counts and SHA-256 values. Raw responses and the joined rows are retained for root inspection at `/workspace/scratch/226a51dc6c64/fee-parser-validation/`.

Both baseline `6f46c79` and the proposed importer normalized that **same fetched input**, with the same retrieval day and current maintained-review fixtures. The [delta receipt](2026-10-30-structured-fee-normalization.json) contains the raw-row hash, both importer hashes, per-response provenance and every changed property. No raw source response was reconstructed from normalized features. No source update date was invented.

| USFS source-feature classification | Before | After |
|---|---:|---:|
| Free | 702 | 703 |
| Paid | 2,846 | 2,847 |
| Conditional | 47 | 47 |
| Unknown | 976 | 974 |

Exactly two source features change, with no source ID additions/removals and no eligibility or coordinate changes:

- `usfs:11263`, Aspen Grove: unknown to paid. The structured fee field says `Standard Fees 20.00 per night. Interagency passes accepted. Senior Passes save 50%.` Cost stays null because the wording does not state a currency.
- `usfs:75504`, Rio Chama Campground, Small Group Sites: unknown to free. The structured description opens `The Rio Chama is a developed no-fee campground where reservations are not required.` Cost becomes zero, with the description field and exact sentence recorded as the classification source.

The normal agency-state and canonical search-index rebuild was also run. Its [canonical delta receipt](2026-10-30-structured-fee-canonical-delta.json) records **33,286 unchanged IDs**, with exactly those two canonical records changing classification: unknown 22,784 to 22,782, free 2,153 to 2,154, paid 8,290 to 8,291 and conditional 59 unchanged. Agency count stays 5,412, with the same one quarantined out-of-US BLM record. Coordinates, elevation dates, source IDs and other canonical properties are unchanged. These are classifications of existing places, not new places.

Compared with previously stored source features, the fresh normalizer also carries forward the already-merged automated-check metadata on the ten maintained USFS observations from PR #118. Their original human observation dates and classifications do not change. Thus twelve stored source features differ: the two classifications above plus ten evidence-metadata-only updates. Other source records, quarantine contents, BLM source, rest-area/state-policy data and coordinate index remain unchanged.

## Scope of the two rules

The positive paid rule applies only in the USFS structured fee field when the existing classifier returned unknown. It recognizes a sentence beginning `Standard Fees`, a positive number and `per night`. It leaves currency/amount unspecified. Any remainder must consist only of the two observed affirmative clauses, `Interagency passes accepted` and `Senior Passes save 50%`. Unparsed remainder is rejected, including later fee waivers, negation, inapplicability, day-use, history or nearby-site wording.

The free fallback requires an empty structured fee field. It accepts only an opening self-description in which the subject matches this record's campground name and explicitly describes it as a no-fee or fee-free campground. The opening sentence must end there or use exactly the observed tail `where reservations are not required`; unparsed tails such as `for veterans` or `for holders of senior passes` are rejected. Questions are not affirmative statements. It rejects nearby/other campgrounds, historical statements, negation, day-use-only wording, camping prohibitions, seasonal/permit qualifications and later charge contradictions. The opening sentence allows only a bare affirmative statement or the observed “where reservations are not required” ending. A nonempty remainder must exactly match the readable, audited 500-byte Rio Chama context in the source adapter (SHA-256 `d820e312a2bec6c5291bd47fc4c53505d291b2bb0abcd285772f2ed1ca76d1e9`). Any changed or additional narrative remains unknown, including indirect billing or rescinded-statement wording. Existing contradiction guards remain. This deliberately bounded template can lose a classification after a harmless provider wording change; that is preferable to silently accepting an unparsed qualification. Ancillary no-water information and wet-road warnings in the actual Rio Chama narrative remain context. It does not classify arbitrary narrative by running the generic fee parser across the entire description. Any nonempty ambiguous fee field, including a booking-rate pointer, blocks this fallback.

The full description remains retained as context. Only the accepted opening sentence is copied into its evidence entry's `classification_text`. Existing camping-permit restrictions can still qualify free evidence. A contradictory maintained official paid review still yields unknown with a conflict flag.

## Maintenance and limits

Both corrections derive from fields already fetched by the normal recurring agency import. They do not create new monthly manual rechecks. Changed/missing future structured wording is re-evaluated by the importer rather than kept alive by a dated page override. Provider retrieval is not proof of on-the-ground conditions or a fee-effective date; record-specific source update dates remain unknown where the provider does not supply them.

The frozen sample's low-resolution or free-yield result must not be reinterpreted as permission to continue manual reviews. These are separately bounded structural fixes from already observed input. The FR 9350 crosswalk/duplicate, Windy Saddle source disagreement, Bonneville seasonal waiver and coordinate discrepancy, and other unclassified pilot records remain outside these rules.

## Validation before merge and data release

- Actual pilot wording plus adversarial subject/adjacency/day-use/history/negation/season/conflict cases are covered by `scripts/tests/test_usfs_structured_fees.py`.
- Existing USFS review identity, source-window, conflict and maintenance tests must pass unchanged.
- Full native CI and root review are required before merge. A previously observed concurrent permission-catalogue build race is repaired with exclusive, per-writer temporary files. A deterministic interleaving regression checks two writers sharing the same catalogue without losing a rename or leaving temporary output.
- Root authorized the source and generated assets in this same focused change. Actual complete provider receipts, source counts and canonical deltas must be reviewed before merging, followed by normal tested deployment and live-byte/census checks.
