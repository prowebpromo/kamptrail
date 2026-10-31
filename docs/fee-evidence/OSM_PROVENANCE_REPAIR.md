# OSM fee and access provenance repair, 2.21.2

Nearby OSM elements could supply a retained record's missing fee, access and OSM
identity through the snapshot property spread. RIDB rows could then be treated
as OSM fee reports. The index merger independently adopted nearby OSM fees and
access. This release keeps those observations with their source element and
withholds classifications unsupported by the retained element's own evidence.

## Evidence policy

- Snapshot fee/charge/access tags, including ancillary and conditional keys, and
  OSM identity come from the kept record. Distinct OSM donors remain in
  `member_evidence`, with their original source ID, retrieval/update dates and
  element URL. This applies to OSM and RIDB recipients.
- An OSM tag disagreement is recorded as `member_fee_disagreement`. It does not
  overwrite the kept element's own tag. Separate OSM identities cannot establish
  a new known fee or access status in either layer. Exact identity enrichment
  remains supported. Existing index conflicts continue to withhold a fee.
- Agency/RIDB reconciliation stays in place. Adopted fees and access now name the
  supplying record through `fee_source_record_id` and `access_source_record_id`.
  Attribution follows the supplying record through subsequent merges. Every
  known fee in the national replay names both a source and a record.
- `access_hold` preserves four previous exclusions without pretending that the
  recipient carries its donor's restrictive tag. None is newly admitted.
- Member evidence is non-classifying, labeled `classification_use: not_used`,
  and visibly disclosed in the fee-evidence panel. Snapshot evidence is unique
  by donor ID, preserves the first stored observation and fails above 128
  donors. The actual maximum is 30. Runtime diagnostics retain at most 128
  reports, and the existing fee-evidence display limit remains 24 records.
- Seasonal paid wording stays unknown or paid as appropriate. An explicit
  `fee=no` plus `fee:conditional=no @ (...)` stays free. Only a conditional
  charging clause produces "Free with conditions". `charge=0`, donation and
  ancillary service fees do not establish free camping.

This deliberately differs from Claude fixture S17, which proposed retaining
index-layer OSM adoption. S17's production test expects unknown fee/access and
retained donor evidence, matching snapshot-layer ownership. The other 60
fixtures retain Claude's expected ownership and classification outcomes.

## National comparison

Baseline: main `bae1e71ccd188919554d2e4c6837f66212d2fdab` (live 2.21.1).
A separate baseline checkout replayed all 50 states and reproduced the saved
snapshots and national index classifications. The repair then rebuilt every
state from the same 98 retained raw-source files. No source fetch occurred.
Original source dates were retained.

All checks passed: 33,286 listings, canonical IDs, coordinates, state partitions,
aliases, snapshot counts and memberships, per-record admission and the weather
coordinate catalogue are unchanged. No normalized record was persisted in a
snapshot. The JSON report contains the raw-source hashes and every fee/access
delta.

| Fee classification | Before | After |
| --- | ---: | ---: |
| Free | 2,154 | 2,140 |
| Free with conditions | 59 | 58 |
| Paid | 8,291 | 8,206 |
| Unknown | 22,782 | 22,882 |
| Total | 33,286 | 33,286 |

There are 107 fee changes: 88 paid to unknown, 15 free to unknown, 3 unknown to
paid and 1 conditional to free. Snapshot access becomes unknown in 99 rows.
716 snapshot rows, representing 605 unique records across state partitions,
retain attributed member evidence.

Claude's frozen simulation had 96 fee changes. This release additionally
withholds 10 index-layer OSM adoptions (7 paid, 3 free) and corrects Wayne Russell
RV Park (`osm:way:1074603527`) from conditional to free. The baseline also
contains the previously deployed agency refresh, so its census differs from
Claude's earlier frozen commit. The three false conflicts resolved to paid are
South Fork (`ridb:245526`), White Azalea (`ridb:236550`) and Goldhill
(`ridb:252786`).

## Validation and reproduction

The automated suite includes the unchanged Claude fixture source (44 actual
record chains plus 17 synthetic cases), current-source replay, repeat merging,
reverse order, cross-source protection, donor dates and access holds. A browser
regression checks the visible member disclaimer and unknown fee offline.

```sh
# Run in a repair checkout, with an unchanged baseline in a separate directory.
git worktree add --detach ../kamptrail-baseline bae1e71ccd188919554d2e4c6837f66212d2fdab
node scripts/verify-osm-provenance.js --baseline=../kamptrail-baseline --report=docs/fee-evidence/osm-provenance-replay.json --remerge
npm run build:search
npm test
npm run test:python
npm run test:browser
npm run build
```

`--remerge` writes the 50 saved snapshots. Without it the verifier checks the
existing repaired snapshots. It fails on identity, coordinate, membership,
admission, source-input or attribution changes. The normal release workflow
provides PHP/MySQL, backup-restore and browser gates. Runtime versions, asset
URLs and the service-worker shell generation are coordinated as 2.21.2/kt-v51.
Publishing uses the existing tested `main` to `hostinger` workflow.

## Remaining identity reviews

| Kept record | Restrictive donor | Hold |
| --- | --- | --- |
| `osm:node:8021890291` | `osm:way:549386043` | private |
| `osm:way:1062744164` | `osm:way:1062961186` | private |
| `osm:way:364973410` | `osm:way:1029939158` | private |
| `ridb:238903` | `osm:way:968061661` | no |

These holds require identity evidence before removal. Name-based merge
membership, inherited tourism/amenities and broader geography/border issues
remain separate reviews. No catalogue splitting or new public admission is
part of this repair.
