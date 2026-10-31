# NWS fire-weather sample capture

Started 2026-10-31. Unblocks the "Fire weather and smoke layers" row (could, partial).

## Why

The remaining-gap audit could not test warning-area geometry because no Red Flag Warning or Fire Weather Watch was active on 2026-10-31. Many NWS fire-weather alerts carry no polygon and list forecast zones instead. A warning-area layer must handle both, so it needs real samples of each.

## What runs

`.github/workflows/capture-fire-weather.yml` runs every three hours and on demand. `scripts/capture_fire_weather.py` requests active Red Flag Warnings and Fire Weather Watches from `api.weather.gov` and, for alerts without a polygon, the geometry of each referenced zone (capped at 60 per run). When any alert is active, the run uploads `alerts.json`, `zones/` and `summary.json` as a 90-day workflow artifact. Each run writes a one-line job summary.

It has read-only repository permission, makes no commits, publishes nothing and is not a trigger for the Hostinger release.

## Next step

Once samples include both polygon and zone-only alerts, copy a small, dated set into test fixtures and define the layer's acceptance criterion before coding. The layer must date each alert, keep warnings separate from closures, and never imply that the absence of an alert means safe conditions.
