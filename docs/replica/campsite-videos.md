# Moderated external campsite videos

Prepared 2026-10-30. This package adds one optional YouTube attachment to a required firsthand campsite review. It does not add a standalone video feed or fabricate any production contributions.

## Scope and operating cost

The stored attachment is an 11-character YouTube video ID in the existing observation record. Input accepts only that ID, an exact HTTPS youtube.com watch URL (with optional www), or an exact HTTPS youtu.be URL, without extra query parameters. No arbitrary HTML, server URL fetch, remote thumbnail, upload, transcoding, API key or paid video service is introduced. Existing hosting/database work and human moderation still have costs. YouTube availability, advertising, consent, restrictions and future terms remain external dependencies; this is not a zero-cost or privacy guarantee.

Before Play, the review shows text and a canonical external link. Play makes a no-store publication check for that specific review/site/video, then mounts the fixed youtube-nocookie embed. The notice explains third-party data collection, ads and connection requirements. A failed, changed or offline check creates no player. Closing the dialog, opening another community view or starting another video destroys the existing iframe. A delayed response cannot mount in a departed view. An already loaded third-party player cannot be guaranteed to revoke immediately when a moderator changes publication remotely.

Video recorded and posted dates are unknown. Review visit dates are the author's report and are not presented as video dates.

## Moderation and integrity

Every accepted owner edit returns the entire review, its video and photos to pending. Omitting the new video field preserves an existing attachment for older clients; an explicit empty value removes it. Author deletion clears the metadata. Pending, hidden, rejected and deleted reviews fail the independent pre-play publication check. Existing reporting routes video concerns to the review queue; a report does not automatically unpublish content.

The moderator sees the video URL alongside the exact review and observation snapshot. Publishing an attached video requires an explicit confirmation that the moderator watched it and checked relevance and permission. A SHA-256 snapshot binds the form to the exact displayed review, observations and photo metadata. All review status decisions reject a missing or stale hash with HTTP 409, including same-second video replacement. Hash construction uses the captured display data rather than re-reading observations during page rendering.

Public fields are explicitly whitelisted and normalized before discovery grouping; unknown/private metadata and video IDs are excluded. Matching dated observation cohorts combine regardless of video, and retain numeric scores. Media-only records create no observation cohort. Monthly categorical summaries separately project their axes before grouping, preserving counts for legitimate numeric/video reviews. The 10,000-group limit applies after projection. Seasonal and discovery counts are visit ratings, not distinct people.

## Verification and handoff

Node tests exercise pre-play behavior, fixed embed URL, failed/changed/offline checks, navigation/close teardown, replacement playback, delayed responses and Spanish text. PHP-backed tests cover strict URL rejection, pending publication, video-review confirmation, same-second stale and missing hashes for every status, preservation/removal, hidden/rejected/delete withdrawal, score cohorts and projected group limits. Browser fixtures cover mobile fit, accessibility, explicit Play, teardown and Spanish author editing.

The earlier isolated video checkpoint passed its local Node and Python checks. Final integrated evidence is recorded in 2026-10-30-parity-2.19-candidate.md. Local PHP-dependent cases remain skipped.

This environment has no PHP executable or local browser. PHP/SQLite, MySQL and Chromium execution must pass the existing CI workflow on the integrated commit before release. No local package/browser download was attempted. The integrated 2.19 candidate coordinates its module identities, asset query versions and worker47 with the main release; no deployment is performed here.
