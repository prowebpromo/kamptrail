# RME section assessment for KampTrail

Reviewed November 4, 2026. Scope is the public web experience and useful additions to KampTrail for RV trip planning. Public marketing and tool pages establish what RME advertises. Its signed-in native app, user population, transactions, moderation performance, and feature quality were not tested.

## Decisions and implementation

| RME section | Public purpose | KampTrail decision |
| --- | --- | --- |
| Roam | Places, services, filters, saved spots and optional journey recording | Retain the existing map, filters, services and saved stops. Journey recording is a distinct future proposal requiring evidence of demand. |
| Meet | Traveler profiles, discovery, messaging and location sharing | Defer. A useful network needs participants and sustained moderation, privacy controls, reporting and abuse response. Existing trip-planning demand does not establish demand for a new social network. |
| Explore | User stories, photos, videos, builds and creator profiles | Surface existing BoB guides and KampTrail place-level contributions. A standalone social feed remains a separate product decision. |
| Market | Member classifieds, seller messaging and scam reporting | Defer pending demonstrated seller/buyer demand and an operating plan for moderation. No listings or transactions are created in this release. |
| Creators | Recruit experienced users, collect feedback and offer possible editorial exposure | Use the existing beta-testing invitation and feedback path. Creator profiles, promotion commitments and compensation are not introduced. |
| Blog | Educational content and app comparisons | Link to the established BoB content from a task-based Guides directory. Preserve the existing canonical articles. |
| News | Editorial stories, app updates and external headlines | Publish KampTrail product updates in its release history and link to BoB for editorial content. A general news feed needs a distinct editorial and maintenance case. |
| Events | Dated gatherings, organizer details and caravans | Defer a standalone directory until its purpose, official-source coverage and upkeep are established. Existing BoB event coverage does not establish a need for attendee accounts or event chat. |
| Free tools | Calculators, planners and printables | Publish a directory of existing KampTrail and BoB resources, with clear labels for calculators, apps, PDFs and written formulas. Further tools require a verified functional gap. |

## Existing BoB resources to reuse

| Resource | Verified public format | Destination |
| --- | --- | --- |
| Trip costs | Interactive calculator in a guide | https://boondockorbust.com/boondocking-guide/how-much-does-boondocking-really-cost-no-b-s-breakdown/ |
| Off-grid power planning | Interactive planner in a guide | https://boondockorbust.com/boondocking-guide/innovative-power-solutions-for-efficient-rv-boondocking/ |
| RV maintenance | Separate web app described by an introduction, with email sign-in and connection requirements | https://boondockorbust.com/resources/free-rv-maintenance-tracker-ditch-the-spreadsheet/ |
| Water and dump discovery | Interactive location finder | https://boondockorbust.com/rv-water-dump-station-finder/ |
| Trip planner and checklists | Six printable, static PDFs | https://boondockorbust.com/resources/the-complete-rv-vanlife-planner-free-2026-templates/ |
| Freshwater duration | Written formula and worked examples | https://boondockorbust.com/resources/rv-boondocking-water-management/ |
| Membership economics | Written break-even formula and worksheet | https://boondockorbust.com/resources/rv-membership-break-even-calculator/ |

These format checks do not constitute a calculation audit or an end-to-end test of every external BoB tool. The supplied search exports are partial search-performance lists and cannot establish that an unlisted tool is absent. Their private metrics and raw rows are not copied into this public repository.

## Public screen inventory and sources

| ID | Public screen | Source | States observed |
| --- | --- | --- | --- |
| S01 | Roam feature page | https://www.roammeetexplore.com/roam | Public product description and FAQ |
| S02 | Meet feature page | https://www.roammeetexplore.com/meet | Public product description and FAQ |
| S03 | Explore feature page | https://www.roammeetexplore.com/explore | Public product description |
| S04 | Market feature page | https://www.roammeetexplore.com/market | Public product description and FAQ |
| S05 | Creator invitation | https://www.roammeetexplore.com/creators | Public invitation, process and limits |
| S06 | Blog index | https://www.roammeetexplore.com/blog | Public article list |
| S07 | News index | https://www.roammeetexplore.com/news | Public story categories and external headlines |
| S08 | Events index | https://www.roammeetexplore.com/events | Public dated listings, source/arrival limitations |
| S09 | Tools index | https://www.roammeetexplore.com/tools | Public categorized tool list |

RME's tools index also advertises a 3D van planner, build-cost and insulation estimators, payload, wiring/fuse, monthly sun-hours, propane, monthly living-cost and affordability calculators, a buying checklist, bill-of-sale form, and listing builder. Their presence does not establish usefulness to KampTrail users or absence from BoB. They remain candidates for separate functional and source review.

## Flows, components and data

F01 Camper chooses a planning task. KampTrail navigation leads to Free tools, a clearly labeled resource card, and the existing tool or PDF. The visitor can return to the map through the site navigation. External BoB destinations are stated on the cards.

F02 Camper learns a planning skill. Guides leads to an existing short KampTrail video or a BoB guide, with source/context limitations visible. Canonical content stays at its existing address.

F03 Tester reports a gap. The beta panel or directory feedback link opens the existing feature-suggestion or bug-report dialog. No account is introduced.

Shared components are the site navigation, current-page indicator, grouped resource cards, resource-type labels, footer links, and existing feedback controls. The new directories are static and have no loading, sign-in or form-submission states. They remain readable if JavaScript is disabled.

Directory entries have a title, resource type, description, destination and action label, explicitly authored in HTML. No new database, background importer, social identity, location-sharing entity or payment entity is required. RME's native data model is unverified and is not inferred for implementation.

## Acceptance and scope

The directories must ship with their stylesheet, be linked from the map, work at desktop and mobile widths without horizontal overflow, retain visible keyboard focus, and clearly distinguish external services and resource formats. Local links and anchors must resolve. Offline caching supports the directory itself, while external BoB resources require their normal connection and access conditions.

The directories are initially English, consistent with the existing standalone how-to and legal pages. The map navigation receives Spanish and French labels. Native-speaker review remains a separate outstanding review.

This is a small directory and navigation package. Social accounts, messaging, location sharing, classifieds and community events would be substantially larger packages with separate operating needs. RME's copyrighted copy, artwork, user content, network, private APIs and code are not reused. This assessment does not change the approved FreeRoam parity denominator or score.
