# Homepage water and dump label — 2.46.7

Owner requested the homepage shortcut read “Water & Dump Stations” and confirmed its existing KampTrail map destination must remain unchanged (`./?mode=dump-stations`). Spanish and French labels are included. Application and cache versions advance together to deliver the updated label to returning visitors.

Validation: 49 existing homepage, locale, service-worker and website checks passed. Exact-head CI and live desktop/mobile acceptance are pending.

The first full run passed 244/245 browser tests. At 390×844 the final shortcut extended 4.77px below the viewport in CI. Reduced mobile hero vertical padding by 8px on each side, retaining button sizes and the first-screen shortcut requirement. No assertions were relaxed.
