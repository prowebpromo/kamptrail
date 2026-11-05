# Boondock or Bust → KampTrail beta integration

Owner requirements received November 4, 2026. These supersede the earlier suggestion to expand KampTrail into an independent editorial or programmatic SEO site. BoB owns editorial search acquisition. KampTrail is its interactive utility. Existing product/help pages remain supporting material. No new blog, location SEO factory, community marketplace or event operation is in the beta work plan.

## Entry contract

| Article intent | CTA | Mode | Actual behavior |
| --- | --- | --- | --- |
| Walmart / business overnight parking | Find Nearby Overnight Parking | overnight-parking | Parking-related campsite records only. Incomplete coverage, not a complete Walmart directory. Permission is never inferred. |
| Interstate rest areas | View Rest Areas on KampTrail | rest-areas | Official rest-area layer, source details and policy caveats. Ordinary campsite markers are filtered out. |
| Dump stations | Find Nearby Dump Stations | dump-stations | RV service layer, only dump category; dated OSM source coverage. Ordinary campsite markers are filtered out. |
| Free camping | Open Free Camping Map | free-camping | Only reported-free campsite records. Conditional and unknown fees are excluded. |
| BLM camping | Explore BLM on KampTrail | blm | Retained BLM-published records and public-land layer. This is not a free-only filter or proof of legal camping. |

`?mode=...` opens the map workspace directly and resets stale campsite filters. `&near=1` requests location through the browser. Denied/unsupported permission leaves the mode active and the search/state controls usable. Optional `&state=TX` selects a state without guessing coordinates. Invalid modes are ignored. Published campsite share links retain precedence and stored IDs never change. Show all campsites clears the entry filter and its URL parameters.

## Website integration prepared, not published

`integrations/bob/cta-blocks.html` contains five portable, script-free WordPress fragments. Keep the relevant block after the article's direct answer and, on long pages, add one contextual inline link near the relevant task. Do not put five competing CTAs on one article. The normal anchors work without enhancement. The optional `kamptrail-launch.js` adds a query-free article referrer and pushes CTA viewed/clicked events to the site's existing data layer. It loads no tracker and sends no requests itself.

Verified existing candidate pages, not a traffic-ranked or exhaustive rollout list:

| Existing BoB page | Mode |
| --- | --- |
| https://boondockorbust.com/resources/walmart-overnight-rv-parking-policy-by-state-2026/ | overnight-parking |
| https://boondockorbust.com/resources/interstate-rest-areas/ | rest-areas |
| https://boondockorbust.com/resources/quick-guide-to-finding-rv-dump-stations-while-on-the-road/ | dump-stations |
| https://boondockorbust.com/resources/finding-free-or-cheap-water-and-dump-stations/ | dump-stations |
| https://boondockorbust.com/boondocking-guide/the-best-apps-for-finding-free-campsites/ | free-camping |
| https://boondockorbust.com/boondocking-guide/how-to-find-free-dispersed-camping-sites-using-google-maps/ | free-camping |
| https://boondockorbust.com/boondocking-guide/are-you-breaking-the-new-blm-camping-rules/ | blm |
| https://boondockorbust.com/boondocking-guide/ltva-camping-your-guide-to-extended-stays-on-public-lands/ | blm |

The public WordPress API identifies the Walmart post as 68886 and the interstate rest-area post as 58675. Other URLs were returned by BoB's indexed pages. Their existence does not establish traffic priority. Ahrefs top-pages retrieval failed with zero available API units. No upgrade or payment was requested. BoB page HTML contains Google Analytics measurement ID G-895FCE9MJX through Site Kit. This does not establish access to its reports or permission/consent configuration. Actual analytics page ranking and CMS-saved previews remain open.

## Measurement contract

The app now emits a bounded, in-memory `kamptrail:metric` event stream. An explicit `KampTrailBeta.setReporter(fn)` adapter can forward it to an approved collector after that site's consent requirements are satisfied. **No collector, external analytics script, analytics endpoint, or automatic data transmission is added by this candidate. Event instrumentation is implemented; collected conversion reporting is not live.** The first 100 events in the current document can be replayed when the reporter is attached. This is not a durable offline analytics queue.

