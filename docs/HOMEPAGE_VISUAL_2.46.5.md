# Homepage visual cleanup 2.46.5

Owner approved the November 5, 2026 visual review with “proceed.” Base: `b7fa9d0d1487817e3e6da87386ff4419fc32158d` (2.46.4). Scope: presentation and existing install engagement rules.

## Changes

- Separate the existing decorative landscape from a solid green copy panel. Remove the tilted device, map miniature, labels, shadows and gradients.
- Keep camping, parking and RV-services positioning and all five query-aware launch links. Place the links in an equal-width strip, with a full-width final choice on mobile. Preserve direct-entry and installed workspace behavior.
- Compact the header and use a deliberate three-column mobile navigation grid. Shorten repeated introduction copy. Keep the founder section, installation instructions, FAQ, feedback and footer legal destinations.
- Crop existing guide screenshots with CSS to show readable interface details instead of tiny whole-page captures. Keep adjacent map attribution.
- Keep the skip link clipped until keyboard focus. Make search/filter actions primary and other map tools quieter.
- Hide the toolbar install action until existing engagement thresholds plus activity in this document are met. Standalone or remembered installations remain hidden. The voluntary lower-page install guide stays available.
- Version 2.46.5, cache kt-v87. No production data, listing identifiers, permissions, routing semantics or national-clearance packaging changed.

## Image provenance

The existing lakeside asset is generated photorealistic decorative scenery, as documented in HOMEPAGE_DESIGN_2.45.0.md. This release does not represent it as a photograph of a real campsite and adds no new imagery. The actual live map remains the product demonstration.

## Verification

- Focused homepage, website and beta unit checks: 18/18 passed before the final combined run.
- Independent install visibility implementation and review: install and beta unit checks passed 20/20.
- Base blob hashes for all 49 changed existing files match the exact main tree.
- Desktop preview inspected through supported browser controls. Mobile, final CI, release source and live acceptance are pending at preparation time. Record terminal results below before calling this release complete.

## Final release and live acceptance — November 6, 2026 UTC

- PR #181: exact tested head `c10fff893a0a869000f227a5fe794bb8d13990fe`, initial merge `771125d0ff971bb3096e52559e341b1e1ca2535d`. Full CI run 42133348118 passed 635 Node tests, 419 Python tests and 245 browser tests.
- Repeated post-merge gates exposed scroll-sensitive layer-picker and correction-popup pointer tests. Publication remained blocked. PR #182 positions the map before opening controls, waits for map motion to settle and keeps ordinary pointer clicks and all original assertions. It changes tests/read-only validation only.
- PR #182: exact tested head `d5081cec3f53e27228cb18f78b683b7a3e30523a`. Targeted run 42139338482 passed 9/9 checks (three affected paths repeated three times) and verified unchanged product/data blobs. Full CI run 42139344307 passed 635 Node, 419 Python and 245 browser tests.
- Final main/release source: `cf618fc93e69bc15fbe660e7922c8265ff3589d8`. Main regression run 42142013970 passed. Normal Publish Hostinger release run 42142014088, job 127644356895, passed all checks, including 245 browser tests, and published artifact commit `dcdce6ae7fede488b4ada47f5968bd322443bcc8`.
- A proposed one-off review-branch publisher was rejected by automatic approval review for unclear production-publishing side effects. It was not committed or executed. The completed release used the unchanged main-branch publisher after standard CI.
- Live acceptance run 42142076507, job 127644564505: PASS on desktop (1440×1000) and mobile emulation (390×844, touch). Both fetched live release.json and verified the exact final source above and client version 2.46.5.
- Both views passed all five keyboard-activated intent launches, their expected filters/layers, entry notices, workspace hiding, horizontal bounds, first-screen shortcut placement, keyboard skip-link visibility, no initial toolbar install action, install availability after three real searches, no automatic install dialog, retained founder/install/FAQ/feedback sections, and no geolocation request. Analytics remained unconsented and measurement off in disposable QA contexts; Google collection requests were blocked.
- Final live evidence artifact: 13469492662, SHA-256 `a1ff1280602d5157a6544ad77e138b7baa113e5ecb6b4298735a83de6708d575`. Raw reports: docs/acceptance/homepage-visual-2.46.5-desktop.json and homepage-visual-2.46.5-mobile.json.
- Manually inspected the deployed desktop homepage after its normal saved-app update completed and inspected the live mobile screenshot. Version 2.46.5, loaded campsite results, hidden initial install toolbar and the clean split hero were observed.
- No forced production data refresh, test submission or additional production configuration change was used. Existing clearance packaging and data were unchanged by this visual release.
- Unverified: physical-phone installation/touch/offline testing and Safari-specific rendering. Mobile acceptance above is Chromium emulation.
