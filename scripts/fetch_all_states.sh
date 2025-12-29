#!/bin/bash
# Quick script to fetch real campsite data for popular camping states
# Run this locally - the API won't work through the development proxy

API_KEY="9276246f-055a-4601-bbe7-a5ec1b45d654"

echo "🏕 Fetching real campsite data from Recreation.gov..."
echo "This will take 5-10 minutes for all states"
echo ""

# Popular camping states
STATES="CA CO UT AZ OR WA MT WY NV ID NM"

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
echo "✅ Done! Now commit and push the updated data files:"
echo "   git add data/campsites/"
echo "   git commit -m 'Add real campsite data from Recreation.gov'"
echo "   git push"
