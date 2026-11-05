# Prepared consent analytics adapter

This folder contains an uninstalled, disabled-by-default adapter. It does not load Google scripts, configure a Google tag, write `dataLayer`, install a consent manager or change either website. Existing Google tag collection is outside its control. No production enablement is established by the tests here.

## Files and local verification

- `consent-analytics.js`: browser/CommonJS adapter and optional guarded transport for an already loaded Google tag.
- `consent-analytics.test.js`: dependency-free Node tests using injected event/document/visibility fixtures and a recording transport. No network access or tracker calls.

Run from this folder with Node 18 or newer:

```sh
node --test consent-analytics.test.js
node --check consent-analytics.js
```

## Explicit lifecycle

Loading the browser file exposes `KampTrailAnalyticsPreparation`. It does not create an adapter automatically. CommonJS exports the same `createAdapter` and `createGa4Transport` functions.

This browser initialization remains dormant:

```js
const analytics = KampTrailAnalyticsPreparation.createAdapter(window);
analytics.configure({ enabled: false, transport: null });
analytics.setConsent(false);
```

| API | Contract |
| --- | --- |
| `createAdapter(window)` | Creates local listeners only. Calling it again for the same window returns the existing instance. An injected `{ window, document, IntersectionObserver }` environment is also supported. |
| `configure({ enabled, transport })` | `enabled` must be a boolean and defaults to false. `transport` must be a function or null and defaults to null. After independent approval, an authorized integrator must explicitly provide a transport and enable the adapter. |
| `setConsent(boolean)` | Accepts only an explicit boolean from the approved consent integration. Unknown, denied, expired and withdrawn permission must map to false. Safety acceptance, location permission, a referrer and an analytics cookie are not consent signals. |
| `getStatus()` | Returns enablement, current consent and current environment eligibility. `permitted` requires all guards plus a transport. |
| `refresh()` | Rescans BoB CTA elements after a page inserts or changes them. It does not replay analytics events. |
| `destroy()` | Removes listeners, disconnects visibility observation and prevents future adapter sends. Idempotent. |

No consent state is stored by this adapter. A reload starts disabled and denied. The future consent integration owns permission persistence, expiry and withdrawal. A production enablement must not be added merely because a matching tag exists.

## What can be sent

The injected transport receives exactly `(eventName, frozenSafeParameters)`. It must not add raw page/referrer URLs, user input, identifiers or its own delayed queue.

App events come only from live `kamptrail:metric` DOM events. The adapter never reads `KampTrailBeta.events()` or attaches `setReporter`. Earlier events are not replayed. Event sequences are observed locally even while disabled or denied, preventing a later grant from forwarding those sequences. Valid live events are deduplicated within the current document. No queue, retry or storage is added.

Allowed app events are `kt_landing`, `kt_open_in_kamptrail`, `kt_search_performed`, `kt_marker_viewed`, `kt_stop_saved`, `kt_return_session`, `kt_install_opened`, `kt_pwa_installed`, `kt_tester_opened` and `kt_feedback_submitted`. BoB handlers emit only `kt_launch_viewed` and `kt_launch_clicked`.

| Parameter | Allowed content |
| --- | --- |
| `page_location` | Exact HTTPS production origin plus an approved pathname. No query or fragment. |
| `page_referrer` | Empty string. Article attribution uses the approved custom field instead. |
| `page_title` | Static `KampTrail` or `Boondock or Bust`. |
| `kt_mode` | One of the five supported modes or `map`. |
| `kt_source` | `boondockorbust`, `pwa` or `other`. A BoB source requires an approved article path. |
| `kt_article_path` | Optional exact pathname from the nine prepared rollout articles in the source map. Arbitrary slugs are dropped. |
| `kt_place_kind` | Optional `campsite`, `service_or_rest_area` or `other_stop`. |

Raw bridge `session_id`, `sequence`, arbitrary detail keys, query strings, fragments, coordinates, listing IDs/names, searches, email and feedback text are never forwarded. Do not map the local UUID into GA4 `session_id`, `client_id` or `user_id`, or register it as a custom dimension. This adapter does not create cross-domain or cross-device identity.

