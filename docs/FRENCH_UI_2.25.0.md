# French interface, 2.25.0

## Acceptance criterion (defined before implementation)

French is selectable beside English and Spanish. Every first-party catalogue string that has a Spanish translation has a French one, with no placeholder the English lacks. The choice persists after reload. Place names, source text and visitor content stay in their original language. English and Spanish visitors do not download the French text. A missing French file falls back to English with a visible bilingual notice. The offline shell caches the French file.

## What shipped

- `locale-fr.js`: 1,655 French strings, one for every Spanish catalogue key, including the 2.24.0 visitor-answer texts. It loads only when French is selected and carries its own version, which must match `locale.js`.
- `locale.js`: `fr` is a supported language with the `fr-CA` number and date locale. Shared labels (fee, type, amenity, rig, status) use the selected catalogue. `catalogueReady()` reports a missing French file.
- Selector: "Français" option. The interface notice reads "Interface en français" and keeps the same limits as Spanish.
- Service worker shell and release package include `locale-fr.js`.

Thirteen English strings join English word fragments in code (for example "listing matches"/"listings match"). The Spanish catalogue already rewrites these without the fragment. The French catalogue follows the same approach, so no English fragment appears inside French text.

## Limits

- The translation was produced with AI assistance and checked automatically for key and placeholder parity. A native French speaker has not reviewed it.
- The how-to page and its videos stay in English. This was a listed exception for the row and remains one.
- Untranslated server or browser messages can appear in English, as in Spanish.

## Tests

- `tests/locale.test.js`: French catalogue key parity with Spanish, no added placeholders, no leftover Spanish-interface wording, labels, locale, missing-file fallback, selector, offline shell and package entries.
- `tests/browser/locale.spec.js`: French boot loads the catalogue, translated controls, unchanged place names, switching back to English, no French download for English visitors, and labeled English fallback when the file is missing.

## Checklist effect

"Multi-language (es fr)" stays partial. French and Spanish now cover the app interface, but the how-to page remains English-only. Closing that exception would need translated tutorial pages with their own URLs.
