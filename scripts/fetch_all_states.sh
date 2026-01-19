#!/bin/bash
# Quick script to fetch real campsite data for popular camping states
# Run this locally - the API won't work through the development proxy

API_KEY="9276246f-055a-4601-bbe7-a5ec1b45d654"

echo "🏕 Fetching real campsite data from Recreation.gov..."
echo "This will take 5-10 minutes for all states"
echo ""

# All 50 US states
STATES="AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"

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