## Environment and CTA restrictions

Only `https://kamptrail.com` and `https://boondockorbust.com` are eligible. Subdomains, `www` aliases, alternate ports, HTTP, userinfo URLs, localhost and the Hostinger staging host are excluded. KampTrail collection is restricted to `/` and `/index.html`. BoB collection is restricted to the nine exact approved article paths.

Preview/draft/admin/customizer query markers and staging build markers are rejected. Public WordPress pages carrying the known `logged-in` or `admin-bar` body class are also excluded. These checks run at send time, independent of Google tag logged-in exclusions.

BoB anchors must match the article's expected mode in both `data-kamptrail-mode` and the destination URL. Destinations must be eligible production KampTrail pages without preview/admin/staging markers. `#site` and `#spot` share targets are rejected because they override the declared entry intent. The adapter never changes hrefs or prevents navigation.

Visibility is recorded only after enabled consent, with a real observer entry reporting `isIntersecting === true` and a finite ratio of at least 0.5. Views are counted once per element. Revocation disconnects observation. Generation guards discard delayed callbacks from an earlier observation period, including after regrant. Without IntersectionObserver, clicks still work and no view is invented.

## Optional Google transport and independent tag gates

`createGa4Transport(options)` accepts an explicitly supplied `gtag` function and measurement ID. It throws unless `automaticCollectionReviewed` is exactly true and both `isPermitted` and `isTagReady` callbacks are provided. `isPermitted` must reflect the adapter's current `getStatus().permitted`. `isTagReady` must truthfully confirm that the actual reviewed tag is loaded, rather than a queueing `gtag` shim. Creating the wrapper makes no Google call.

On each allowed call, the wrapper rechecks both callbacks, rebuilds the parameter allowlist and invokes the supplied tag with an event and explicit `send_to`. It never calls `config`, updates consent or installs cross-domain settings. It does not assign custom identifiers. The Google tag's normal identifiers still require separately approved consent settings. The wrapper drops malformed, query-bearing, fragment-bearing and ineligible page URLs and provides no delayed delivery or retry.

This is **not** a solution to the existing tag's automatic collection. A separate integration must block tag loading until approved analytics consent, review automatic page views and Enhanced Measurement, and inspect all outgoing payloads. Existing global tag settings, user properties, identifiers, browser/network metadata and independently fired events cannot be guaranteed safe by this event wrapper. Calls already handed to an external tag cannot be recalled by withdrawing this adapter's permission. Future adapter calls stop immediately.

Google documents that the default GA4 `page_location` excludes the URL fragment. Do not describe `#spot` leakage as an inevitable GA4 default. Query strings remain an exposure, and manual full-URL forwarding, automatic link fields and history collection require separate checks. `send_page_view: false` alone does not disable Enhanced Measurement history page views.

Cross-domain measurement remains absent here. Matching custom article attribution or using one property does not prove joined sessions. A future native integration must verify the same Google tag ID/web stream, approved domains, permission behavior on both sites and actual identity/session continuity. Until then, use separate observed funnel stages and identify them as consented measurement, without backfilling denied activity.

Technical references verified by the parent review:

