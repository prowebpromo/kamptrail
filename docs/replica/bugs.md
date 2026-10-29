# Reproduced bugs

## COMMUNITY-01 — S3 — Honeypot exposed to screen readers

Observed on the live 2.6.0 review form: an unnamed text input appeared in the accessibility tree. The DOM helper converted boolean ARIA values to empty attributes. It must retain `aria-hidden="true"` while preserving normal HTML boolean attributes. Fixed and deployed in 2.6.1, with an accessibility-tree regression and scoped axe scan.

## COMMUNITY-02 — S3 — Legacy static host has no PHP backend

The community module on the GitHub Pages origin cannot execute its PHP endpoints. Opening or submitting a contribution must hand off to the current host before collecting content. Deployed in 2.6.1, with tests that no legacy API request or dead contribution form is exposed.

## MVUM-01 — S3 — Canvas roads lack keyboard targets

Found by the new road-detail browser flow. The map defaults to canvas; road paths had no focusable DOM element. The MVUM layer now uses its own SVG renderer and labeled keyboard controls. A road overlapping a campsite marker is opened by keyboard in the regression, without changing marker stacking. PR72's complete 49-flow browser suite passed before merge.

## ROUTE-QA-01 — Test isolation

The new routing fixture initially reused the corrections test's PHP port and reset community fixtures in the shared disposable MySQL database. It now uses a distinct port and resets only routing tables/migration state. MySQL integration and backup restoration pass together. This affected CI fixtures, not production data.

## MAP-FOCUS-01 — S2 — Old popup retained after explicit campsite navigation

Live2.8.0: open Denver Creek, search Pawnee and select it. The map moved to Pawnee while Denver Creek remained in the popup, so Save stop still targeted the first place. The guard intended to preserve popup content during background clustering also blocked intentional navigation. 2.8.1 closes the previous popup on an explicit focus and cancels older pending focus callbacks. A two-campsite browser regression verifies the new heading.

## MVUM-02 — S3 — Ambiguous forest alias selected a sibling unit website

The official forest index can repeat one administrative name for several destination URLs. Choosing the first exact alias could label a grassland destination as another ranger district's forest link. 2.8.1 links only when matching candidates have one unique URL. Source metadata and coverage labels remain available; no URL is guessed.
