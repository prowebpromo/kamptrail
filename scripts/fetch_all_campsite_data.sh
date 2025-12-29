#!/bin/bash
#
# Master script to fetch and merge campsite data from all sources
# Uses browser automation to bypass proxy restrictions
#
# Usage:
#   ./scripts/fetch_all_campsite_data.sh CA
#   ./scripts/fetch_all_campsite_data.sh "CA CO UT"
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   KampTrail - Automated Campsite Data Fetcher${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if states provided
if [ -z "$1" ]; then
    echo -e "${YELLOW}📍 No states specified. Using popular camping states...${NC}"
    STATES="CA CO UT AZ OR WA MT WY NV ID"
else
    STATES="$1"
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js is not installed${NC}"
    echo "   Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if Playwright is installed
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

if [ ! -d "node_modules/playwright" ]; then
    echo -e "${YELLOW}📦 Installing Playwright...${NC}"
    npm install playwright
    echo ""
fi

# Process each state
TOTAL_STATES=0
SUCCESS_COUNT=0

for state in $STATES; do
    TOTAL_STATES=$((TOTAL_STATES + 1))
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}   Processing: ${state}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # 1. Fetch Recreation.gov data
    echo -e "${GREEN}[1/3]${NC} Fetching Recreation.gov data..."
    if node scripts/scrape_recreation_gov.js --state="$state" --limit=50; then
        echo -e "  ${GREEN}✓${NC} Recreation.gov data fetched"
    else
        echo -e "  ${YELLOW}⚠${NC} Recreation.gov fetch failed (continuing anyway)"
    fi

    echo ""

    # 2. Fetch Campendium data
    echo -e "${GREEN}[2/3]${NC} Fetching Campendium reviews and ratings..."
    if node scripts/scrape_campendium.js --state="$state" --limit=30; then
        echo -e "  ${GREEN}✓${NC} Campendium data fetched"
    else
        echo -e "  ${YELLOW}⚠${NC} Campendium fetch failed (continuing anyway)"
    fi

    echo ""

    # 3. Merge datasets
    echo -e "${GREEN}[3/3]${NC} Merging data sources..."
    if node scripts/merge_campsite_data.js --state="$state"; then
        echo -e "  ${GREEN}✓${NC} Data merged successfully"

        # Copy merged file to main state file
        if [ -f "data/campsites/${state}_merged.geojson" ]; then
            cp "data/campsites/${state}_merged.geojson" "data/campsites/${state}.geojson"
            echo -e "  ${GREEN}✓${NC} Updated main data file: data/campsites/${state}.geojson"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} Merge failed"
    fi

    # Rate limiting between states
    if [ "$TOTAL_STATES" -gt 1 ]; then
        echo ""
        echo -e "${YELLOW}⏳ Waiting 5 seconds before next state...${NC}"
        sleep 5
    fi
done

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ COMPLETE!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  States processed: ${SUCCESS_COUNT}/${TOTAL_STATES}"
echo -e "  Data location: ${BLUE}data/campsites/${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Review the generated GeoJSON files"
echo -e "  2. Test the data in your KampTrail app"
echo -e "  3. Commit and push the updated data:"
echo -e "     ${BLUE}git add data/campsites/${NC}"
echo -e "     ${BLUE}git commit -m 'Update campsite data with real sources'${NC}"
echo -e "     ${BLUE}git push${NC}"
echo ""
