# FCC carrier coverage — access checkpoint

Checked 2026-10-28. No carrier layer is shipped yet.

The FCC public map's download page returned Access Denied in this browser, including one reload. No attempt was made to evade that restriction. The documented public-data API requires an FCC user account. No FCC account/API credentials were available in this session, and redistribution/usage conditions for the intended mobile datasets have not been verified.

Official sources:
- https://help.bdc.fcc.gov/hc/en-us/articles/20044640394395-How-to-Create-an-FCC-User-Account
- https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions
- https://www.fcc.gov/sites/default/files/bdc-public-data-api-spec.pdf (not retrievable here)

Resume with authorized FCC download/API access or a user-provided current mobile coverage export plus its usage documentation. Verify mobile-data redistribution separately; do not infer it from Location Fabric licensing. Record provider identifiers, technology, data-as-of date and modeled service assumptions. Simplify/tile on the server or in builds; load viewport tiles only. Keep carrier models distinct from camper-reported signal. Model coverage is not a promise of usable service inside an RV.

Do not add a decorative coverage toggle, substitute an old mirror, invent carrier polygons, or mark parity complete until current licensed data is loaded and tested. This is the only external-access blocker among the four requested packages.
