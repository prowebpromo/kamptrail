# Community backend extension

2.6.0 extends the existing Hostinger PHP/PDO backend. Accounts, payments and email are outside this release. Existing moderator authentication and CSRF protection are reused.

- Server validation and prepared statements cover every public input.
- Author management requires a random private code, stored only as a server-side hash. Automated tests reject another code and unauthenticated edits/deletes.
- Review publication and photo approval are independent. Pending, hidden, rejected and author-deleted content are excluded from public delivery.
- Photo bytes are decoded and re-encoded, then kept in private database storage. The hardened JPEG response replaces a separate media bucket for this shared-hosting implementation.
- Rate limits, upload limits, bounded storage and moderator status audit are implemented.
- Privacy and device-code limitations are explained in the live About dialog and contribution form.
- PR and publication workflows require PHP/GD tests and a MySQL integration suite before publishing.
- Hostinger backup status and production migration/smoke checks must be recorded at deployment. A host backup restore is not implied by passing API tests.

See `docs/COMMUNITY_REVIEWS.md` for operation, storage and backup details.

## 2.15 permission extension — verification pending

Dedicated permission reports, flags and audit records reuse Hostinger PHP/PDO and moderator authentication. No new provider credentials, account registration, payments, uploads or email processor. The additive 005 migration uses the existing authenticated migration path. Public reads and owner actions use JSON POST bodies; bearer management tokens are hashed server-side, omitted from URLs and never included in public reports or audits. Source evidence remains readable independently of the database.

Local build and JavaScript checks pass. Real PHP/MySQL ownership, race, deletion and moderator tests and browser behavior are required in CI before release. Production backup status, migration and live checks are still pending; these are not claimed complete by a local test run.
