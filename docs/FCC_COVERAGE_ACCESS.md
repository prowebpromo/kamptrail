# FCC coverage integration: private ingestion checkpoint

2026-10-29: owner reports Public Map Data APIs Enabled and a privately saved token.
Owner reviewed FCC About → License and Attribution: BDC availability data free and
unrestricted by copyright; CostQuest Fabric subject to separate restrictions.
This is owner-provided evidence, not a newly inspected page in this session.

## Implemented, not deployed

`scripts/fcc_download.py` is a POSIX/Python 3 private-terminal worker. No third-party
Python dependencies. `setup` accepts email and token only via hidden interactive
prompts. It refuses repository/web-root paths, symlinks and insecure permissions.
Directory mode 700, credential and archive files mode 600. Do not share terminal
input, credential contents, screenshots or backups containing credentials.

Requests use a fixed HTTPS FCC origin. Redirects are rejected so credentials cannot
be forwarded to another host. Exceptions are replaced with fixed messages; no
upstream body/header/request diagnostics, tracebacks, or debug logging. Metadata
and archives remain private. Maximum archive size 2 GiB, temporary-file validation,
SHA-256 and atomic replacement. A shared lock reserves requests at least 6.1 seconds
apart. No automatic retries, credential forwarding or automatic publication.

Official API specification retrieved from the FCC-published Box link on 2026-10-29:
https://us-fcc.app.box.com/v/bdc-public-data-api-spec
Document dated June 8, 2026, sections 3.1–3.4. Verified header names, route paths,
response envelope, GIS format values and 10 calls/minute limit. Corrected API
origin to https://bdc.fcc.gov. The worker still requires `--spec-verified` for
manual CLI requests. Redirects remain refused.

## Private entry on Hostinger

First confirm Python 3 and SSH access are available on the hosting plan. From an
SSH terminal you control, using a reviewed repository checkout outside public_html:

```
python3 scripts/fcc_download.py --private-dir "$HOME/.kamptrail-fcc" setup
```

Paste the FCC account email and token only at the hidden prompts. Neither value
belongs in the command line, shell history, environment dump, repository, chat,
GitHub Actions log, or browser screenshot. No command here reads/prints saved
credentials. The worker does not modify the existing PHP database configuration.

After the official API specification has been checked, test with:

```
python3 scripts/fcc_download.py --private-dir "$HOME/.kamptrail-fcc" --spec-verified check
```

Report only the fixed success/failure message. Authentication is **not tested yet**.
If the server returns Access Denied, stop and use FCC support. Do not evade it.
If FCC requires a redirect-based download flow, review its documented mechanism
before changing the no-redirect rule.

## Remaining to finish the public mobile layer

1. Inspect official API spec and confirm the route/header/response contract.
2. Private token entry and real successful authentication on the server.
3. Select current **Mobile Broadband availability** records by provider, technology,
   state and filing date. Never request Location Fabric or consumer challenges.
4. Download one provider/state pilot, inspect the actual GeoPackage schema and CRS,
   validate geometry, then build bounded viewport tiles. Preserve source hash,
   carrier, technology/speed/environment assumptions, as-of and retrieval dates.
5. Only publish validated tiles and a sanitized manifest. Tokens and raw response
   metadata never enter the public build. Add source/license attribution and modeled
   coverage limitations. Display no claim of measured signal or usable indoor-RV service.
6. Test carrier/technology switching, dates, viewport limits, missing coverage,
   offline behavior and mobile accessibility; test real pilot before national rollout.
7. Add scheduled refresh only after the real transfer/process/publish sequence works.

There is deliberately no decorative toggle or invented coverage geometry. This
branch changes no public map behavior. RV clearance routing remains a separate task.

Official references:
- https://help.bdc.fcc.gov/hc/en-us/articles/6789299021723-Key-Reference-Documents
- https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions
- https://www.fcc.gov/sites/default/files/bdc-public-data-api-spec.pdf

## Verified Hostinger installation

Private installation: `/home/u720198529/domains/kamptrail.com/private/fcc-install/`.
`fcc-worker` contains code only. `fcc-data` has mode 700 and its credential file
has mode 600. Python 3.9.25 and six security tests passed on the actual Hostinger
server. Initial self-check cron was removed. Owner privately saved credentials.
The model did not open/read the credential file. First API probe stopped on local
credential validation before transmitting an FCC request. Follow-up validator
returns only a fixed reason identifying an invalid/missing field, never its value.

The server wrapper `scripts/fcc_server_auth.py` is installed as
`fcc-worker/server_auth.py` beside a `scripts/` folder containing the downloader.
It uses a private process lock and writes only sanitized results and public mobile
availability metadata. Temporary probe cron must be removed after observing its
result. No public layer, national refresh or production API deployment yet.

Sanitized follow-up result: `FCC token field is missing or empty.` No FCC request was transmitted. Owner must privately populate that field, save and close the editor. Do not inspect the credential file or capture it.

Latest retry, 2026-10-29 16:00 UTC: direct Python cron ran successfully and reported `FCC account email field is missing or empty.` This supersedes the earlier missing-token diagnosis. Validation stopped before any FCC request. No raw credential values were read. The temporary direct-test cron was removed; wait for owner-provided FCC account email, which can be inserted server-side without displaying or replacing the saved token.

Email-only helper executed on Hostinger after owner supplied the account email. It atomically updates the username while retaining all other stored fields and mode 600. Fresh sanitized result at 2026-10-29 17:16 UTC still reports a missing/empty `token` field, so no FCC request was transmitted. The temporary email-update job was removed. A separate protected masked-entry form is being tested in PR #78 to replace raw JSON editing. Nine Python security/helper tests pass locally.
