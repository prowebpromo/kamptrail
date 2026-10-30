# Nearby route height evidence

This route dialog reuses the same validated `data/clearances/RI.json` Rhode Island pilot as the existing map layer. It does not create a second dataset. The feed has 254 source-tagged OSM objects, dated in the source metadata; see `CLEARANCE_RI_PROOF.json` for inclusion and quarantine details. This pilot is geographically limited and incomplete.

The dialog compares full feature geometry to calculated car-route geometry using an approximate 100 m threshold. A nearby feature may belong to a different road, direction, or grade-separated crossing: the route has no OSM way identity. Raw legal, physical, conditional, directional and lane tags are displayed without deciding their meaning, and unknown values stay unknown. A missing match does not establish clearance; the car router does not enforce dimensions or road restrictions.

The feed is streamed under a 512 KiB cap and validated using the map layer's validator. A search is capped at five million geometry operations and 500 matches; exceeding a cap or failing to load the feed yields unavailable rather than partial results. It does not use the map's saved offline cache. It discards results if the itinerary or calculated route changes while loading. Browser fixtures cover raw tags, no-match uncertainty, delayed invalidation, and scoped accessibility; CI and live verification are still required.
