#!/bin/bash
# ====================================================================
# KampTrail - Fetch OpenCampingMap Data (Mac/Linux)
# ====================================================================
# This script fetches campsite data from OpenStreetMap via the
# Overpass API and saves it to data/opencampingmap/
# ====================================================================

echo ""
echo "========================================================"
echo "  KampTrail - OpenCampingMap Data Fetcher"
echo "========================================================"
echo ""
echo "This will fetch campsite data from OpenStreetMap for"
echo "all US states and save it to the data/opencampingmap folder."
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ ERROR: Python is not installed!"
    echo ""
    echo "Please install Python:"
    echo "  Mac: brew install python3"
    echo "  Linux: sudo apt install python3 python3-pip"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

echo "[1/2] Installing dependencies..."
pip3 install requests > /dev/null 2>&1
echo "     ✅ Done!"
echo ""

# Define all 50 states
STATES="AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"

echo "[2/2] Fetching campsite data from OpenStreetMap..."
echo "     This may take a several minutes per state."
echo "     States: $STATES"
echo ""

total=0
failed_states=""

for state in $STATES; do
    echo ""
    echo "========================================"
    echo "  Processing: $state"
    echo "========================================"

    python3 scripts/fetch_osm_data.py --state "$state"

    if [ -f "data/opencampingmap/${state}.geojson" ]; then
        echo "  ✅ Done: $state"
        ((total++))
    else
        echo "  ⚠️  Warning: $state may have failed"
        failed_states="$failed_states $state"
    fi

    # Be nice to the API
    sleep 5
done

echo ""
echo "========================================================"
if [ -z "$failed_states" ]; then
    echo "  ✅ SUCCESS! Fetched data for all $total states"
else
    echo "  ⚠️  DONE WITH WARNINGS!"
    echo "     Successfully fetched data for $total states."
    echo "     Failed states: $failed_states"
fi
echo "========================================================"
echo ""
echo "Your data is in: data/opencampingmap/"
echo ""
echo "You can now see this data integrated in the app."
echo ""
echo "========================================================"
echo ""
read -p "Press Enter to exit..."
