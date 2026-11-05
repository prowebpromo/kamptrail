# Isolated staging PHP acceptance

Staging domain: https://lightslategrey-emu-717044.hostingersite.com/
Application source tested: 87c800eee03763fb851507817c26a736d20af5c5.
Hostinger deployment artifact: 9e988dde861c36a404df8e757301e97e3ba30818, shown Completed / Current in hPanel. No production merge, deployment, DB copy, source refresh or paid service was used.

## Isolation

The disposable SQLite file came from staging build 41937992717, artifact 13374253477. ZIP SHA-256: 86a8b0c7c51f2626271f8d45d5c522b5bd9e2d6c14e319793111c853272e436f. Seven existing migrations were applied through the application's own migration code. Before upload, submissions, moderation, reviews, photos, observations, permission/clearance reports, routing events and the notification outbox were empty. Four singleton system-state rows were at their initial values.

The database and a staging-only configuration are in `private/`, beside `public_html/`, not in the public package or git. Folder mode is 0700; configuration and database are 0600. The configuration contains the SQLite DSN and a generated abuse-control salt. It has no admin credentials, SMTP settings, notification recipient or production data. The existing notification code defaults to disabled unless explicitly enabled. No notification worker or cron job was created.

## Observed results

| Check | Observed result |
| --- | --- |
| GET api/health.php | HTTP 200, ok true; config present/private; DB ok; schema current; reports, routing, community, observations and photo processing ready |
| Public-coordinate route POST | HTTP 200; FOSSGIS OSRM car route; 866.8 meters; 32 geometry points |
| UI calculation | One route API request; successful route shown with “Car route. Not checked for your rig’s height, weight or length. Check posted restrictions.” |
| Saved-stop reload | Two test stops retained |
| Same-input route replay after reload | Explicit Calculate action uses cached route; zero additional route API requests |
| Offline cached replay | Zero route API requests; “Saved road route … Offline: conditions may have changed.” |
| Synthetic private feedback | HTTP 201, status received, valid private token and visible “Thanks. Your feedback was received.” |

Coordinates were ordinary public Moab map points, not a person's location. The feedback contained synthetic acceptance text and no contact email. Its private token is excluded from this document. Browser tests used an isolated context and did not accept legal terms on behalf of a person. External imagery requests were blocked in the automated PHP/UI test; normal staging map rendering was separately inspected in the browser.

An initial test incorrectly expected a route to redraw automatically after reload. The product requires an explicit Calculate action to retrieve the cached route. The corrected test verified that action and zero new requests. This is not a claim of automatic route restoration.

## Limits

Outgoing notifications are disabled by the actual staging configuration and the unchanged application's default. A post-test DB download from the Hostinger UI did not complete, so a post-test outbox row count was not independently read. No claim is made that production reporting, production credentials, moderator access or live email delivery were tested. Real iOS/Android installed-app, offline-area and assistive-technology acceptance remain open. These results close the isolated PHP functional gap, not the entire SOW.
