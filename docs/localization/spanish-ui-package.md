# Spanish UI integration candidate

The 2.19.0 candidate combines explicit Spanish product labels with numeric seasonal visit ratings and moderated external campsite videos. It builds on PR101's monthly condition counts, single camping-care checklist, rig profile, route terrain and Rhode Island height-tag map. The optional nearby-route height consumer uses the same existing `data/clearances/RI.json` feed. National service freshness and guarded promotion code from the reviewed 2.18.1 source are retained. The release identity is 2.19.0 with worker `kt-v47`.

## Language and data boundaries

The English/Español selector stores `kt_language` on this device. English is the default; unsupported preferences fall back to English. The document language is set before UI initialization. A successful language change reloads while preserving saved trips, map position, filters, layer preferences and profiles. Storage denial keeps the current language and explains the failure without reloading. No remote translation service or browser-language assumption is used.

Spanish first-party labels cover core map and search tools, filters, saved trips, correction/review/permission forms, numeric ratings, monthly counts, videos, rig-profile controls, terrain and mapped-height explanations, services and About/help. Source names, proper place names, agency quotations, forecast prose, source tags, visitor words, profile names and notes remain unchanged. Imported profile schemas, score/season/month/carrier keys, units and action identifiers remain canonical. Source dates and raw metadata stay distinct from translated explanations. The separate existing English tutorial videos and their source metadata are preserved.

French is absent. The combined “Multi-language (es fr)” criterion remains partial. Unknown future server messages, native browser messages and external/source content can remain in their original language; this is not a full source-content translation claim.

## Coexisting community summaries

Monthly counts describe categorical reports across calendar visit months and years. Numeric seasonal averages use only explicit 1–5 quietness, shade-satisfaction and personal-comfort ratings, with at least three ratings per selected aspect and season. A count is a number of ratings, not distinct people. Combined filters require the same dated cohort. Qualitative observations never create numeric ratings or an objective safety score.

The PHP projection whitelists and normalizes public categorical fields, scores and carrier observations before discovery grouping. Video IDs and unknown/private metadata cannot fragment or leak through cohorts. Monthly grouping separately projects categorical fields before grouping, so legitimate numeric/video attachments retain the original condition counts. Invalid known categorical values remain invalid; missing fields stay unknown.

There is one care checklist at `#kt-camping-care`, reachable from About and map spot help. It retains the dated primary-source links, local-rule precedence, offline-readable text and conditional fire guidance, including soaking and stirring embers until cold. No duplicate land section or parallel height feed is added.

## Extension and validation

Use explicit `KampTrailI18n.t(key, params)` keys for first-party text. Interpolation is literal. Escape interpolated HTML parameters or use text nodes. Never translate arbitrary visitor/source strings. `apply()` changes only explicitly marked shell elements.

Dedicated tests cover persistence and storage denial, literal interpolation, original visitor/source text, numeric/carrier payloads, current rig keys and raw height tags. Browser fixtures additionally cover language changes, mobile fit, keyboard behavior, accessibility and forms. Every top-level browser spec is explicitly included in `playwright.config.js`.

Final local and pending CI evidence is recorded in `docs/replica/2026-10-30-parity-2.19-candidate.md`. No local PHP or browser installation was attempted. PHP/SQLite, MySQL and Chromium tests must pass against the exact integrated source before release; local skipped tests are not a pass claim.
