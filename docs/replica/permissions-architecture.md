# Permissions extension architecture

This extends the existing Hostinger PHP/PDO application. The normative scope and wire contract are in `docs/PERMISSIONS_CONTRACT_2.15.md`. Existing database connection, moderator session, CSRF protection and migration runner remain the platform. There is no account, payment, email or photo subsystem in this extension.

- `permissions.js`: one accessible dialog; explicit scoped source evidence, public report pagination and owner management. No cached public reports.
- `api/permissions.php` / `_lib/permissions.php`: validated no-store JSON transport and owner authorization. Dedicated reports, flags and audit tables with optimistic versions.
- `_lib/permissions-admin.php`: queue and decisions behind existing moderator authentication and CSRF checks.
- `_lib/permission-evidence.php`: local validated official evidence and exact catalogue identity resolution; no request-driven remote URL fetch.
- `scripts/build-permissions.js`: protected release lookup generated from the current campsite search index and validated services snapshot. These generated files are not a second public catalogue.

Public source evidence is independently useful while the database is unavailable. Report availability is explicit. Permission conclusions are computed when read and never embedded in saved trip snapshots. Existing saved stops reopen the live panel.
