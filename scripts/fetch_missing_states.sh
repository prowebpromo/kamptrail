#!/bin/bash
# ========================================================================
# KampTrail - Fetch Missing State Data to Achieve 100% Coverage
# ========================================================================
# This script fetches all missing state data to achieve complete coverage
# of all 50 US states for both Recreation.gov and OpenStreetMap sources.
# ========================================================================

set -e  # Exit on error

API_KEY="9276246f-055a-4601-bbe7-a5ec1b45d654"

echo ""
echo "========================================================================"
echo "  KampTrail - Complete Database Coverage Script"
echo "========================================================================"
echo ""
echo "This script will fetch missing data to achieve 100% state coverage."
echo ""

# Missing Recreation.gov states (2 states)
MISSING_RECGOV="DE RI"

# Missing OpenStreetMap states (27 states)
MISSING_OSM="AR CA FL KS KY MD MN MS MT ND NJ OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY"

echo "[1/2] Fetching Missing Recreation.gov Data"
echo "========================================================================"
echo "States to fetch: $MISSING_RECGOV"
echo ""

recgov_count=0
for state in $MISSING_RECGOV; do
    echo "Fetching Recreation.gov data for $state..."

    python3 scripts/fetch_recreation_gov_data.py \
        --api-key "$API_KEY" \
        --state "$state" \
        --limit 100

    if [ -f "data/campsites/${state}.geojson" ]; then
        echo "  ✅ Success: $state"
        ((recgov_count++))
    else
        echo "  ⚠️  Warning: $state may have no data"
    fi

    # Rate limiting - wait 5 seconds between states
    sleep 5
done

echo ""
echo "Recreation.gov: Fetched $recgov_count/2 missing states"
echo ""

echo "[2/2] Fetching Missing OpenStreetMap Data"
echo "========================================================================"
echo "States to fetch: $MISSING_OSM"
echo ""

osm_count=0
for state in $MISSING_OSM; do
    echo "Fetching OSM data for $state..."

    python3 scripts/fetch_osm_data.py --state "$state"

    if [ -f "data/opencampingmap/${state}.geojson" ]; then
        echo "  ✅ Success: $state"
        ((osm_count++))
    else
        echo "  ⚠️  Warning: $state fetch failed"
    fi

    # Rate limiting - OSM Overpass API recommendation: 5-10 seconds
    sleep 8
done

echo ""
echo "OpenStreetMap: Fetched $osm_count/27 missing states"
echo ""

echo "========================================================================"
echo "  FETCH COMPLETE"
echo "========================================================================"
echo ""
echo "Summary:"
echo "  - Recreation.gov: $recgov_count new states fetched"
echo "  - OpenStreetMap: $osm_count new states fetched"
echo ""
echo "Running audit to verify coverage..."
echo ""

# Run audit
python3 scripts/audit_campsite_data.py

echo ""
echo "========================================================================"
echo "Next Steps:"
echo "  1. Review the audit report above"
echo "  2. Commit the new data files to git"
echo "  3. Push to GitHub"
echo "  4. Verify the app loads all states correctly"
echo "========================================================================"
echo ""
