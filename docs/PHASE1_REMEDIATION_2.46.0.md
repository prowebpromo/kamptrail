# Phase 1 remediation candidate 2.46.0

This candidate implements supported findings from the November 4 review and revised Phase 1 SOW. It is prepared for review before production. The current live source at the start of this work was `52d9963606c0030c1260f1fb37042c808674688d` (2.45.0).

No accounts, cloud sync, mass location pages, paid services, legal-copy changes, listing-id rewrites or production data refreshes are introduced. KampTrail already has PHP APIs for routing, moderation, feedback and other features; the review's static-only assumption is incorrect.

## Work item mapping

| ID | Candidate implementation or observed result |
| --- | --- |
| P-1 | 6.5 KB English runtime; separate Spanish and French packs, loaded on selection and cached by the worker after first use. Deferred initial scripts; map startup on workspace proximity, explicit action, deep link or returning visit. Build produces a minified ordered map bundle. Performance acceptance remains measured, not assumed. |
| P-2 | Responsive portrait hero 95,856 bytes; desktop hero recompressed. Original subject and layout preserved. Correct map-preview intrinsic dimensions. |
| O-1 | Existing online/offline footer retained. Immediate offline notice on state jump and search; failed state loads announce recovery. Existing routes, weather, land and feedback already have failure paths, which remain subject to regression checks. |
| O-2 | Best-effort persistence request after a saved stop; dismissible GPX backup reminder after three stops, and on export/routing. Session dismissal survives reload. iOS note makes no guarantee of permanent storage. Existing kt_trip schema and stored ids are unchanged. |
| O-3 | Estimate and confirmation already exist in offline-maps.js, including tile count, approximate MB, tile limit and paced USGS requests. Added an explicit quota-full message that retains existing saves. Physical-device size/time test remains unverified. |
| U-1 | Full-height mobile Filters and Saved stops, one scroll region, persistent controls, filter groups and disclosure for long explanatory notes. Live result-count action. Existing filter logic and source caveats retained. |
| U-2 | Unique explicit city/campsite/state search opens directly. Ambiguous queries retain choices. Coordinates remain direct. |
| U-3 | Acceptance gate retained before installation help. Added context and aria-modal. Existing recorded acceptance and cancel/focus behavior retained. |
| U-4 | Manifest launches ?source=pwa; map workspace hides marketing sections. Full website toggle and working Saved stops/Near me shortcuts. Actual iOS/Android installation remains unverified here. |
| U-5 | Primary Filters styling, standalone install hiding, visible car-route limitation banner, Help test / PUBLIC BETA OPEN TO EVERYONE / Real map data copy with ES/FR translations. |
| A-1 | My rig, Saved stops and Near me accessible names now contain their visible labels. Voice-control device test remains unverified. |
| A-2 | State bubbles announce full names and counts, retaining their visible abbreviated counts. Cluster names describe location counts. |
| A-3 | Keyboard skip link reaches the map controls without traversing every marker; clear marker focus ring. Campsite list remains available. |
| A-4 | 44 px targets for navigation, language, search/state controls and mobile sheet buttons; larger state/cluster hit areas preserve existing marker collision layout. |
| M-1 | Stable manifest id, description, categories, language, functional shortcuts, distinct any/maskable icon assets and a wide actual UI screenshot. |
| H-1 | robots.txt, eight-URL sitemap and favicon packaged. Search Console/Bing submission not performed: no verified property access in this session. |
| H-2 | Reviewed deploy htaccess adds short initial HSTS, nosniff, strict-origin-when-cross-origin referrer policy, same-origin geolocation, HTML/manifest/worker revalidation and a report-only CSP draft. Hosting behavior is unverified until staged on LiteSpeed. Existing API access protection retained. |
| H-3 | WebApplication JSON-LD and explicit Twitter title/description/image. Canonical source URLs point to kamptrail.com. |
| H-4 | Shared provider configuration for map URLs/attribution and routing URL. Existing server already enforces a global 1100 ms upstream interval, returns readable 429 responses, and caches successful routes on the device. OSM tiles are not offline-downloaded; offline saving uses USGS Topo only. See the provider note. |
| D-1 | Exact-id triage and counts in docs/remediation/data-triage.json. The Moab BLM record represents a broad jurisdiction; its result card and popup now state that it is not an individual campsite. Its withdrawal is proposed for independent review, not silently applied as a name-based exclusion. Up the Creek gains an explicitly labeled catalogue-area fallback in the UI. Distance ordering is now stated. No data import or classification changes are included. |

