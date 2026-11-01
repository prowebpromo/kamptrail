# KampTrail · Independent November 1 release audit

**Handback to Claude, November 1, 2026.** GitHub main and the live Hostinger marker both identified `041ff76c47cbc002ef38aa29e39a508337e2bf91` at 12:33:38 UTC. KampTrail served version **2.34.0**, service-worker cache **kt-v67**, and **33,370** discoverable places. The live search-index SHA-256 was `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`. Rhode Island’s clearance file returned 200, and the national clearance manifest returned 404. [Independent handback read](acceptance/2026-11-01-handback-live.json)

**Next engineering work.** Correct the Bird Creek partial-load ID collision before publishing tourism changes. Preserve already loaded rest-area states when a slow region times out. Both issues have measured reproductions below. The tourism branch stays review-only pending owner disposition of the revised classifications and an authorized publication path for rebuilt data. The next physical acceptance requires Chuck’s phone on November 2.

## Release record

| PR | Exact PR head and checks | Merge SHA | Hostinger publish | Live desktop and mobile |
|---|---|---|---|---|
| #156, handoff documentation, merged by another session | `74c7ec5276d5f4e11edebae92ecd3f7bcd4a3b0b` · [regression](https://github.com/prowebpromo/kamptrail/actions/runs/41302115815) · [Lighthouse](https://github.com/prowebpromo/kamptrail/actions/runs/41302115767) | `1ce6aaccf98aade607d79f40377d66ac08d87ce4` | [41302971327](https://github.com/prowebpromo/kamptrail/actions/runs/41302971327) | [41304023514](https://github.com/prowebpromo/kamptrail/actions/runs/41304023514) · [record](acceptance/nov01-pr-156-live.json) |
| #157, Indiana popup test | `d3fd45ce95e9eee058fe0664e015ad6029792a49` · [regression](https://github.com/prowebpromo/kamptrail/actions/runs/41302618327) · [Lighthouse](https://github.com/prowebpromo/kamptrail/actions/runs/41302618417) | `3171711b31dce4fd09d66d6f16a2d0efbe525c20` | [41304132160](https://github.com/prowebpromo/kamptrail/actions/runs/41304132160) | [41305534528](https://github.com/prowebpromo/kamptrail/actions/runs/41305534528) · [record](acceptance/nov01-pr-157-live.json) |
| #158, RIDB raw fields and smoke-popup test | `a27bb87efe7057f959ac4a99a0aff583bc82ad8c` · [regression](https://github.com/prowebpromo/kamptrail/actions/runs/41303852717) · [Lighthouse](https://github.com/prowebpromo/kamptrail/actions/runs/41303852685) | `041ff76c47cbc002ef38aa29e39a508337e2bf91` | [41305696938](https://github.com/prowebpromo/kamptrail/actions/runs/41305696938) | [41307106486](https://github.com/prowebpromo/kamptrail/actions/runs/41307106486) · [record](acceptance/nov01-pr-158-live.json) |

The team merged #157 and #158 serially, each with its expected exact head. The merge of #158 had the expected parents and tree. The release steward recorded a successful Hostinger publication, matching production marker, and direct production acceptance on two viewports before proceeding to the next release. Each acceptance checked the named Indiana facility, its permission evidence and source, the production index hash, national-clearance isolation and uncaught browser errors. The last audit-branch commit before this handback was `70600aab9d59f814e35eebde6a1d6590b6392527`. The immutable link shared with Chuck identifies the report commit itself.

## Verified baseline

Production served app **2.34.0**, cache **kt-v67**, at source `a8785f981e58f745fbd57e34763b630ab73fe7d2` at the start of the audit. The incoming handoff named `9c930466`, the original app merge. PR #155 then changed eight documentation and acceptance-script files and the main-push workflow deployed that commit. Ten live app/data assets compared byte-for-byte with the independently built package. No rollback was indicated.

