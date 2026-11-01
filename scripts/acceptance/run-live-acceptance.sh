#!/usr/bin/env bash
# Live identity and saved-stop acceptance. Any failing step fails the whole run:
# - every step runs under set -euo pipefail, so no exit code is masked;
# - every browser step has a time limit (STEP_TIMEOUT seconds, default 1200), and a timeout fails the run;
# - every step must leave a JSON result whose "result" is "PASS"; a missing, empty or unparsable result fails.
# Usage: scripts/acceptance/run-live-acceptance.sh <expected-merge-sha> <out-dir>
# Optional env: BASE (default https://kamptrail.com), CHROMIUM_PATH, STEP_TIMEOUT,
#   ACCEPTANCE_SCRIPTS (directory of the check scripts; tests point it at stubs).
set -euo pipefail
expected="${1:?expected deployed SHA required}"; out="${2:?output directory required}"
base="${BASE:-https://kamptrail.com}"
scripts="${ACCEPTANCE_SCRIPTS:-$(cd "$(dirname "$0")" && pwd)}"
step_timeout="${STEP_TIMEOUT:-1200}"
mkdir -p "$out"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "$(stamp) $*" | tee -a "$out/log.txt"; }

# Run one check with a time limit, then require its JSON result to exist and say PASS.
check() {
  local name="$1"; shift
  log "step $name start"
  if ! timeout "$step_timeout" "$@" > "$out/$name.json"; then
    log "step $name FAILED (exit or timeout)"; return 1
  fi
  if ! node -e '
    const fs = require("fs"); const file = process.argv[1];
    let r; try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("unreadable result: " + e.message); process.exit(1); }
    if (!r || r.result !== "PASS") { console.error("result is not PASS: " + JSON.stringify(r && r.result)); process.exit(1); }
  ' "$out/$name.json"; then
    log "step $name FAILED (missing, empty or non-PASS result)"; return 1
  fi
  log "step $name PASS"
}

log "start, expected $expected, base $base"
curl -sf "$base/release.json?n=$RANDOM" -o "$out/release.json"
grep -q "\"$expected\"" "$out/release.json" || { log "deployed SHA is not $expected: $(cat "$out/release.json")"; exit 1; }
curl -sf "$base/data/campsites/search-index.json?n=$RANDOM" -o "$out/search-index.json"
curl -sf "$base/data/campsites/identity-hosts.json?n=$RANDOM" -o "$out/identity-hosts.json"
sha256sum "$out/search-index.json" "$out/identity-hosts.json" | tee -a "$out/log.txt"
log "national clearance manifest HTTP $(curl -s -o /dev/null -w '%{http_code}' "$base/data/clearances/index.json?n=$RANDOM")"
export INDEX_FILE="$out/search-index.json" BASE="$base"
check census-desktop-reversed node "$scripts/live-identity-census.js" reversed
check census-mobile-seed7 env MOBILE=1 node "$scripts/live-identity-census.js" seed:7
check saved-stop-desktop node "$scripts/live-saved-stop-reopen.js"
check saved-stop-mobile env MOBILE=1 node "$scripts/live-saved-stop-reopen.js"
log "end PASS"
