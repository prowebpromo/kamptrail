# Published reports by visit month

This increment adds a bounded **Reports by visit month** panel to the existing reviews dialog. It summarizes categorical observations already stored with moderated reviews. It requires no migration, new contribution fields or numerical scoring system. The current overall star rating remains separate.

The panel uses actual `visited_on` calendar months across all reported years. It shows the earliest and latest included visit dates, the number of published condition reports, category counts for approach, noise, shade, crowding and subjective personal comfort, and unreported counts for each axis. Months are used directly. They do not imply a shared climate season or forecast. One review can report multiple axes, so axis counts overlap. No category is converted into a numeric subscore. Carrier details remain separate in individual reviews.

## Source and moderation

The existing `GET api/community.php?site=…` response adds a `monthly` object. A site-scoped aggregate query includes only `community_reviews.status='published'`, joined to existing `community_observations` by review ID. It uses the exact campsite identity requested for the review list. It does not group neighboring places or aliases automatically. Counts cover all published pages for that identity, independently of the ten reviews displayed on each page.

Pending, rejected, hidden and deleted reviews cannot contribute. Author edits already return a review to pending, so the next read removes its conditions until reapproval. Explicitly cleared observations become unreported. A review without condition axes, including a carrier-only review, does not become a condition report. Unknown or malformed dates are never replaced by submission dates. A condition report needs a valid date from 1900 through the current UTC date, matching the existing contribution contract. Invalid date reports and unusable condition data are counted separately without assigning them to a month. Names, prose, photos, management codes and carrier values are absent from the summary.

The producer reads at most 10,001 grouped rows to enforce a 10,000-group ceiling and one million published-review ceiling. An over-limit candidate returns `available:false` and no partial counts. Existing individual review reads remain available. The consumer validates the complete summary, exact month/date identities and integer/category totals. Missing, invalid, partial or over-limit summaries display unavailable. A summary checked more than seven days ago, or with a check time more than five minutes ahead, displays expired rather than current counts. This feature adds no offline snapshot. The existing reviews service still requires an internet connection.

## Limits and acceptance

These are self-reported past visits. They do not establish current conditions, objective safety, camping permission, current signal coverage or expected conditions for a later visit. Sparse or missing reports remain unknown. The feature is a descriptive seasonal-evidence increment and does not claim complete historical FreeRoam numeric-subscore parity.

Acceptance checks cover calendar month/year boundaries, omitted axes, explicit invalid and future dates, carrier separation, complete pagination, exact site isolation, publication/hide/edit/clear/delete transitions, private-field rejection, producer limits, source expiry, empty months, mobile width, keyboard interaction and scoped accessibility. The existing popup/share regression is unchanged. Local dependency skips and missing Chromium are not browser or PHP passes. Parent integration controls the global release version and final GitHub/live verification.

## Local preparation evidence

On base `369efee`, the complete Node suite passed 179 tests with 48 native-PHP-dependent skips (227 total). The Python suite completed 188 tests with seven optional skips. The release build, JavaScript syntax checks and diff check passed. The existing installed PHP-WASM runtime separately passed syntax, calendar-month producer, unknown/future date, carrier exclusion, group-cap and exact published-site SQLite join checks. This is limited SQLite/helper verification, not a native PHP/MySQL API or moderation-suite pass. Browser discovery lists all eight community tests, including the three new monthly-view cases. Chromium remains unavailable locally, so GitHub must execute the browser and native PHP/MySQL gates.
