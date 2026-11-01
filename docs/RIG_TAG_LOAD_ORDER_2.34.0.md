# Rig-tag load-order check (2.34.0)

Script: `scripts/verify-rig-load-order.js`. Result: `docs/RIG_TAG_LOAD_ORDER_2.34.0.json`. Run in Chromium against the real committed snapshots of `fix/rig-tag-ownership` rebased on main 16fcc1b (2.33.0, deterministic browser identity), served from this worktree on 127.0.0.1:8791.

## Result: pass

| Measure | Value |
| --- | ---: |
| Listings checked (every fixture case) | 245 |
| Multi-state listings | 40 |
| Scenarios | 84 |
| Stable in every scenario (source identities, rig line, popup rig block, Tents, Trailers) | **245** |
| Rig line or Tents/Trailers outcome changes with order | **0** |
| Source identities change with order | 0 |
| Differ from the published fixture | 0 |
| Browser canonical id differs from the index | 0 |

Scenarios: the default (all 34 affected states in one batch), sequential forward, sequential reversed, one delayed state response (ID, held 4 s), and each multi-state listing's states one at a time in both orders.

`usfs:24878` and `usfs:9461`, which showed under their OSM ids in every order on 2.32.0, are now elected as `usfs:24878` and `usfs:9461` in every run and match the index and the fixture (no rig source).

## State retries

The script retries a state request that failed once, as the app's own retry does, and records it. In this run WA timed out once in the default 34-state batch (12 s fetch limit under a parallel load) and loaded on retry. An earlier run without the retry lost WA in the delayed scenario and WV in the default batch for the same reason. Every listing found in that run was stable too.

## Before the identity fix (2.32.0 on 2.31.0)

The same check on the pre-rebase build found 18 listings whose rig line and filters changed with load order. The reversed order elected the absorbed OSM element as host, and 2 listings always differed from the index. The 2.33.0 host file removes both effects.
