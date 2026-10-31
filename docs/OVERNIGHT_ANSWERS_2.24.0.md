# Visitor overnight-stay answers, 2.24.0

Extends the 2.15 permission contract (`PERMISSIONS_CONTRACT_2.15.md`). Visitor answers are a new kind of moderated permission report. They never change the source conclusion.

## Acceptance criterion (defined before implementation)

A visitor can submit an explicit "overnight stay allowed" or "not allowed" answer, with their visit date, for any map place. Answers are moderated before publication, and one answer per visitor per place is enforced on the server, with rate limits, a honeypot, a minimum completion time and flags. The place view shows a dated tally labeled as visitor reports, with a visible disagreement notice. The tally never changes official permission, filters, fees or classification.

The "Overnight allowed voting" row becomes yes only when all of this works live, with the moderation path verified against real PHP and MySQL in CI.

## What a visitor sees

- In the permission dialog for overnight occupancy: "Answer: was an overnight stay allowed?" The form asks Allowed or Not allowed, the visit date, a display name, an optional note and a confirmation that it is their own visit.
- A "Visitor answers" panel shows published counts with the latest visit date for each side. When both sides have answers it shows "Visitors disagree. Compare visit dates and check current rules before relying on either answer."
- When the source reports a prohibition, the panel adds "The source reports a prohibition. Visitor answers do not override it."
- Footer on every panel: "These are moderated visitor reports, not official permission. They never change the source conclusion, filters or fees."
- An unavailable tally says so. It is never shown as zero.
- Answers are offered for overnight occupancy only, not unoccupied vehicle parking.

## Server rules

- Observations `stay_allowed` and `stay_not_allowed`, activity `overnight_occupancy` only, no authority fields, note up to 1,000 characters.
- New answers start pending. Only published answers count.
- One answer per client per place for 30 days, keyed by the existing salted client hash in `permission_events` (`stay:` plus a truncated place-key hash). A second answer returns 409 `already_answered` and points to My permission reports for editing.
- Existing controls still apply: per-client rate limit, honeypot, minimum 3 seconds, owner-token edit and delete, flags and the CSRF-protected admin queue, which labels each item "VISITOR ANSWER".
- An edit cannot switch an answer into a report or the reverse (422 `type_changed`).
- No database migration. Answers use the existing permission tables.

## Limits

- One-per-place relies on the salted network-address hash. Different networks or devices can answer again. Moderation is the backstop.
- Counts are reports, not people or verified stays. A tally can be stale. Visit dates are shown so readers can judge.
- No answers exist in production at release. None were created to populate the panel.

## Tests

- `tests/permissions-api.test.js`: answer validation, pending-then-published tally, duplicate rejection, disagreement and type-change rejection against native PHP and MySQL in CI.
- `tests/browser/permissions.spec.js`: answer form, tally labels, disagreement and prohibition notices.
- Spanish strings for every new text.
