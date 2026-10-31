# After-stay review prompt, 2.26.0

## Acceptance criterion (defined before implementation)

A saved campsite stop whose visitor-entered departure date, or arrival date when no departure is set, is today or earlier shows a "How was your stay?" prompt inside its saved-stop card. "Write a review" opens the existing moderated review form for that campsite. "Dismiss" hides the prompt for that stop and date and the choice survives reloads. Future-dated, undated and service stops show no prompt. Nothing is sent unless the visitor submits the existing form. No rating is pre-filled or inferred. Corrupted or unavailable browser storage never breaks the saved-stops panel. English, Spanish and French text, keyboard accessible.

## Why

Three checklist rows (crowds, noise and shade filters, seasonal sub-scores, review sub-scores) wait on real moderated ratings. The inputs shipped in 2.19.0. This prompt asks visitors who planned a stay to report it, at the moment it is most likely to be firsthand. It creates no content and earns no parity credit by itself.

## Change

- `trip-planner.js`: prompt rendered per qualifying stop, dismissals in `kt_stay_prompts_v1` keyed by stop ID and date, every storage access wrapped so failures fall back safely. Dates compare in the visitor's local calendar.
- `locale.js`, `locale-fr.js`: four new strings in Spanish and French. "Write a review" reuses the existing catalogue entry.
- `tests/browser/saved-stops.spec.js`: past, future and undated stops, the review form opening for the right campsite, dismissal persisting after reload, and corrupted storage.
- Version 2.26.0, service worker cache `kt-v57`.

## Limits

- Only visitors who save stops and enter dates see the prompt. Its effect on review volume is unmeasured until real submissions arrive.
- The French text has had no native-speaker review.
