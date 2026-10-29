# Reproduced bugs

## COMMUNITY-01 — S3 — Honeypot exposed to screen readers

Observed on the live 2.6.0 review form: an unnamed text input appeared in the accessibility tree. The DOM helper converted boolean ARIA values to empty attributes. It must retain `aria-hidden="true"` while preserving normal HTML boolean attributes. Fixed and deployed in 2.6.1, with an accessibility-tree regression and scoped axe scan.

## COMMUNITY-02 — S3 — Legacy static host has no PHP backend

The community module on the GitHub Pages origin cannot execute its PHP endpoints. Opening or submitting a contribution must hand off to the current host before collecting content. Deployed in 2.6.1, with tests that no legacy API request or dead contribution form is exposed.

## MVUM-01 — S3 — Canvas roads lack keyboard targets

Found by the new road-detail browser flow. The map defaults to canvas; road paths had no focusable DOM element. The MVUM layer now uses its own SVG renderer and labeled keyboard controls. A road overlapping a campsite marker is opened by keyboard in the regression, without changing marker stacking. PR72's complete 49-flow browser suite passed before merge.

## ROUTE-QA-01 — Test isolation

The new routing fixture initially reused the corrections test's PHP port and reset community fixtures in the shared disposable MySQL database. It now uses a distinct port and resets only routing tables/migration state. MySQL integration and backup restoration pass together. This affected CI fixtures, not production data.
