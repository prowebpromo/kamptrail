# FCC mobile coverage integration

## Current status

The protected credential form is deployed. Native browser submissions have a
regression test covering the former null-origin failure and a successful save
using synthetic credentials. Production credentials are never included in tests.

A real server-side authentication attempt passed local validation but the FCC
service denied authentication or access. Successful FCC authentication is still
unverified. No mobile coverage geometry has been downloaded or published.
Temporary authentication checks have stopped.

The request contract matches the official FCC specification. A denial alone does
not distinguish an invalid credential from account permissions or a service access
restriction. Verify the FCC account username before changing credentials.

## Security design

The importer uses the official HTTPS API, constrained routes and named
authentication headers. Credentials stay in private server storage outside the
web root. They are never returned to the public application, committed to source,
placed in URLs or recorded in logs. Redirects are refused to prevent credential
forwarding. Error reporting uses fixed categories without raw upstream bodies.

The form requires moderator authentication, CSRF validation and same-origin
submission checks. Null and foreign origins remain rejected. Secret fields are
masked, never prefilled, and never reflected in responses.

## Remaining work

1. Resolve the authentication/access denial through the authorized account.
2. Obtain Mobile Broadband availability metadata and a provider/state pilot.
3. Validate the downloaded geometry, CRS, carrier and technology fields.
4. Produce bounded map tiles with filing and retrieval dates and source hashes.
5. Test carrier switching, missing coverage, offline behavior and mobile access.
6. Publish validated coverage and its modeled-service limitations.
7. Enable scheduled refresh only after transfer, processing and publication work.

BDC availability and CostQuest Location Fabric have separate licensing. This
integration is scoped to mobile availability. It does not request Location Fabric
or consumer challenge records. Coverage does not establish measured signal,
indoor RV reception or usable service at a campsite. Route clearance checks are
a separate feature.

## Official references

- https://us-fcc.app.box.com/v/bdc-public-data-api-spec
- https://help.bdc.fcc.gov/hc/en-us/articles/6789299021723-Key-Reference-Documents
- https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions
