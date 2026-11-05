# SOW closeout candidate 2.46.2

The controlling product requirements are the November 4 BoB-to-KampTrail beta integration requirements. BoB retains editorial acquisition. Cloud accounts, magic-link synchronization and programmatic location pages are not introduced by this closeout. This is an implementation and acceptance record, not a declaration that physical-device or production acceptance has occurred.

## Completed software follow-through

- Added a lossless versioned JSON trip backup alongside GPX. It preserves exact saved IDs, snapshots, notes, dates and custom locations. The entire file is validated before replacement, with a 1 MB/200-stop bound and replacement confirmation. A failed storage write leaves prior memory and stored stops unchanged. Backup files contain private trip details and should be kept private.
- Fixed offline status counting historical downloads instead of current unique cached tiles. An identical-area retry updates its log instead of adding a duplicate. Quota and cancellation preserve existing saves.
- Finished the dormant consent integration: inline settings, bounded stored choice, expiry/cross-tab withdrawal, sanitized event wrapper and controlled sole-owner loader. All release switches remain false in analytics-settings.js. No Google collector is enabled.
- Added a post-consent kt_measurement_started boundary instead of replaying denied landings or earlier actions. It uses approved article/mode/source fields and no local session UUID. Funnel analysis must use this boundary for late-consent visitors and report consent exclusions.
- A second analytics owner is refused. Existing gtag, dataLayer or Google scripts block the loader. This preserves BoB's existing tag but means its beta integration requires one-owner reconciliation before activation. A separate GA4 property does not solve page-level ownership by itself.
- Increased remaining primary Offline, zoom, layer, search and filter controls to 44-pixel targets. Added focused browser acceptance for changed filter counts, keyboard paths, offline actions, quota/cancel/retry, JSON file recovery and consent controls.
- Bundled the four consent modules into one local release asset. The service worker versions that local asset with the app shell. No external Google library is precached.

## Validation boundaries

Targeted local tests and the release build are recorded in the final hand-back after completion. New browser cases use synthetic/intercepted services rather than live provider downloads. The inert tag-loader fixture proves bootstrap ordering and event sanitation, not Google's actual network payload or session joining. No test loads real Google analytics or emits production feedback.

The existing Phase 1 source already implements deferred map/languages, responsive photos, persistent storage requests and GPX reminders, mobile sheets, direct unique searches, preserved safety acceptance, installed map entry, car-route warnings, accessibility labels, manifest/site files and hosting policies. Existing exact-head CI and isolated PHP acceptance are reused as historical evidence, not claimed for a new head without its own run.

## Remaining acceptance that code cannot replace

- Actual iPhone/Android installation and launch, airplane-mode saved-area timing/MB, device touch/keyboard, VoiceOver/TalkBack and voice control.
- Current-candidate production Lighthouse and hosting checks after authorized release. The earlier staged desktop score was 94 against the proposed 99 target. Do not describe that target as met or silently revise it.
- Existing BoB tag ownership/consent reconciliation, final accurate privacy text, reviewed publication of the beta tag configuration, and actual Google payload/report/cross-domain validation. The unused property is 562540990, measurement G-VQE0H1DNKL. No user data has been collected by this candidate.
- Saved WordPress drafts 73675/73677 remain review copies. Actual mobile CMS rendering and transfer of approved CTA blocks into their originals follow app acceptance. Do not publish duplicate articles.
- Independent data review before any discovery withdrawal. No withdrawal, source refresh, production database copy or paid service is part of this closeout.

The original Phase 1 SOW explicitly requires physical devices and production-after measurements. These cannot be marked passed by desktop automation. Production release must preserve that distinction.
