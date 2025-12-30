#!/bin/bash
# ====================================================================
# KampTrail - Fetch Real Campsite Data (Mac/Linux)
# ====================================================================
# Just double-click this file to fetch real campsite data!
# ====================================================================

echo ""
echo "========================================================"
echo "  KampTrail - Campsite Data Fetcher"
echo "========================================================"
echo ""
echo "This will fetch real campground data from Recreation.gov"
echo "and save it to the data/campsites folder."
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

echo "[1/3] Installing dependencies..."
pip3 install requests > /dev/null 2>&1
echo "     ✅ Done!"
echo ""

# Define your API key (you can change this)
API_KEY="9276246f-055a-4601-bbe7-a5ec1b45d654"

# Define states to fetch (edit this line to change states!)
# Popular camping states:
STATES="CA CO UT AZ OR WA MT WY NV ID"

# OR use New England states:
# STATES="NH ME VT MA CT RI"

# OR all 50 states (takes 2-3 hours):
# STATES="AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"

echo "[2/3] Fetching campsite data..."
echo "     This will take about 5-10 minutes per state."
echo "     States: $STATES"
echo ""

total=0

for state in $STATES; do
    echo ""
    echo "========================================"
    echo "  Processing: $state"
    echo "========================================"

    python3 scripts/fetch_recreation_gov_data.py \
        --api-key "$API_KEY" \
        --state "$state" \
        --limit 100

    if [ -f "data/campsites/${state}.geojson" ]; then
        echo "  ✅ Done: $state"
        ((total++))
    else
        echo "  ⚠️  Warning: $state may have failed"
    fi

    sleep 3
done

echo ""
echo "========================================================"
echo "  ✅ SUCCESS! Fetched data for $total states"
echo "========================================================"
echo ""
echo "Your data is in: data/campsites/"
echo ""
echo "NEXT STEPS:"
echo "1. Open GitHub.com in your browser"
echo "2. Go to: github.com/prowebpromo/kamptrail"
echo "3. Click 'Add file' → 'Upload files'"
echo "4. Drag all files from data/campsites/ folder"
echo "5. Click 'Commit changes'"
echo "6. Refresh your KampTrail app!"
echo ""
echo "========================================================"
echo ""
read -p "Press Enter to exit..."
