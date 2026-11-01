#!/bin/bash
# Replay the complete candidate from its unchanged release baseline.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="$(realpath "$1")"; OUT="$(realpath -m "$2")"; mkdir -p "$OUT"
cp "$BASE/data/campsites/search-index.json" data/campsites/search-index.json
cp "$BASE/data/campsites/coordinate-index.json" data/campsites/coordinate-index.json
echo "== replay merges"
node -e '
const {CampsiteMerger,loadStateSources,saveMergedData}=require("./scripts/merge_campsite_data");const fs=require("fs"),path=require("path");
(async()=>{const dir="data/campsites";for(const f of fs.readdirSync(dir).filter(n=>/^[A-Z]{2}_merged\.geojson$/.test(n)).sort()){const st=f.slice(0,2),m=new CampsiteMerger(),log=console.log;console.log=()=>{};
try{const {datasets}=await loadStateSources(st,m,{campsitesDir:dir,osmDir:"data/opencampingmap"});await saveMergedData(path.join(dir,f),await m.mergeDatasets(datasets));}finally{console.log=log;}}})().catch(e=>{console.error(e);process.exit(1);});' || exit 1
echo "== build index"; node scripts/build-search-index.js || exit 1
echo "== withdrawn"; node scripts/tourism-type-admission/build-withdrawn.js --baseline="$BASE" > "$OUT/withdrawn.log" || exit 1; head -c 600 "$OUT/withdrawn.log"; echo
sha256sum data/campsites/*_merged.geojson data/campsites/{search-index,coordinate-index,identity-hosts,withdrawn}.json | sha256sum > "$OUT/digest.txt"
