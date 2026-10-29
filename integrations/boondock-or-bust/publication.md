# Boondock or Bust integration

Published October 28, 2026 at https://boondockorbust.com/resources/kamptrail-campsite-map/ (WordPress page 73633). The Resources submenu entry **KampTrail Map** was verified in the live page DOM. The existing RV Park & Campground Finder remains separate.

## 2.5 update (published 2026-10-28 20:43 ET)

- Page 73633: RV fit sentence now states one site must list the length and every hookup. About the data sentence mentions source download dates. New section "Report a problem or a missing campsite". `kamptrail-page.html` matches.
- Post 58434: second KampTrail paragraph adds in-app corrections. Quick facts Includes line adds in-app corrections.
- Pages 35 and 68009 already carried the 2.4.1 copy and needed no change.
- Verified on the live pages (LiteSpeed cache miss). "GPX tools" and "public-land overlays" no longer appear as missing features in post 58434.

## Publication record

- Published **KampTrail Campsite Map** under Resources with the embedded app and full-page link. `kamptrail-page.html` contains the page markup; WordPress supplies the page H1.
- Updated the apps article (post 58434): https://boondockorbust.com/boondocking-guide/the-best-apps-for-finding-free-campsites/. Corrected all KampTrail-related claims in its main section, comparison table, callout, BLM paragraph, alternatives paragraph, decision table, and FreeRoam FAQ. Removed the obsolete screenshot, old campsite/water-station counts, federal-only/verified assertions, and water/tower promises. KampTrail links now point to the new BoB page. Other app sections were preserved.
- Added a contextual KampTrail link after the existing native-finder call to action in the free/cheap campsite guide (post 68009): https://boondockorbust.com/boondocking-guide/a-35-year-rvers-guide-to-finding-free-cheap-campsites/.
- Added a KampTrail paragraph after the existing native-finder call to action on Useful Links (page 35): https://boondockorbust.com/resources/useful-links/.
- Added **KampTrail Map** to the Resources submenu. The legacy `/camp-finder-free-or-cheap-campsites/` redirect was not changed.

## Verified in the published desktop embed

- The iframe retained the interactive app and returned campsite listings for Albany, NY.
- Saving **North-South Lake Campground** persisted across a page reload.
- The directions link used the campsite coordinates **42.2005732, -74.0450907**.
- The new Resources submenu entry was present in the live DOM.

WordPress mobile rendering and Near me permission behavior have not been verified. The app's automated mobile checks do not establish mobile behavior within the WordPress theme. Real-RVer usability sessions have not been performed; the session protocol remains in `docs/USABILITY_TASKS.md`.

## Current KampTrail copy for future maintenance

### KampTrail: Find Campsites and Save Stops Without an Account

KampTrail is our free campsite map. Search by city, state, campsite name, or coordinates, filter by reported fees and campsite type, and save stops in your browser. Open a listing for coordinates, source details when available, and a directions link.

Its campsite records come from Recreation.gov and OpenStreetMap contributors. Coverage is incomplete, varies by state, and is not limited to federal campgrounds. Listings have not been field verified. Imported records do not consistently include snapshot dates. A fee marked unknown does not mean free; confirm fees, camping permission, closures, and reservations with the operator.

Saved stops stay in this browser on this device. Previously loaded listings may remain available offline after an online visit, but map imagery and directions need internet. The current MVP does not include water-station or cell-coverage layers, GPX tools, reviews, or public-land overlays.

Link **Explore the KampTrail campsite map** to https://boondockorbust.com/resources/kamptrail-campsite-map/. Keep catalogue counts in the app's live data panel rather than hardcoding them into the article. Do not imply a public-land pin establishes permission to camp.

## Future editing checks

Use the Classic Editor Text tab for `kamptrail-page.html`. Preserve the theme-provided H1, Resources parent, slug `kamptrail-campsite-map`, iframe title, geolocation delegation, and full-page link. Inspect the saved preview after editing because WordPress may filter markup.

For follow-up verification, check the page at phone widths, horizontal overflow, full-page link, and Near me permission handling. Continue to preserve the separate RV Park & Campground Finder and the legacy campsite-guide redirect.
