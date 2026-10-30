# Probably-free fee evidence: targeting and decision gates

Status: selection and measurement design only. No new page reviews, fee classifications, overrides or production data changes have been made. The ten maintained USFS reviews and their automated-recheck pilot take priority. New overrides must wait until that pilot's maintenance policy is accepted.

## Reproduce the saved-input assessment

```sh
python scripts/analyze_fee_pool.py --output docs/fee-evidence/2026-10-30-probably-free-pool.json
python -m unittest discover -s scripts/tests -p test_fee_pool.py
```

The committed report fingerprints the canonical search index and all 50 saved merged state snapshots. These fingerprints identify inputs, not fresh provider retrievals. Baseline source is main `8a46972` (PR #111); the campsite index still has 33,286 records. Main/live release changes must be checked again before running a review batch. Rebuild selection if source hashes change. Keep the pre-review selection and results for an audit rather than silently replacing it with another sample.

## Verified baseline

The saved canonical index reproduces the reported 22,784 unknown fees:

| Primary canonical ID source | Unknown |
|---|---:|
| OSM | 20,808 |
| RIDB | 1,074 |
| USFS | 562 |
| BLM | 340 |

Unknown types are 22,288 established, 458 dispersed and 38 other. Source counts use the primary canonical ID, not a sum of source-feed rows. A single place can have other source aliases.

The hypothesis that most unknown established sites charge has not been sampled or verified. No fee is inferred from site type, operator, public ownership, a rest-area parking duration or missing evidence.

## Targeted pool and overlap

| Eligibility flag | Canonical records |
|---|---:|
| Unknown dispersed | 458 |
| Unknown primary USFS or BLM | 902 |
| Unknown OSM-associated record with explicit federal operator text | 1,159 |
| Dispersed/primary-agency overlap | 454 |
| Unique union | **2,065** |

There are no other flag overlaps in these saved inputs. The operator group includes 1,124 primary OSM IDs and 35 primary RIDB IDs with joined OSM source identities. Requiring a primary OSM ID for that third group produces a narrower **2,030-record union**. Keep the 35 RIDB records visible rather than treating them as extra physical places.

Operator tags are review leads, not verified ownership or free-camping evidence. Matching accepts explicit USFS/BLM abbreviations, United States/US/USDA Forest Service and Bureau of Land Management. Generic `Forest Service`, `USDA` alone and national-forest names alone are excluded. This avoids treating the Florida or Delaware Forest Service as USFS. A misleading OSM operator tag can still enter the lead pool and must be checked before classification.

Canonical IDs and exact aliases drive joins. Thirty-five raw state-snapshot identity joins point at multiple canonical records and are excluded from operator targeting. No name/proximity guesses resolve those joins. These are conservative eligible counts, not a completeness claim for every agency-operated OSM place.

## Structural findings

The importer retains OSM tags in `scripts/fetch_osm_data.py`, and merged state records retain operator fields. The compact search index deliberately omits operator fields. Therefore targeting must join the canonical index to source-bearing snapshots; compact-index-only analysis loses operator leads. No production schema change is needed for the present selection script.

Of 20,918 unknown canonical records associated with an OSM identity in the merged snapshots, 3,963 have one of the selected operator fields and 16,955 do not. Missing saved fields do not prove that today's OSM object lacks the tags. Distinguish old snapshots, genuine source gaps and merge/identity issues before changing the importer.

A retained `fee=no` or `charge=0` does not by itself justify changing a canonical unknown. Current normalization already recognizes common OSM yes/no fee tags. Remaining unknowns can involve conflicts or stale/ambiguous source evidence. Inspect the reason the published status is unknown before extending tag parsing. Do not overwrite a source disagreement with a preferred tag.

## Sequence before review work

1. Complete and approve the automated recheck/maintenance pilot on the ten expiring reviews. Retain a meaningful due date and an explicit changed/unavailable/ambiguous review queue. A 304 response or unchanged arbitrary HTML must not silently count as a fresh human fee review.
2. Confirm current release and source hashes. Rerun this diagnostic against current publication inputs.
3. Run a structured audit of retained fee/conditional/charge fields and canonical conflicts in the eligible pool. Source-refresh only the selected records where saved evidence is insufficient; record original provider modification dates separately from retrieval dates.
4. Review the fixed 50-record sample in the report. It is a feasibility experiment, not a population estimate or a promise of 50 new free campsites.
5. Apply the gates below before extending the method to additional records. No mass override file is authorized by successful selection alone.

## Pilot sample and thresholds fixed before reviews

Sample: 15 dispersed records, 15 primary agency records that are not dispersed, and 20 remaining OSM-associated federal-operator leads. The strata are disjoint. Within each stratum, sort by SHA-256 of the fixed selection seed plus canonical ID. The report stores all 50 selected IDs, reasons, states and operator evidence. The order is reproducible and does not allow choosing only easy pages. These quotas intentionally test three targeting methods; they do not match population proportions.

The thresholds below are proposed operating decisions, not measured outcomes or claims about normal review productivity. Record them unchanged before the first review. Change a threshold only as an explicit new experiment with a new sample/seed.

| Metric | Definition | Scale gate |
|---|---|---|
| Resolution rate | Unknown becoming defensibly free, paid or conditional / all attempted selected records | At least 30% |
| Minutes per record | Total active research, extraction, identity checking and evidence logging minutes / all attempted records, including failures | Mean no more than 5 minutes |
| Unknown-to-free share | Resolved records becoming free / all resolved records | At least 50% |
| Free yield | Unknown becoming free / all attempted records | At least 15% |
| Maintenance fit | Each proposed override has an approved recheck mechanism and exception owner/queue | Required for every published override |

Start timing on the first identity/source lookup and stop when the outcome and evidence are recorded. Record unattended fetch time separately. Unavailable pages, ambiguous identity, conflicting fees and inconclusive evidence count in attempted denominators. A conditional classification requires explicit camping-fee conditions; it is not a bucket for uncertainty. Known fees retained or unrelated source enrichment do not count as resolutions.

Stop or change the method after the first 30 attempted records if fewer than nine resolve, or if 150 active minutes are consumed before those 30 outcomes are recorded. If the interim gate passes, finish the fixed 50. At 50 attempts, scaling requires at least 15 resolutions, at least eight free outcomes, free outcomes making up at least half of resolutions, and at most 250 active minutes. Failed free-yield gates mean retarget the pool; failed time gates mean automate source/identity extraction or reduce scope. Do not continue more manual records merely to improve an unfavorable rate.

Report metrics for each stratum and combined, with exact numerator/denominator counts and observed times. The small targeted sample does not support extrapolating a national unknown-to-free conversion rate. If a stratum fails while others pass, run a separately declared follow-up experiment on the promising method instead of claiming the whole pool passed.

Each outcome needs canonical and source identities, source URL, exact camping-fee wording, source modification/retrieval/check dates when available, conflict handling, active minutes, outcome and reason, plus the approved recheck basis. Keep fee text and derived classification separate. Publish before/after canonical fee counts only after the normal import, deduplication, quarantine and search-index build, and distinguish changed classifications from new physical places.

## Maintenance limits

This document does not extend the current 30-day override expiry or set human review dates. Automated change detection should reduce human attention to changed, missing or uncertain evidence; it cannot verify that an agency's unchanged page reflects current on-the-ground charges. Decide the stable-evidence validity window and periodic human backstop explicitly with the ten-record pilot, then budget its queue capacity before scaling. The existing November 23 task and November 27 commit deadline remain separate from this new selection work.
