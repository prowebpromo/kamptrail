# Translation review package (R13)

## Status

Preparation only. No reviewer has been contacted. No money has been spent or committed. Nothing here is a quote or an approved budget. No translation has been changed.

Nothing in this folder reaches production. It is documentation.

## Contents

- ../TRANSLATION_REVIEW_BRIEF.md: the reviewer brief, volume, estimate, terminology rules, acceptance, and Spanish tracking.
- fr-review.csv: 1,703 French catalogue strings for review (key, English, French, context).
- how-to-review.csv: 29 how-to strings in English, Spanish and French.
- QUOTE_REQUEST.md: fixed-price quote request, ready to send after the bracketed fields are filled.
- Reviewer shortlist: kept out of this public repository. The owner holds it privately.
- drafts/how-to.fr.html and drafts/how-to.es.html: machine-assisted drafts of the help page. Both carry the label "Machine-assisted draft, pending native review".

## Why the drafts are not deployable

The drafts live under docs/. The release build copies an explicit list of files and a few named folders. docs/ is never copied. Checked in scripts/build-release.js on origin/main:

Line 3, the allowlist of root files. It names `how-to.html` but no `how-to.fr.html`, no `how-to.es.html`, and nothing under docs/:

    const files=['index.html','locale.js','locale-fr.js','how-to.html','app.js', ... 'LICENSE','DATA_SOURCES.md'];

Line 8, the only root-file copy loop, which reads that list:

    for(const file of files)await fs.copyFile(path.join(root,file),path.join(out,file));

Lines 9 and 10, the only directory copies of non-data folders:

    for(const dir of ['leaflet','markercluster'])await fs.cp(path.join(root,'vendor',dir),...
    await fs.cp(path.join(root,'media','how-to'),path.join(out,'media','how-to'),{recursive:true});

The string "docs" does not appear anywhere in scripts/build-release.js. The remaining copies target data/ and api/ paths only. This was checked by reading the file and by searching it. If the build script changes, repeat the check before relying on this note.

## Spanish

Spanish is a separate review with its own tracking section in the brief. No Spanish native review exists. See docs/ROUTE_CLEARANCE_I18N_2.25.1.md line 33. A French outcome does not close Spanish.

## Acceptance gate for R13

Human review closes R13. AI checks never do.

- Parity tests, placeholder checks, AI second opinions and machine back-translation are useful screens. None counts as review.
- R13 closes for a language only when a named native reviewer has completed the full CSV, the findings are applied or declined with reasons, no S1 or S2 finding remains open, the reviewer has confirmed the corrected S1 and S2 rows, and a signed statement is on file.
- Until then, the interface docs and the draft pages keep the label "machine-assisted draft, pending native review".
- Never write "native-reviewed" in docs, release notes or the app before that gate is met.
