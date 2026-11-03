# Homepage onboarding — 2.42.0

The homepage introduces KampTrail with direct links to the working map, installation and the browse/filter/offline workflow. Existing search, map tools and private feedback stay on the same page. Three real product screenshots illustrate the workflow. The installation guide includes iPhone/iPad, Android, Chrome/Edge desktop and Mac Safari instructions; its buttons reuse the existing user-initiated install dialog.

All new first-party text and image alternatives have Spanish and French translations. Screenshot content itself remains the captured English interface. Installation does not download map areas; the page explains what to save while online and which actions require a connection.

Runtime version 2.42.0 and shell generation kt-v76 advance together. The brand mark belongs to the shell; optional screenshots load lazily and cannot block shell installation. The manifest uses an actual mobile screenshot while preserving start_url and scope. Packaging creates nested directories before copying these assets.

Validation must include exact-head CI and live desktop/mobile acceptance before release completion. Check map height and scrolling, all hero links, both install buttons, feedback, device-guide disclosures, locale alternatives, and an existing installed browser upgrading to kt-v76. No production acceptance is claimed by this implementation note.
