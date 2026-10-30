# Moderated visitor YouTube links

This 2.19 candidate supports one optional external YouTube video on a campsite review. This is a link and click-to-load player, not a video-file upload or complete media-hosting pipeline. No database migration or new provider credential is required.

`youtube_video` accepts an exact 11-character YouTube ID, canonical HTTPS `youtube.com/watch?v=ID` URL, or exact HTTPS `youtu.be/ID` URL. Extra parameters, credentials, other providers, arbitrary embed URLs and markup are rejected. The server stores only the validated ID in the existing private observation row. Output reconstructs fixed provider URLs and returns media separately from condition evidence.

New reviews and attached videos stay pending until whole-review moderation. Public edits return both to pending. Authors can clear the video field, remove the attachment, report the review or delete their review. Older clients omitting the video field retain its saved value. Explicitly empty input removes it. Deleted reviews clear the observation/media row. Moderators see an ordinary YouTube link without an automatic thumbnail or player.

Whole-review decisions bind to a SHA-256 digest of actual current review fields, observations/media and photo rows. A changed review, including same-second video replacement, returns 409 for fresh inspection. Existing CSRF, authentication and audit controls remain.

No YouTube player, thumbnail or external video request is created before Play. Play first rechecks the exact review's current publication and unchanged video ID through a no-store first-party GET. Offline/failed checks, unpublished reviews and changed videos never create a player. A late response cannot mount after leaving the review. Closing or navigating removes the iframe.

The iframe uses a fixed youtube-nocookie.com embed, sandbox, title and referrer policy. Visitors are told playback loads a third party that may show advertising and collect information. External content can change after moderation. Posted and recorded dates are unknown; a review's visit date does not establish a video's date.

Media IDs are projected out before discovery cohorts and visit-month condition counts. Different videos do not create different condition cohorts. Existing query/group bounds remain fail-closed. A video-only review contributes no condition count. No amenity, fee, permission or safety claim is inferred from media.

Node tests cover fixed URLs, no pre-Play request, failed publication checks, stale responses and Spanish controls retaining visitor words. Native PHP/MySQL tests cover validation, moderation, same-second replacement, legacy edits, condition/monthly projection and removal. Four added browser flows cover mobile/accessibility, offline/unpublished checks, delayed responses and Spanish author management. Native/browser checks remain CI gates here.