| Event | Trigger |
| --- | --- |
| kt_launch_viewed | BoB CTA at least half visible, once per element (optional enhancement) |
| kt_launch_clicked | BoB CTA click (optional enhancement) |
| kt_landing | KampTrail document starts |
| kt_open_in_kamptrail | Map initialized and requested mode applied |
| kt_search_performed | Nonempty search submitted, no query text included |
| kt_marker_viewed | A campsite popup opens, deduplicated per listing within an activity session |
| kt_stop_saved | New valid stop persisted, duplicate saves excluded |
| kt_return_session | Return after at least 30 minutes of inactivity on this device |
| kt_install_opened | Engagement suggestion opens install instructions |
| kt_pwa_installed | Browser emits appinstalled, not a prompt acceptance |
| kt_tester_opened | Engagement suggestion opens feedback |
| kt_feedback_submitted | API confirms a successful report, no report content included |

Metadata is limited to event, random session token, sequence, source category, BoB article pathname, KampTrail landing pathname, supported mode and a coarse place kind when applicable (campsite, service_or_rest_area, or other_stop). No search text, GPS coordinates, listing IDs/names, email, full URL query/fragment or feedback body enters this bridge. Local engagement counters and at most twelve recent campsite IDs/names stay on the device. Clearing site data resets them. No account or cross-device identity is created.

Primary business KPI: BoB visitor → active KampTrail user conversion. An active session performs a search, opens a campsite marker or saves a stop. A click alone is not activation. Until a shared, consent-aware measurement setup joins both domains, report three separate observed stages: article session → CTA click; KampTrail landing → map open; BoB-referred map open → active session. The last rate is an operational session proxy, not the full visitor-level business KPI. Do not infer the BoB denominator from KampTrail arrivals or claim local visit counters measure unique people.

Before collection: verify the existing GA4 property and consent behavior, use one consistent event mapping, configure cross-domain measurement if supported, exclude staging/internal tests, inspect actual events in the reporting system, and verify the article denominator. Register only useful dimensions (mode, article path, source), not high-cardinality random session tokens. Review the privacy notice to accurately reflect the final collection. Do not silently enable analytics while the live notice says no audience tracker. No reporting access or collection verification has been established here.

Secondary metrics: searches/session, stops saved, observed appinstalled events, returning sessions and confirmed feedback submissions. Safari/manual installation may not emit appinstalled, so observed installs are a lower bound. Never count native prompt acceptance as completed installation.

## Engagement and retention

Install suggestions are inline, dismissible, and never open a modal or native prompt automatically. Eligibility is three searches, first persisted campsite save, or a third visit (two returns). Even a returning arrival waits for an action in the current document. Session dismissal persists through reloads. Standalone mode and an appinstalled event hide the suggestion. Existing manually requested installation remains available.

The beta checklist is initially hidden. It and the tester suggestion become eligible only after at least one search, two distinct campsite views and one saved campsite. An install suggestion has priority over a tester suggestion, avoiding two simultaneous asks. Manual bug reports and feedback remain accessible from the first visit. The initial hero/navigation no longer asks a first-time visitor to join a testing exercise.

Saved Stops remains the main saved-place and favorite action, preserving its existing GPX backup/import and routing. Recently Viewed records at most twelve campsite identities, reopens the published share-link path and can be cleared. This candidate does not add a second competing favorites collection or imply cross-device synchronization.

## Remaining gates

Publish neither domain until reviewed. The app must be published before live BoB links rely on the new modes. Install prompts, source restrictions, data caveats and existing saved/route behavior require staged regression. Collector wiring, real reports, traffic-ranked coverage, actual WordPress previews, actual iOS/Android installation and retention outcomes remain unverified. The existing Phase 1 physical-device, independent data review and production-after gates still apply.

## Independent review follow-up

The delegated review found and fixed entry parameters overriding published/legacy campsite or coordinate share links, noncampsite saves qualifying as campsite engagement, loss of remembered installation, stale in-document return-session identity, repeated recent-place selection failing to reopen, and mode notices surviving a Reset or an incompatible manual fee/type change. Valid rig narrowing retains the entry mode. Focused validation: 8 Node beta tests and 17 browser beta tests passed. These changes require new exact-head CI and a new staging artifact before release.
