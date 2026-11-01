# Rest-area smoke discrepancy: read-only diagnosis

Observed on kamptrail.com 2.34.0 on November 1, 2026, at 11:42–11:44 UTC, using Linux, Chromium 143, Playwright and a managed HTTPS test environment. Upstream requests used normal certificate validation; no certificate bypass was enabled.

**Finding:** The deployed client’s shared 20-second deadline reproduces the unavailable-catalogue result under the observed request latency. The live data and schema are valid. This is independent of the test-only PR #157. These measurements do not establish an origin outage or typical direct-user performance.

## Live validation

The manifest, policy bundle and all 13 regional JSON files returned HTTP 200 with successful TLS certificate validation. The actual deployed JavaScript’s validators accepted every file. Regional request durations were 2.264–2.863 seconds. The sum of measured manifest plus regional round trips was 35.547 seconds, or 38.372 seconds including policies; these sums combine individual request measurements.

| Region | Actual deployed validator | Records |
|---|---|---:|
| CA | Pass | 87 |
| FL | Pass | 8 |
| IA | Pass | 33 |
| ID | Pass | 27 |
| IN | Pass | 17 |
| KS | Pass | 33 |
| MI | Pass | 68 |
| MT | Pass | 49 |
| NV | Pass | 31 |
| OH | Pass | 86 |
| SD | Pass | 21 |
| TX | Pass | 78 |
| WA | Pass | 48 |

Total: 586 records. The manifest passed `validateIndex`; the policy bundle passed `validatePolicies` with 15 policies. Indiana contains `indot:0db7d09b-31eb-439c-b8bc-f6322669b016`, Greenfield Rest Area Westbound, at `[-85.701562,39.826439]`.

## Live browser reproduction

The layer was enabled at 11:43:24.755 UTC. The manifest followed by CA, FL, IA, ID, IN, KS, MI and MT returned HTTP 200 sequentially, with upstream elapsed times of 1.782–3.275 seconds. Indiana succeeded at 11:43:36.584 UTC. At 11:43:44.751 UTC, 19.996 seconds after enable, the NV browser request failed with `net::ERR_ABORTED`. The control then showed “Official rest-area catalogue unavailable” with zero Greenfield pins.

Browser requests were fulfilled through a certificate-validating upstream request bridge, matching the existing smoke environment. The timing therefore includes that environment; it is not an unmediated browser-to-origin measurement.

## Applicable code

In deployed `rest-areas.js`, `init()` → `load()` starts one AbortController timer before loading the manifest. The sequential `for (const x of index.regions)` loop shares that signal across every region. Its catch block rethrows when `signal.aborted`, discarding already successful catalogues. `redraw()` catches that rejection, clears markers and displays the unavailable-catalogue message. Policy fetching occurs after the regional loop.

An isolated control executed the actual downloaded loader with the downloaded JSON and proportionally scaled request/timer delays. With zero added latency, all 13 regions loaded. Replaying the measured per-file round trips reached the shared deadline and failed with AbortError. This supports the causal browser reproduction rather than replacing it.

## Smallest suggested acceptance test

Use the real manifest and valid regional fixtures, with every regional response individually successful and bounded but enough sequential latency to exceed 20 seconds overall—for example, 1.6 seconds per manifest/region response. Enable the layer at Greenfield’s coordinates and zoom 11. Require Greenfield to remain discoverable and the control to avoid reporting total catalogue unavailability solely because the aggregate sequential budget expired. Keep the existing fast-response smoke as a baseline. No implementation choice is prescribed here.

No source, deployment or public data was modified during diagnosis.
