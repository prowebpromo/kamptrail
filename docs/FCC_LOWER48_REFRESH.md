# Lower-48 FCC coverage refresh

KampTrail packages the FCC's provider-reported outdoor stationary 4G LTE data for AT&T, T-Mobile and Verizon. The packed edition covers the 48 contiguous states. It requires exactly 144 state/carrier combinations. The original New York and Rhode Island XYZ data remain available to existing clients.

## Monthly update

`Refresh lower 48 FCC mobile coverage` checks the latest FCC availability filing on the 10th of each month at 09:41 UTC. It uses the public map API at `https://broadbandmap.fcc.gov/api/public/map/`. The earlier two-state refresh runs separately. Both workflows use the same concurrency group for FCC requests.

The planner selects raw carrier files at FCC technology code 400. It checks the file ID, source name, record count, provider ID, filing, 2025 Census boundary and builder versions against the retained packed release. The scheduled run stops after checking the catalog when those inputs match. A manual `rebuild` also checks the source bytes if an upstream correction is suspected. An incomplete catalog keeps the last verified release.

The acquisition runs on four standard Ubuntu workers. They share disjoint 12-second request slots and download one file at a time per worker. Each worker verifies independent geographic samples against the original source, compares every packed tile with its native PNG and discards the raw inputs. The assembly step rechecks all 144 source and packed-file receipts before issuing a new manifest. A missing combination, failed check or disk limit prevents publication.

## Publishing

The trusted main workflow validates the receipt against the exact rendering, qualification and importer code on the publishing commit. It validates each archive and measures the proposed current-plus-previous storage before atomically updating the existing `fcc-mobile-data` branch. Hostinger then packages the active packed release beside the two-state fallback. Automatic refreshes preserve any matching quarantined source set until its source or builder changes.

A candidate run retains these GitHub Actions artifacts:

| Artifact | Contents | Retention |
| --- | --- | --- |
| `fcc-catalog-plan` | Source identities, boundary, component fingerprints and worker assignments | 7 days |
| `fcc-packed-lane-*` | Intermediate qualified archives and receipts for failed-run diagnosis | 1 day |
| `fcc-conus48-candidate` | `candidate/manifest.json`, 144 files at `candidate/<release>/<carrier>/<STATE>.pmtiles`, and `qualification.json` | 7 days |
| `fcc-conus48-evidence` | Final manifest and per-carrier/state qualification report, including geographic witnesses | 30 days |

The initial release reuses the already verified candidate. Its one-time adoption request at `.github/fcc-conus48-adoption.json` records the exact successful producer, GitHub artifact ID, SHA-256 digest and release ID. The main job checks that identity and the producer's code hashes before publication. This avoids a second download of the same carrier files. Future monthly refreshes produce their own candidate.

A successful qualification names the version, records and source date. Production verification also checks public archive range responses, map selection and a returning visitor's saved trip before a public release is considered complete.