| Independent check | Result |
|---|---|
| Live search index vs the 2.33.0 index at `16fcc1bbd904b98358ce1d5bb557943c1067e6f0` | Exactly 33,370 unique canonical IDs before and after, in the same order. No field changed outside `m.r`. Exactly 237 rows changed. Tents 5,963 → 5,783, trailers 2,989 → 2,848 and RV metadata 242 → 187. |
| Live search-index SHA-256 | `83e6f21c026796ab6ee54f7963855d676536f29a5d95d256dadbbaf53b06c33a`. Byte-identical to the index in the 2.34.0 application merge. |
| Identity after all 50 states loaded | Four Chromium censuses (desktop/mobile emulation, alphabetical/reversed, normal/404 then recovery) matched all 33,370 canonical hosts and the complete 36,290 canonical/alias IDs. No other-row memberships or missing IDs. Actual rig selector: 5,783 Tents, 2,848 Trailers on both viewport sizes. |
| Missing identity sidecar on first visit | Zero wrong merges, unrecognized IDs, or disappearing shown IDs at all 50 checkpoints in both fallback scenarios. Before recovery there were 2,490 listings with duplicates, 35,959 shown IDs, and 26 listings shown only under an alternate ID. On reconnection, all 35,959 resolved as expected. |
| National clearance isolation | Fresh `node scripts/build-release.js` packaged only `data/clearances/RI.json`. Searched 37 web client files. No national clearance tile paths, manifest reads or v3 schema identifiers. Live RI matched the build and the national manifest GET returned 404. |
| Previous maintenance baseline | GitHub-hosted direct HTTPS rendered the real Greenfield Rest Area Westbound facility, permission evidence and facility link on desktop and mobile; live index, release marker and 404 also passed. [Baseline browser run](https://github.com/prowebpromo/kamptrail/actions/runs/41303289362). |

The four-census audit used direct public HTTPS for two scenarios and replayed independently captured HTTPS responses for the other two. Mobile was emulated. No user submission, production database, private reviews or visitor browser storage was inspected. The November 2 physical-device cold-start check remains a separate acceptance step.

[Per-listing index diff and package results](acceptance/2026-11-01-codex-index-package.json) · [Four browser runs, raw evidence and exact harness](https://github.com/prowebpromo/kamptrail/tree/3af5114e7f1e444c47bf9f5d08faad503912bedd/docs/return-audit-2026-11-01/identity)

## Two issues reproduced on the released map

**Bird Creek Campground, wrong record during a partial load.** With the published host manifest available, load Nevada before California. In the real Chromium loader the separately published `usfs:65184` resolves to `ridb:234209`, which belongs to `osm:way:1236741631`. In the reversed candidate census the mix-up persisted for 28 state-load checkpoints. When California arrived the two published owners resolved correctly. A forced HTTP 404 for the host file kept the two places separate on both versions. The reviewer reproduced the issue in 2.34.0 and the locally rebuilt candidate and matched all 12 relevant runtime/data files to their captured production hashes. The four complete-catalogue passes and the separate 404-recovery result stand. The recorded results do not establish whether any visitor submitted or saved anything during that interval.

The proximity merge in `data-quality.js` permits a same-name alternative when the known host has not loaded. The next identity patch should prevent that rule from combining two separately published owners. Add a Nevada-before-California browser test with the manifest present. Require the independently published USFS ID to resolve to itself after each state loads, and verify the OSM/RIDB pair still converges for both load orders. Keep stored IDs unchanged.

**Rest-area catalogue on a slow connection.**

All 13 live state rest-area files validated, totaling 586 facilities. The current client keeps one 20-second deadline across sequential region requests. Under measured slow-network conditions it canceled Nevada at 19.996 seconds, discarding Indiana even though Indiana had already arrived. A second network passed the actual desktop/mobile popup check. The test-only Indiana change does not address this separate runtime defect. A future patch should retain already validated regions when another region times out, preserve sourced permission/unknown policy behavior and explicitly test slow partial failure. [Measured reproduction and acceptance test](acceptance/2026-11-01-rest-area-network.md)

## Maintenance work

The Indiana test originally accepted the first matching map marker, which could leave the previous Texas popup open. PR #157 selects Greenfield Westbound by its full accessible name and waits for its facility ID before checking permissions. The existing content checks remain. Delaying the Indiana response by 1.5 seconds made the old test fail and the new one pass. This was a test-only change.

PR #158 retains `FacilityTypeDescription` and `LastUpdatedDate` verbatim on each future raw Recreation.gov facility import. Omitted, null and blank remain distinguishable. The snapshot merger strips both raw fields before publishing. Existing stored raw files were not backfilled, and this release does not refresh any campground data. The initial PR CI failed on a different existing test. In Chromium a closing fire popup could coexist with an open smoke popup, making the evidence locator ambiguous. The replacement commit targets the visible satellite-smoke popup and retains every original content assertion. Extending the closing animation reproduced the old failure and the corrected test passed.

## Owner direction and scope

November 1. Asked about the OSM website identity rule, the tourism proposals and retaining the raw agency fields, Chuck replied **“agree - proceed”**. The question proposed using a same-facility URL only as supporting evidence unless independent evidence confirms identity, preparing the 31 withdrawals and 10 lodging changes *for review*, retaining all 51 description-only cases at their current labels, and retaining raw `FacilityTypeDescription` and `LastUpdatedDate` per Recreation.gov facility. The initial numerical proposals are subject to the subsequent record-level audit. Chuck separately authorized delegation as needed. No approval to merge or publish the tourism candidate was given.

The score remains **91.7/100** (100/109, all 13 must-haves). These checks confirm existing releases and don't complete an additional approved parity contract.

## Candidate evidence and publication boundary

The original aggregate counts hid cases that matter to a visitor:

- The BLM describes Pink House Recreation Site (`ridb:255240`) as a developed campground. A word inside its proper name gave a false lodging match. [BLM](https://www.blm.gov/visit/pink-house-day-use-pavilions)
- The operator describes the screen cabins at `ridb:234745` as gathering places and directs campers to bring their own sleeping accommodations. The four structured cabin-unit labels alone would give the wrong impression. [Recreation.gov](https://www.recreation.gov/camping/campsites/91885)
- Mica Bay (`ridb:255232`) is a boat-in campground with 16 tent units. Fourteen of the original withdrawal proposals have direct own-site campsite evidence, another has primitive sites, seven have limited or mixed evidence, and nine lack sufficient evidence in the retained row. A missing field is insufficient to conclude that camping is prohibited. [BLM](https://www.blm.gov/visit/mica-bay-boater-park)

The candidate is for review. Automatic approval review rejected transferring the complete rebuilt Alabama campsite GeoJSON to the GitHub review branch because it contains potentially sensitive contact and location-derived fields; the repository/dataset authorization was unverified for that transfer. An earlier attempted upload returned an object hash different from the expected local object. It was never attached to a commit or branch. The corrected transfer was rejected and further generated-data uploads stopped. Only reproducible source, approved evidence and verification summaries are eligible for the remote review checkpoint. The locally rebuilt candidate and its digest must be distinguished from the data committed on that branch. The resulting branch retains the 2.34.0 search index and state files, and its package builder fails until the source has been rebuilt. No tourism data went to production.

## Tourism candidate results

The revised 2.35.0 candidate (cache kt-v68) was prepared against the 2.34.0 release baseline at `a8785f981e58f745fbd57e34763b630ab73fe7d2`. That first source-only checkpoint is `735d5afd35ddbbd8b3219e9f106e291dabd8314a`. It was then reconciled with the exact final main at `041ff76c47cbc002ef38aa29e39a508337e2bf91` through review-only merge `c2e57b710645bfcdb7b9120755e31831b8de3c82`. Its conflict-free tree `9c32dec4179a1037a304e9b5b1ad06eefdfc11b3` differs from the final review head `9087521fd1f986494f2d0891f9e2958787034ee0` by one documentation clarification. The separate pre-integration locally regenerated commit is `37505437e8d9476fcf6f8e0dca27d1b38731a64a`. Its 53 differences from the corresponding remote tree are the 48 changed state snapshots, three indexes and two ledgers. Its rebuilt index contains **33,361** discoverable canonical places, down nine from 33,370. All 36,290 previously published canonical and alternate IDs still resolve. Of these, 36,276 resolve to discoverable records and 14 resolve to the nine withdrawal notices. No published ID moved to a different host. Existing users’ saved IDs do not need rewriting.

| Question | Independently reviewed outcome |
|---|---|
| Should the 31 places disappear from discovery? | Withdraw nine with individual notices. Keep 15 with direct evidence of camping. Keep the other seven discoverable with an admission-review notice. |
| Should 10 places be relabeled as lodging? | Eight qualify. Pink House and Desolation Gray Canyons Screen Cabins are the two exceptions. Shaw House has a reported closure. The White Mountains record covers more than one cabin. |
| Can narrative descriptions or OSM web links upgrade a label? | All 51 description-only proposals keep the published Other label. Of 51 reviewed OSM links, 44 carry a matching Recreation.gov number. A matching link alone transfers no rig, tourism or amenity evidence. |
| What else changes? | Twenty-three own-name records move from Other to Campground and four to Dispersed. Twenty-one previously labeled Campground and five previously labeled Dispersed move to Other. Three state-file loading hints change. Four restrictive-access holds remain in force. |
| Can a future reviewer reproduce the data? | Two complete local rebuilds, then two more from an independently fetched source checkout at 62cca379, returned the same aggregate digest `cd970cbd495be53b6271812b6f51a3b235e1a2ea98791434bfbf5e2b7162bbca`. The candidate search index has SHA-256 `370e42268e41ec027a4d89b9214084f240cc2bbc054632920690d9670b837740`. The admission verifier reported 734 ledger records, 73 deltas and zero unexplained deltas. |

[Independent review, exact source hashes and both browser orders](https://github.com/prowebpromo/kamptrail/blob/36220203ddeaf2f94a3dd40d6ff53d6ebd8cfdf4/docs/candidates/TOURISM_INDEPENDENT_REVIEW.md)

The reviewer checked 64,280 state snapshot rows. Among the defects corrected during the candidate review were BLM observations incorrectly labeled as a Recreation.gov structured field, a partial-load path that resurfaced withdrawn places and two lodging pins whose submeter position changes dropped their coordinate-keyed elevation. On White Mountains cabins (`ridb:252494`), the corrected map shows 529.285 m. Axolotl Cabin (`ridb:251354`) shows 2,176.689 m. Both were independently reproduced before and after the fix in a zoomed browser and compared with 2.34.0. A listing’s label does not verify its operating status.

## Candidate test environment

On an isolated copy of the locally built candidate, the complete configured Node suite passed 489 of 489 with PHP 8.3.6, SQLite/PDO, GD and mbstring enabled. The full Python suite passed 397 of 397, including the six native forecast and three OpenStreetMap parser cases omitted on the first run. The latter used the exact repository forecast lock (CPython 3.12.16) and its checksum-pinned osmium 4.3.2 wheel. All 165 of the candidate’s existing Playwright tests passed in 8.8 minutes with zero retries and zero skips, in Chromium 143 against an isolated server verified to be serving local built commit 37505437 and index 370e4226. The separately prepared maintenance test improvements were outside that candidate baseline. The candidate’s separate MySQL/Docker backup and restore tests were not exercised. CI on the maintenance PRs exercised its own MySQL and Docker gates.

On the final integrated review tree, the complete suite grew to **490/490 Node/PHP** and **399/399 native Python**. Both exited 0 with zero skips or failures. The maintenance changes add one Node case and two Python cases. Two clean rebuilds directly on the integrated maintenance tree matched both earlier hashes and every historical host. Across 64,280 public snapshot rows and all 54 generated files the reviewer found zero leaked raw facility type/date keys. Both modified browser tests passed on this integrated tree. [Integrated replay and field scan](acceptance/2026-11-01-integrated-candidate.json).

## Branches outside main

| Branch | Status |
|---|---|
| `review/tourism-admission-nov01` | Final source-only checkout `9087521fd1f986494f2d0891f9e2958787034ee0`, integrated with the final maintenance main. [Source and reviewed proposal](https://github.com/prowebpromo/kamptrail/blob/9087521fd1f986494f2d0891f9e2958787034ee0/docs/TOURISM_TYPE_ADMISSION_CANDIDATE.md). No tourism merge, PR or deployment. |
| `candidate/tourism-type-admission` | Original proposal `c109f3396f93147d1fab02b8e9598c6d8f1b95c2`. Superseded for review. No edits. |
| `audit/codex-identity-20261101` | Independent nationwide production audit and raw test evidence at `3af5114e7f1e444c47bf9f5d08faad503912bedd`. Evidence branch only. |
| `audit/codex-handoff-20261101` | Contains this return report, package audit, slow-network reproduction and deployment acceptance records. Evidence branch only. |

Previously open PRs #77 (FCC) and #80 (FreeRoam) were outside this handoff. Finalizing a tourism release requires resolving the partial-load identity issue, reviewing the individual proposed changes, and using an authorized route for the generated datasets. The local candidate already reserves version 2.35.0 and cache kt-v68.

## Dates

- Monday, November 2, 3:00–3:20 p.m. Eastern: Chuck's real-phone cold-launch and offline acceptance. Use [the runbook](https://github.com/prowebpromo/kamptrail/blob/a8785f981e58f745fbd57e34763b630ab73fe7d2/docs/OFFLINE_READINESS.md).
- Tuesday, November 3: one review of the first scheduled national-clearance refresh, at 3:00 p.m. Eastern, task `6ae723dfeb308191840a09170f798ad2`. Inspect the actual scheduled run, protected RI, same-input no-commit behavior and continued exclusion of national client assets.
- November 23: existing USFS fee backstop `6ae50903f7ec8191a5e1f06888a35fb2`. Resolve exceptions by November 27; November 29 is the existing evidence-expiry date.
