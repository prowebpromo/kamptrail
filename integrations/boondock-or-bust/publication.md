# Boondock or Bust integration

Prepared October 28, 2026. Publishing and inspection in WordPress are pending authenticated access. No live BoB content has been changed.

## Dedicated page

Use `kamptrail-page.html` in the Classic Editor Text tab. Set the page title to **KampTrail Campsite Map** and use the Resources parent with slug `kamptrail-campsite-map`. The fragment assumes WordPress renders the H1; do not add a second one. Preview at desktop and phone sizes before publication and verify that WordPress retains the iframe. Add **KampTrail Map** to the Resources submenu after publication. Keep the existing RV Park & Campground Finder separate.

## Replacement for the apps article KampTrail section

Destination article: https://boondockorbust.com/boondocking-guide/the-best-apps-for-finding-free-campsites/

### KampTrail: Find Campsites and Save Stops Without an Account

KampTrail is our free campsite map. Search by city, state, campsite name, or coordinates, filter by reported fees and campsite type, and save stops in your browser. Open a listing for coordinates, source details when available, and a directions link.

Its campsite records come from Recreation.gov and OpenStreetMap contributors. Coverage is incomplete, varies by state, and is not limited to federal campgrounds. Listings have not been field verified. Imported records do not consistently include snapshot dates. A fee marked unknown does not mean free; confirm fees, camping permission, closures, and reservations with the operator.

Saved stops stay in this browser on this device. Previously loaded listings may remain available offline after an online visit, but map imagery and directions need internet. The current MVP does not include water-station or cell-coverage layers, GPX tools, reviews, or public-land overlays.

Link the phrase **Explore the KampTrail campsite map** to the new page after publication. Until then use https://prowebpromo.github.io/kamptrail/.

## Other KampTrail references in the same article

Review every KampTrail mention before saving. Replace any claim of “verified federal campsites only” with **Campsite listings from Recreation.gov and OpenStreetMap; incomplete coverage**. Remove the old 4,400 campsite / 2,700 water-station counts and water/tower promises. Revise the comparison, BLM discussion, alternatives, decision table, and FreeRoam FAQ wherever they repeat those claims. Do not imply a public-land pin establishes legal camping access. Preserve the other apps’ sections.

## Internal links after the page is live

- In https://boondockorbust.com/boondocking-guide/a-35-year-rvers-guide-to-finding-free-cheap-campsites/ add: **Use our free KampTrail campsite map to search a destination, check reported fees, and save stops. Confirm current access with the operator before you go.** Link “KampTrail campsite map” to the published page.
- In https://boondockorbust.com/resources/useful-links/ under camping tools add: **KampTrail campsite map — Search campsites and save stops without an account. Coverage varies; check the source before traveling.** Link the tool name to the published page.
- Preserve the existing redirect from `/camp-finder-free-or-cheap-campsites/` to the 35+ year guide.

## Final verification in WordPress

Inspect the saved page, not just the editor: one H1, working map and full-page link, no horizontal overflow, readable text, saved-stop behavior, directions links, and Near me permission handling. Confirm new navigation and internal links resolve. Review the saved apps article for remaining outdated KampTrail claims.
