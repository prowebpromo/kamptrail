# NWS fire-weather sample capture

Started 2026-10-31. Unblocks the "Fire weather and smoke layers" row (could, partial).

## Why

The remaining-gap audit could not test warning-area geometry because no Red Flag Warning or Fire Weather Watch was active on 2026-10-31. Many NWS fire-weather alerts carry no polygon and list forecast zones instead. A warning-area layer must handle both, so it needs real samples of each.

## What runs

`.github/workflows/capture-fire-weather.yml` runs every three hours and on demand. `scripts/capture_fire_weather.py` requests active Red Flag Warnings and Fire Weather Watches from `api.weather.gov` and, for alerts without a polygon, the geometry of each referenced zone (capped at 60 per run). When any alert is active, the run uploads `alerts.json`, `zones/` and `summary.json` as a 90-day workflow artifact. Each run writes a one-line job summary.

It has read-only repository permission, makes no commits, publishes nothing and is not a trigger for the Hostinger release.

## Next step

Once samples include both polygon and zone-only alerts, copy a small, dated set into test fixtures and define the layer's acceptance criterion before coding. The layer must date each alert, keep warnings separate from closures, and never imply that the absence of an alert means safe conditions.

## Seven-day check, 2026-10-31

The capture job's two runs so far (15:12 and 19:31 UTC) found no active Red Flag Warnings or Fire Weather Watches. That result covers the active-alert snapshot only.

To check the previous seven days, `scripts/check_fire_weather_window.py` queried `https://api.weather.gov/alerts`:

- Window: `start=2026-10-24T20:34:53Z` and `end=2026-10-31T20:34:53Z`
- Event filter: one event per query
- `limit=500`, following every `pagination.next` link

| Event | HTTP | Pages | Alerts |
|---|---|---|---|
| Small Craft Advisory (control) | 200 x6 | 6 | 2,404, including Cancel and Update messages |
| Red Flag Warning | 200 | 1 | 0 |
| Fire Weather Watch | 200 | 1 | 0 |

The control event shows the window, event filter and pagination work. The NWS API's own seven-day record therefore held no Red Flag Warnings or Fire Weather Watches for this window.

Output: `docs/fire-weather/seven-day-check-2026-10-31.jsonl`, sha256 `d85bd340410e856a53b748b21d3c187564e9b60cc60bb509291d4d52a2b178d4`.

R12 fixtures still wait for real captured cases. Synthetic edge cases may be added later, labeled as synthetic.

## Request-header incident, 2026-10-31

One manual exploratory request to `api.weather.gov`, made from the development workspace at about 20:30 UTC, carried the owner's personal email address in its User-Agent header.

- It was a single request.
- No repository file, script, workflow or saved artifact contains the address. A search of the repo, all worktrees and the saved request outputs on 2026-10-31 found none.
- Every scripted request uses a project URL as its contact, for example `KampTrail fire-weather fixture capture (https://kamptrail.com)`.

## NWS 503 recovery, 2026-11-17

[Scheduled run 44126078179](https://github.com/prowebpromo/kamptrail/actions/runs/44126078179) exhausted the original three attempts against the active-alert endpoint with HTTP 503. A manual rerun also received HTTP 503. The original retry waits totaled only six seconds.

The active-alert snapshot now gets six attempts with waits of 5, 10, 20, 40 and 60 seconds. Each request retains its 30-second timeout and 8 MB response limit. Zone fetches keep their original three-attempt budget with 2- and 4-second waits. Logs identify each failed request, attempt and retry delay. HTTP 408, 429 and 5xx responses can retry. Other HTTP errors fail immediately.

A persistent outage still fails the capture. It never produces a successful zero-alert summary. The output format, event filters, zone cap and artifact policy are unchanged. This change improves recovery from brief service failures. It cannot make an unavailable NWS endpoint return data.

Validation: `python -m unittest discover -s scripts/tests -p test_capture_fire_weather.py -v` passes 14 tests, including 503 recovery after the old retry limit, exhausted retries, permanent HTTP errors, transient errors, timeouts, response limits, distinct alert/zone budgets and no false zero-alert result. CI and live workflow verification are recorded in the pull request.
