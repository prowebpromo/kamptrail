# Build log

- 2026-10-28: Community reviews/photos shipped in 2.6.0. Server-side author management, independent review/photo moderation, reporting and bounded image storage passed PHP, MySQL and browser tests; live migration and initial approval checks passed.
- 2026-10-28: Community follow-up 2.6.1 fixes an assistive-technology-visible honeypot and avoids dead contribution forms on the legacy static address. Adds a dialog accessibility scan and legacy-host regression.
- Remaining authorized work: MVUM road/vehicle/season context, FCC carrier coverage if access and terms permit, and road-route geometry with along-route discovery. FCC's public map currently returns Access Denied in this browser; its documented API requires an FCC account. Do not substitute stale coverage or expose an empty coverage layer.

- 2026-10-28: Road geometry, on-demand along-route discovery, compact filter metadata, requested driving detours, route-order insertion and bounded offline reuse implemented for 2.8.0. Fixed-provider backend and additive migration003; no coordinate storage. CI and production activation pending. See docs/ROUTE_DISCOVERY.md.
- 2026-10-28: MVUM 2.7.0 implements opt-in viewport roads, source vehicle/season fields, district coverage/date context, official forest links, independent road/land opacity, bounded saved-view fallback and source-error states. 72 local Node/PHP tests pass; browser and live-source checks pending.

- 2026-10-29: 2.8.0 merged and deployed (source1c591e4), all55 browser checks,79 Node/PHP,31 Python,MySQL integration and dump/restore passed. Production migration003 applied and health reports routing/community ready.
- 2026-10-29: Live QA reproduced an existing popup retained after explicit navigation to a second campsite. 2.8.1 closes it and cancels older focus attempts. Ambiguous official forest aliases now omit the destination instead of choosing a sibling unit. Both have regressions.

2026-10-29 — Environmental context (2.10.0): NIFC perimeter + NOAA satellite smoke overlays, on-demand NWS point alerts, dated sources, unavailable/offline states. Partial against the historical fire-weather/smoke row: no fire-weather risk overlay or universal closure feed. Weather/elevation filters remain separate.
