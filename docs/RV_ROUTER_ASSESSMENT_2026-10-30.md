# Rig-aware router assessment — October 30, 2026

## Decision

**NOT YET PASSED. Hold national clearance-data expansion.**

Managed Valhalla through Stadia Maps is the first candidate to evaluate. It has documented vehicle-dimension options and an HTTP interface that could be called from KampTrail's PHP backend. This is a shortlist decision, not a provider selection, purchase, integration or successful routing test.

No authenticated candidate requests, self-hosted graph builds or production rig-aware routes were run in this assessment. Existing routing remains car routing. The next gate is a bounded, authorized backend trial with reviewed restriction fixtures and confirmed application/storage terms.

## Existing implementation

Reviewed main `8a46972` (which includes the 2.20 implementation and the subsequently merged parity documentation). `api/route.php` accepts points and sends them to the fixed FOSSGIS OSRM car endpoint in `api/_lib/routing.php`. It allows 2–26 stops, normalizes complete route/leg geometry and applies existing request budgets. No height, width, weight or travel-combination length reaches the router.

`rig-profile.js` stores canonical integer millimetres/kilograms locally. Missing measurements are null. Its dimensions are reference values. `data/clearances/RI.json` is a dated OSM display dataset, and `route-clearance.js` finds nearby evidence. Neither modifies the router's graph or enforces a restriction.

The current deployment contract is PHP/MySQL plus static assets on Hostinger. No dedicated routing daemon, graph-storage service or graph-update process is provisioned in this repository. Account infrastructure and private configuration were not inspected. The scratch machine has Java and about 9.7 GiB RAM, but no Docker or Valhalla executable was found. These are scratch observations, not production-host specifications.

## Candidates

| Candidate | Verified capability | Fit and unresolved gate |
|---|---|---|
| Managed Stadia/Valhalla | Documented truck costing and height, width, length and weight parameters. Standard routing permits 50 locations and 5,000 km straight-line cumulative distance. | Leading HTTP candidate. Existing 26-stop trips fit the documented location ceiling. Longer trips need explicit segmentation or rejection. Account access, restriction behavior, geometry normalization, storage and application terms remain untested. |
| Self-hosted Valhalla | MIT-licensed C++ engine with dynamic truck costing. | Requires a separately provisioned persistent engine and graph/update operation. No production capacity measurement or complete-US build was performed. It does not run inside the existing PHP request process. |
| Self-hosted openrouteservice | `driving-hgv` exposes height, width, length, axle load and weight. Java/Docker deployment. | Official sizing guidance makes graph builds a separate resource decision. Repository documentation identifies GPLv3 licensing. No national hardware quote or runtime validation is available. |
| GraphHopper | Apache-2.0 open-source engine; managed directions API and configurable routing profiles. | Backup candidate. Public Basic pricing starts at €69/month, but exact custom-dimension/profile entitlement and persistent output rights have not been verified. Do not treat a fixed truck preset as an exact fit for a user's rig. |

Hostinger's official Web/Cloud support documentation excludes installed compilers and compiled programs and points these workloads to VPS hosting. A new VPS is a separate deployment/operations decision. The evidence does not establish that a suitable VPS already exists in this account.

## Cost and terms gate

Stadia currently lists Starter at $20/month with 1 million credits and Standard at $80/month with 7.5 million credits. Standard routing consumes 20 credits per request. **Calculated upper bounds**, using routing alone, are 50,000 and 375,000 requests/month respectively. All other API usage consumes the same pool. No observed KampTrail traffic model was supplied, so these are not usage forecasts.

The pricing page's storage descriptions do not establish that arbitrary routing output can be retained indefinitely. The terms restrict proxying/caching and describe limited client/offline exceptions. Their documentation also supplies PHP routing examples. Confirm, in writing or an unambiguous applicable agreement, that KampTrail's server-side application adapter, device route cache, GPX export and route-derived elevation/discovery work are permitted. Do not infer permission from a pricing badge. Avoid traffic-influenced variants in the first trial because they carry additional terms and are unnecessary to test dimensional enforcement.

No account was created, key requested, subscription started or provider contacted. This assessment does not authorize a paid plan.

## RV semantics and missing data

A truck profile can exclude roads because goods vehicles are prohibited even when an RV is legally allowed. The trial must compare dimensional enforcement separately from commercial-vehicle classification. Do not weaken access restrictions globally to make an RV route shorter. Valhalla documents restriction-ignoring options and nontrivial default vehicle/axle values. A future adapter must explicitly validate supported measurements and must not silently populate unknown RV fields with truck defaults.

Restriction-free graph edges do not establish measured clearance. Missing, outdated, conditional and direction-specific restrictions remain coverage limitations. An engine avoiding its known restrictions still cannot certify safe passage.

The candidate router uses its own routing graph. Adding points or lines to KampTrail's clearance display will not update that graph. Before importing more states, document whether the chosen provider ingests relevant OSM restrictions and how discrepancies or newer official restrictions can affect routing. If it cannot accept KampTrail's independent restrictions, retain those as separately dated evidence and describe the limitation.

