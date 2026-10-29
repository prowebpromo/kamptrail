# Contributions API (corrections and new campsites)

Campers send corrections and new-campsite proposals from the app. Reports go to a moderation queue. Nothing changes on the map until a moderator accepts a report and the data is updated in a release.

## Files

| Path | Public | Purpose |
| --- | --- | --- |
| `api/submit.php` | Yes | POST a report. Returns a private status token. |
| `api/status.php` | Yes | GET a report's status by token. |
| `api/health.php` | Yes | Config, database and schema status. No secrets. |
| `api/admin.php` | Password | Moderator queue, status changes with a public note, audit log, migrations. |
| `api/_lib/*` | No | Shared code and migrations. Denied by `.htaccess`. |

`scripts/build-release.js` copies only the files in its `apiFiles` list. The build fails if a new file appears under `api/` without being listed.

## Private configuration

Location on Hostinger: `private/kamptrail-config.php`, beside `public_html/` (not inside it). Permissions: directory 700, file 600. Never commit it. It is not part of the release.

```php
<?php
return [
  'db' => [
    'host' => 'localhost',
    'name' => 'u720198529_kamptrail',
    'user' => 'u720198529_kamptrail_api',
    'pass' => '(entered privately, never in chat or Git)',
  ],
  'ip_salt' => '(random string, 32+ characters)',
  'moderator_password' => '(12+ characters)',
  'moderator_name' => '(shown in the audit log)',
];
```

`KAMPTRAIL_CONFIG` overrides the path. Tests use it with a temporary SQLite file.

## Failure behavior

- Missing config: every endpoint returns 503 with `config: missing`. No paths or errors are shown.
- Database unreachable: 503 `database: unavailable`. The PDO error goes to the server error log only.
- Migrations pending: submissions return 503 until a moderator applies them.
- `health.php` reports `config_permissions: too_open` if the config file is readable by group or others.
- The app treats any non-201 response as unavailable and offers a GitHub issue link instead.

## Spam and privacy controls

Honeypot field, a 3-second minimum on the form, 5 reports per client per hour, and a first-hand confirmation. Client IPs are stored only as a salted hash. Contact email is optional and only shown to moderators. Spam decisions read as "Not accepted" on the public status.

## Production checklist

1. Release with `api/` deployed through the `hostinger` branch.
2. Create `private/kamptrail-config.php` (600) through a secure session. The database password is never pasted into chat.
3. `GET /api/health.php`: expect `config: present`, `database: ok`, `schema: migrations_pending`, `config_permissions: private`.
4. Sign in at `/api/admin.php` and choose Apply migrations. Health then shows `schema: current`, `accepting_reports: true`.
5. Send a test report from the app. Accept it with a public note. Confirm My reports shows the note.
6. After the next automatic deployment, confirm the test report and its status are unchanged.

## Refresh health

`scripts/record_health.js` writes `data/health.json` during the scheduled data refresh: per source and state, the last attempt, last success, and outcome (`fresh`, `failed`, `skipped`). The About dialog shows it. A run where every refresh failed, or a source older than 45 days, is shown as degraded. `node scripts/record_health.js seed` fills missing entries from each file's `retrieved` date or git history, marked `not_recorded`.

## Production verification (2026-10-28)

- Release c309c31 deployed through the `hostinger` branch. Without config, every endpoint returned 503 with no secrets. `api/_lib/` and the `api/` listing returned 403.
- Config created in `private/` through hPanel File Manager. Secrets typed by the owner. Permissions set to 600. Health showed `config_permissions: private`, `database: ok`.
- Apply migrations ran `001_contributions` on MySQL. Health showed `schema: current`, `accepting_reports: true`.
- Test report #1 (Clints Well, marked as a test) returned 201 with a token. Status showed `received`. Validation returned 422 for a short description.
- Moderator set it to accepted with a public note. Status returned the note. The audit log recorded received to accepted by the moderator.
- Persistence across an automatic deployment: checked after the release that carries this note.
