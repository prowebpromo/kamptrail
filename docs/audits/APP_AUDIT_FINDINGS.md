# Audit findings register

Updated November 1, 2026. Evidence below comes from the preceding independent review of PR #160 at `c9bc33f3210c7ca545628dbb991413c04bddcd98`. Claude has announced fixes; no revised frozen SHA has been reviewed here. Score remains 91.7. Coverage gaps in the matrix are hypotheses/probes, not additional confirmed defects.

| ID | Severity / status | Finding, evidence and impact | Closure requirement / owner |
|---|---|---|---|
| AUD-001 | High / fix proposed | `.github/workflows/fetch-campsite-data.yml:283–286` validates before `:314–316` push/rebase retry. Disposable Git reproduction: refresh passes, concurrent main validator passes, clean rebase publishes combined failing tree. | Claude: revalidate after every rebase against updated upstream, or abort on movement. Codex: repro initial and rebased failure, inspect remote unchanged, exact-head CI. |
| AUD-002 | Medium / fix proposed | Failure artifact paths `:293–296` omit staged `data/services` and `data/health.json`; exact failed output cannot be fully reconstructed from archive alone. | Claude: include every eligible staged output. Codex: compare staged paths to archived paths and confirm initial/post-rebase failure both upload for 14 days. |
| AUD-003 | Medium standalone weakness; mitigated in full gate / fix proposed | `scripts/check-id-continuity.js:11` last-write-wins. Previous `a` with alias `x`; next `b` with `x`, then `a` with `x`: checker reports no loss/move while first-match lookup can select `b`. Existing deterministic-identity npm test rejects conflicting map, so this is not a full refresh bypass. | Claude: reject cross-host collisions. Codex: verify both row orders and alias/canonical collisions; preserve valid unchanged aliases. |

## Deferred design limitations, not active PR #160 data regressions

- No withdrawal records or runtime notice resolver are present in the reviewed tree. The checker's allowance is not proof that a link resolves. Before activating withdrawals, implement/test resolution and retain historical withdrawn IDs across subsequent refreshes. Owner-reviewed retirement design remains outside this repair.
- Rejecting refreshes that lose or re-host published IDs is intended until a reviewed continuity mechanism exists.
- Weekly refresh gating omits browser tests by declared design; review full release CI and production acceptance separately.

## Verified review evidence

- `data/` and `docs/REST_AREAS_PILOT_2.15.json` match `041ff76c` exactly by Git diff; index SHA-256 is `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`.
- Continuity: accepted baseline to frozen repair, 36,290 IDs, zero lost/moved; accepted baseline to `023d444d`, 134 lost and 37 moved.
- Original provenance suite on `023d444d`: 44 failures out of 64. Revised ownership test against those same old inputs: 64 pass. Other pinned fee/access/source-ID/access-hold expectations remain unchanged.
- Focused frozen-head runs: provenance 64/64, continuity 5/5, workflow safety 16/16.
- GitHub runs 41318225423, 41318225408 and 41318218702 were confirmed successful on exact frozen SHA. Full suites were not rerun locally during review.

## New finding record template

ID and matrix row; severity with impact; status; affected frozen SHA and environment; exact file/line or user flow; minimal reproducible trigger; expected/actual result; evidence path or immutable run URL; confidence and limitations; responsible implementer; proposed fix boundary; regression test; corrected SHA and retest evidence; deployed SHA/evidence if relevant; owner acceptance if deliberately deferred.

Never overwrite original failure evidence with passing results. Add the new SHA and closure evidence. A new implementation revision invalidates only the affected conclusions unless shared dependencies require wider retesting.
