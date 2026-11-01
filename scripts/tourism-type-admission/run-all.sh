#!/bin/bash
# One heavy job: replay, rebuild, withdrawn list, ledger, second rebuild (determinism), verifier.
#   run-all.sh <baseline checkout> <out dir>
set -uo pipefail
cd "$(dirname "$0")/../.."
BASE="$1"; OUT="$2"; mkdir -p "$OUT"
echo "== replay merges"
node -e '
const {CampsiteMerger,loadStateSources,saveMergedData}=require("./scripts/merge_campsite_data");const fs=require("fs"),path=require("path");
(async()=>{const dir="data/campsites";for(const f of fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort()){const st=f.slice(0,2),m=new CampsiteMerger(),log=console.log;console.log=()=>{};
try{const {datasets}=await loadStateSources(st,m,{campsitesDir:dir,osmDir:"data/opencampingmap"});await saveMergedData(path.join(dir,f),await m.mergeDatasets(datasets));}finally{console.log=log;}}})().catch(e=>{console.error(e);process.exit(1);});' || exit 1
echo "== build index"; node scripts/build-search-index.js || exit 1
echo "== withdrawn"; node scripts/tourism-type-admission/build-withdrawn.js --baseline="$BASE" > "$OUT/withdrawn.log" || exit 1; head -c 600 "$OUT/withdrawn.log"; echo
sha256sum data/campsites/*_merged.geojson data/campsites/search-index.json data/campsites/coordinate-index.json data/campsites/withdrawn.json | sha256sum > "$OUT/digest-1.txt"
echo "== ledger"; node scripts/tourism-type-admission/build-ledger.js --baseline="$BASE" ${RECONCILE:+--reconcile=$RECONCILE} > "$OUT/ledger.log" 2>&1 || { tail -20 "$OUT/ledger.log"; exit 1; }
echo "== second rebuild (determinism)"; bash scripts/tourism-type-admission/rebuild.sh "$BASE" "$OUT/r2" > /dev/null
cp "$OUT/r2/digest.txt" "$OUT/digest-2.txt"; diff -q "$OUT/digest-1.txt" "$OUT/digest-2.txt" && echo "deterministic: $(cat "$OUT/digest-1.txt")"
tail -3 "$OUT/r2/provenance.log"
echo "== verifier"; node scripts/verify-tourism-type-admission.js --baseline="$BASE" --report="$OUT/verify.json" > "$OUT/verify.log" 2>&1; echo "verifier exit $?"; head -c 2500 "$OUT/verify.log"
