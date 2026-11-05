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
