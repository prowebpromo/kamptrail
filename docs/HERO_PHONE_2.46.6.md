# Hero phone preview and beta badge — 2.46.6

Owner request: add the phone/app preview to the KampTrail homepage hero and make “Public beta · Free · No account required” stand out.

The existing real Moab map capture appears in a CSS phone frame over the existing lakeside image. Both assets are already included in the release package. The map credits remain visible. The beta line now uses larger bold cream text, a dark green badge and a contrasting border. The image alternative is translated in Spanish and French. Release/cache versions advance together; saved user data is retained.

Local verification: 34 existing homepage, website and service-worker checks passed. Browser previews at 1440×1000, 390×844 and 320×740 show the phone image and beta label with no horizontal document overflow. The small/full WebP headers confirm 500×767 and 750×1150 respectively, reflected in the image markup.

The first full browser run passed 244 of 245 tests and identified that the larger mobile preview displaced the map shortcuts below the first viewport. The corrected mobile layout uses a compact phone preview and tighter spacing, retaining the installation guidance in the dedicated installation section. At 390×844 the last shortcut ends at y=823.17, and document/client widths are both 375px. Badge text/background contrast measures 10.30:1.

Release gates: corrected exact-head CI and post-deploy desktop/mobile verification remain pending. Do not call this deployed until the live release source SHA and rendered homepage are checked.
