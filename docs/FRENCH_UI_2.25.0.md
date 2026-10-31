# French interface, 2.25.0

## Acceptance criterion (defined before implementation)

French is selectable beside English and Spanish. Every first-party catalogue string that has a Spanish translation has a French one, with no placeholder the English lacks. The choice persists after reload. Place names, source text and visitor content stay in their original language. English and Spanish visitors do not download the French text. A missing or mismatched French file falls back to English with a visible bilingual notice, and the page language and number formats switch to English too. French stays available offline after the first French load.

## What shipped

- `locale-fr.js`: 1,655 French strings, one for every Spanish catalogue key, including the 2.24.0 visitor-answer texts. It loads only when French is selected and carries its own version, which must match `locale.js`.
- `locale.js`: `fr` is a supported language with the `fr-CA` number and date locale. Shared labels (fee, type, amenity, rig, status) use the selected catalogue. `catalogueReady()` reports a missing French file.
- Selector: "Français" option. The interface notice reads "Interface en français" and keeps the same limits as Spanish.
- The release package includes `locale-fr.js`. It is not precached: the service worker caches it when a French visitor first loads it, so English and Spanish visitors never fetch it. An independent review caught an earlier version that precached it for everyone.

Thirteen English strings join English word fragments in code (for example "listing matches"/"listings match"). The Spanish catalogue already rewrites these without the fragment. The French catalogue follows the same approach, so no English fragment appears inside French text.

## Limits

- The translation was produced with AI assistance and checked automatically for key and placeholder parity. A native French speaker has not reviewed it.
- The how-to page and its videos stay in English. This was a listed exception for the row and remains one.
- Untranslated server or browser messages can appear in English, as in Spanish.
- The route clearance dialog's fixed text is English in every language (see live verification).

## Tests

- `tests/locale.test.js`: French catalogue key parity with Spanish, no added placeholders, no leftover Spanish-interface wording, labels, locale, missing and stale-version fallback, selector, no precache and package entry.
- `tests/browser/locale.spec.js`: French boot loads the catalogue, translated controls, unchanged place names, switching back to English, no French download for English visitors, and labeled English fallback with English page language when the file is missing.

## Live verification, 2026-10-31

Production `release.json` reported `d5ba80f112a4828f00f72df46ae8ab464fe3d6c0`, the PR #127 merge. That PR's exact head `a5f68932` passed the full regression run 41206336605 (Node, native PHP/MySQL APIs, backup restore, Python, browser suite, release build) and Lighthouse. Publish Hostinger release run 41207151862 succeeded.

A scripted headless Chromium check against kamptrail.com at a 390 by 844 mobile viewport recorded 32 passes and 0 failures. Nothing was submitted.

- Release identity, served `locale-fr.js` version 2.25.0, and every corrected string present with no superseded wording.
- English visit: no French request, no French script tag, service worker does not precache French.
- French selected from the keyboard-focusable selector, `lang="fr"`, choice persists after reload, file requested at `locale-fr.js?v=2.25.0`.
- Rendered in French: zoom control, a popup with an unchanged place name, the "Durée maximale de séjour" stay-limit label, the report-form option "Séjour sans avoir demandé", the fix-dialog option "Camping non autorisé" and, in the layers control, "Inclure les lieux sans accès ou à accès privé (restreint)". Escape closed the permissions dialog.
- No raw placeholders in visible text, no horizontal overflow, Tab reaches the language selector, no page errors.
- Offline: after one online French load the file was in the `kt-v55` shell cache. After closing the browser and relaunching the same profile offline, the service worker served `locale-fr.js?v=2.25.0` with status 200 and the interface loaded in French.
- With the French file returning 404, the page switched to English with the bilingual fallback notice.

Not demonstrated live:
- The corrected route no-match and height-tag status lines. Both are confirmed in the served file. A probe route did not complete a clearance search, so the no-match line did not render. That probe used a hand-built route, so it is not evidence of a production fault.
- A physical phone. The scheduled November 2 test stays separate and pending.

Additional limit found: the route clearance dialog builds its heading, Close button, introduction, loading and unavailable messages as fixed English text, outside the translation catalogue. They appear in English in French and Spanish. Only its result line is translated.

## Checklist effect

"Multi-language (es fr)" stays partial. French and Spanish now cover the app interface, but the how-to page remains English-only. Closing that exception would need translated tutorial pages with their own URLs.
