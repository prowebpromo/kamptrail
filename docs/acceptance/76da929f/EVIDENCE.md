# Live acceptance of main 76da929f (PR #160): audit pilot baseline

Baseline for Codex's first audit flow: refresh → merge → index and host map → browser resolution → saved-stop reopening. PR #160 changed no data, so the live data equals the 2.34.0 release data.

Every value below is labelled. **Observed** means read from the live site, the GitHub API or the raw output during or after this run. **Configuration-derived** means taken from the scripts' settings, not captured at runtime. **Reconstructed** means recomputed afterwards from inputs that were themselves observed. **Unknown** means not recorded.

The raw output `raw-output.txt` is copied unchanged from the run (sha256 prefix `5543c9b8c6238885`). The exact command chain is `command-chain.sh`. The browser checks are `identity-check.js` and `saved-stop-check.js`, copied as run (their `require` path is the sandbox's absolute path).

## Release and data (observed)

| Item | Value | Source |
|---|---|---|
| Merge SHA | `76da929f56eafbe20844b6b55e6596baf6f67af4` | GitHub merge API response |
| PR #160 reviewed head | `73814e7de90dcdf4a53399be442054834fd8406c` | Codex review, CI on exact head |
| Publish run | 41322396746, success. Created and started 2026-11-01T15:40:16Z, updated 2026-11-01T15:52:32Z | `publish-run.json` (GitHub API) |
| Deployed SHA | `76da929f56eafbe20844b6b55e6596baf6f67af4` | live `release.json`, raw output |
| App version | 2.34.0 | live `index.html` meta, raw output |
| Search index sha256 | `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a` | live file, raw output. Equals 2.34.0 (`9c930466`) |
| identity-hosts.json sha256 | `9f83fc564ec2240a13412cc49950782966e0ffa9c12915b3022214381eed4e58` | live file, raw output |
| National clearance manifest | HTTP 404 | raw output |
| RI clearance file | HTTP 200 | raw output |

## Identity census (observed)

Method: load all states one at a time through `KampTrailData.loadStates` in the given order. For every listing in the live search index, compare its canonical id and its sorted source-id set (id plus legacy_ids) with the browser. Service workers are blocked, and `/api/**` is answered 404 so no community data is involved.

| Run | Listings expected | Listings checked | Differences | Missing | Split | Canonical id differs | Source-id set differs | Wrong merges | Duration |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Desktop, all states reversed | 33,370 | 33,370 | 0 | 0 | 0 | 0 | 0 | 0 | 291,337 ms |
| Mobile, random order seed 7 | 33,370 | 33,370 | 0 | 0 | 0 | 0 | 0 | 0 | 303,730 ms |

- Mismatch ids: none, because every count is 0. The script records up to eight example ids per run, and both runs printed `"ex":[]`.
- Published ids in the live index (canonical plus legacy): 36,290. Not recounted by these two runs. It is the count from the PR #160 continuity check against this same index hash.

Viewports:
- **Desktop:** configuration-derived. The identity context sets no viewport, so Playwright's default (1280x720) applies. Not captured at runtime.
- **Mobile:** configuration-derived, 390x844 with `isMobile` and `hasTouch`. Not captured at runtime.
- **Browser:** Google Chrome at `/usr/bin/google-chrome`, launched by Playwright 1.57.0 in this sandbox. The Chrome version string was not recorded (unknown).

State order:
- **Reversed:** reconstructed. It is the live state list reversed.
- **Seed 7:** reconstructed. `seed7-order-reconstructed.json` holds the order, recomputed with the identical `seedShuffle` function from `identity-check.js` (function source included):
  `TX AZ IN AK WI PA GA NJ AL IA HI OK ID DE ND WY CO SC MN MO UT NV MT ME NC MI OR KS NM NH VA MD TN MA LA NE VT KY WA WV CA SD AR OH MS RI CT IL FL NY`
- **State list check:** the input list was not logged during the run. It was captured afterwards from the same deployed SHA, at 2026-11-01T16:04:18.306Z (`live-state-list.json`, script `capture-state-list.js`, release.json `76da929f…` at capture). It is identical, in order, to the `STATE_BOUNDS` keys in `data-loader.js` at 76da929f (50 states).

## Saved stop (observed)

Method: seed `localStorage.kt_trip` with one stop under the legacy id `ridb:232479` (index host `osm:way:1107154601`, Cosby Campground). Load NC and TN in each order, reload, and repeat. Network online. Service workers blocked.

| Order | Visit | Stored id before | Stored id after | Resolved host | Name |
|---|---|---|---|---|---|
| NC>TN | 1 | ridb:232479 (seeded) | ridb:232479 | osm:way:1107154601 | Cosby Campground |
| NC>TN | 2 (reload) | ridb:232479 | ridb:232479 | osm:way:1107154601 | Cosby Campground |
| TN>NC | 1 | ridb:232479 (seeded) | ridb:232479 | osm:way:1107154601 | Cosby Campground |
| TN>NC | 2 (reload) | ridb:232479 | ridb:232479 | osm:way:1107154601 | Cosby Campground |

Cached second visit:
- Service worker on, network online: load NC then TN, reload, and load again.
- Then `context.setOffline(true)` and reload offline, loading TN then NC.
- Result: identical identity and toilet evidence. Both `ridb:232479` and `osm:way:1107154601` resolve to `osm:way:1107154601`, with source set `osm:way:1107154601|ridb:232479` and toilet `included, evidence, [osm:element, ridb:campsite_records]`.
- Offline identity status: `{"hosts":"published"}`, the host map served from cache.
- Viewport: configuration-derived Playwright default (no viewport set).

## Timestamps

- Publish run: observed from the GitHub API (above).
- Live index file fetched for the census: filesystem modification time 2026-11-01T15:53:18Z. This is not a log timestamp.
- Raw output file last written: filesystem modification time 2026-11-01T16:03:59Z. This is not a log timestamp.
- Start and end time of each browser run: unknown. The scripts log durations only (above).
- State-list capture: 2026-11-01T16:04:18.306Z, logged by the capture script.

## Limits

- These are emulated desktop and mobile viewports in a sandbox Chrome. They are separate from the physical-phone offline acceptance scheduled for 2026-11-02, 3:00 to 3:20 pm Eastern.
- No user submissions, production database, private reviews or visitor browser storage were inspected.
- Partial-load identity (the Bird Creek case) is a known open defect, fixed in the 2.35.0 package under way. These censuses load all states and do not cover partial-load checkpoints.
- No parity claim. Score 91.7.
