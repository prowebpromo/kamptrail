#!/bin/bash
# After run-all: ledger, second rebuild from retained inputs (determinism), verifier.
set -uo pipefail
cd "$(dirname "$0")/../.."
BASE="$1"; OUT="$2"; mkdir -p "$OUT"
sha256sum data/campsites/*_merged.geojson data/campsites/search-index.json data/campsites/coordinate-index.json data/campsites/withdrawn.json | sha256sum > "$OUT/digest-1.txt"
echo "== ledger"; node scripts/tourism-type-admission/build-ledger.js --baseline="$BASE" ${RECONCILE:+--reconcile=$RECONCILE} > "$OUT/ledger.log" 2>&1 || { tail -20 "$OUT/ledger.log"; exit 1; }; head -c 3000 "$OUT/ledger.log"; echo
echo "== second rebuild"; bash scripts/tourism-type-admission/rebuild.sh "$BASE" "$OUT/r2" > /dev/null
diff -q "$OUT/digest-1.txt" "$OUT/r2/digest.txt" && echo "deterministic: $(cat "$OUT/digest-1.txt")"
grep -E '"(fee_changes|access_changes|held_exclusions)"|Error|assert' "$OUT/r2/provenance.log" | head -8
echo "== verifier"; node scripts/verify-tourism-type-admission.js --baseline="$BASE" --report="$OUT/verify.json" > "$OUT/verify.log" 2>&1; echo "verifier exit $?"; head -c 3000 "$OUT/verify.log"
