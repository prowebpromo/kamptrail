# Historical campsite listings and refresh recovery — 2.47.0

## Owner decision

On November 15, 2026, Chuck selected: **“Historical listing only; exclude from current search until verified (Recommended)”**. The question explicitly retained old saved stops and shared links, original source dates, and an unverified-current-status notice. This is the policy implemented here. A source's omission does not establish that a physical campground has closed.

## Trigger and reviewed data

The November 15 refresh run [43702743410](https://github.com/prowebpromo/kamptrail/actions/runs/43702743410) did not commit or deploy. Seven service imports failed before receiving response bytes; the separate campsite continuity gate detected 211 missing IDs and six reassigned aliases. The forecast repair is separate.

The retained campsite artifact was reviewed against the published `1c1ac3a3b5f742c829370fbcfa6f1cb7291afdc3` baseline. Public OSM object checks covered all 205 omitted OSM IDs: 143 were retagged as individual camping pitches, 39 objects were no longer visible, 16 no longer had campground tags, and seven Florida objects still had eligible tags. The four omitted Recreation.gov IDs still had public pages; their absence does not establish closure. One additional Florida record lost its usable name; the remaining Florida loss was a fuzzy merge of two published canonicals.

The candidate retains the entire last-good Florida OSM source, byte-for-byte, because the new feed omitted eligible objects. Its download date remains October 29. Idaho already retained its last-good source after repeated upstream failures. Florida's new RIDB source remains usable. All other source bytes match the retained failed-run artifact; unrelated datasets remain byte-identical to the published baseline.

After the separate canonical-merge correction and this historical reservation policy:

| Check | Result |
|---|---:|
| Current canonical listings | 33,353 |
| IDs in current catalogue | 36,272 |
| Historical canonical listings | 202 |
| Reserved historical IDs, including aliases | 208 |
| Previously published IDs resolving to their original host | 36,290 of 36,290 |
| Lost, moved or conflicting previous IDs | 0 |
| Current merged/agency files bound to the registry by byte hashes | 92 |

The historical registry SHA-256 is `0a689478d064146979fdaa861117af2d5d09d2b5086b52ad75f82ad06855cf3f`. It contains 198 OSM and four RIDB canonical rows. Six agency aliases remain attached to their original historical hosts. Each row preserves its original coordinates, name and own-source evidence. Unknown source update dates remain unknown. Archive timestamps are bookkeeping dates, not source verification dates.

## Runtime behavior

Historical records never enter current campsite search, filters, counts, route discovery or ordinary active lookup. Shared links and saved-stop map actions use a separate historical resolver. Saved IDs, notes, trip dates and stored snapshots are preserved. Active display and routing can use newer resolved coordinates without rewriting the stored snapshot. Legacy entries that never had a snapshot may capture one once when their exact listing becomes available. The historical view contains original source links and dates, an unverified-status notice, and no revived current fee, access or rig-suitability claims. English, Spanish and French copy is included.

The history registry and each current data file are bound to the index by SHA-256. A missing or mismatched registry prevents current admission; cached bytes must validate too. Retry discards rejected promises and stale in-memory admission state before loading a coherent generation. Offline historical reopening works when the validated registry was previously cached. A missing offline registry is reported as unavailable.

History is append-only during automated refresh. A source reappearing does not silently reactivate a historical listing. A future verified reactivation requires an explicit reviewed change. Refreshes freeze the previous index, create justified historical reservations, rebuild the current index, and enforce continuity before committing. Still-publishable records lost by merging block the refresh instead of being automatically archived.

## Ownership regression coverage

The original ownership expectations remain pinned to exact retained baseline inputs. Current data is checked separately against each listing's own source evidence and historical reservations. Review of the published amenity fixtures found 90 changed outcomes across 31 active IDs, all supported by newly available own-facility Forest Service records, including six explicit water negatives. No active rig-category outcome changed in the reviewed fixture set. Historical fixture rows resolve to their original hosts and cannot supply current classifications.

## Release verification

Release packaging rejects missing or inconsistent registry/index/source generations and historical IDs leaking into current search. Data files use exact checkout bytes, including on Windows. Focused tests cover identity preservation, provenance dates, failed source scopes, source reappearance, duplicate reservations, cached and mismatched generations, saved snapshots, shared aliases, retry and offline reopening.

Saved stops also uses valid list semantics in empty and populated states; dedicated browser checks cover both. Its button derives its accessible name from the visible translated label and count, keeping speech and screen-reader labels aligned.

Packaged HTML script replacement handles both LF and Windows CRLF checkouts and fails the build if the required block is missing or duplicated. This keeps the requested bundles aligned with the offline shell. The historical registry bypasses generic service-worker JSON handling; the data loader owns its exact-byte validation and offline cache.

The refreshed Forest Service fee receipts mark Airplane Flat (35645), Blodgett (60306), Gold Creek (60320) and Paradise (60666) as changed. Their old maintained free-fee observations remain blocked; those refreshed USFS records retain unknown fee status. Tests retain the real October 30 receipt and its expiry separately from current evidence; no future confirmation was created.

Final exact-head CI and live desktop/mobile results are recorded in the release handoff after publication. A passing automated check is not physical-phone or Safari verification, nor a claim that a historical campground's real-world status was established.
