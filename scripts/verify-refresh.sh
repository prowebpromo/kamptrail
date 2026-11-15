#!/usr/bin/env bash
# Verify a refreshed tree before it may be pushed. Used by the weekly refresh before its first
# commit and again after every rebase onto a newer main, so a pushed tree is always a tested tree.
# Usage: scripts/verify-refresh.sh <baseline-ref>
#   <baseline-ref> is the commit whose published index the refresh must keep resolving
#   (HEAD before the refresh commit, then origin/main after each rebase).
set -euo pipefail
baseline="${1:?baseline ref required}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Every id in the baseline's published index must still resolve to the same listing.
git show "$baseline:data/campsites/search-index.json" > "$tmp/previous-search-index.json"
if git cat-file -e "$baseline:data/campsites/withdrawn.json" 2>/dev/null; then
  git show "$baseline:data/campsites/withdrawn.json" > "$tmp/previous-withdrawn.json"
else
  printf '%s\n' '{"version":1,"listings":[]}' > "$tmp/previous-withdrawn.json"
fi
node scripts/check-id-continuity.js "$tmp/previous-search-index.json" data/campsites/search-index.json data/campsites/withdrawn.json "$tmp/previous-withdrawn.json"
npm test
python -m unittest discover -s scripts/tests -p 'test_*.py'
