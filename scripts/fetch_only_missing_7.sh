#!/bin/bash
# Fetch only the 7 remaining OSM states that are still missing
# Run this from the repository root: ./scripts/fetch_only_missing_7.sh

set -e

echo "========================================================================="
echo "  Fetching ONLY the 7 Missing OSM States"
echo "========================================================================="
echo ""
echo "Missing states: FL, KS, KY, NJ, OH, SC, SD"
echo ""

MISSING_STATES="FL KS KY NJ OH SC SD"
SUCCESS_COUNT=0
FAIL_COUNT=0

for state in $MISSING_STATES; do
    echo ""
    echo "========================================================================="
    echo "  [$state] Fetching OpenStreetMap data..."
    echo "========================================================================="

    if python3 scripts/fetch_osm_data.py --state "$state"; then
        echo "✅ [$state] Successfully fetched"
        ((SUCCESS_COUNT++))

        # Verify file exists and has content
        if [ -f "data/opencampingmap/${state}.geojson" ]; then
            SIZE=$(wc -c < "data/opencampingmap/${state}.geojson")
            FEATURES=$(grep -c '"type": "Feature"' "data/opencampingmap/${state}.geojson" || echo 0)
            echo "   File size: $SIZE bytes"
            echo "   Features: $FEATURES campsites"
        else
            echo "⚠️  [$state] File was not created!"
            ((FAIL_COUNT++))
        fi
    else
        echo "❌ [$state] Failed to fetch"
        ((FAIL_COUNT++))
    fi

    echo ""
    echo "Waiting 15 seconds before next state (respecting API rate limits)..."
    sleep 15
done

echo ""
echo "========================================================================="
echo "  SUMMARY"
echo "========================================================================="
echo "  Successful: $SUCCESS_COUNT/7"
echo "  Failed: $FAIL_COUNT/7"
echo ""

if [ $SUCCESS_COUNT -eq 7 ]; then
    echo "🎉 All 7 states fetched successfully!"
    echo ""
    echo "Running audit..."
    python3 scripts/audit_campsite_data.py
fi

echo ""
echo "========================================================================="
echo "  Next steps:"
echo "  1. Review the files created in data/opencampingmap/"
echo "  2. Commit: git add data/ && git commit -m 'feat: Add remaining 7 OSM states'"
echo "  3. Push: git push"
echo "========================================================================="
