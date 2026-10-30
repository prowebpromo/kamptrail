# KampTrail 2.19.0: Spanish core UI and visitor video links

Prepared October 30, 2026, from the complete 2.18 candidate. This adds an English/Español selector and moderated external YouTube attachments to campsite reviews. Runtime handshakes and first-party URLs use 2.19.0. The worker shell is kt-v46.

Spanish covers the established public core, camping-care help and descriptive visit-month reports. Rig, sampled terrain, height-tag, qualified amenity and service-source descriptions are translated too. Unmapped server/browser messages and the separate English tutorial page remain exceptions. French is absent. Source, place and visitor words remain unchanged. See [localization/spanish-ui-package.md](localization/spanish-ui-package.md).

Video players require a fresh publication check and an explicit Play action. Review moderation, author management and condition aggregation retain their meanings. No video files, automatic thumbnails, new credentials or schema migration are introduced. See [CAMPSITE_VIDEOS.md](CAMPSITE_VIDEOS.md).

The candidate includes the final 2.18 clearance timeout fix, rig-cache documentation restoration, mobile spot-popup map-control guard and bounded forecast-pointer confirmation. The current 2.18 native Close and control-restoration regression is preserved. It does not revive obsolete numeric seasonal sub-ratings. Final parent integration must retain the actual 2.18 merge and any eventual national-service data commits rather than replacing their source data with this earlier snapshot.

Independent review corrected a moderation rendering race. Each decision now hashes the exact review, video and photo snapshot shown on its card, then compares that hash against locked current content on submission. A deterministic same-second attachment replacement reproduced the previous bug and verified that an unseen replacement receives a conflict instead of approval.

Current local checks: Node 310 tests (253 passed, 57 PHP-dependent skips), Python 216 tests (eight optional skips), build and diff checks passed. Native PHP and Chromium are unavailable locally. Full GitHub PHP/MySQL, backup restore, browser, build and Lighthouse checks on the final integrated head remain required. Publish through main → Publish Hostinger release → hostinger and verify source, health, language persistence/mobile/keyboard behavior, unpublished media boundaries and the actual accepted service snapshot.
