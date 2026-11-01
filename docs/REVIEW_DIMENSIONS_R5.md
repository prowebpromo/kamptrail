# Review dimensions (R5, package A)

Contract: `docs/replica/COMPLETION_CONTRACTS.md`, R5, with the owner decisions of November 1, 2026.
Version: not bumped. The release version is set when this branch is rebased after earlier releases land.

## What was added

Five new optional 1-5 visit scores, stored beside the existing `quietness`, `shade` and `comfort` scores in the review's observation JSON. No SQL migration is needed.

| Key | Label | 1 means | 5 means |
|---|---|---|---|
| `crowds` | Crowds (how crowded it felt) | Not crowded | Very crowded |
| `fullness` | Fullness (camping spaces occupied) | Nearly empty | Completely full |
| `noise_day` | Quietness by day | Very noisy | Very quiet |
| `noise_night` | Quietness by night | Very noisy | Very quiet |
| `cleanliness` | Cleanliness | Very dirty | Very clean |

Crowds is perceived crowding. Fullness is the share of camping spaces occupied. For both, higher means more crowded or fuller. For every other aspect, 5 is the better experience. The form states this in one sentence and labels both endpoints on every option list.

Unchanged and not converted: the categorical `crowding`, `noise`, `shade`, `access` and `comfort` observations, the existing numeric `quietness`, `shade` and `comfort` scores, carrier signal reports, and the visit-month counts. No numeric score is derived from any categorical field.

### Season

