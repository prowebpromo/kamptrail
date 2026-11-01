# Validation of the hardened acceptance scripts (live site, 76da929f)

Raw outputs, unchanged. Runs from this sandbox against https://kamptrail.com at deployed SHA 76da929f, Chrome 153.0.8010.12 (recorded at runtime by each script).

| File | Check | Result |
|---|---|---|
| census-tampered-index.json | Census given the live index plus one fake listing `test:tampered-1` (mobile, seed 7) | FAIL as intended, exit 1, `missing: ["test:tampered-1"]`, 1 mismatch. Proves a census mismatch fails. |
| saved-stop-desktop-unscoped-FAIL.json | First desktop saved-stop run, before the click was scoped to the drawer | FAIL, exit nonzero: the click timed out on a sidebar "View on map" covered by the open drawer. A script defect, fixed in 233ae3bf. Kept as the original failure evidence. |
| saved-stop-desktop.json | Saved-stop reopening, desktop 1280x720 | PASS, exit 0 |
| saved-stop-mobile.json | Saved-stop reopening, mobile 390x844 touch | PASS, exit 0 |

The two passing runs record the release, browser and version, runtime viewport and UTC start and end. Online with the service worker controlling, the stored id is `ridb:232479` and resolves to `osm:way:1107154601` Cosby Campground. Offline, with an uncached fetch confirmed blocked, the stop is reopened from the drawer with "View on map", the popup shows Cosby Campground, and the stored id and resolution are unchanged.

The runner's failure modes (script error, timeout, missing, unparsable or FAIL output with exit 0, wrong deployed SHA) are proven offline by `tests/acceptance-runner.test.js` in npm test.

The full census was not rerun for this hardening, per the owner. The 76da929f census evidence is in ../76da929f/.
