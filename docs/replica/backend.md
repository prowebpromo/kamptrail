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
