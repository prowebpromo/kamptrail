# Boondock or Bust copy updates for KampTrail 2.4.1

These updates target the live 2.4.1 app at https://kamptrail.com/. The full-page link and iframe in `kamptrail-page.html` use the custom domain. Keep internal Boondock or Bust links pointed at the map resource page. Several current BoB sentences now understate KampTrail, and two are false after 2.3.0 (GPX tools and public-land overlays). Catalogue counts stay out of the copy. The app's About the data panel shows them.

The RV Park & Campground Finder (/resources/rv-park-campground-finder/) is a separate WordPress tool. It does not embed KampTrail and needs no change for this release.

## 1. KampTrail Campsite Map page (page 73633)

Replace the page body with `kamptrail-page.html` in this folder (Classic Editor, Text tab). Keep the theme H1, slug, and Resources parent.

## 2. Best apps article (post 58434)

Section heading. Replace:

> KampTrail: Find Campsites and Save Stops Without an Account

With:

> KampTrail: Free Campsite Map With Public Land, Offline Topo Maps, and No Account

First paragraph. Replace the paragraph that starts "Full disclosure: I built KampTrail." with:

> Full disclosure: I built KampTrail. It is our free campsite map. Search by city, state, campsite name, or coordinates. Filter by reported fee, including free and free-with-conditions, plus RV length and hookups where Recreation.gov lists them. Turn on the public land layer to see BLM, Forest Service, and National Park land, and long-press any spot to see who manages it and that agency's stay-limit rule.

Second paragraph. Replace the paragraph that starts "Saved stops stay in this browser" with:

> Plan a trip with saved stops, notes, dates, and drive times, then open it in Google Maps or export a GPX file. Save USGS Topo maps for an area before you lose signal. Saved stops stay in this browser on this device. KampTrail does not include cell coverage maps or reviews.

Quick facts list. Replace the five bullets with:

> - Cost: Free. No account required.
> - Data sources: Recreation.gov, US Forest Service, Bureau of Land Management, and OpenStreetMap contributors
> - Best for: Free and dispersed campsite research, public land checks, and trip planning
> - Includes: Fee wording from the source, public land layer, land manager lookup, RV length and hookup filters, dump stations and propane, offline Topo maps, GPX export
> - Limitations: Incomplete coverage. Listings are not field verified. Saved stops stay in this browser.

BLM paragraph. Replace:

> For campsite research, KampTrail combines records from Recreation.gov and OpenStreetMap. It does not show public-land boundaries or establish permission to camp; confirm current access with the land manager.

With:

> KampTrail shows BLM, Forest Service, and National Park land on its public land layer. Long-press a spot to see the land manager and the agency's stay-limit guidance. A boundary on the map does not grant permission to camp. Posted signs and local orders take priority.

Alternatives paragraph. Replace the sentence that starts "KampTrail, our free campsite map, lets you search" with:

> KampTrail, our free campsite map, combines Recreation.gov, Forest Service, BLM, and OpenStreetMap listings, shows each source's fee wording, and saves stops without an account. Coverage is incomplete, and listings have not been field verified.

Comparison table, KampTrail row, last column. Replace "Campsite listings from Recreation.gov and OpenStreetMap; incomplete coverage" with:

> Agency and community campsite listings with fee wording, public land layer, offline Topo maps. Incomplete coverage

Decision table, KampTrail row. Replace "Want free campsite search and saved stops without an account" with "Want free campsite search, public land, and trip planning without an account". Replace "Recreation.gov and OpenStreetMap records; verify current fees and access" with "Shows fee wording from the source. Verify current fees and access".

FreeRoam FAQ. Replace the KampTrail sentences at the end ("KampTrail, our free campsite map, uses Recreation.gov ... confirm current fees and access with the operator.") with:

> KampTrail, our free campsite map, covers many of the same jobs: campsite search, public land, dump stations, and trip planning. Its coverage is incomplete. Confirm current fees and access with the operator.

Do not change the FAQ's FreeRoam status claim without a primary source. A third-party guide (Boondockers Bible, updated April 2024) reports FreeRoam went offline in early 2024, but no shutdown notice from the FreeRoam team has been found.

## 3. Useful Links (page 35)

Replace the KampTrail line with:

> KampTrail campsite map: Find free and paid campsites, see public land, save Topo maps for offline use, and plan stops without an account. Coverage varies. Confirm current fees and access with the operator before traveling.

## 4. Free and cheap campsites guide (post 68009)

Replace the KampTrail sentence with:

> You can also use our free KampTrail campsite map to find listings whose source reports no camping fee, see BLM and Forest Service land, and save stops without an account. Confirm current access with the land manager before you go.

## Checks after publishing

1. Each edited page shows no em dashes or semicolons in the new copy.
2. "GPX tools" and "public-land overlays" no longer appear as missing features anywhere on BoB.
3. The embed on page 73633 loads v2.4.1, and Filters shows "Free with conditions."
4. Purge LiteSpeed cache for each edited URL, then recheck the live pages.
5. Existing GitHub Pages saved stops and offline maps belong to that origin. Keep the old app accessible. Export/import stops and save maps again before relying on the new origin offline.
