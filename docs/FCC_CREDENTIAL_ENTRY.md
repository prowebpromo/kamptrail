# Private FCC credential entry

The moderator-only `api/fcc-setup.php` form replaces raw JSON editing. Sign in at
`api/admin.php`, then choose FCC credentials. Both an FCC account email and API
token are required on every save. The token uses a password field, is never
prefilled, reflected into HTML, put in a URL, logged, or made available through
an API response. The user must enter it privately and close the page before
agent inspection resumes. No screenshot or DOM inspection during secret entry.

The route reuses the existing `kt_mod` moderator session and CSRF token. It requires
HTTPS (except the loopback PHP test server), checks an Origin header when supplied,
limits submitted length, validates both fields server-side, and sends no-store,
same-origin referrer policy, noindex, frame denial and a strict CSP. No third-party resources or
scripts load on this page. There is no credential-read or credential-download route.

Storage is fixed at `private/fcc-install/fcc-data/credentials.json` beside the web
root. It requires the pre-created owner-only directory, refuses symlinks/insecure
permissions, writes a mode-600 temporary file and atomically replaces the target.
Both required fields replace the existing pair together. The existing PHP/database
configuration is unchanged. The page confirms only a successful private save;
**saving is not an FCC authentication test**. Downloads and coverage rendering are
separate work in draft PR #77.

CI's PHP integration test checks unauthenticated reads/writes, moderator session
reuse, CSRF, origin, missing/invalid fields, no secret values in HTML, mode-600
storage and symlink/insecure-file refusal. The release build explicitly allowlists
this entry point. Local PHP tests are skipped where PHP is unavailable; require
CI to run them before merge.

The referrer policy must preserve the origin of native same-site form POSTs.
`no-referrer` makes browsers send `Origin: null` and fails our strict origin check.
The Chromium regression test reproduces that rejected save with no file written,
then submits the corrected form successfully using synthetic credentials only.
Null and cross-site origins remain rejected. No external referrers are sent.
