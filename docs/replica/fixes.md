# What campers want: research summary and fix plan

Sample: 72 rows in [reviews.csv](reviews.csv), about 55 of them real user complaints or requests. Sources: App Store reviews (via JustUseApp), RV and overland forums, one r/vandwellers thread via a mirror, blog comment threads, and two vendor blogs (marked as biased). Reddit and Hacker News could not be reached directly. Quotes were read through a summarizing fetch tool. Verify any quote against its URL before publishing it. Reviewer words are research only, not testimonials.

Free Roam status: offline since early 2024 (Boondockers Bible, updated 2024-04-06).

## What they hate

1. Paywalls and price jumps. About 14 items, 8 sources. Search and maps locked behind subscriptions.
2. Stale or wrong data, and corrections that go nowhere. About 9 items, 6 sources.
3. Glitchy apps, including unreliable offline maps. About 9 items, 5 sources.
4. Redesigns that make apps harder to use. About 9 items, 5 sources.
5. Apps that get abandoned. 6 items, 4 sources. Free Roam is one.
6. Ads. Thin (3 items).

## What is missing (asked for by name)

1. Offline maps. About 6 items, 5 sources.
2. Public land boundaries and overlays. About 5 items, 3 sources (partly vendor sourced).
3. Rig size and clearance awareness. 5 items, 4 sources.
4. Route export without stop limits. Thin (1 item: Google Maps export capped at about 11 stops).
5. Weather, fire restrictions, GPX, propane. No user items found. Built where cheap and parity-driven, not on user evidence.

## What is unsolved

- Working out remaining stay days across apps. Thin (1 item).
- Availability alerts that actually arrive. Thin (1 source).

## Fix plan applied in 2.3.0

| Fix | Size | Evidence |
| --- | --- | --- |
| Public land layer and land-manager lookup with stay-limit guidance | M | Missing #2, unsolved stay-days (thin) |
| Whole-trip directions split into legs within Google's waypoint limits, plus GPX export/import | S | Missing #4 (thin), parity |
| Free, no account, no ads, open source, keyless public data sources | none | Hate #1, #5, #6 |
| "Suggest a fix" and "Add a campsite" prefilled issue forms, reviewed before data changes | S | Hate #2 |
| Offline: services data cached with the app shell | S | Missing #1 (partial) |

Not yet addressed: offline map tiles (Missing #1) and rig length/clearance (Missing #3). Both are the strongest remaining evidence-backed gaps. Rig length needs RIDB campsite attributes. Offline tiles need a tile source whose terms allow bulk caching.

## Positioning options

1. For campers tired of paywalls and apps that disappear, KampTrail is a free, open-source campsite map with no account and no ads. Evidence: paywalls (about 14 items, 8 sources) and abandonment (6 items, 4 sources).
2. For boondockers who juggle several apps to find public land and stay limits, KampTrail shows who manages the land and the agency's stay rule in one tap. Evidence: public land requests (about 5 items, 3 sources). Stay-limit juggling is thin.
3. For RVers planning long trips, KampTrail exports the whole route to Google Maps in legs and to GPX, with no stop cap. Evidence: thin.

Recommended: option 1, with option 2 as the feature proof point. It rests on the strongest evidence and on something competitors cannot copy without changing their business model.
