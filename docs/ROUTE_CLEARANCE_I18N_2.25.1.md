# Route clearance dialog language, 2.25.1

## Acceptance criterion (defined before implementation)

In Spanish and French, the route clearance dialog's heading, Close button, introduction, loading message, unavailable message and route-changed message render from the selected catalogue. English output is unchanged. The existing route clearance browser tests still pass.

## Finding

The live 2.25.0 check on 2026-10-31 showed these six strings in English with French selected. Both catalogues already held Spanish and French entries for all six. The dialog set them as fixed text and never called the translator. Only the result line was translated.

## Change

- `route-clearance.js`: the six strings go through `t()`. No catalogue text changed.
- The "Height tag unavailable" fallback also goes through `t()`, found by independent review. Validated clearance data always carries a `maxheight` tag (`clearances.js` allows only `maxheight` keys and requires at least one), so this fallback cannot appear with valid data. It is translated as a defensive measure and has no browser test.
- `tests/browser/route-clearance.spec.js`: a French case asserts the translated dialog name, Close button and no-match line, and the absence of the English introduction. It fails on 2.25.0 code and passes with this change. The three existing English cases are unchanged.
- Version 2.25.1, service worker cache `kt-v56`, so returning visitors receive the corrected script.

## Live verification, 2026-10-31

Production `release.json` reported `8c9bde808c26ff64e1d1952a4fa9947434fb699f`, the PR #130 merge. Its exact head `0eb96f1d` passed regression run 41208803439 and Lighthouse. Publish Hostinger release run 41209452411 succeeded.

A scripted headless Chromium check on kamptrail.com opened the dialog with a route beside a real Rhode Island record and with a route far from all records, in French, Spanish and English. All 14 checks passed.

- French: heading "Étiquettes de hauteur cartographiées près de l’itinéraire" and "Fermer". The far route shows "L’absence de correspondance ne signifie pas que l’itinéraire est sans obstacle."
- Spanish: heading "Etiquetas de altura cartografiadas cerca de la ruta" and "Cerrar".
- English: unchanged.
- Searches completed in every language, with no fixed English text and no page errors.

The same check run against 2.25.0 before this release showed the English heading and Close button in French and Spanish, so the change is measured, not assumed. The full French check also reran on 2.25.1 with 32 passes, 0 failures, and offline French served from the `kt-v56` cache.

## Limits

- The French and Spanish text for these strings was written in earlier releases and has had no native-speaker review. "Dégagement" for height clearance is one term for a native reviewer to confirm.
- The how-to page stays English-only, so "Multi-language (es fr)" stays partial.
