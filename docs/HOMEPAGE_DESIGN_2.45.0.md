# Homepage design 2.45.0

Owner instruction, November 4, 2026: replace the illustrated treatment with a photorealistic appearance.

The hero uses an original generated, photorealistic decorative lakeside forest landscape. It is not evidence of a particular campsite or a photograph taken at Moab. The separate product preview is an actual screenshot of the live KampTrail map near Moab, Utah, captured November 4, 2026. No map interface, campsite counts, ratings or features were generated. OpenStreetMap and USGS credits remain visible.

## Asset record

- `media/hero/lakeside-photo.webp`: 1536 x 1024, generated through the built-in image tool. Direction: realistic forest and lake, modest mountain backdrop, gravel shore path, soft morning light, neutral natural colors, shadowed forest on the left for readable text, no people, vehicles, lettering or interface. Converted to WebP. The rejected illustration is not shipped.
- `media/hero/moab-map-preview.webp`: 750 x 1148, actual KampTrail Satellite map screenshot, center 38.57332, -109.54984. Preserve on-image and adjacent OpenStreetMap / USGS attribution.
- Both images are packaged but excluded from mandatory offline shell installation. Decorative imagery must not prevent installation.

## Implementation

Preserved the beta copy and calls to action. Used forest green, warm amber and ivory, stronger type hierarchy, a photographic background and a product phone frame. Grouped the existing map toolbar with search without changing control IDs or behavior. Version 2.45.0, service-worker cache kt-v79. No production datasets, listing identity, route semantics or clearance policies changed.

## Local acceptance

- Screenshots reviewed at 1440 x 1000, 390 x 844 and 320 x 740. No document overflow at those widths in English, Spanish or French. Translated hero fragments display. Native-speaker translation review remains pending.
- Existing feedback browser tests cover accessibility, map height, page scrolling, touch gestures, feedback and resource navigation. The independent-list scrolling test now first scrolls the list into the viewport before sending a wheel event, because the redesigned hero precedes the map.
- Exact PR-head CI, deployment source and live desktop/mobile acceptance are recorded in the PR release record after deployment.
