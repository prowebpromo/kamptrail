# Offline readiness and phone acceptance check

The Offline panel inventories this browser’s existing app-scoped storage without downloading anything. It separates cached USGS Topo tiles, base campsite listing states, agency listing states, the national campsite name index, saved-stop records and saved location snapshots. A cached name-search result does not establish that its full listing is cached. Legacy stop IDs can lack location snapshots.

The map download log shows geographic bounds, zoom range, original logged download date and the currently present versus expected tile URLs for the most recent twenty valid area logs. This comparison detects missing or evicted tile entries even when the old download log says every tile was saved. It cannot certify map coverage outside those bounds/zoom levels or current physical conditions. Unlogged tile entries are counted but receive no invented area or date.

Listing cache dates are not currently recorded and are explicitly unknown. Cached-file inventory is not a freshness or schema certification. The existing loader validates data when restoring it. Storage denial is reported as unknown. No data caches are created merely by checking readiness. Saved stops stay local and GPX remains the independent backup path. This change does not extend offline behavior to live APIs, forecasts, land lookups or directions.

## Weekday phone check

Scheduled by the root task for Chuck: Monday, November 2, 2026, 3:00–3:20 p.m. America/New_York. **Not yet run.** Workspace automation does not substitute for this check. Record phone model, operating-system/browser versions, launch mode (installed app or browser), app version and outcome.

1. While connected on the phone, open KampTrail, view the intended camping region, run one campsite-name search and save one stop with a note. Export GPX to a separate file.
2. Save a small Topo area and wait for completion. Open Offline and choose Check saved data. Record the area bounds/zoom, tile present/expected count, cached base/agency states, name-index state and saved-stop snapshot count. Capture failures before retrying.
3. Close KampTrail completely. Enable airplane mode with Wi-Fi also off. Launch it again from the same browser or installed-app entry point.
4. Confirm the app opens. Choose Topo and pan/zoom inside the recorded saved bounds and zoom range. Confirm cached listings, the previously searched name and the saved stop/note work. A name result outside a cached listing state can lack full details; report the distinction.
5. Confirm areas/zoom levels not saved remain visibly unavailable. Confirm current online services do not pretend to provide current data. Confirm Offline still displays unknown listing dates and the actual saved inventory.
6. Reconnect and reopen. Confirm the stop/note survived and online refresh works. If any offline core step failed, keep physical-phone readiness pending and record exact reproduction steps. Do not clear browser data as a test workaround.

Acceptance: successful full offline restart, usable chosen Topo area, cached listing/detail access, saved-stop/note retention, honest missing-data states, and successful reconnection. Test a second time after the next shell update to cover the upgrade path. No global “offline ready” claim follows from one phone or one saved region.

## Validation

Five new Node tests cover fresh storage, cache eviction versus stale logs, scope isolation, legacy stop snapshots, denied/corrupt storage and oversized log rejection. The existing browser map-save flow now verifies that deleting one cached tile changes the readiness count after Check saved data. Local Node/locale/service-worker checks pass; native browser CI and the physical-phone check remain separate gates.
