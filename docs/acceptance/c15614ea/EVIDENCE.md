# Live acceptance of 2.38.0 (PR #168, merge c15614ea)

Observed values only. Chrome 153.0.8010.12. `release.json` reported `c15614ea…` at the start and end of every check. Publish run 41478244359, success.

## Agency-load notice (`scripts/acceptance/live-agency-notice-check.js`)

| | Desktop 1280x720 | Mobile 390x844 |
|---|---|---|
| Agency index failing in the national overview: "Forest Service and BLM listings could not load. Other listings are shown." with Retry, and Retry restores the index | PASS | PASS |
| Colorado agency file failing at detail zoom: notice names Colorado, and Colorado's 1,203 other listings stay | PASS | PASS |
| The notice survives zooming out to the overview | PASS | PASS |
| Retry restores 442 Forest Service and BLM listings (0 before) and clears the notice | PASS | PASS |

Only the named request was failed, with `page.route`. Everything else came from the live site.

## Identity and saved-stop regression

Census desktop (states reversed) and mobile (seed 7): 33,370 expected, 33,370 in the browser, all difference counts 0. Saved stop PASS on desktop and mobile.

The runner used the acceptance scripts on this evidence branch, which predate #168's census change (`load_failures`). The full listing match shows that the agency data loaded in both runs.

## Not part of this release

`api/health.php` is still HTTP 503 with `schema: migrations_pending` (`health.json`). Migration 006 (2.36.0 visitor clearance reports) is waiting for the owner.

No parity claim.
