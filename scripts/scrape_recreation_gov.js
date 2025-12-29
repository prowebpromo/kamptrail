#!/usr/bin/env node
/**
 * Recreation.gov Campground Scraper using Playwright
 *
 * This script uses browser automation to scrape campground data from Recreation.gov,
 * bypassing API proxy restrictions.
 *
 * Usage:
 *   node scripts/scrape_recreation_gov.js --state CA --limit 50
 */

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

// State codes
const US_STATES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming'
};

class RecreationGovScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    console.log('🌐 Launching browser...');

    // Use globally installed chromium browser
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      require('child_process').execSync('which chromium-browser chromium google-chrome 2>/dev/null || echo ""').toString().trim() ||
      '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

    this.browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(30000);
  }

  async scrapeCampgroundsForState(stateCode, limit = 50) {
    const stateName = US_STATES[stateCode];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Processing ${stateName} (${stateCode})`);
    console.log(`${'='.repeat(60)}`);

    const campgrounds = [];

    try {
      // Navigate to Recreation.gov search page for camping in the state
      const searchUrl = `https://www.recreation.gov/search?entity_type=campground&state=${stateCode}`;
      console.log(`📍 Navigating to: ${searchUrl}`);

      await this.page.goto(searchUrl, { waitUntil: 'networkidle' });
      await this.page.waitForTimeout(2000);

      // Extract campground cards from the search results
      const campgroundData = await this.page.evaluate((limit) => {
        const results = [];
        const cards = document.querySelectorAll('[class*="EntitySearchResult"], [class*="campground"], .rec-flex-card');

        for (let i = 0; i < Math.min(cards.length, limit); i++) {
          const card = cards[i];

          try {
            // Extract campground name
            const nameEl = card.querySelector('h3, h4, [class*="title"], a[href*="/camping/campgrounds/"]');
            const name = nameEl?.textContent?.trim() || null;

            // Extract link to detail page
            const linkEl = card.querySelector('a[href*="/camping/campgrounds/"]');
            const link = linkEl?.href || null;

            // Extract facility ID from URL
            const facilityId = link?.match(/\/(\d+)$/)?.[1] || null;

            if (name && link) {
              results.push({ name, link, facilityId });
            }
          } catch (err) {
            console.error('Error extracting card:', err.message);
          }
        }

        return results;
      }, limit);

      console.log(`  Found ${campgroundData.length} campgrounds`);

      // Visit each campground detail page to get full information
      for (let i = 0; i < Math.min(campgroundData.length, limit); i++) {
        const { name, link, facilityId } = campgroundData[i];

        try {
          console.log(`  [${i + 1}/${campgroundData.length}] Scraping: ${name}`);

          await this.page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await this.page.waitForTimeout(1000);

          // Extract detailed information
          const details = await this.page.evaluate(() => {
            // Get coordinates from map or metadata
            let lat = null, lon = null;

            // Try to find coordinates in various places
            const coordScript = Array.from(document.querySelectorAll('script')).find(s =>
              s.textContent.includes('latitude') || s.textContent.includes('coordinates')
            );

            if (coordScript) {
              const latMatch = coordScript.textContent.match(/latitude["\s:]+(-?\d+\.\d+)/i);
              const lonMatch = coordScript.textContent.match(/longitude["\s:]+(-?\d+\.\d+)/i);
              if (latMatch) lat = parseFloat(latMatch[1]);
              if (lonMatch) lon = parseFloat(lonMatch[1]);
            }

            // Get description
            const descEl = document.querySelector('[class*="description"], [class*="overview"] p');
            const description = descEl?.textContent?.trim() || '';

            // Get amenities
            const amenities = [];
            document.querySelectorAll('[class*="amenity"], [class*="feature"]').forEach(el => {
              const text = el.textContent.toLowerCase();
              if (text.includes('toilet') || text.includes('restroom')) amenities.push('toilets');
              if (text.includes('water') && text.includes('potable')) amenities.push('water');
              if (text.includes('shower')) amenities.push('showers');
              if (text.includes('electric')) amenities.push('electricity');
              if (text.includes('dump')) amenities.push('dump_station');
            });

            // Get cost
            let cost = 0;
            const priceEl = document.querySelector('[class*="price"], [class*="fee"]');
            if (priceEl) {
              const priceMatch = priceEl.textContent.match(/\$(\d+)/);
              if (priceMatch) cost = parseInt(priceMatch[1]);
            }

            return { lat, lon, description, amenities: [...new Set(amenities)], cost };
          });

          if (details.lat && details.lon) {
            campgrounds.push({
              facilityId,
              name,
              latitude: details.lat,
              longitude: details.lon,
              description: details.description.substring(0, 200),
              amenities: details.amenities,
              cost: details.cost
            });
          } else {
            console.log(`    ⚠️  Skipping (no coordinates found)`);
          }

          // Rate limiting
          await this.page.waitForTimeout(800);

        } catch (err) {
          console.log(`    ⚠️  Error: ${err.message}`);
        }
      }

    } catch (err) {
      console.error(`❌ Error scraping ${stateCode}:`, err.message);
    }

    return campgrounds;
  }

  convertToGeoJSON(campgrounds, stateCode) {
    const features = campgrounds.map((camp, idx) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [camp.longitude, camp.latitude]
      },
      properties: {
        id: `${stateCode}-${String(idx + 1).padStart(3, '0')}`,
        name: camp.name,
        type: 'established',
        cost: camp.cost || 0,
        rating: null,
        reviews_count: 0,
        amenities: camp.amenities || [],
        rig_friendly: [],
        road_difficulty: 'paved',
        state: stateCode,
        source: 'recreation.gov',
        facility_id: camp.facilityId,
        description: camp.description || ''
      }
    }));

    return {
      type: 'FeatureCollection',
      features
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const stateArg = args.find(a => a.startsWith('--state='));
  const limitArg = args.find(a => a.startsWith('--limit='));

  const stateCode = stateArg ? stateArg.split('=')[1].toUpperCase() : 'CA';
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 50;

  if (!US_STATES[stateCode]) {
    console.error(`❌ Invalid state code: ${stateCode}`);
    process.exit(1);
  }

  const scraper = new RecreationGovScraper();

  try {
    await scraper.init();

    const campgrounds = await scraper.scrapeCampgroundsForState(stateCode, limit);

    if (campgrounds.length > 0) {
      const geojson = scraper.convertToGeoJSON(campgrounds, stateCode);

      // Save to file
      const outputDir = path.join(__dirname, '../data/campsites');
      await fs.mkdir(outputDir, { recursive: true });

      const outputFile = path.join(outputDir, `${stateCode}.geojson`);
      await fs.writeFile(outputFile, JSON.stringify(geojson, null, 2));

      console.log(`\n✅ Saved ${campgrounds.length} campgrounds to ${outputFile}`);
    } else {
      console.log(`\n⚠️  No campgrounds found for ${stateCode}`);
    }

  } catch (err) {
    console.error('❌ Fatal error:', err);
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { RecreationGovScraper };
