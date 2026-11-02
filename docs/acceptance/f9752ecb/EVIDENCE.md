# Live acceptance of 2.37.0 (PR #166, merge f9752ecb)

Observed values only. Chrome 153.0.8010.12. `release.json` reported `f9752ecb…` at the start and end of every check. Publish run 41377853605, success.

## Rest-area partial timeout (the release's own check)

`scripts/acceptance/live-rest-area-timeout-check.js`, run on the live site with only the first Nevada request held past its own 20 s deadline (fake clock):

| | Desktop 1280x720 | Mobile 390x844 |
|---|---|---|
| "Unavailable now: Nevada." after the deadline, no whole-catalogue failure | yes | yes |
| Validated INDOT facility (Greenfield Rest Area, I-70 MM 107) stays on the map with "overnight parking Prohibited" | yes | yes |
| "Retry official rest areas" reloads Nevada (2nd request) and the notice clears | yes | yes |
| Result | PASS | PASS |

Control: the same check fails against the live 2.36.0 site (Nevada never gets its own deadline) and passes against 2.37.0 code on a local server.

## Identity and saved-stop regression

- First run, 02:47 to 02:52Z: census desktop (reversed) FAIL, kept unchanged in `first-run-FAIL/`. 122 Forest Service and BLM listings were missing and 111 source sets lacked their agency ids. failed_states was 0 and there were no page errors. The runner stopped there.
- Rerun, 02:53 to 03:04Z (`rerun/`): census desktop reversed and mobile seed 7, 33,370 expected, 33,370 browser, all difference counts 0. Saved stop PASS on desktop and mobile.
- Assessment: transient. The agency files answered 200 right after, and 2.37.0 changes only rest-areas.js and version strings. It exposes a pre-existing coverage gap: when the agency index or an agency state file fails to load, data-loader.js logs a console warning and omits Forest Service and BLM listings with no visible notice and no failed-state entry. Investigation target for the audit, not fixed in this release.

No parity claim. Score 91.7.
