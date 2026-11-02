#!/bin/bash
# Rebuild, produce the candidate ledger, and verify against an unchanged baseline checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="$(realpath "$1")"; OUT="$(realpath -m "$2")"; mkdir -p "$OUT"
bash scripts/tourism-type-admission/rebuild.sh "$BASE" "$OUT/first"
node scripts/tourism-type-admission/build-ledger.js --baseline="$BASE" > "$OUT/ledger.log"
bash scripts/tourism-type-admission/run-check.sh "$BASE" "$OUT"
