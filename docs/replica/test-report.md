# Release verification — 2026-10-29

## Deployed 2.8.0

PR73 merged at `1c591e43b4d1ed268cfb4431816788c00fe0506d`. PR CI, main CI and the Hostinger publication workflow passed. Verified live `release.json` matches that source commit.

- 79 Node/PHP tests; 31 Python tests; 55 Playwright browser flows including scoped axe scans.
- Community and routing API integration passed on MySQL 8; a real mysqldump restored every table and encoded photo bytes with matching hashes/counts.
- Production migration 003 applied through the authenticated moderator page. Health returns HTTP 200, current schema, private configuration permissions, routing ready, community ready and photo processing ready.
- Live routing used public campground coordinates only. Denver Creek to Pawnee returned 106 road miles, 3 hr 17 min by car; corridor discovery returned 111 catalogue records within 5 miles. These are software checks, not a recommended trip or proof of current road access.
- A requested detour through Willow Creek Group returned an estimated added 20 min and 7.5 road miles, separately from its 2.3-mile distance from the route line.
- Live MVUM returned 4 road segments near Denver Creek, with district-unit entry 2024-06-26 separate from retrieval 2026-10-29.
- Earlier isolated review/photo QA verified separate approvals, report resolution, persistence through redeploy, owner edits returning to moderation, and removal. No synthetic review was attached to a real campground. QA text/photo bytes were removed.

## 2.8.1 follow-up

Live testing reproduced MAP-FOCUS-01 (a prior popup blocked the new explicitly focused campsite) and MVUM-02 (ambiguous administrative forest aliases selected a sibling destination URL). The patch closes the old popup for explicit navigation, cancels older delayed focus attempts and requires one unique official URL. Pure tests and a two-campsite browser regression cover these fixes. Complete CI is required before merge; verify the new popup on the live release afterward.

## Limits

No production database restore was attempted. Restore testing used the disposable CI MySQL service. Hostinger daily backups were enabled; the manual backup job's final completion was not verified. A private pre-migration SQL export was retained as a rollback aid. Public routes use a light-use car router and do not establish RV clearance, access permission or seasonal passability. FCC coverage remains blocked on verified data access and usage conditions. No live FreeRoam backend or comparable original screenshots were available for a visual score.
