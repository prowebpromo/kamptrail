# Private feedback intake (2.39.0)

Kamptrail.com is the primary traffic destination. The map stays immediately available. **Feedback** beside the introductory text opens a private bug / feature form, with no account and optional email. Campsite facts still use **Suggest a fix** on the listing.

Public entry points: `https://kamptrail.com/#feedback=bug` and `https://kamptrail.com/#feedback=feature`.

## Privacy and handling

- Reports enter the existing `api/admin.php` moderation queue. Nothing is posted publicly or applied to the map automatically.
- Basic diagnostics default off. Explicit opt-in shares only version, language, browser family, viewport width/height and online/offline status. The server independently permits only these fields. It discards map coordinates, listing IDs, source notes and problem flags from app feedback.
- Optional email is for manual follow-up. This release sends no email and adds no third-party feedback service.
- Private status links contain a random 128-bit token. Anyone with that link can see status and the moderator's public note, not the message, email or diagnostics. Avoid sensitive material in moderator notes.
- **My reports** keeps the last 50 receipts on the submitting device. A private status link also works without local storage. Clearing storage removes the local receipt, not the queued report.
- Existing spam controls still apply: honeypot, 3-second minimum form time and 5 reports per connection per hour. No offline submission queue: a failed send keeps the entered text while the form stays open and offers the verified contact form.

## Operating the queue

Check received reports each working day during launch. Reproduce bugs before scheduling fixes. Address data loss, broken core tasks and exposed private information first. Group feature suggestions for a weekly review instead of opening a release for each one.

For bug/feature reports: **received** = waiting, **accepted** = follow-up planned, **applied** = completed, **rejected** = closed without a change. Explain decisions in the submitter-visible note. A suggestion does not promise implementation. Existing correction and clearance meanings are unchanged.

This release claims no parity points. Press outreach waits for the release gates and live desktop/mobile verification.
