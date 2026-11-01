#!/bin/bash
M=76da929f56eafbe20844b6b55e6596baf6f67af4
S=/tmp/claude-0/-home-claude/6c80b305-077e-5285-8aa5-8a68e5ba3b59/scratchpad/idlive
for i in $(seq 1 90); do r=$(gh api "repos/prowebpromo/kamptrail/actions/runs?head_sha=$M" -q '[.workflow_runs[]|select(.name=="Publish Hostinger release")|"\(.id) \(.status)/\(.conclusion)"]|join(" ")'); case "$r" in *completed*) break;; esac; sleep 30; done
echo "publish: $r"
for i in $(seq 1 20); do l=$(curl -s "https://kamptrail.com/release.json?n=$RANDOM"); echo "$l" | grep -q $M && break; sleep 30; done
echo "release.json: $l"
echo "version: $(curl -s "https://kamptrail.com/?n=$RANDOM" | grep -o 'kamptrail-version" content="[^"]*')"
curl -s "https://kamptrail.com/data/campsites/search-index.json?n=$RANDOM" -o $S/live-index-160.json
echo "index sha256: $(sha256sum $S/live-index-160.json | cut -d' ' -f1)"
echo "identity-hosts sha256: $(curl -s "https://kamptrail.com/data/campsites/identity-hosts.json?n=$RANDOM" | sha256sum | cut -d' ' -f1)"
echo "national clearance index: $(curl -s -o /dev/null -w '%{http_code}' "https://kamptrail.com/data/clearances/index.json?n=$RANDOM")"
echo "RI clearance: $(curl -s -o /dev/null -w '%{http_code}' "https://kamptrail.com/data/clearances/RI.json?n=$RANDOM")"
echo "$l" | grep -q $M || { echo "NOT LIVE"; exit 1; }
export INDEX_FILE=$S/live-index-160.json CHROMIUM_PATH=/usr/bin/google-chrome BASE=https://kamptrail.com
echo "== desktop reversed"; timeout 900 node $S/run.js reversed 2>&1 | grep -v PAGEERR | tail -2
echo "== mobile seed7"; MOBILE=1 timeout 900 node $S/run.js seed7 2>&1 | grep -v PAGEERR | tail -2
echo "== saved stops and cached visit"; timeout 900 node $S/saved.js 2>&1 | tail -12
echo ACCEPT-DONE
