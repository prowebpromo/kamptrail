# Reproduced bugs

## COMMUNITY-01 — S3 — Honeypot exposed to screen readers

Observed on the live 2.6.0 review form: an unnamed text input appeared in the accessibility tree. The DOM helper converted boolean ARIA values to empty attributes. It must retain `aria-hidden="true"` while preserving normal HTML boolean attributes. Fixed in the 2.6.1 branch with an accessibility-tree regression and scoped axe scan; deployment verification pending.

## COMMUNITY-02 — S3 — Legacy static host has no PHP backend

The community module on the GitHub Pages origin cannot execute its PHP endpoints. Opening or submitting a contribution must hand off to the current host before collecting content. The 2.6.1 branch provides that handoff and tests that no legacy API request or dead contribution form is exposed. Deployment verification pending.
