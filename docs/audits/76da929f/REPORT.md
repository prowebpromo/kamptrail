# Independent audit pilot: first pass

Baseline: `76da929f56eafbe20844b6b55e6596baf6f67af4`, version 2.34.0. Evidence reviewed: PR #161 head `59964aae2752f8516f6fa270d534bfb3258f3e1c`. November 1, 2026. No production writes, implementation changes, merge or parity credit.

## Disposition

Accepted as the frozen audit baseline. This is a partial first pilot pass, not closure of the six-probe pilot or a whole-app certification. All-state browser census evidence is accepted within its stated complete-load scope. Partial-load behavior remains the known Bird Creek issue owned by the 2.35.0 package. Physical-phone acceptance is separate.

## Independently verified

- Live release marker: full baseline SHA. Live index hash `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`; live host-map hash `9f83fc564ec2240a13412cc49950782966e0ffa9c12915b3022214381eed4e58`; national clearance manifest HTTP 404, RI HTTP 200. Publish run 41322396746 successful on the baseline SHA. These were new read-only HTTP/API checks.
- Independent Python enumeration, without using the production continuity checker: 33,370 listings, 36,290 unique canonical/legacy IDs, no cross-host conflicts, no lost or moved IDs versus `041ff76c`. Host-map entries/count/index hash exactly match the index. See `catalogue-check.py` and `.json`.
- Claude's unchanged raw output hashes to `5543c9b8c62388854c917b4938648e3c96a1fdac6ee657a45437867c4716f651`, matching the stated prefix. Its two full-load census outputs each report 33,370 features and zero differences. This checks browser/index agreement, not independent real-world identity or every listing's UI navigation.
- Focused source tests on the baseline: `node --test scripts/tests/merge-safety.test.js scripts/tests/osm-provenance.test.js`: 80 passed, zero failed/skipped (16 merge-safety, 64 provenance). No full suite/rebuild/remerge was run. Fixed fixtures pin behavior but their independent authorship cannot be established solely from the committed generated-fixture metadata; this is bounded regression evidence.
- New independent integrated saved-stop probe: seed legacy ID `ridb:232479`, load NC then TN under a controlling service worker, request offline mode, reload and load TN then NC, open Saved stops and click **View on map**. Stored ID remains unchanged, resolved host remains `osm:way:1107154601`, and rendered popup names Cosby Campground. An uncached request fails, proving the result was not dependent on a successful uncached fetch. See `offline-saved-stop.cjs` and `.json`.

The integrated probe ran against an isolated localhost checkout, not live hosting: Chromium `143.0.7499.0`, 390×844 touch/mobile emulation, runtime timestamps recorded in JSON. `navigator.onLine` stayed true despite requested offline mode and blocked uncached fetch. Preserve that observed value; do not claim this tests application branches keyed to navigator.onLine or actual phone airplane mode. Initial setup attempts failed due to an unavailable browser binary/server, and the first completed flow failed an overly strong navigator.onLine assertion; the final probe substitutes observable uncached-fetch failure and records both signals.

## Evidence boundaries for Claude

1. The original saved-stop evidence demonstrates online trip-model resolution and a separate cached offline catalogue lookup. The offline phase creates a fresh context without a saved stop. It does not itself prove offline saved-stop reopening. The new local probe above fills that combined-flow gap for this fixture only; it does not retroactively change Claude's original test scope.
2. The online script's word “opens” means trip-model feature resolution; it does not click the saved stop. Keep original raw output untouched and describe this precisely in summaries.
3. `command-chain.sh` lacks pipefail around timeout/script pipelines, so its shell exit or ACCEPT-DONE marker is not a standalone acceptance gate. Existing explicit zero census counts and SUMMARY PASSED support the observations already recorded. For future automated acceptance, propagate command failures and make nonzero census mismatches exit nonzero.
4. The identity runner falls back from Google Chrome to bundled Chromium. Actual executable/version was not recorded. Label the previous run's browser provenance as unknown or fallback-capable; do not assert which executable ran from configuration alone.

These are evidence/harness limitations, not newly demonstrated production defects. No need to repeat the two whole-catalogue runs solely for missing metadata.

## Pilot status and next work

| Probe | Status on this baseline | Remaining work |
|---|---|---|
| P01 published ID conservation | Verified for current baseline versus 041ff76c, index/host-map uniqueness and mapping | Historical retirement support remains separately scoped; no withdrawals activated. |
| P02 source ownership | Partial | Multi-generation donor update/removal: persist A←B, refresh B with changed/removed tags/date, and independently check evidence without borrowing classification. Current repeat-merge tests largely reuse unchanged donor values. |
| P03 partial/ordered browser loads | Partial; known partial-load defect | Retest 2.35.0 at its frozen SHA with intermediate checkpoints; complete-load evidence does not close this. |
| P04 saved stop/share continuity | Partial, integrated offline saved-stop fixture verified locally | Expand to cross-state/missing-region/upgrade fixtures and share navigation. Do not generalize Cosby to every ID. |
| P05 refresh failure/concurrency | Verified within reviewed PR #160 paths | Carry forward the exact-head review and its limits: artifact condition checked structurally, no deliberately failing Actions upload. |
| P06 package/cache compatibility | Partial | Valid but stale host-map/index combinations and interrupted/mixed-generation updates; national clearance exclusion verified by current live endpoints only in this pass. |

Claude continues implementation. Codex reviews the partial-load repair and conducts the outstanding bounded probes. Existing AUD-001/002/003 fixes passed review at `73814e7d` and are deployed in this baseline. Score stays 91.7.

## Reproduction

The scripts contain absolute runtime paths to the actual environment used; adapt those paths explicitly when replaying elsewhere. Serve the frozen checkout on a dedicated localhost port (8794 for this run) and run `offline-saved-stop.cjs`. The browser script creates only disposable browser storage and uses no production submissions. `catalogue-check.py` reads baseline data and immutable Git objects. No existing evidence file was edited.
