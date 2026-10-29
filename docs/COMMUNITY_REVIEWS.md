# Camper reviews and photos (2.6.0)

Campers can read approved reviews and photo galleries from a campsite popup. Contributions require a public nickname, rating, visit date, firsthand text and confirmation that the author has permission to publish the photos. Browsing and contributing do not require accounts or email addresses.

## Author workflow

- Submit a review with up to three JPEG, PNG or WebP photos. The API returns a random 256-bit management code. Only its SHA-256 hash is stored server-side.
- My reviews keeps codes on this device. The confirmation and management screens also expose an explicit copy control so authors can retain their own access. Entering a code on another device restores management access. Codes are sent in Authorization headers, never URLs.
- Authors can edit and resubmit. The review and all retained photos immediately return to pending, including formerly approved photos. Authors can remove individual attachments or delete their review and all its photo bytes.
- There is no email recovery. Losing both the saved device data and the copied code loses self-service management access. The public report control still reaches moderators.

## Moderation

The existing moderator login at `/api/admin.php` has a **Reviews, photos and reports** link. Apply `002_community` there before opening community contributions. Existing campsite corrections remain available while this additive migration is pending. It adds tables and indexes without changing the existing contributions tables.

Review states are pending, published, rejected and hidden. Photo states are independent. Publishing a review never publishes its photos. Public lists include published reviews only; photo delivery requires both review and photo to be published. Pending photo previews require the moderator session. The pending queue includes reviews with pending photos even when their text is already published.

Moderators can reject with a note to the author, hide published content, restore hidden content, inspect reported reviews/photos and mark a report resolved. Status decisions are logged with the moderator and UTC time. Report resolution does not itself hide content. Author deletion removes text, public nickname and photo bytes, and cannot be undone through moderation.

## Image checks and storage

- Maximum 3 photos per review, 6 MiB input per photo, 16 million pixels and 10,000 pixels on either axis. A memory-budget check can reject a smaller image on a constrained PHP runtime.
- File signatures and decoded image types must agree. SVG, GIF, HEIC, corrupt images and executable files are rejected. JPEG, PNG and WebP are decoded to pixels, resized to at most 1600 pixels on the long edge and encoded into a fresh JPEG. Original metadata, filenames and appended bytes are not retained. EXIF orientation is honored when the PHP EXIF extension is available.
- Encoded JPEGs are stored in a bounded MySQL MEDIUMBLOB table, outside the Git deployment lifecycle. No upload directory or original file is publicly accessible. `photo.php` streams authorized bytes with `image/jpeg`, `nosniff`, `no-store`, same-origin resource policy and a sandbox CSP. This avoids adding a storage service or a photo subdomain to the existing shared-hosting deployment.
- The hard ceiling is 256 MiB of encoded photos, including hidden/rejected images retained for moderation recovery. Optional private config `community_storage_bytes` can lower it. Hitting the ceiling rejects the complete attempted upload with an actionable message. Text-only reviews still work. Author removal releases photo quota. Moderation shows usage.
- No virus-scanner or automated visual-content classifier is claimed. Structural image validation and re-encoding run automatically. A human moderator checks the image content before publication.
- Five new reviews and five content reports per connection per hour. Image decoding has a separate ten-upload-attempt limit per hour. Mutation quota/rate checks serialize through a database row. Raw IP addresses are not stored in community tables.

## Operations and backup

Use the Hostinger database backup facility for the application database, not just Git or public_html file backups. All seven community tables must be included: reviews, photos, reports, events, audit, storage, plus schema_migrations. The database also contains the existing submissions and moderation_log tables. Photo byte data is in the database; a separate image directory is not required.

Before the migration, confirm an available database backup. Before wider promotion, take a new backup containing community tables and restore it into an isolated database. Verify review counts, moderation states, photo byte hashes and the storage counter there. Do not test restore against the production database. Database snapshots can contain deleted content until their normal retention expires. Keep backup access restricted.

## API

- `GET api/community.php?site=ID`: average/count and ten published reviews, each with approved photo metadata. `next_before` supports pagination.
- `GET api/community.php` with `Authorization: Bearer CODE`: one author's own review, status, note and attachment state. The code is not accepted as a URL parameter.
- `POST api/community.php` multipart: submit, edit, delete, or report. Edit/delete require the code in the Authorization header. Edits cannot move a review to another campsite.
- `GET api/photo.php?id=ID`: published image only. Moderator previews additionally require the authenticated moderator session and `preview=1`.
- `GET api/health.php`: additive `community` and `photo_processing` readiness fields. Missing extensions disable photo upload with an explicit message; reviews can still be submitted without attachments.

Private management responses and images bypass the service worker and use no-store headers. Community content requires a connection; the existing map/offline catalogue behavior is unchanged.

## Validation

`npm test` exercises PHP HTTP workflows against SQLite when PHP, GD and mbstring are available. CI sets `KT_REQUIRE_PHP=1` so missing extensions fail instead of silently skipping. Both PR validation and Hostinger publication repeat the community suite against a disposable MySQL 8 service, then use mysqldump to restore a copy and compare every table, including photo byte hashes and storage accounting. Browser tests cover desktop reading/reporting, a photo submission and device management code, plus the mobile failure/recovery interface. No production camper review is used as test data.