## Trial protocol and acceptance gates

All rows below must pass before scaling clearance data or offering a rig-aware routing mode. A metadata-only assessment cannot satisfy the behavioral rows.

| Gate | Procedure and pass condition | Current result |
|---|---|---|
| Account, cost and retention | Approved bounded quota, applicable commercial/app terms, route-cache/export rights and maximum request rate recorded. No unbounded overage. | Pending |
| Fixture validation | Record exact source object/limit/date, public start/end coordinates outside the restricted edge, permissible detour and provider graph identity/date where available. Confirm snapped endpoints and a baseline route actually traverses the relevant edge. | One dated RI source object identified; endpoint corridor and wider fixture set pending |
| Height boundary | Paired small/oversize rigs on each validated corridor. Oversize route avoids the restricted edge or returns no route. Small control remains usable where allowed. Test both travel directions. | Not run |
| Width, weight and length | At least one independently reviewed restriction fixture per dimension. Change only that dimension between paired requests. Exceeding the limit must avoid/fail. | Fixtures and runtime tests pending |
| Access and unsatisfiable destination | Test a legal RV route with an HGV restriction, a restricted endpoint and a corridor with no permitted alternative. Explain class-related differences. Never return a car route as a successful rig route. | Not run |
| Missing/conditional restrictions | Demonstrate unsupported or absent evidence stays unknown. Document conditional/directional semantics, axle fields and provider defaults. No fit claim from missing tags. | Not run |
| Integration integrity | Normalize geometry/leg boundaries and 2/26-stop requests. Rig or stop edits invalidate old results. Exact cache identity includes provider, profile, every enforced dimension, restriction policy and graph/data identity when exposed. | Not implemented |
| Failure and privacy | Exercise invalid dimensions, unavailable/429/timeout/malformed responses and stale cache. Fail closed in rig mode, preserve user saves, keep keys private, minimize logged coordinates and disclose the new provider/dimension transfer. | Not implemented |
| Deployment operation | Verify public-coordinate requests from Hostinger, observed latency/error behavior, daily cap, rollback and retained car-mode labeling. Do not move the engine into PHP hosting. | Not run |

### First known source restriction

The existing pilot contains [OSM way 1212627497](https://www.openstreetmap.org/way/1212627497), Blackstone Street, with raw `maxheight=9'4"`, normalized as 2.8448 m. Its geometry runs from longitude −71.3850003 / latitude 41.8929753 to longitude −71.3851899 / latitude 41.892954. Source extract time is October 28, 2026; the object edit time is October 2, 2023. These are source dates, not current sign inspections.

Use 2.5 m and 3.0 m heights as the initial paired test **after validating a through-corridor and endpoint snaps**. The two endpoints of this very short object alone are not adequate routing-test endpoints. A route simply becoming longer is not proof of avoidance. Inspect the returned path against the actual restricted edge, using returned edge identifiers where available or reviewed geometry/map matching.

### Execution record

For each approved test, send the same public waypoints with explicit costing and complete validated vehicle fields, save the request body without authentication, normalized response, UTC acquisition time, provider/graph metadata, response hash and expected forbidden edge. Preserve failed requests in the result ledger. Compare paired requests and inspect forbidden-edge traversal. Record each gate as pass, fail or untested. Unrun gates remain untested.

No live endpoint/key is embedded here. A trial runner belongs with the provider adapter once the account/terms and fixture gates pass, rather than an arbitrary-URL script that could send secrets or certify unvalidated coordinates. Existing native/browser regression checks remain release gates after that implementation.

## Sources checked October 30, 2026

- [Valhalla API reference](https://valhalla.github.io/valhalla/api/route/api-reference/): costing, dimensions, restriction flags, truck defaults.
- [Valhalla MIT license](https://github.com/valhalla/valhalla/blob/master/COPYING).
- [Stadia vehicle routing guide](https://docs.stadiamaps.com/guides/getting-the-best-routes-with-valhalla-turn-by-turn-directions-apis/).
- [Stadia standard routing](https://docs.stadiamaps.com/routing/standard-routing/) and [service limits](https://docs.stadiamaps.com/limits/).
- [Stadia pricing](https://stadiamaps.com/pricing/) and [terms](https://stadiamaps.com/terms-of-service).
- [openrouteservice routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options), [system requirements](https://giscience.github.io/openrouteservice/v8.2.0/run-instance/system-requirements), [Docker deployment](https://giscience.github.io/openrouteservice/run-instance/running-with-docker) and [license](https://github.com/GIScience/openrouteservice/blob/main/LICENSE). Sizing examples are guidance, not a KampTrail national capacity benchmark.
- [GraphHopper pricing](https://www.graphhopper.com/pricing/), [API documentation](https://docs.graphhopper.com/openapi) and [open-source license](https://github.com/graphhopper/graphhopper/blob/master/LICENSE.txt).
- [Hostinger supported server capabilities](https://www.hostinger.com/support/which-server-capabilities-are-supported-at-hostinger/).

This is a documentation-only assessment. No API, route mode, rig fields, graph, production data or deployment configuration changed.
