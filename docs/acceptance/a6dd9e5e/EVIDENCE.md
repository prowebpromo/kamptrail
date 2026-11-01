# Live acceptance of 2.35.0 (PR #164, merge a6dd9e5e)

All values are observed: read from the live site or the raw outputs in this folder, at runtime. Browser: Chrome 153.0.8010.12 (Playwright, sandbox), runtime viewports recorded in each result. Scripts are the corrected PR #161 versions at 09549421 (census fails on unexpected browser listings, unmatched listings and unequal counts, and every result is pinned to the requested release at start and end). The Bird Creek trace is `scripts/check-bird-creek-checkpoints.js` from PR #164.

## Release (observed)

| Item | Value |
|---|---|
| Merge SHA | `a6dd9e5ed6b2ce64e372ba30d99119be4aaa19e7` (PR #164, reviewed head `0de91c11`) |
| Publish run | 41345750232, success, 2026-11-01T20:13:35Z to 20:30:30Z |
| Deployed `release.json` | `a6dd9e5e…` at the start and end of every check |
| App version | 2.35.0 |
| search-index.json sha256 | `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a` (unchanged from 2.34.0) |
| identity-hosts.json sha256 | `9f83fc564ec2240a13412cc49950782966e0ffa9c12915b3022214381eed4e58` (unchanged) |

## Bird Creek checkpoint (live, UTC 20:35:02 to 20:35:15)

| Order | Checkpoint | Bird Creek listings in the browser | Problems | Result |
|---|---|---|---|---|
| NV>CA | after NV | `ridb:234209` [ridb:234209], `usfs:65184` [usfs:65184] | 0 | PASS. No merge across listings. `osm:way:1236741631` and `ridb:234209` resolve to their own listing's NV record until CA loads. |
| NV>CA | after CA | `osm:way:1236741631` [osm:way:1236741631, ridb:234209], `usfs:65184` [usfs:65184] | 0 | PASS. Matches the index. |
| CA>NV | after CA | `osm:way:1236741631` [osm:way:1236741631] | 0 | PASS. Partial id set until NV loads. |
| CA>NV | after NV | as above, full match | 0 | PASS |

Total mismatches: 0. On 2.34.0 the NV-only checkpoint had 1 wrong merge and 3 wrong resolutions (PR #164, `docs/identity/bird-creek-checkpoints-2.34.0.json`).

## Identity census (live)

| Run | Viewport | Start, end (UTC) | Expected listings | Browser listings | Count differs | Missing | Split | Canonical | Source set | Wrong merges | Unexpected ids | Unmatched browser listings | Failed states | Result |
|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Desktop, states reversed | 1280x720 | 20:35:18 to 20:41:38 | 33,370 | 33,370 | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | PASS |
| Mobile, seed 7 | 390x844 | 20:41:38 to 20:46:31 | 33,370 | 33,370 | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | PASS |

State orders are recorded in each result file (`state_order`).

## Saved stop, online then offline (live)

| Viewport | Stored id before and after | Resolved host | Service worker controlling | Uncached fetch blocked offline | Result |
|---|---|---|---|---|---|
| Desktop 1280x720 | `ridb:232479` | `osm:way:1107154601`, Cosby Campground | yes | yes | PASS |
| Mobile 390x844 | `ridb:232479` | `osm:way:1107154601`, Cosby Campground | yes | yes | PASS |

## Limits

- Emulated viewports in a sandbox browser. The physical-phone offline check is separate (2026-11-02, 3:00 to 3:20 pm ET).
- No user submissions, production database or visitor storage inspected.
- Partial-load checkpoints beyond Bird Creek were measured before release (PR #164) and not repeated live.

Partial-load identity: retest done, fixed on the deployed SHA. No parity claim. Score 91.7.
