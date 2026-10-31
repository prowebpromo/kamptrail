# Cell coverage stop-gap, 2.27.0

Owner decision, 2026-10-31: keep the nationwide carrier coverage overlay on hold pending FCC ticket #64052. In the meantime, give each campsite a link to the FCC's public mobile map with its coordinates available to copy, and keep KampTrail's dated camper signal reports visible beside it. No recurring downloads.

## Acceptance criterion (defined before implementation)

Every campsite popup has a "Cell coverage" section that shows:
- KampTrail's published camper signal reports for that campsite, each with carrier, signal level, setting when reported, visit date and report count, newest first, labeled as visit experience and not prediction. When none exist it says so.
- A "Check carrier coverage (FCC map)" link to the FCC National Broadband Map, opening in a new tab with `noopener`.
- The campsite coordinates as text and a "Copy coordinates" control. A failed copy shows the coordinates instead.
- A note that the FCC map shows carrier-modeled coverage, not a guarantee.

KampTrail sends nothing to the FCC. Coordinates leave the device only if the visitor pastes them into the FCC site. English, Spanish and French.

## Why a plain link

The FCC help article describes address search and documents no deep-link format, so the link opens the map's home page. Its Provider Detail view compares up to three providers, and the mobile map can show outdoor stationary or in-vehicle coverage. Whether the FCC search box accepts raw coordinates was not verified here.

## Change

- `data-loader.js`: coverage section in the popup and the copy handler.
- `locale.js`, `locale-fr.js`: eleven new strings.
- `app.css`: section styles.
- `tests/browser/discovery.spec.js`: dated reports, the FCC link attributes, coordinates copied exactly, and the empty state.
- Version 2.27.0, service worker cache `kt-v58`.

## Checklist effect

None. "Cell carrier coverage overlay" stays "no" and "Filter by cell signal" stays partial. A link to another site is not a KampTrail coverage layer.

Source: [How to Use the FCC's National Broadband Map](https://help.bdc.fcc.gov/hc/en-us/articles/10467446103579-How-to-Use-the-FCC-s-National-Broadband-Map), checked 2026-10-31.
