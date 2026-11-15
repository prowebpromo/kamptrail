# Maintenance release 2.47.1

This maintenance follows published release 2.47.0 (`a028b69e1adc5e96c9737302303c955f33f7fdbe`). It does not change campsite data, historical-listing policy, stored IDs or the unfinished tourism candidate.

- GitHub Actions use verified Node 24 action runtimes. Existing permissions, triggers, guards and artifact paths are retained. Runtime versions used to build/test the application remain unchanged.
- Lighthouse builds and serves `dist/kamptrail`, the published package, instead of the raw repository checkout. The performance warning threshold remains 90. The Lighthouse action/toolchain upgrade means scores must not be treated as a controlled before/after comparison with earlier runs.
- At viewport heights up to 1,000px, the two informational sections after the map can defer off-screen layout/paint. Their intrinsic size estimates reserve space; the browser remembers their measured size after rendering. The hero, map, interactive dialogs and disclosures keep their prior rendering behavior. Unsupported browsers use normal rendering.
- The release/cache markers are 2.47.1 / `kt-v92`.

## Verification

The two new browser regressions exercise sequential keyboard navigation across the off-screen sections and anchor navigation at 390px and 1440px, including horizontal-overflow checks. Both passed locally. All 28 targeted workflow-safety checks passed using Git Bash on Windows.

Local Lighthouse comparison runs both carried a slow-CPU calibration warning and did not establish a score improvement. No quantified performance improvement is claimed from those runs. The updated isolated CI measures the actual release bundle; its results and final desktop/phone-width live acceptance are recorded in the pull request before release completion.

The unfinished tourism/type/admission work remains a separate draft. Its owner decisions are not resolved by this maintenance release.
