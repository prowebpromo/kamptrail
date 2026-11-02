# Private feedback intake (2.39.0)

Kamptrail.com is the primary traffic destination. The map stays immediately available. **Feedback** beside the introductory text opens a private bug / feature form, with no account and optional email. Campsite facts still use **Suggest a fix** on the listing.

Public entry points: `https://kamptrail.com/#feedback=bug` and `https://kamptrail.com/#feedback=feature`.

## Privacy and handling

- Reports enter the existing `api/admin.php` moderation queue. Nothing is posted publicly or applied to the map automatically.
- Basic diagnostics default off. Explicit opt-in shares only version, language, browser family, viewport width/height and online/offline status. The server independently permits only these fields. It discards map coordinates, listing IDs, source notes and problem flags from app feedback.
- Optional email is for manual follow-up. No automatic email is sent to submitters. Optional owner-only notices are described below.
- Private status links contain a random 128-bit token. Anyone with that link can see status and the moderator's public note, not the message, email or diagnostics. Avoid sensitive material in moderator notes.
- **My reports** keeps the last 50 receipts on the submitting device. A private status link also works without local storage. Clearing storage removes the local receipt, not the queued report.
- Existing spam controls still apply: honeypot, 3-second minimum form time and 5 reports per connection per hour. No offline submission queue: a failed send keeps the entered text while the form stays open and offers the verified contact form.

## Operating the queue

Check received reports each working day during launch. Reproduce bugs before scheduling fixes. Address data loss, broken core tasks and exposed private information first. Group feature suggestions for a weekly review instead of opening a release for each one.

For bug/feature reports: **received** = waiting, **accepted** = follow-up planned, **applied** = completed, **rejected** = closed without a change. Explain decisions in the submitter-visible note. A suggestion does not promise implementation. Existing correction and clearance meanings are unchanged.

This release claims no parity points. Press outreach waits for the release gates and live desktop/mobile verification.

## Layout correction (2.39.1)

The owner reported missing page scrolling and an overly wide Kamptrail.com. The old app fills `100dvh` with `overflow:hidden`, and wheel gestures zoom the map. Horizontal overflow was not reproduced at 698 pixels; this correction addresses the scrolling trap and edge-to-edge desktop presentation.

The app now has a centered desktop width of at most 1,120 pixels and a map track of 560–680 pixels. Document scrolling can reach the feedback/help section below the map. The results list keeps its own scrolling. Mouse-wheel gestures scroll the page; map zoom buttons and desktop dragging remain available. On touch devices, one finger scrolls the page and the map retains two-finger pan/zoom.

Verify wide desktop, a short/zoomed window and mobile. Check document scrolling, independent list scrolling, no horizontal overflow, usable map height, and both feedback buttons. This package changes no source data, listing identities or parity rows.

## Owner email notifications

Optional owner-only notices are disabled unless the private server configuration explicitly enables them. Only new bug and feature reports submitted while enabled are queued. No historical reports are backfilled, and no submitter receives email. Notices contain only report type, numeric ID, received time and the fixed private admin URL; no title, body, visitor email, diagnostics or receipt token.

Deployment order: upload code including the vendored PHPMailer files; apply migration `007_feedback_notifications` through authenticated moderation; configure the verified sender privately; install the worker cron; then enable and test one new bug and feature report. Confirm actual inbox arrival separately from SMTP acceptance. Preserve all existing private configuration entries.

Add this entry to `private/kamptrail-config.php`, outside `public_html`, with owner-only permissions (0600). Never put real passwords in source, browser code, logs or release ZIPs:

```php
'notifications' => [
    'enabled' => false, // enable only after sender and worker are ready
    'recipient' => 'chuck@boondockorbust.com',
    'from' => 'VERIFIED_SENDER_EMAIL',
    'host' => 'VERIFIED_SMTP_HOST',
    'port' => 465, // integer; 465 + ssl or 587 + tls
    'encryption' => 'ssl',
    'username' => 'VERIFIED_SMTP_LOGIN_EMAIL',
    'password' => 'PRIVATE_SMTP_PASSWORD',
],
```

Hostinger needs an authenticated SMTP sender and its required DNS verification. The recipient mailbox can remain with its existing provider. PHP must provide PDO/MySQL and OpenSSL; PHPMailer 7.1.1 is bundled with its license. No Composer install is required on hosting.

Run the hosting account's PHP CLI every five minutes against the absolute path `public_html/api/_lib/notification-worker.php`. Use the account's verified PHP binary and full account path. The worker is CLI-only, processes at most ten notices per run and retries five times with backoff. Configure the cron before enabling notices. The admin queue shows pending/failed/sending or SMTP accepted, and an authenticated CSRF-protected retry control for unsent notices. Configuration disabled pauses existing queued notices.

Submission storage commits before queue insertion; no SMTP connection occurs on a public form request. A queue-write failure is logged generically and cannot remove a saved report; that rare failure requires operator review and is not automatically backfilled. Missing notification migration also leaves report intake working. Review the moderation queue routinely regardless of email status.

A five-minute lease prevents concurrent workers from sending the same notice normally. A crash after SMTP accepts but before the state is saved can cause a duplicate on retry; the stable Message-ID helps identification but does not promise exactly-once delivery. SMTP acceptance is not proof of inbox delivery. Worker logs omit credentials, server replies and submitted content.

Implementation validation does not establish production email acceptance. Sender verification, private credentials, migration, cron installation and inbox receipt testing remain required before claiming delivery.