- [GA4 page views, default page location and manual measurement](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [Basic consent mode and blocking tags until consent](https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic)
- [Google cross-domain measurement requirements](https://support.google.com/analytics/answer/10071811?hl=en)

## Remaining acceptance

Node tests verify this adapter's behavior, including canary payload sanitation and consent/environment boundaries. They do not verify the real consent manager, Google tag readiness, existing automatic events, cookie handling, GA4 reports, native cross-domain linkage or production transport. The parent is independently reviewing those integration gates. A live packet review must inspect complete request URLs and bodies, including automatic hits, before collection is enabled.

## Parent integration acceptance

The parent reran all 16 Node tests successfully and independently exercised the final adapter in Chromium using the actual candidate beta.js, live DOM metric events and a real IntersectionObserver. All document responses were local fixtures and all other network access was intercepted. The checks covered late grant, withdrawal/regrant, sanitized payload canaries, duplicate initialization, CTA views/clicks and staging exclusion. No request reached either production site or Google. Results are in ../Analytics-Local-Browser-Acceptance.json.

Loading order still matters: install the adapter before beta.js emits its initial events if a previously saved analytics choice is already valid. When consent is granted after the app opens, earlier kt_landing and kt_open_in_kamptrail events are deliberately absent. Do not backfill them or use later search/save counts with an incompatible landing denominator. A separately defined post-consent measurement-start boundary or a validated initial-event setup is needed before reporting a funnel for late-grant visitors. This adapter does not invent such a boundary.

## Isolated consent controls and preview

`consent-controls.js` adds an inline settings region through `KampTrailConsentControls.mount({ container, adapter })`. It has equally styled Allow optional analytics and Decline buttons, permanent Change choice and Revoke and clear choice controls, a named region, and polite status messages. It opens no arrival modal and makes no safety, location, account or legal acceptance decision. It never calls `adapter.configure`, loads tags, sends network requests or writes `dataLayer`.

The mount API also accepts `storage`, `storageKey`, `maxAgeMs`, `onChange`, `window`, `document`, and injectable `now`, `schedule` and `cancel` functions for testing. Repeated mount calls for the same container return its existing component. `getStatus()` returns the actual choice, permission, expiry and persistence state. `clear()` revokes permission and removes the stored choice. `refresh()` checks expiry. `focus()` focuses the choice controls. `destroy()` revokes this mounted component's permission, removes its listeners/timers and leaves the saved choice available for a later mount.

The default record is version 1 under `kt_optional_analytics_choice_v1`, with `choice` equal to `granted` or `denied`, an integer `savedAt`, and `expiresAt` exactly 180 days later. **180 days is a configurable test constant, not a legal requirement or compliance assertion.** Unknown, malformed, future, wrong-version and expired records deny permission. Different expiry configuration invalidates records that do not match it. Open-page timers, focus, visibility, page-show and status checks apply expiry. Long timers are rearmed within browser timeout limits.

Initialization denies before reading storage and then synchronizes a valid saved choice through `adapter.setConsent`. Decline and revoke deny immediately before storage operations. Cross-tab storage events read the current authoritative value, instead of trusting an old event payload, and synchronize the adapter and UI. Granting a choice never enables the adapter or supplies a transport.

Blocked storage has an explicit memory-only notice. Choices can work for the current page but cannot survive reload. Any failed choice write attempts to remove the previous stored record, so a declined choice does not silently leave an old grant behind when removal works. If removal also fails, current-page permission remains revoked and the UI explicitly warns that an older choice may return on reload and other open pages may still use it. The component cannot guarantee durable deletion when the browser refuses storage writes. Clear that origin's browser data if persistent removal is needed.

The eventual transport's send-time permission check must include `controls.getStatus().analyticsConsent` as well as `adapter.getStatus().permitted`. For the optional Google wrapper, supply an `isPermitted` callback that checks both. Calling controls.getStatus checks expiry and revokes the adapter if a suspended browser delayed its timer. A timer alone is not the send-time consent boundary. `isTagReady` remains a separate truthful check of the loaded Google tag. The isolated preview has no transport and sends nothing.

`consent-preview.html` loads the two actual local scripts by relative URL, mounts the controls and displays their real state alongside `adapter.getStatus()`. The adapter is explicitly disabled with a null transport. The preview's CSP disallows connections, external assets and forms. It does not simulate analytics traffic or change the production app. Its staging copy specifically says that optional analytics are not loaded and the controls test only the saved choice. Keep that copy confined to the isolated preview/integration.

Run both local suites:

```sh
node --test consent-analytics.test.js consent-controls.test.js
node --check consent-controls.js
```

Serve this folder locally or through the isolated staging overlay to inspect `consent-preview.html`. Do not install it into BoB or KampTrail as part of this prepared review. The existing Google tag and production consent setup remain independent gates.