## Provider and storage findings

Sources checked November 4, 2026:

- https://operations.osmfoundation.org/policies/tiles/ requires visible attribution, a browser Referer, normal HTTP caching, and no bulk/offline OSM tile downloads. Standard tiles pass through the service worker to ordinary browser HTTP caching; no cache-bypass headers or bulk-saving path is applied to OSM. Leaflet's normal viewport look-ahead remains distinct from offline saving.
- https://routing.openstreetmap.de/about.html states one upstream request per second maximum, no heavy usage, attribution/fix-map links, and provider request logging. api/_lib/routing.php already globally reserves at least 1100 ms between upstream requests. Client cached routes and external Directions remain available as fallbacks. The linked full German terms were blocked by an anti-bot page, so the critique's blanket non-commercial-only claim is not verified against the full current terms.
- https://webkit.org/blog/14403/updates-to-storage-policy/ describes browser-controlled persistence and eviction. Home Screen installation can affect heuristics, but is not a replacement for an exported backup or protection against deliberate data clearing.

No-cost fallbacks: if OSM limits service, use the existing USGS Topo or Satellite base layer, retaining USGS attribution and unknown availability; this changes map presentation and does not provide guaranteed capacity. If routing is unavailable, saved successful routes remain dated local evidence and the existing external Directions links remain available. Self-hosted global tiles or OSRM on the current shared hosting are not represented as feasible or free without capacity measurements. No paid provider is added. Revisit on 429/403/block responses, provider-policy changes, or any monetization plan. No universal monthly-user allowance is published by these providers, so none is invented.

## Data pipeline and review

Source fetchers live under scripts/, including fetch_blm_recreation.py, the OSM refresh scripts and the Recreation.gov/USFS importers. They write retained inputs under data/sources, which are reconciled by merge_campsite_data.js and build-search-index.js. Existing reviewed identity and provenance rules remain in force. Do not fix an area-level BLM record by guessing a campsite type or fee, or by deleting every record whose name contains Office.

The exact BLM RecAreaID 16330 was read from its agency ArcGIS service without running a refresh workflow. Its description covers 1.8 million acres and directs visitors to separate camping guides. Retained own-source coordinates and identifiers match the published record. The two review examples and all name candidates are in the triage JSON. Any later exact-id exclusion must retain saved/share/legacy resolution and be checked by someone other than its implementer before a data release.

## Verification limits

Real iPhone/Android installs, airplane-mode Topo download timing, VoiceOver/TalkBack and voice-control checks require physical devices and have not been represented as passes. No source data was refreshed to obtain evidence. Staging/review is required before this candidate changes production.

Initial read-only triage: 33,370 canonical index listings, zero without catalogue regions. 33,268 canonical ids matched an own retained record, of which 23,912 lack both state and addr:state fields. These are source-field gaps, not 23,912 geographically unassigned listings. Twenty names match the office/headquarters/ranger-station candidate pattern; no name-based exclusion was applied.

## Additional verified details

The desktop manifest screenshot is an actual capture of the candidate map workspace. Responsive map-preview imagery uses a 45,882-byte smaller variant. The worker retains separately versioned optional language responses, including a selection made before first worker control. Automatic update reloading is deferred while visible dialog inputs contain edits; the visitor gets an explicit reload action. Existing version handshakes remain in force.

A Hostinger staging connection or configured preview address has not been found in this session. Production publication is held for the revised SOW's staging/review gate. Local packaged-site checks do not establish that LiteSpeed has accepted the proposed htaccess headers, and physical-device requirements remain open.
