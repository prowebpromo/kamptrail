#!/usr/bin/env node
/**
 * Campendium Scraper using Playwright
 *
 * Scrapes campground ratings, reviews, and additional details from Campendium.com
 * to enrich Recreation.gov data.
 *
 * Usage:
 *   node scripts/scrape_campendium.js --state CA --limit 50
 */

const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

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

class CampendiumScraper {
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

    // Set a realistic user agent to avoid bot detection
    await this.page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    this.page.setDefaultTimeout(30000);
  }

  async searchCampgrounds(stateName, limit = 50) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Searching Campendium for ${stateName} campgrounds`);
    console.log(`${'='.repeat(60)}`);

    const campgrounds = [];

    try {
      // Navigate to Campendium state page
      const stateSlug = stateName.toLowerCase().replace(/\s+/g, '-');
      const searchUrl = `https://www.campendium.com/${stateSlug}`;
      console.log(`📍 Navigating to: ${searchUrl}`);

      await this.page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await this.page.waitForTimeout(2000);

      // Extract campground listings
      const listings = await this.page.evaluate((maxResults) => {
        const results = [];

        // Try multiple selectors for campground cards
        const selectors = [
          '[class*="campground-card"]',
          '[class*="listing-card"]',
          'article',
          '.search-result',
          '[data-testid*="campground"]'
        ];

        let elements = [];
        for (const selector of selectors) {
          elements = document.querySelectorAll(selector);
          if (elements.length > 0) break;
        }

        for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
          const card = elements[i];

          try {
            // Extract name
            const nameEl = card.querySelector('h2, h3, h4, [class*="title"] a, a[class*="name"]');
            const name = nameEl?.textContent?.trim();

            // Extract link
            const linkEl = card.querySelector('a[href*="/campground/"], a[href*="/camping/"]');
            const link = linkEl?.href;

            // Extract rating
            const ratingEl = card.querySelector('[class*="rating"], [class*="star"]');
            let rating = null;
            if (ratingEl) {
              const ratingText = ratingEl.textContent || ratingEl.getAttribute('aria-label') || '';
              const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
              if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            }

            // Extract review count
            const reviewEl = card.querySelector('[class*="review"], [class*="rating-count"]');
            let reviewCount = 0;
            if (reviewEl) {
              const reviewText = reviewEl.textContent;
              const reviewMatch = reviewText.match(/(\d+)/);
              if (reviewMatch) reviewCount = parseInt(reviewMatch[1]);
            }

            if (name && link) {
              results.push({ name, link, rating, reviewCount });
            }
          } catch (err) {
            console.error('Card extraction error:', err.message);
          }
        }

        return results;
      }, limit);

      console.log(`  Found ${listings.length} campground listings`);

      // Visit each campground page for detailed information
      for (let i = 0; i < listings.length; i++) {
        const listing = listings[i];

        try {
          console.log(`  [${i + 1}/${listings.length}] ${listing.name}`);

          await this.page.goto(listing.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await this.page.waitForTimeout(1000);

          const details = await this.page.evaluate(() => {
            // Extract GPS coordinates
            let lat = null, lon = null;

            // Try to find map element or coordinates in page
            const mapEl = document.querySelector('[class*="map"]');
            if (mapEl) {
              const coordMatch = document.body.innerHTML.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
              if (coordMatch) {
                lat = parseFloat(coordMatch[1]);
                lon = parseFloat(coordMatch[2]);
              }
            }

            // Extract amenities
            const amenities = [];
            const amenityElements = document.querySelectorAll('[class*="amenity"], [class*="feature"]');
            amenityElements.forEach(el => {
              const text = el.textContent.toLowerCase();
              if (text.includes('toilet')) amenities.push('toilets');
              if (text.includes('water')) amenities.push('water');
              if (text.includes('shower')) amenities.push('showers');
              if (text.includes('electric')) amenities.push('electricity');
              if (text.includes('dump')) amenities.push('dump_station');
              if (text.includes('wifi')) amenities.push('wifi');
              if (text.includes('cell')) amenities.push('cell_service');
            });

            // Extract cost
            let cost = 0;
            const costEl = document.querySelector('[class*="price"], [class*="cost"], [class*="fee"]');
            if (costEl) {
              const costMatch = costEl.textContent.match(/\$(\d+)/);
              if (costMatch) cost = parseInt(costMatch[1]);
            }

            // Extract type (established, dispersed, backcountry)
            let campType = 'established';
            const typeEl = document.querySelector('[class*="type"], [class*="category"]');
            if (typeEl) {
              const typeText = typeEl.textContent.toLowerCase();
              if (typeText.includes('dispersed') || typeText.includes('boondocking')) {
                campType = 'dispersed';
              } else if (typeText.includes('backcountry')) {
                campType = 'backcountry';
              }
            }

            // Extract RV compatibility
            const rigFriendly = [];
            const rigText = document.body.innerHTML.toLowerCase();
            if (rigText.includes('tent') || rigText.includes('tenting')) rigFriendly.push('tent');
            if (rigText.includes('rv') || rigText.includes('motorhome')) rigFriendly.push('RV');
            if (rigText.includes('trailer')) rigFriendly.push('trailer');

            return {
              lat,
              lon,
              amenities: [...new Set(amenities)],
              cost,
              campType,
              rigFriendly: [...new Set(rigFriendly)]
            };
          });

          campgrounds.push({
            name: listing.name,
            rating: listing.rating,
            reviewCount: listing.reviewCount,
            latitude: details.lat,
            longitude: details.lon,
            amenities: details.amenities,
            cost: details.cost,
            type: details.campType,
            rigFriendly: details.rigFriendly
          });

          // Rate limiting - be respectful
          await this.page.waitForTimeout(1500);

        } catch (err) {
          console.log(`    ⚠️  Error: ${err.message}`);
        }
      }

    } catch (err) {
      console.error(`❌ Error scraping Campendium:`, err.message);
    }

    return campgrounds;
  }

  convertToGeoJSON(campgrounds, stateCode) {
    const features = campgrounds
      .filter(camp => camp.latitude && camp.longitude)
      .map((camp, idx) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [camp.longitude, camp.latitude]
        },
        properties: {
          id: `${stateCode}-CAMP-${String(idx + 1).padStart(3, '0')}`,
          name: camp.name,
          type: camp.type || 'established',
          cost: camp.cost || 0,
          rating: camp.rating,
          reviews_count: camp.reviewCount || 0,
          amenities: camp.amenities || [],
          rig_friendly: camp.rigFriendly || [],
          road_difficulty: 'paved',
          state: stateCode,
          source: 'campendium',
          description: ''
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

  const stateName = US_STATES[stateCode];
  if (!stateName) {
    console.error(`❌ Invalid state code: ${stateCode}`);
    process.exit(1);
  }

  const scraper = new CampendiumScraper();

  try {
    await scraper.init();

    const campgrounds = await scraper.searchCampgrounds(stateName, limit);

    if (campgrounds.length > 0) {
      const geojson = scraper.convertToGeoJSON(campgrounds, stateCode);

      // Save to file
      const outputDir = path.join(__dirname, '../data/campsites');
      await fs.mkdir(outputDir, { recursive: true });

      const outputFile = path.join(outputDir, `${stateCode}_campendium.geojson`);
      await fs.writeFile(outputFile, JSON.stringify(geojson, null, 2));

      console.log(`\n✅ Saved ${campgrounds.filter(c => c.latitude && c.longitude).length} campgrounds to ${outputFile}`);
    } else {
      console.log(`\n⚠️  No campgrounds found for ${stateName}`);
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

module.exports = { CampendiumScraper };
