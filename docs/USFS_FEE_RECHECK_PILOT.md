# Maintained USFS fee evidence: automated recheck pilot

## Scope and decision

Pilot the ten independently reviewed campground pages in `scripts/fixtures/usfs_fee_overrides.json` whose human review window ends November 29, 2026. Their October 30 human observation dates, coordinate/name matches, fee wording, caveats and manual deadlines remain unchanged. This pilot changes maintenance, not fee classifications or the campsite census.

An importer may renew eligibility from a **separate machine confirmation** for up to 30 days after a successful check, capped at **180 days after the human observation**. The cap for this batch is April 28, 2027. These are operational limits, not promises that agency fees remain stable. Weekly checks reduce the chance of missing a publication change. The six-month human cap bounds the risk of a parser or source-design assumption silently remaining wrong forever. This initial policy is deliberately limited to ten approved pages; expanding the list requires source/baseline review.

A changed page, missing/redirected/error page, ambiguous identity/fee field, changed linked notice, stale receipt, edited review record or reached human cap blocks that maintained override. Independently conclusive current agency-feed evidence is still evaluated normally. The routine exception is recorded without preventing unrelated sources from refreshing. A failed overall agency import can still retain last-known source files under the existing refresh policy; this pilot does not claim it can revoke already-deployed data when the import itself fails.

## What an unchanged confirmation actually proves

The script re-fetches the exact official `https://www.fs.usda.gov/r...` URL once, with bounded HTML size and a 30-second timeout. Redirects are refused. Requests are serial and at least one second apart. No account, key, credential or FCC access is involved.

It requires a single main region, a single matching page title, a single dedicated `rec_acc_fees` section with the reviewed wording, and unambiguous coordinates within the existing 300-meter identity radius. It then compares **all meaningful main-region text and all main-region link destinations**, not just the fee sentence. Scripts, styles, SVG, template navigation/footer and whitespace are excluded. Main-region restrictions, season/access context, page update dates and links remain included. The separately reviewed Canyon Lake notice is a dependency of the five Tonto pages. Its content must also remain unchanged.

This confirms the approved published evidence still appears unchanged. It does not prove actual conditions, fee effective dates, absence of unpublished changes, camping permission, site opening or vehicle suitability. It neither sets `retrieved_at` to a fabricated human date nor updates source-page modification dates.

The approved baseline stores readable snapshots, raw-response hashes, semantic hashes and a digest of each entire human review record. Runtime receipts bind the exact baseline and record digest, actual UTC check time and a limited `valid_until`. Imported fee evidence keeps the human `retrieved_at` and `fee_checked` date, with a separate `automated_check` object where applicable.

## Running and operating

- Normal: `python scripts/recheck_usfs_fee_pages.py` writes `data/sources/usfs-fee-checks.json`.
- Review a changed record: open its dedicated official page and dependency, re-evaluate full fee/access/season context and identity, then update the maintained record only from actual evidence.
- Propose a new baseline after that review: `python scripts/recheck_usfs_fee_pages.py --capture-baselines --output scripts/fixtures/usfs_fee_page_baselines.json`. Inspect the readable snapshot diff. This command does not edit the manual observation dates or itself approve a new review.
- Run the normal checker again to generate matching receipts, validate, and commit both baseline and receipt with any genuinely updated manual evidence. Do not edit hashes or machine times by hand.

The **existing Sunday 03:00 UTC data writer** runs checks immediately before agency import and commits receipts along with source/search updates. The manual `agency` job uses the same path and stages the receipt. No second scheduled data writer is added. Exceptions generate GitHub Actions warnings and a step-summary list by record ID. Unchanged records produce a count, not individual review flags. The workflow remains successful for expected source exceptions so unrelated data promotion continues. Structural corruption of checked-in policy/receipt files is an error requiring repair.

Before Friday, November 27, inspect the latest actual scheduled check and confirm the ten receipts are fresh, or resolve its exceptions. On November 29, an unchanged page checked by that import is eligible through December 29, subject to the human cap. Today's October 30 receipts alone still end November 29. Installing this pilot does not pretend November's future check has already happened.

## Pilot evidence and acceptance

On October 30, captured all ten official pages and the notice dependency, then independently re-fetched them. The initial result was **10 unchanged, zero exceptions**. The receipt contains actual capture/check timestamps and hashes. No production review was submitted and no live classifications were changed.

Tests cover changed prices and contextual text/links, moved/renamed sites, duplicate/missing fields and error pages, notice changes/timeouts, future/stale confirmations, a November 29 renewal with the original human date, the April 28 hard cap, edited evidence, altered receipts and output symlinks. The required full native CI remains a release gate.

Before scaling, measure false-positive exception rate, retrieval failures, human minutes per genuine exception and any fee false negatives found during human spot checks. A shared-template text change may conservatively flag several pages. Investigate that noise before relaxing a comparison. The probably-free discovery pass remains a separate job and must not infer free fees from campground type or an agency operator tag alone.
