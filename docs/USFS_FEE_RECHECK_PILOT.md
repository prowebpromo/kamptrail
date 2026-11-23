# Maintained USFS fee evidence: automated recheck pilot

## Scope and decision

Pilot the ten independently reviewed campground pages in `scripts/fixtures/usfs_fee_overrides.json` whose original human review window was due to end November 29, 2026. At installation their October 30 human observation dates, coordinate/name matches, fee wording, caveats and manual deadlines remained unchanged. The November 23 exception review below genuinely renews three observations; machine checks alone never change human dates.

An importer may renew eligibility from a **separate machine confirmation** for up to 30 days after a successful check, capped at **180 days after the human observation**. The original October 30 observations have an April 28, 2027 cap; a genuinely renewed November 23 observation has a May 22, 2027 cap. These are operational limits, not promises that agency fees remain stable. Weekly checks reduce the chance of missing a publication change. The six-month human cap bounds the risk of a parser or source-design assumption silently remaining wrong forever. This initial policy is deliberately limited to ten approved pages; expanding the list requires source/baseline review.

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

## November 23 deadline review

Verified main `0711b3027fe597250766c5e2691b71898679fdc6` and pending PRs first: no pending fee-recheck PR or completed deadline review existed. The installed pilot was already merged; this is its focused exception follow-up.

Actual scheduled evidence: [Refresh campsite data run 45012745211](https://github.com/prowebpromo/kamptrail/actions/runs/45012745211), event `schedule`, head `a016d67cb32db8dbf5cd78bc3c1e782ffa00cdd8`, started November 22 at 10:30:15 UTC. In job `137181693341`, the maintained-page step actually ran at 12:02:02–12:02:16 UTC and succeeded: **six unchanged, four exceptions**. Its receipt timestamp is `2026-11-22T12:02:02Z`, not October 30. The overall refresh failed later in listing-history publication (`Current own record remains publishable`, `osm:way:234239616`); verification and commit steps were skipped. Do not describe that scheduled workflow as successful. Recovery commit `9404c8997e62b498b48b69df8fa1e86b15e1e530` retained those receipts and restored the reviewed snapshot; main's PR #206 already repaired the recurring import guards. This review does not duplicate that repair.

Complete official-page semantic reviews on November 23, independently cross-checked, resolved three exceptions:

| USFS ID | Actual official change and review | Result |
|---|---|---|
| 35645 Airplane Flat | `Site Open` became `Site Closed` / `Closed for the winter.` Last-updated footer April 6 → November 4, 2026. Fee wording, identity, all other meaningful text and links unchanged. | Genuine November 23 review; preserve winter closure as attributed context and all April–October, road, trailer, stay and group-permit caveats. Fee-free ordinary camping does not establish current access. |
| 60306 Blodgett | `Site Open` became `Site Closed` / `Closed for Season`. Footer May 22 → November 12, 2026. Fee wording, identity, all other meaningful text and links unchanged. | Genuine November 23 review; preserve closure, winter inaccessibility and the conflicting May 1–October 31 / Memorial Day–Labor Day season statements. |
| 60666 Paradise | Only published coordinates changed: `45.86083333,-114.7377778` → `45.861263,-114.737718`, approximately 48 m. Otherwise identical page and links; footer still April 8, 2026. | Genuine November 23 review; same exact official identity within the existing 300 m guard. Original identity anchor and canonical geometry/id retained. Snow, unplowed roads and river-permit caveats retained; no current opening asserted. |
| 60320 Gold Creek | Only published coordinates changed: `46.3975,-113.9013889` → `46.397874,113.902573`. The longitude is actually positive, approximately 8,693 km from the reviewed point; fee text and May 22 footer unchanged. | **Blocked / unknown.** Do not negate the sign, infer identity from directions/name, renew its human date or accept a new baseline. Original October 30 observation and baseline retained, failed receipt has no validity. |

The Canyon Lake dependency was also read in full and remains semantically identical (`6c8b9492c6871d0094f624c3d354c4b5103de88096d2f6824e62d1089645ac43`). Its August 25 source date is retained; its named Canyon Lake closures do not override Airplane Flat's separate winter closure.

Three actual reviewed snapshots were incorporated using the existing `snapshot`/`digest` functions; the other seven baseline entries and dependency were retained byte-for-byte as evidence objects. Baseline bundle assembled at `2026-11-23T13:39:54Z`, digest `15147ac486e86e84b37a751e6bad85e7a8dc0f8833a1e82290ad87d4dc9575b8`. This timestamp is bundle assembly, not a claim that all ten human reviews occurred then. Original October evidence is archived in `scripts/tests/fixtures/usfs-fee-original-pilot.json` so its full pin-validation/November 29 expiry regression stays independent of legitimate future reviews.

The normal checker then independently fetched all ten pages and the notice. Actual receipt `2026-11-23T13:39:54Z`: **nine unchanged, one changed (60320)**. Every review digest, baseline pin, semantic digest, notice dependency and full UTC timestamp validates. The nine successful receipts are valid until **December 23, 2026, exclusively**. The six untouched human dates remain October 30; only 35645/60306/60666 have November 23 human observations and December 23 manual deadlines. All fee wording and fee-text hashes remain exact.

The importer validates nine maintained observations as eligible on **November 29** under these current receipts; Gold Creek is ineligible. The Sunday import remains a future execution: it must actually re-fetch and can block any newly changed/unavailable page or dependency. An unchanged successful November 29 check could renew to December 29 within the human cap; today's receipt does not pretend that future check has run. November 29 at 03:00 UTC is **Saturday November 28 at 10 p.m. America/New_York**; the commit deadline is Friday November 27.

The normal USFS importer and agency/search builders were run with current official agency data. Only three substantive source/agency rows change: 35645, 60306 and 60666, unknown → free with their own reviewed evidence. Routine USFS retrieval dates advance November 22 → November 23. USFS stays 4,571 records and 61 source quarantines; combined agency stays 5,415 records, 42 states, with its quarantine unchanged. Canonical IDs, geometry, ordering, membership, historical identities and all refresh guards remain unchanged. No BLM, OSM or RIDB source record was edited.

| Census | Before | After |
|---|---:|---:|
| Search listings | 33,605 | 33,605 |
| Free | 2,159 | 2,161 |
| Conditional | 58 | 58 |
| Paid | 8,233 | 8,233 |
| Unknown | 23,155 | 23,153 |

Exactly two search fields change: `m.f` on canonical `ridb:241823` (Blodgett / `usfs:60306`) and `osm:node:3211267403` (Paradise / `usfs:60666`), unknown → free. Airplane's canonical `osm:way:1192369273` was already free from its own evidence. Gold's canonical `osm:node:12120743109` remains unknown. Every other indexed listing field is identical. Independent read-only review confirmed these differences, source dates, closure context, bounds and evidence pins.

Release acceptance: full required CI must pass on the exact PR head before the leased merge. The release must then pass **Publish Hostinger release**, update `hostinger`, and match live `release.json` plus the affected agency/index bytes. Final merge, workflow and live desktop/mobile acceptance evidence will be recorded in this follow-up PR's discussion after actual publication; no pending check is represented here as complete.
