#!/bin/bash
# Rebuild once more from the same released seed, then fail on any verification discrepancy.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="$(realpath "$1")"; OUT="$(realpath -m "$2")"; mkdir -p "$OUT"
bash scripts/tourism-type-admission/rebuild.sh "$BASE" "$OUT/second"
diff "$OUT/first/digest.txt" "$OUT/second/digest.txt"
node scripts/verify-osm-provenance.js --baseline="$BASE" --report="$OUT/provenance.json" --ledger=docs/candidates/tourism-type-admission.json > "$OUT/provenance.log"
node scripts/verify-tourism-type-admission.js --baseline="$BASE" --report="$OUT/verify.json" > "$OUT/verify.log"
# Owner decisions of 2026-11-01 against the fresh RIDB evidence, and published-id continuity against the baseline.
node scripts/tourism-type-admission/owner-decisions.js --baseline="$BASE" --markdown="$OUT/owner-decisions.md" > "$OUT/owner-decisions.log"
node scripts/check-id-continuity.js "$BASE/data/campsites/search-index.json" data/campsites/search-index.json data/campsites/withdrawn.json > "$OUT/continuity.log"
sha256sum data/campsites/{search-index,coordinate-index,identity-hosts,withdrawn}.json > "$OUT/key-digests.txt"
