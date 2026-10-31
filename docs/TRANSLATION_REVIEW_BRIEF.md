# KampTrail translation review brief (R13)

Status: draft for the reviewer. Prepared 2026-10-31.

## Why this review exists

KampTrail's French and Spanish text was written with AI assistance and checked by code for key and placeholder parity only. No native speaker has reviewed either language (docs/FRENCH_UI_2.25.0.md, docs/ROUTE_CLEARANCE_I18N_2.25.1.md). Your review is the first. Automated checks are never described as native review.

Much of this text tells a camper what they may or may not do. A wrong word can read as permission that does not exist. Meaning matters more than style.

## Scope

French interface catalogue (locale-fr.js)
- 1,703 strings, 13,146 English source words
- Files: docs/translation/fr-review.csv (key, English, French, context)

Two draft how-to pages (machine-assisted draft, pending native review)
- docs/translation/drafts/how-to.fr.html (the French draft) and its Spanish twin, 29 strings, 337 English source words per language
- Files: docs/translation/how-to-review.csv

Volume for French review: 13,146 + 337 = 13,483 English source words. This figure is for French only.

## Volume and cost estimate

Counting method: split each English source string on whitespace and count the tokens. The catalogue count uses the keys of `es` in locale.js, which are the English source strings. The how-to count uses the English column of docs/translation/how-to-review.csv.

| Language | Catalogue strings | Catalogue words | How-to strings | How-to words | Total English source words |
|---|---|---|---|---|---|
| French | 1,703 | 13,146 | 29 | 337 | 13,483 |
| Spanish | 1,703 | 13,146 | 29 | 337 | 13,483 |

The two totals match because locale.js and locale-fr.js carry the same 1,703 keys (no key is missing from either) and the two how-to drafts share one English source. They are still two separate counts and two separate engagements. A Spanish reviewer is paid for Spanish work, not for the French count.

Cost estimate (planning assumption, not sourced from any vendor). Review of existing translation is assumed to run $0.03 to $0.08 per English source word. Rates vary by reviewer, subject matter and rush terms.

| Scope | Words | Low ($0.03) | High ($0.08) |
|---|---|---|---|
| French review | 13,483 | about $404 | about $1,079 |
| Spanish review | 13,483 | about $404 | about $1,079 |
| Both languages | 26,966 | about $809 | about $2,157 |

This is an estimate only. It is not a quote and not an approved budget. No vendor has been contacted and no money has been committed. Real quotes may fall outside this range.

## Spanish review tracking

- Status: no Spanish native review exists. docs/ROUTE_CLEARANCE_I18N_2.25.1.md line 33 states: "The French and Spanish text for these strings was written in earlier releases and has had no native-speaker review."
- Tracked separately from French. French review closing does not close Spanish review, and the reverse.
- Spanish scope: 13,483 English source words (see the table above). Spanish catalogue is `es` in locale.js. Spanish how-to strings are in the Spanish column of docs/translation/how-to-review.csv.
- Spanish CSV export (es-review.csv), reviewer shortlist, quote request and signed statement: not started.
- Variety question for Spanish (US Spanish, Mexican or neutral) is open and belongs to the Spanish engagement.
- Owner and date: unassigned.

## What matters most

The context column marks 132 strings (about 2,975 words) as HIGH priority. The flags come from keyword matching, so read every row. Topic counts overlap: errors 192, permission 151, closures 117, clearance 94, fees 63.

Examples of the wording that must stay exact:

- "A time limit does not establish permission to sleep overnight." French: "Une limite de durée n’établit pas l’autorisation de dormir sur place la nuit."
- "Boundaries can be approximate and do not grant permission to camp." French: "Les limites peuvent être approximatives et n’accordent pas l’autorisation de camper."
- "Overnight parking, sleeping and camping permission remain unknown." French: "L’autorisation de stationner la nuit, de dormir ou de camper reste inconnue."
- "Current opening and space availability remain unknown. Check posted facility exceptions." French: "L’ouverture et les places disponibles actuelles restent inconnues. Consultez les exceptions affichées sur place."
- "Confirm current fees, camping access, and closures with the operator before you go." French: "Confirmez les tarifs, l’accès au camping et les fermetures actuels auprès de l’exploitant avant de partir."
- "Designation and dates do not establish current road conditions, clearance, camping permission, or suitability for your RV." French: "…n’établissent ni l’état actuel de la route, ni le dégagement, ni l’autorisation de camper, ni l’adéquation pour votre véhicule récréatif."

## Terminology rules

1. A stay limit is not permission. "Maximum stay: 24 hours" describes a duration. It never means sleeping or camping is allowed. Keep the two ideas in separate sentences.
2. Unknown stays unknown. "Unknown", "not reported" and "not allowed" are three different states. Never render unknown as "no", "none" or "not allowed". Never soften "does not establish" into "may".
3. Camping, sleeping in a vehicle and overnight parking are three different activities. Use one French term for each and keep it the same everywhere. Current terms: camper or camping, dormir dans un véhicule, stationnement de nuit.
4. Clearance means vertical height under a bridge or tunnel. "High-clearance vehicles" means ground clearance (garde au sol). These must not share a word.
5. Source text, place names, agency names and visitor words are not translated.

Open questions for you:
- "Dégagement" for height clearance. Is it right, or is "hauteur libre" better?
- Stay limit appears as "Durée maximale de séjour" and "durée de séjour limite". Choose one.
- "RV" is "véhicule récréatif" in places and "véhicule" in others. Choose a rule.
- "Leg" of a trip is "tronçon" in the app and the how-to page. Confirm.
- "mile" and "miles" are identical to English in the French file. Correct them if wrong.
- The app adds "s" for plurals when the count is not 1. French treats 0 as singular. Tell us which strings this affects.

## Deliverables

1. fr-review.csv returned as a spreadsheet (xlsx or Google Sheet), or as the same CSV with comments. Do not change the key or English columns. Add columns on the right: Suggested French, Severity, Comment.
2. Severity: S1 changes safety or legal meaning. S2 is wrong or unnatural French. S3 is style.
3. Placeholders such as {0}, {date} and {count} must be kept exactly as written. Their order may change.
4. Answers to the open questions above.
5. A signed statement: name, native language, qualification, date, scope reviewed.

## Acceptance

- Every row is marked OK or has a finding.
- Each finding is applied or declined with a reason. Declined S1 findings go back to the reviewer.
- Zero open S1 and S2 findings.
- The reviewer confirms the corrected S1 and S2 rows in a second pass.
- Locale tests pass (key and placeholder parity).
- Only then do the docs say "native-reviewed". Until the signed statement exists, the pages stay labelled "machine-assisted draft, pending native review".
