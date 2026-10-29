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

## FCC ingestion draft — 2026-10-29

- [x] Hidden private-terminal credential entry, mode 700/600, outside repo/web root.
- [x] Fixed HTTPS origin, no credential-bearing redirects, fixed error messages.
- [x] Shared request spacing, bounded downloads, private provenance/hash sidecars.
- [x] Six isolated security tests pass locally.
- [ ] Current official API specification reconciled with request/response contract.
- [ ] Real server authentication and mobile availability download verified.
- [ ] Actual mobile geometry schema, CRS and filing-date processing validated.
- [ ] Dated viewport layer, browser tests, refresh, production deployment.

Owner reports enabled Public Map Data APIs and reviewed availability-data terms;
credentials remain private and unavailable to this session. The local extension
still reports missing originating browser context. No production coverage toggle
or fake data was added. Full Python suite could not complete locally because the
existing fetcher tests require `requests`, absent from this runtime (three imports).
See `docs/FCC_COVERAGE_ACCESS.md` for private setup and remaining gates.
