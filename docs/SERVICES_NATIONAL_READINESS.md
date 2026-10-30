# National services producer readiness — candidate, 2026-10-30

This change prepares bounded state imports and complete-set candidate aggregation. It does not establish 50-state native coverage, change the accepted Utah/legacy database, dispatch a workflow, or publish data. Existing accepted evidence remains 2,981 Utah identities plus 4,359 legacy identities, snapshot `3229270a46978b58db5cb7d8`, 698 shards. Full national fit is unmeasured. All delivery caps remain binding; a national candidate that exceeds one fails before index promotion.

## Official source registry

`scripts/services-regions.json` is the exact 50-state ISO 3166-2 projection of the public [Geofabrik index](https://download.geofabrik.de/index-v1.json), retrieved `2026-10-30T16:28:57Z`. The actual index bytes were 3,785,307; SHA-256 `9b1d170b09eee255c0e56925788eb367646397c1ba1882f36b4c5c79133691fc`. Each entry retains the index's ID, name, ISO identifier and canonical public PBF URL; URLs were extracted from `properties.urls.pbf`, not constructed from guessed state slugs. The index lists DC separately; the registry intentionally contains exactly the 50 Census states. The observed Maryland URL is `https://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf`.

The importer binds every redirect in a request chain and the final URL to the originally requested registry entry. It permits only the canonical HTTPS latest URL or that exact extract's valid nonfuture YYMMDD public PBF URL, with at most three redirects. Arbitrary hosts, internal/contributor-metadata endpoints, user info, queries, other states and path traversals fail. A dated final URL must agree with the parsed replication header's calendar date. The parsed header must not postdate retrieval. PBF SHA-256 is calculated from actual downloaded bytes and verified again before parsing; saved receipts do not refresh retrieval dates.

Extract buffers never establish state membership. Census containment still quarantines ambiguous, foreign, outside-requested-state and unsupported-jurisdiction candidates. A DC point in the buffered Maryland extract does not become Maryland evidence. Exact node/way/relation identities, positive category predicates, lifecycle exclusion, access labels, source dates and ODbL attribution remain unchanged. Geometry fixtures cover AK/HI/dateline; they establish no real regional import.

## Bounded execution and last-good behavior

Downloads remain serial per process, 2 GiB and 30 minutes per state, with content-length, truncation, time and checksum checks. Raw PBFs stay outside Git. Native parsing now runs in an expendable child process using the checksum-pinned `osmium==4.3.2`, an external `sparse_file_array` location index, Linux 4 GiB address-space/30-minute CPU limits, a 30-minute wall limit, 12 GiB parse scratch limit, 512 MiB result limit, and disabled core dumps. The supervisor kills the child process group on wall/disk excess or termination; accepted canonical sources are written only after successful child completion. The maximum canonical record count remains 1 million.

`scripts/stage_services.py` runs an explicit set of state codes serially. A successful state checkpoint includes canonical source, full source report (including quarantine, category/access/lifecycle counts and OSM-linked samples), and a receipt binding source/report SHA-256 hashes, registry hash, batch, region, accepted count, runtime and finish time. Resume validates hashes, canonical schema, state URL/date bindings and native download/parser proof without downloading again. Failure receipts are separate; failure, shrink, regression and interrupted replacement preserve or recover the previous checkpoint. Current accepted state evidence supplies the loss/regression baseline. No automated reviewed-shrink bypass is exposed.

`scripts/aggregate_services.py` defaults to requiring every one of the 50 state checkpoints from the same batch and registry. An explicitly selected regional pilot is labeled `national_complete:false`. It first validates every checkpoint, builds complete assets in an external candidate directory, and measures actual manifest/shard sizes. It then writes immutable shards and generation manifest before the builder's atomic current-index rename. Existing accepted snapshots remain available. Unrefreshed state and legacy evidence remain in a regional candidate. The source tree and production files are never changed by these staging commands.

Unchanged browser delivery ceilings: 1 MiB manifest, 4,096 shards, 1 million rows, 512 KiB UTF-8 and 1,500 records per shard. Synthetic growth tests demonstrate fail-closed rejection at the manifest and shard ceilings. They do not predict whether all 50 real sources will fit. Any measured national cap failure is a contract blocker, requiring an explicit contract/design decision; do not relax the caps or label a truncated candidate national.

## Prepared workflow and review sequence

`.github/workflows/stage-national-services.yml` prepares artifact-only manual/weekly staging. The matrix has `max-parallel:2`, one bounded state per 75-minute job, fail-fast disabled, independent receipts, and aggregation only after every requested job succeeds. The weekly schedule requests all 50; the manual default is RI. It has read-only repository permissions and never commits, pushes, deploys, uses private credentials or promotes production data. No workflow was dispatched for this work. The existing weekly writer, PR #74 rebase/retry path, legacy `XX (1)` cleanup and Utah manual route are untouched.

A local pilot, using the already checksum-pinned native environment, is:

```sh
python scripts/stage_services.py --regions 'RI' --batch readiness-20261030 --stage /absolute/external/services-stage --scratch /absolute/external/public-pbf
python scripts/aggregate_services.py --regions 'RI' --batch readiness-20261030 --stage /absolute/external/services-stage --destination /absolute/external/services-candidate
```

Resume uses the same batch and stage. `--refresh` reimports against the accepted checkpoint baseline; `--reuse-download` verifies an existing public PBF/receipt and preserves its original retrieval evidence. For a national attempt, stage each registry state into the same batch (the prepared workflow does so in at most two concurrent jobs), then omit `--regions` when aggregating. Review all 50 provenance/quarantine/runtime receipts and measured complete assets before copying canonical sources, running the ordinary build/CI, updating coverage descriptions, or publishing. A failed state or cap failure keeps the last accepted public database.

## Actual readiness measurement

On `2026-10-30T16:30:30Z`, the new bounded downloader completed a real RI request:

- Canonical source: https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf
- Observed final URL: https://download.geofabrik.de/north-america/us/rhode-island-261028.osm.pbf
- Actual bytes: 52,513,926; actual SHA-256 `2e814ed12a070be2112f7e64bd80b05785ca082820c9a83f0c8e7ce9c6ce58b6`.
- Bounded download duration: 63.287 seconds. The new index plus PBF downloads total 56,299,233 bytes, below the 1 GiB readiness allowance (58,175,887 bytes including the 1,876,654-byte native wheel).

The public PBF and receipt are external cache intermediates, never Git assets. The first installation tool response ended with a cancellation error after public-wheel proxy timeouts, but inspection confirmed the wheel had in fact installed. Reuse required no further download: the installed version is 4.3.2, and the actual cached public wheel is 1,876,654 bytes with SHA-256 `604a3145aa755790b91e3eefac7ddbb74d31f188fddbbbb988877cba50e88eb7`, exactly the existing requirements pin.

The real RI native import completed with header timestamp `2026-10-28T21:21:02Z`, retaining 491 exact identities. Positive category counts overlap: dump 5, water 0, LPG 1, showers 5, laundry 24, groceries 248, fuel 217. There was one lifecycle exclusion, one conditional-access candidate, no invalid geometries and no private/no-access candidates. Four candidates were quarantined: three Census-contained Massachusetts objects outside requested RI, plus one unsupported relation geometry. Zero positive water-point matches is a result of this dated extract and predicate, not a claim about current real-world water availability. OSM-linked samples include two per category where available; LPG has only one, water none.

The final bounded replay took 4.543 seconds inside the importer, 7.533 seconds including boundary loading and worker supervision, with peak process RSS 308,680 KiB and sampled peak parse scratch 100,663,830 bytes. Retrieval evidence remained `2026-10-30T16:30:30Z` on replay. No Alaska or Hawaii PBF was downloaded.

The external RI+UT+legacy candidate measures 7,827 identities (RI 491, UT 2,981, legacy 4,355), 698 shards, a 199,340-byte manifest, 2,473,697 shard bytes, maximum shard 427,766 bytes and maximum 1,285 rows. Four dated legacy RI rows are superseded only within RI; every other retained legacy state remains. Snapshot `e2e1bd6b83a6bebb862e057e`; manifest SHA-256 `247cb2080bef265238789bf6407204c2a9c2d672f2b3794f34494e9391163c6c`. The candidate receipt explicitly says `national_complete:false`. These are measured regional candidate assets, not a production promotion or evidence of national fit. Full source/quarantine/sample proof and actual receipts are in `docs/SERVICES_RI_READINESS.json`.

Validation: 16 native-enabled importer/readiness tests pass without skips; three legacy-service tests and 14 existing weekly workflow safety tests pass in the general QA environment. Thirty-five focused Node producer/shared-client/route tests pass, including 13 producer tests. Tests exercise official registry/state URL binding, cross-state/date/host redirect rejection, parsed header/redirect-date mismatches, truncated downloads, wall/disk/address-space parse failures, last-good bytes, interrupted checkpoint recovery, failed refreshes, validated resume, incomplete national aggregation, all asset hashes/caps, exact identity collisions, AK/HI/dateline geometry and immutable generation/index retention. The staging workflow uses a stable run-ID/code-SHA batch across failed-job reruns and overwrites only that state's artifact so successful checkpoints remain usable.

## PR preparation against current main

The branch incorporates current main `18ca6668b773d433112aa133d6a217e9c9206221` (the three release-verification documentation updates) without changing accepted production sources, generated services assets, release version or the existing weekly writer.

Pre-PR verification completed on this tree:

- Full `npm test`: 223 tests, 177 passed, 46 skipped, no failures.
- Full `PATH=/workspace/scratch/2f7921418a46/qa-runtime/bin:$PATH npm run test:python`: 188 tests passed, seven skipped.
- The cached checksum-pinned native 4.3.2 importer/readiness suite: 16 passed, no skips.
- One full Playwright attempt: all 101 tests attempted and failed at browser launch because the expected `chromium_headless_shell-1200` executable is absent. The application was not exercised by this attempt; browser behavior remains unverified here. No browser or package installation was attempted during PR preparation.
- `git diff --check` passed. Only the explicit producer code, workflow, tests, proof documentation and inherited main documentation are staged; public raw/cache intermediates and generated browser reports are excluded.

The pre-PR review loss/freshness finding is corrected: refreshed output must pass both the currently accepted source and checkpoint baselines, so an older checkpoint cannot weaken the accepted date or 30% loss guard. A larger checkpoint retains its own applicable loss guard as well. Resume and final aggregation independently recheck current accepted evidence before replacement. Focused regression cases cover date regression, accepted-source loss, stricter checkpoint loss, and stale resume/aggregation; accepted source, checkpoint assets and the last-good manifest remain byte-for-byte unchanged on rejection. The 16-test native suite and 188-test full Python suite passed after this fix.
