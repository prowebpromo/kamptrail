#!/bin/bash
# Deterministic rebuild of the candidate from retained inputs.
#   rebuild.sh <baseline checkout> <out dir>
# 1. Replay every state merge (verify-osm-provenance --remerge, ledger mode). 2. Rebuild the search index.
# 3. Write withdrawn.json. 4. Print one digest over every output.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="$1"; OUT="$2"; mkdir -p "$OUT"
node scripts/verify-osm-provenance.js --baseline="$BASE" --report="$OUT/provenance.json" --remerge --ledger=docs/candidates/tourism-type-admission.json > "$OUT/provenance.log" 2>&1 || echo "provenance check failed: see $OUT/provenance.log"
node scripts/build-search-index.js > "$OUT/index.log"
node scripts/tourism-type-admission/build-withdrawn.js --baseline="$BASE" > "$OUT/withdrawn.log"
sha256sum data/campsites/*_merged.geojson data/campsites/search-index.json data/campsites/coordinate-index.json data/campsites/withdrawn.json | sha256sum | tee "$OUT/digest.txt"
