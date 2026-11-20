# FCC coverage archive reader proof

This branch tests same-origin PMTiles v3 delivery for KampTrail's dated PNG coverage layer. The XYZ pilot remains supported. Nothing on this branch publishes data or deploys the app.

## Archive contract

Schema 1 uses the existing versioned XYZ path. Schema 2 adds an optional `archive` to a carrier region with `format: pmtiles-v3`, `bytes` and a lowercase SHA-256 digest. Region `footprints` are nonwrapping [west, south, east, north] bounds. An Alaska-like region can declare more than one. The archive path is `data/fcc-coverage/<release>/<carrier>/<region>.pmtiles` with the archive digest included in requests and cached tile keys.

Standard 256-pixel PNG tiles use the existing exact palette, including explicitly transparent tiles. All declared native tiles must exist. An HTTP error, absent PMTiles directory entry, unrecognized pixel or failed image decode leaves coverage unavailable. Pixels outside the authoritative source boundary stay unknown.

## Browser and hosting requirements

- The browser uses the npm-locked Protomaps reader and first-party HTTP transport. The browser reads in-range bytes only. It requires exact HTTP 206, Content-Range start/end/total and matching observed length. When a strong ETag is present, subsequent requests must match. HTTP 200 full downloads, redirects and transformed range bodies fail closed.
- Archive sizes/digests, directory integrity and every tile must be checked before the data release. A browser requesting a few byte ranges cannot independently verify a whole-archive hash. Immutable versioned objects and atomic manifest publication are required.
- The reader accepts gzip or uncompressed directories and native PNG payloads. Up to four tile operations run concurrently. The first read is at most 16 KiB. Decoded PNGs use a 256-entry bounded on-device cache with a digest-specific identity. Cached tiles retain their original FCC filing date offline.
- Before public release, verify binary range support through the actual production origin and CDN, including untransformed bytes, 206 start/end/total, headers and cross-request stability. The existing schema-1 data publisher does not publish PMTiles. Budget retained same-origin storage and transfer, and update the publisher, retention and rollback checks before activation.

## Qualification

The branch-only workflow installs pinned dependencies, downloads the approved derived RI archives, and compares every PNG byte to the independent XYZ artifact via a genuine HTTP range server. Desktop and phone-width Chrome check known covered, uncovered and missing points, an offline page restart and an uncached offline point. The Alaska test loads both firms' western and positive-longitude footprints and verifies zero range reads in the intervening gap. It uses qualified derived raster artifacts only. The workflow references short-retention Actions artifacts; regenerate them and update the input IDs when repeating after expiry.

Sources: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md and https://github.com/protomaps/PMTiles/tree/main/js.