- The season comes from the visit date, using the existing US calendar seasons: winter Dec-Feb, spring Mar-May, summer Jun-Aug, fall Sep-Nov.
- The form shows the derived season in a "Season being rated" field for the visitor to confirm. It updates when the date changes.
- When a stay crosses a season boundary, the visitor can pick an adjacent season (the one before or after the visit date's season). The API rejects any other season.
- The confirmed season is stored only when it differs from the visit date's season and only with at least one numeric score. If a later date edit makes it non-adjacent, it is dropped.
- A missing or unusable visit date gives no seasonal contribution. Those ratings still count toward the whole-site count.
- PHP (`ko_season`, `ko_allowed_seasons`, `ko_rated_season`) and JS (`season`, `allowedSeasons`, `ratedSeason`) are identical. A parity test runs both on the same boundary, adjacency and invalid-date cases.
- There is no stay-length field.

### Averages

- `GET api/community.php?site=` now also returns `site_scores`: per axis, the count of explicit published ratings, first and latest visit, and `average`, which is null below 3 ratings.
- The review dialog shows a "Visit sub-rating averages" panel. Below 3 ratings it shows "insufficient evidence" with the count. The client also refuses to show an average below 3 even if a server sends one.
- Counts are ratings, not distinct campers.

### Out of scope here (packages B and C)

- R6 filters: the filter panel keeps only the original three numeric score filters (`FILTER_SCORES`). Direction-aware crowds and fullness filters come in package B or C.
- R7 seasonal display: the seasonal panel keeps showing the original three aspects (`SEASONAL_SCORES`). The API already returns seasonal sums for the new axes, honouring the confirmed season.

## Files

- `api/_lib/observations.php`: new axes, season validation and binding, `ko_site_scores`.
- `api/community.php`: binds the season to the visit date on submit and edit, returns `site_scores`.
- `community-discovery.js`: new score labels, season field, averages text, season parity functions.
- `community.js`: averages panel in the review dialog.
- `filters.js`: filter list limited to the original three aspects.
- `locale.js`, `locale-fr.js`: Spanish and French for every new string.
- `tests/helpers/php-harness.js`: reusable isolated PHP and database harness.
- `tests/review-dimensions.test.js`: API and unit proof.
- `tests/browser/review-dimensions-staging.spec.js`: browser proof against the harness.

## Proof

Tested commit: `8609a2a229eb9ed913f410e51776bec54cb89865` on branch `feat/review-dimensions-r5`, based on main `023d444d`. Run on 2026-11-01 in the agent workspace (PHP 8.3.6 with pdo_sqlite, gd and mbstring, Node 22, Chromium 1243). This doc commit changes no code.

### Staging harness (owner decision 1)

`tests/helpers/php-harness.js` starts `php -S` on this checkout with a disposable SQLite file (or `KT_TEST_MYSQL_DSN` in CI), a test-only moderator, and the real `api/community.php`, `api/community-discovery.php` and `api/admin.php`. It never contacts production. The browser spec loads the app from that same PHP server, so the form posts to the real endpoints. No app endpoint is mocked. Only third-party https tiles are stubbed.

### API and unit proof: `tests/review-dimensions.test.js`, 6 of 6 pass

1. Each new dimension submits alone, and bad values are rejected (0, 6, 2.5, string, boolean, categorical keys used as scores, unknown season). Pending reviews are invisible. The moderation queue shows every new axis. Publication shows them. Author edit returns to pending. Hide, reject and restore work. A legacy client edit keeps stored scores. Clearing a score removes it, and delete removes it.
2. Threshold: 2 ratings give a count with a null average and "insufficient evidence". 3 ratings give 3.0/5 and 4.7/5. Hiding one drops back to 2. A review without the axis is not a qualifying rating. The client never shows an average below 3.
3. Season: a non-adjacent season is rejected. A boundary stay (2026-03-01, rated winter) counts in winter. A confirmed visit-date season is not stored. PHP and JS seasonal sums agree. A date edit drops a season that is no longer adjacent. An undated published rating counts in the whole-site count but in no season. A submission without a date is rejected.
4. No conversion: categorical crowding, noise, shade and comfort produce no numeric score, legacy stored rows included. Monthly categorical counts are unchanged.
5. PHP and JS season parity across 96 date and choice cases, including Dec 1, Feb 28/29, Mar 1, May 31, Jun 1, Aug 31, Sep 1, Nov 30, empty, invalid and pre-1900 dates.
6. Form: the labels and endpoint hints, "Not reported" defaults, derived season with adjacent choices, the disabled state without a date, and the payload (season only with scores, and only when it differs from the date's season).

The existing `tests/community.test.js`, `tests/discovery.test.js` and `tests/locale.test.js` pass. `tests/discovery.test.js` was updated to count the new form fields.

### Browser proof: `tests/browser/review-dimensions-staging.spec.js`, 2 of 2 pass

Desktop 1440x1000 and mobile 390x844. Each run fills crowds, fullness, day and night quietness and cleanliness in the real form. It checks that the season field is disabled before a date, that it shows the derived season and adjacent choices, and that the posted payload is exact. It selects winter for a 2026-03-01 boundary stay, submits through the real API and moderates through the real admin endpoint. After 2 published ratings it sees "insufficient evidence · 2 explicit ratings". A third pending rating does not change that. After the third is published it sees 3.0/5 and 4.7/5. It also checks the "Season rated: Winter" line, no horizontal overflow and an axe scan with no violations.

Server: the app and API were served by the harness's own `php -S 127.0.0.1:18940` started from `/home/claude/wt-r5`. The Playwright `BASE_URL` was this worktree's own `PORT=8800 node scripts/serve.js`, which served the other specs.

### Suites at the tested commit

| Suite | Result | Failures |
|---|---|---|
| `npm test` (KT_REQUIRE_PHP=1) | 430 of 475 pass | 44 "Claude provenance" cases and "committed Forest Service file validates…". All 45 fail the same way on main `023d444d` (bot data refresh). |
| `npm run test:python` | 397 pass, 9 skipped, 2 fail | `test_usfs_fee_rechecks…nov29…` and `test_usfs_site_amenities…snapshot_record_counts`. Both also fail on main `023d444d`. |
| Browser: community, discovery, locale, campsite-videos, upgrade, reports, app, review-dimensions-staging | 36 of 38 pass | `app.spec.js` mobile map height (493 vs >500, known). `locale.spec.js` French fallback hits its 45 s total limit after all its assertions pass. It also fails on main `023d444d` (46.2 s on one of three base runs) and passes when run alone. |

### Not covered here

- Production desktop and mobile acceptance is separate (owner decision 1).
- R6 filters and the R7 seasonal display are packages B and C.
