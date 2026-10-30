# KampTrail 2.21.0 — offline device inventory

Candidate release, not yet merged or deployed. First-party runtime module identities, page asset query strings, HTML handshake, package/lock metadata and locale module all report 2.21.0. Service-worker shell generation advances from kt-v48 to kt-v49 while retaining existing app-scoped data, route, terrain, services, height and Topo tile caches.

The Offline panel inventories the device’s actual cached Topo tile entries, cached base/agency listing states, national name-index file and persisted saved-stop records/location snapshots. It compares recent saved-area expected tile URLs with existing entries, exposing eviction and incomplete downloads. It does not create caches or fetch data during an inventory. English and Spanish controls are available. Cached listing dates remain unknown and no comprehensive or current offline dataset is promised.

The fee recheck pilot must merge before this candidate is merged. Refresh current main and preserve its source/policy changes when integrating. Native regression and Lighthouse success on the final exact head are release gates. Publish through the existing main → tested Hostinger release → hostinger branch pipeline only. Verify the live release.json source commit, health, native Offline panel interaction and existing saved-stop/cache upgrade behavior after deployment.

The physical-phone cold launch remains pending for Chuck’s November 2 weekday check. See [the acceptance runbook](OFFLINE_READINESS.md). A code or CI pass does not complete that phone gate or change its parity row to complete.

Local validation: runtime identity/asset handshake test and 37 offline/locale/service-worker tests pass. Static release build passes and packaged HTML reports 2.21.0 with kt-v49 and the readiness checklist. Native CI remains required on the final exact head. The local build output was removed after inspection to preserve workspace capacity.
