# FCC national coverage qualification

This branch builds candidate PMTiles and verifies them against provider-reported outdoor 4G LTE at 5/1 Mbps. It has no deployment job, schedule, data-branch credential or production write permission.

## Runs

A push to `trial/fcc-national-ak` can only qualify Alaska. A dispatch to `work/fcc-national-qualification` accepts an uppercase state abbreviation, DC or US. US means the 50 states and DC. A distinct region input never selects US automatically.

The default branch already registers a read-only state staging workflow. This prototype branch supplies its own dispatch entry at that path with the same `states` input, calling the FCC qualifier at the same reviewed commit. GitHub requires a registered default-branch workflow path for dispatch. Neither workflow file from this prototype should replace the production jobs.

```bash
gh workflow run stage-national-services.yml --repo prowebpromo/kamptrail --ref work/fcc-national-qualification --field states=NY
```

Use the same command with `states=US` only for an explicitly approved full qualification after reviewing trial storage, source file sizes and run time. A regular branch push cannot launch a national fetch.

## Data flow

The planner freezes the current FCC filing date, SHA-256 of its filtered provider catalog and Census boundary, all eligible file IDs and observed catalog absences, source code hashes and a balanced worker assignment. A download unit is one state and one carrier. The territorial datasets are outside this 50-state-plus-DC scope.

Four standard Ubuntu runners handle a national candidate. One runner handles a single-state candidate. The account-wide workflow concurrency group is shared with the FCC refresh. Each runner receives an exclusive one-second admission window in a 12-second cycle of slots. At four lanes each returns to its slot every 48 seconds. A worker missing a window waits for its next slot. Two planner requests run before lanes start. Worker HTTP failures do not trigger credential retries.

Each worker downloads one archive at a time, checks declared and actual byte counts, available scratch space, expansion cost, the data schema, provider identity and FCC record counts. Maximum compressed archive is 6 GiB, total expansion is limited to 18 GiB, and 5 GiB of scratch disk is reserved beyond two uncompressed sizes. It checks source/raster pixel classifications, packs every qualified native tile into per-carrier/per-state PMTiles, verifies all packed tile bytes, then discards private inputs and temporary XYZ/GPKG files. Unsupported archives and incomplete independent checks fail qualification. A missing official provider/state file appears explicitly in the final receipt.

One-day lane artifacts retain only packed archives and source/spatial receipts. Each pack must be smaller than 96 MiB. The combined PMTiles budget is 96 MiB per lane (384 MiB maximum for a national candidate), with lightweight JSON receipts in addition. No raw source datasets are uploaded. Standard public-repository runners are used. Available account storage and source growth are checked separately before a full run.

The final job checks each lane against the original plan, verifies every packed archive hash and compares original source identity, boundary, model and spatial evidence. It emits `manifest.json` and `qualification.json` in a small 14-day artifact. The receipts identify the one-day artifact member for every archive. There is no second upload of all archive bytes. To assemble locally from downloaded lane artifacts and the retained plan, use the original checked-out commit with its `GITHUB_SHA` set, then run `qualify_fcc_national.py assemble` with `--materialize` and new output directories.

A failed lane may preserve verified partial artifacts for diagnosis. A national manifest is produced only when every eligible catalog row passed; scope cannot silently shrink on a failed download. A changed file, boundary or filing is a new candidate. This prototype does not replace the live NY/RI generation.
