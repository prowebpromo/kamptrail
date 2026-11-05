# Phase 1 closeout candidate 2.46.1

This record replaces the stale status sentences in the original 2.46.0 implementation mapping. It does not declare the SOW accepted. Production is held for owner review. The supplied SOW includes physical-device and production measurements that cannot be established by desktop automation.

The November 4 beta integration requirements now set the product priority. See `BETA_INTEGRATION_2026-11-04.md`. Candidate runtime remains 2.46.1; its next staging artifact uses cache generation kt-v83 and an exact source SHA. No production release is implied.

## Additional implementation

- Website: original `plan.html` and `about.html`, task-based Tools categories, consistent visitor navigation, social metadata and collection/page structured data. Both pages ship in the offline shell and sitemap. See `WEBSITE_RECONCILIATION_2026-11-04.md` for all nine RME sections and explicit build/defer decisions.
- O-1: deterministic offline guards for feedback, listing corrections, location-dependent discovery and uncached coordinate lookups. Draft text is retained; coordinate results have polite status announcements. Existing cached-route and forecast-offline behavior remains in force.
- D-1: `data/record-overrides.json` is the authoritative correction ledger. A validated generated module is used by the index and browser. Exact ID, name and six-decimal coordinates must all match. A correction cannot set fees, access, rig suitability, source type, identity or discovery admission.
- Up the Creek: the operator's own physical address identifies Moab, UT. The missing state is corrected to UT with a dated correction-source link. The raw source snapshot is unchanged. An explicit contradictory state is retained, and a relocated/renamed record is not silently corrected.
- Moab Field Office: the displayed kind is Management area, with the exact source-scope warning. The source classification and discovery admission remain unchanged pending independent data review. This is not a completed withdrawal.
- Version and service-worker generation move together to 2.46.1 / kt-v83.

## SOW acceptance register

| ID | Implementation | Remaining acceptance |
| --- | --- | --- |
| P-1 | Deferred map, optional language packs and minified ordered bundle | Measure the new candidate on staging. Production-after targets and desktop target require production verification after approval. Prior staging measured mobile 89 / LCP 2.41 s / TBT 0, desktop 94. |
| P-2 | Mobile hero 95,856 bytes, responsive imagery and explicit dimensions | Recheck new candidate image insight and layout shift. The SOW's exact zero-CLS target is not inferred from a near-zero result. |
| O-1 | Visible offline status and action-specific failure handling; additional immediate guards | Complete automated action matrix and actual-phone airplane-mode pass. Desktop emulation is not a physical-device pass. |
| O-2 | Best-effort persistence, session-scoped reminder and GPX export | Actual-device storage/install behavior; browser grant remains browser-controlled. |
| O-3 | Existing estimate/confirmation retained; explicit quota handling | Real-phone area, tile count, MB and duration report remains open. |
| U-1 | Single-scroll mobile sheets, persistent controls and live count | New-candidate staged regression; physical-device touch pass. |
| U-2 | Unique matches open directly; ambiguous choices retained | New-candidate browser regression and real mobile keyboard pass. |
| U-3 | Terms/Safety gate preserved; modal context and behavior | Real install and screen-reader pass. Legal wording is unchanged. |
| U-4 | PWA launches map workspace; full website and shortcuts reachable | Actual Android and iOS installed-app launches. |
| U-5 | Primary actions, route warning and clarified beta wording with translations | Successful route, visible car warning, reload/cache and offline replay passed on isolated staging. Standalone-device check remains. |
| A-1 | Visible labels contained in accessible names | Actual voice-control tool pass remains open. |
| A-2 | State and cluster names include meaning and visible count | Screen-reader pass remains open. |
| A-3 | Marker skip link and focus styling | Record keyboard path and screen-reader/device checks. |
| A-4 | 44-pixel controls/hit areas | New-candidate viewport measurements and real-device touch. |
| M-1 | Separate any/maskable icons, id, metadata, shortcuts, real wide screenshot | External manifest check and real Android icon/shortcut inspection. |
| H-1 | robots, sitemap, favicon and new website URLs packaged | Temporary-domain robots is provider-controlled. Submit the production sitemap only after publication and verified property access. |
| H-2 | Header/cache policy verified on the prior Hostinger staging build | Isolated staging health, road routing and feedback passed; see STAGING_PHP_ACCEPTANCE_2026-11-04.md. Production remains a separate gate. |
| H-3 | WebApplication/page/collection JSON-LD and social tags | Independent schema-validator result remains open until recorded. |
| H-4 | Shared configuration, existing global pacing/cache and provider notes | Successful route and cached/offline replay passed on staging. Keep provider limits/availability explicit. No paid service or traffic allowance is invented. |
| D-1 | Exact-ID ledger, operator-backed state correction, management-area presentation, counts and pipeline notes | Independent review before any BLM discovery withdrawal. Retained-input replay is not a live source refresh. |

## Data evidence and refresh behavior

The operator website https://www.moabcampground.com/ identifies the physical address as 210 E 300 S, Moab, UT 84532. The retained OSM record is `osm:node:1944017355`, Up the Creek Campground, at -109.5468667 / 38.5678333. Only its missing state is supplemented. No fee, campsite suitability or opening-status override is made. The website contains dated season information and older flood/rebuild wording; that does not establish a current closure or reopening date.

BLM's own RecAreaID 16330 describes a management jurisdiction. The exact source query and correction evidence are retained in the ledger. Its raw type is not silently changed and the ID continues to resolve. A later exact-ID withdrawal must preserve saved/share/legacy resolution and be reviewed by someone other than the implementer.

Refresh sequence: retained fetchers write source snapshots; merge processing produces state/agency inputs; `scripts/build-search-index.js` regenerates the validated correction module before normalizing records. The browser loads the same generated module before DataQuality. A repeated same-ID/name/coordinate input receives the same correction even when upstream still omits state. Evidence mismatches require review. Never implement a blanket Office/Headquarters/Ranger Station exclusion.

## Explicit remaining gates

Owner staging review, independent data withdrawal review, required physical-device/accessibility tests, verified webmaster property access, and production-after acceptance remain gates. A successful CI run alone does not close these items. Live refreshes, production database copies and publication are not used to manufacture evidence.
