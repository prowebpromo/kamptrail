# KampTrail application audit

Prepared November 1, 2026. Owner authorized this audit in chat. Codex owns independent review; Claude owns fixes, merges and deployment. No parity points are awarded by this document.

## Baseline and status

Inventory baseline: `c9bc33f3210c7ca545628dbb991413c04bddcd98` (PR #160). This is an unreleased review baseline with findings awaiting repair, not a release recommendation. Last verified live baseline in the preceding review: `041ff76c47cbc002ef38aa29e39a508337e2bf91`, version 2.34.0, index SHA-256 `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`. Live was not rechecked for this inventory.

Work completed: read code and test assertions, mapped existing coverage, registered prior independently reproduced PR #160 findings, and specified the first audit pass. No new full-suite or live security test was performed for this inventory. Existing test coverage is not an audit pass.

Before executing the pilot, record the repaired PR's frozen head and CI results. After merge, record its merge SHA and live release separately. Do not silently switch baselines when main advances. This documentation branch is for taking the three audit documents only; do not reset Claude's branch or merge the old repair commits from this branch.

## Audit scope and order

1. **Data-to-saved-stop pilot:** source refresh, ownership, snapshot merge, index/host map, browser resolution and stored references. This is first because the same identity can cross every layer.
2. **Core camper journey:** search, filters, detail evidence, saving, trip editing, sharing and GPX. Include empty, unknown, error and conflicting-evidence states.
3. **Offline and upgrades:** interrupted downloads, stale or missing assets, storage denial/eviction, reloads and upgrade continuity. Owner physical-phone offline evidence remains a distinct requirement.
4. **Server security and privacy:** endpoint inventory, authorization and moderation, input/output handling, uploads, rate limits, logs, key handling, backup/restore. Use local disposable databases and fixtures for adversarial probes.
5. **Routing and hazard semantics:** provider failures, units, road association, stale evidence, quota and route invalidation. Evaluate shipped behavior separately from pending R10/R11 contracts; do not fail the current app merely because a future feature is absent.
6. **Release and operational integrity:** tested/published tree equality, concurrent writers, data promotion, artifact completeness, partial deploys, cache versioning and recovery.

Accessibility, language, performance and third-party licensing are cross-cutting checks. Inventory reachable UI, APIs, jobs and external services and reconcile each to a matrix row; an unassigned surface is not covered. French native review and provider permission questions remain external dependencies.

## Repeatable method

For each row, write the invariant and an independent oracle before testing. Record the exact SHA, data digest, environment, command or interaction, expected/actual result, exit code, timestamp and evidence location. Mark whether the provider, network, database or browser was real or substituted.

Use statuses: **not examined**, **partial** (some evidence, limits stated), **blocked** (named dependency), **verified** (specified probes passed on a named SHA), **failed** (reproduced mismatch). A row with test files only starts partial. Findings use open / fix proposed / retest needed / verified closed / owner-accepted limitation. Do not equate proposed fixes or green unrelated CI with closure.

Use an isolated checkout and unique browser server port. Confirm the server process is serving that checkout before testing: the inventoried Playwright configuration can reuse a server on 8765. Coordinate the shared expensive-test lock with Claude; one browser/full-suite run at a time. At most two scoped readers plus one integration reviewer are normally useful. Use lighter models for inventory and focused checks, stronger reasoning for cross-layer failures. Stop work when its evidence is sufficient.

Do not submit synthetic production reviews, send real moderation messages, spend provider quota on arbitrary user coordinates, or run intrusive probes on live hosting. Production acceptance is read-only except separately authorized reversible flows. Keep test payloads and credentials out of public evidence.

## First pilot: execution specification

| Probe | Independent expected behavior | Evidence and boundary |
|---|---|---|
| P01 Published identity conservation | Enumerate every canonical and alias ID from the accepted baseline. Each resolves to exactly one unchanged host in the candidate; duplicate cross-host assignments fail. Stored IDs remain unchanged. | Compare independently built maps, not only the production checker. Record total IDs, lost/moved/ambiguous IDs and exact examples. Do not authorize retirement by presence of a JSON file. |
| P02 Source ownership | On a small reviewed set containing own, member, conflicting and held-access evidence, dates belong to the donor and fee/access/amenity/rig evidence never transfers classification without approved identity. | Replay inputs; assert raw donor identity/value/date and outputs at snapshot, index and browser layers. Check source class coverage separately. |
| P03 Partial and ordered loads | Canonical result and evidence agree for relevant state subsets, forward/reverse order, delayed sidecars and missing/late host map. Unresolved states stay explicit. | First run a cheap catalogue-wide mapping check, then selected real browser fixtures. Full state-pair expansion only when the invariant or observed failures require it. |
| P04 Saved stop/share continuity | Seed actual canonical and legacy IDs from the baseline, open through search and links, save, reload and reopen after candidate upgrade without rewriting IDs or changing destination. | Compare stored ID, resolved host and coordinates; include a cross-state merged listing, missing region and cached snapshot. Use named assertions rather than a marker count. |
| P05 Refresh failure and concurrency | Initial validation failure and post-rebase validation failure cannot publish. A newly based tree is revalidated against accepted upstream data. | Disposable Git remotes, deterministic fault injection, remote SHA before/after, command exits and complete failure-artifact path manifest. PR #160 owns implementation. |
| P06 Package/cache boundary | Index, host map, snapshots and first-party modules form a compatible release; a missing/old component never silently redirects a saved ID. | Build/package assertions plus interrupted or mixed-version fixture loads. Keep national clearance files excluded until the approved release gate is met. |

Pilot exit: every P01–P06 probe is verified or explicitly blocked with owner/reason; no unresolved critical/high finding in the pilot path; medium findings have a concrete disposition. Report remaining coverage limits. Closure of this pilot does not certify the entire app or increase parity.

## Gates and handoff

Per PR: changed-surface checks, regression reproducer for each meaningful defect, exact-head CI and independent review. Before release: affected integrated journeys, package checks and upgrade behavior. After deployment: published SHA and data hashes, desktop/mobile acceptance, retained evidence. Physical device tests cannot be replaced by changing a desktop viewport.

Severity: critical = demonstrated severe compromise or destructive broad impact; high = a plausible normal path can publish unverified changes, corrupt identity or undermine a safety claim; medium = bounded wrong behavior or missing recovery/evidence; low = limited usability/documentation defect. Severity needs a concrete trigger, not only a hypothetical possibility.

Claude's next handoff should include PR URL, frozen SHA, changed surfaces, claimed contract rows (or none), test commands/results and limitations. Codex returns findings with lines and repros, verified checks, omissions and disposition. Claude applies fixes. Record closure only after the corrected SHA passes retest; production claims additionally require deployed evidence.

Companion files: [coverage matrix](APP_AUDIT_COVERAGE.md), [findings register](APP_AUDIT_FINDINGS.md).
