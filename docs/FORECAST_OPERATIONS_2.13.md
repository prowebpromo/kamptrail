# Forecast operations — 2.13

This is the operational companion to `FORECAST_CONTRACT_2.13.md`. It documents implementation and remaining release checks; it is not evidence that forecast publication or a production deployment has occurred.

## Separate data publication

`.github/workflows/publish-forecasts.yml` runs hourly at minute 17 or by manual dispatch on trusted `main`. Its production job builds the current coordinate catalogue, installs the hash-locked native decoder environment, runs decoder checks, and produces/validates one bounded package. That job has read-only repository access. A dependent publication job downloads only the artifact from that same workflow run, rebuilds the coordinate catalogue, revalidates the package and uses the ephemeral workflow token with `contents: write`. No persistent secret or application deployment is involved. Actions are pinned to reviewed commits; checkout does not persist credentials. Workflow concurrency queues publishers rather than cancelling an in-progress transaction.

The publisher only targets public repository `prowebpromo/kamptrail` (repository ID `967717280`), release tag `forecast-data-v1`, and a non-latest prerelease. It checks these identities at runtime and refuses an immutable release. It never changes repository policy. Initial creation stages and verifies every generation asset plus both pointers in a draft before publishing; if publication activates immutability, it halts and makes no further writes.

Each generation has 50 immutable state gzip assets and an immutable manifest copy. Both `current-a.json` and `current-b.json` are complete manifests. Publication uploads and downloads every new asset for byte verification before replacing the older pointer. Immediately before replacement it rereads release identity, both pointer bodies and asset IDs to detect a concurrent change. The other valid pointer survives a failed deletion/upload/verification. Expired unreferenced generations are removable only after expiry plus 30 minutes. Incomplete abandoned uploads use upload time plus three hours plus the same grace. Both pointer targets are always protected.

The October 30 scheduled run `41102987726` produced a valid generation but stopped at `pointer_propagation_pending` immediately after replacing the older pointer. Later independent public reads matched both uploaded pointer digests, including scheduled snapshot `0ab20162ee9310adcc29e6b5`. This establishes eventual visibility, not a successful workflow result. In 2.18 the publisher confirms a replaced fixed URL with at most four reads and 2/4/8-second waits only when it returns the exact previously validated bytes for that slot. It never repeats the mutation, accepts different bytes, suppresses transport errors or extends forecast expiry. Each read rechecks freshness; persistent old bytes stop publication and preserve the other valid pointer. Final asset/pointer identity verification and cleanup protections remain required. A successful scheduled run still needs operational verification after deployment of this correction.

Live verification run `41115309459` confirmed that the bounded waits alone still reached `pointer_propagation_pending`. The newly uploaded pointer later matched its public digest `434b4f688d2f032ee764d0e3e36293cc3dd750c79a9a9981a328fef45e253eef` and snapshot `58c4af58f44e532a3e1110f6`. Inspection found that the existing PHP reader already sends `Cache-Control: no-cache` on both public hops, while the Python publisher did not. The publisher now uses the same revalidation header on unauthenticated downloads and their allowed redirects. Metadata authentication, destination allowlists, exact-byte verification, bounded waits and expiry checks are unchanged. A transport regression models stale cached redirect and asset responses and requires revalidation at both hops without forwarding authorization. This is a publication correction; it does not change the application bundle or forecast schema. A successful live corrected publication remains a separate verification gate.

The producer exports the immutable artifact ID returned by its successful upload. The publisher downloads that exact ID from the same workflow run, including when only a failed publication job is rerun. Recomputing an artifact name from the publisher's new `run_attempt` would request a package the successful producer never created.

Public asset verification tolerates a short visibility delay: a public 404 gets at most four reads with bounded backoff, honoring bounded Retry-After values. Error-page bodies are discarded after a bounded read. Missing authenticated draft assets and forbidden responses stop immediately. No pointer advances before all exact bytes pass verification, and response status is retained in failure codes. This does not establish that GitHub's hourly scheduler has executed; production run history must show that separately.

Local validation performs no network mutation:

```sh
python3 scripts/publish_forecasts.py --input /path/to/forecast-output
```

The `--publish` switch additionally requires trusted GitHub Actions context and its workflow token. It must not be used from a local developer environment to bypass workflow authorization.

## PHP reader and private cache

The application endpoint is `api/forecast.php`. Its cache path is the domain's `private/kamptrail-weather` directory, a sibling of `public_html`, never inside the application release tree. If the web root is `/domains/kamptrail.com/public_html`, the path is `/domains/kamptrail.com/private/kamptrail-weather`. The PHP process needs permission to create/read/write that directory. Directories require owner-only permissions (`0700`); cache/lock files are written with `0600`. No moderator, database, service token or other private configuration is used by forecast requests.

The deployed PHP runtime requires PHP 8.3 and the cURL/zlib extensions. It must trust the operating system CA store and permit outbound HTTPS to `github.com` and `release-assets.githubusercontent.com`. Certificate verification remains enabled. Each redirect is separately validated; no caller URL, credential or authentication header is forwarded upstream.

An index request downloads at most the two fixed pointers, never state assets. A global metadata reservation limits attempts to once per 15 minutes and honors longer upstream retry delays. An accepted fresh cached manifest survives upstream failures; absolute expiry always stops matching and serving. State requests only accept a locally retained snapshot and a known state code, then validate compressed/raw hashes, bytes, schema, dates and catalogue identity before atomically caching exact raw JSON. Only two state downloads may run concurrently, with per-state locks and failure backoff. Cache data is bounded at 300 MiB and four retained generation directories; current, previous and incoming snapshots remain protected during expiry-aware cleanup. Manifestless directories left by interrupted writes are removed only after their directory modification time plus the three-hour source lifetime and 30-minute reader grace; cleanup rejects symlinks and unrelated files before deleting any directory contents.

The endpoint returns explicit unavailable/stale responses when evidence cannot be validated. `server_now` anchors the client clock. State ETags identify exact raw bytes; their HTTP freshness never extends past the forecast expiry. Source file digests identify downloaded GRIB input bytes, and model reference times remain separate from NOAA object modification timestamps.

## Verification before enabling live operations

These checks require the real hosting environment and GitHub channel. Offline tests do not prove them:

- Run PHP 8.3 tests with `KT_REQUIRE_PHP=1` so a missing runtime cannot silently skip API checks.
- Verify private-cache ownership, restrictive permissions, TLS trust and outbound access on Hostinger without exposing private files or signed redirect URLs.
- Confirm an application deploy and rollback preserve the sibling weather cache; demonstrate expired evidence remains unavailable after rollback.
- Verify an authorized first publication is public, non-latest, prerelease and mutable under the actual repository policy. Do not disable immutable-release policy to force publication.
- Exercise interrupted pointer replacement and confirm readers can still use the other unexpired pointer; verify expired retired assets are deleted only after reader grace.
- Confirm actual national package size, memory, coverage and provenance against the producer benchmark, then run browser/mobile/accessibility checks and live index/state checks.

A production enablement failure should leave filters selected but evidence unknown. Packaging time, retries, cache fallback and rollback must never renew meteorological freshness.
