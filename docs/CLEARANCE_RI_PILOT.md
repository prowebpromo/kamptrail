# Rhode Island reported height-tag pilot

This package adds an opt-in map layer for source-reported OSM height tags. It does not match restrictions to a route, compare a rig against a restriction, enforce avoidance, inventory all bridges or establish safe passage. Missing and nonnumeric tags stay unknown. OSRM car routing is unchanged.

## Actual source and result

The existing public Geofabrik Rhode Island PBF was reused without another source download. Canonical URL: https://download.geofabrik.de/north-america/us/rhode-island-latest.osm.pbf. Resolved URL: https://download.geofabrik.de/north-america/us/rhode-island-261028.osm.pbf. Actual size: 52,513,926 bytes. SHA-256: `2e814ed12a070be2112f7e64bd80b05785ca082820c9a83f0c8e7ce9c6ce58b6`. Existing receipt retrieval: `2026-10-30T16:30:30Z`. Independently parsed PBF replication header: `2026-10-28T21:21:02Z`. Neither is an inspection date.

The bounded native import retained **254 exact OSM ways and 1,742 original vertices**, all Census-contained in RI. Geometry is not simplified or moved. Four objects were quarantined: two boundary-ambiguous, one outside RI and one without highway/height-restrictor context. One lifecycle object was excluded. A highway tag does not establish public access or vehicle suitability.

All accepted records have `maxheight`. Of these, 239 have a supported numeric conversion. The remaining 15 contain `none` or `default` and remain numerically unknown. No accepted physical-height, conditional, directional or lane-specific height tags occur in this dated pilot. That absence establishes no physical clearance. The code and native fixtures handle those fields separately without borrowing general/legal values for physical clearance or interpreting conditions, direction or lanes.

Browser asset: 119,065 bytes, SHA-256 `5c32f4cb33c1159dad135408d7810e5717d4bfa2b8866af77b6d2552d9a706e5`, below 512 KiB. Native import took 4.831 seconds under the existing 4 GiB address-space, 12 GiB scratch and 30-minute wall/CPU limits. Sampled peak scratch: 100,663,812 bytes. Full evidence and quarantine: `CLEARANCE_RI_PROOF.json`. Raw PBF, location indexes and intermediates stay outside Git and the browser package.

Live verification example: [OSM way 1212627497](https://www.openstreetmap.org/way/1212627497), Blackstone Street in the extract, raw `maxheight=9'4"`. First vertex: latitude 41.8929753, longitude -71.3850003. This is an imported, uninspected OSM statement. Check current signs and the responsible operator before travel.

## Semantics and parsing

Primary [OSM maxheight guidance](https://wiki.openstreetmap.org/wiki/Key:maxheight) was retrieved through ordinary HTTPS after the web-search tool errored. HTML: 108,387 bytes, SHA-256 `eb2c1168fc644efc434232bd7c871a636356ec00402321258ea95a960f30c805`, wiki revision 3086994. It describes maxheight as generally a legal limit, with physical limits separately identified. Bare numbers use metres; an optional ` m` suffix and ASCII feet/inches are documented. The bounded parser accepts only those forms. Original text accompanies an approximate metric display, with no fit decision.

Primary [OSM physical-height guidance](https://wiki.openstreetmap.org/wiki/Key:maxheight:physical), checked in the same retrieval: 73,472 bytes, SHA-256 `1df0b27e8ef0d7a0f393d1bbc2298236ebafbffb31dcaca33bc7abd0db6d7d15`, revision 2907563. Physical and general/legal tags can coexist and never substitute for each other. Conditional, directional and lane fields remain raw. Unsupported units, ranges, comma decimals, invalid inches, nonnumeric/nonpositive values and values beyond the parser's 100 m bound remain unknown. No route policy follows from conversion.

## Loading, accessibility and offline behavior

The layer is off by default and requests its RI asset only after selection. It draws full accepted way geometry and supplies a keyboard-accessible record selector/details button. Details show raw values, separate physical unknowns, source links, original dates and scope/verification limits. Source text is rendered safely. Open popups survive redraws; the existing campsite popup regression is unchanged.

The loader caps streamed responses and validates identity, geometry, dates and raw/normalized consistency before caching. Failed or corrupt refreshes retain the last validated dated snapshot, labeled saved. Without one, evidence stays unavailable and coverage unknown. The generic worker bypasses the dataset and preserves its separate validated cache. This is not a real-phone offline cold-launch pass.

The importer checks every original vertex against pinned Census polygons. State-border ambiguity, cross-state geometry, unsupported objects and missing highway/height-restrictor context are quarantined. The packager independently validates JSON, checks the asset ceiling and rejects symlinked data. Existing services limits/weekly writer, campsite filters, permissions and rig preferences are unchanged. Parent integration owns the global version bump; this local package retains the reviewed 2.17 handshake until then.

## Rebuild and release gate

```sh
python scripts/build_clearances.py --pbf /absolute/external/RI.osm.pbf --receipt /absolute/external/RI-download.json --scratch /absolute/external/clearance-parse
```

Use the existing checksum-pinned osmium 4.3.2 environment. There is no downloader, provider key or production migration. Native tests cover namespace collisions, full geometry, quarantine, checksum failures and units/unknowns. Browser fixtures cover opt-in loading, mobile/keyboard details, safe rendering, validated-cache fallback and missing coverage. GitHub browser/PHP checks and live UI verification remain release gates.

Local validation on the reviewed rig 2.17 tree: full Node suite 260 tests, 207 passed and 53 PHP-dependent skips; full Python 191 tests completed with 8 optional skips; native-enabled clearance fixture suite 3 passed without skips. Focused source/worker/release checks 21 passed after final loader changes, and the full release build and diff checks passed. One selected browser test was attempted and failed at browser launch because local Chromium 1200 is absent, before application execution. Four browser regressions are included for CI. No local browser pass, production deployment, phone cold launch or parity increase is claimed.
