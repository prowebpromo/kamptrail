#!/bin/bash
# Quick script to fetch real campsite data for the 7 missing states

API_KEY="9276246f-055a-4601-bbe7-a5ec1b45d654"

echo "🏕 Fetching real campsite data from Recreation.gov for the 7 missing states..."
echo ""

STATES="FL KS KY NJ OH SC SD"

for state in $STATES; do
  echo "Fetching $state..."
  python3 scripts/fetch_recreation_gov_data.py \
    --api-key "$API_KEY" \
    --state "$state" \
    --limit 100

  # Rate limit protection
  sleep 3
done

echo ""
echo "✅ Done!"
