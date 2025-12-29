# Using Axiom.ai for No-Code Data Scraping

**Perfect for non-technical users!** No command line required.

## What is Axiom?

[Axiom.ai](https://axiom.ai) is a **visual browser automation tool** that lets you scrape websites by clicking, not coding. Think of it as recording a macro that plays back automatically.

---

## 🎯 Quick Start (15 minutes)

### Step 1: Install Axiom

1. Go to [axiom.ai](https://axiom.ai)
2. Sign up (free tier available)
3. Install the Chrome extension
4. Pin the extension to your toolbar

**Free tier:** 2 hours/month (enough for 5-10 states)

---

### Step 2: Build Your Recreation.gov Scraper

#### A. Navigate and Start Recording

```
1. Open: https://www.recreation.gov/search?entity_type=campground&state=CA
2. Click Axiom icon → "Build a bot" → "Scraper"
```

#### B. Select Data Points

Click on these elements when Axiom prompts you:

1. **Campground name** → Click "Select all similar"
2. **Campground link** → Select
3. Click "Add step" → "Click each link" (to visit detail pages)
4. On detail page, select:
   - **Description text**
   - **GPS coordinates** (look for lat/lon numbers)
   - **Amenities list**
   - **Price** (if shown)

#### C. Configure Settings

```
Name: Recreation.gov - California
Max results: 50
Delay between pages: 1 second
```

Save the bot!

---

### Step 3: Build Your Campendium Scraper

Same process, different site:

```
1. Open: https://www.campendium.com/california
2. Axiom icon → "Build a bot" → "Scraper"
3. Select:
   - Campground name
   - Rating (stars)
   - Review count
   - Link to detail page
4. On detail page:
   - GPS coordinates
   - Amenities
   - User reviews
```

Save as: `Campendium - California`

---

### Step 4: Run Your Bots

1. Open Axiom dashboard: [app.axiom.ai](https://app.axiom.ai)
2. Find `Recreation.gov - California`
3. Click **"Run"**
4. Minimize browser and let it work (5-10 minutes)
5. Repeat for Campendium

---

### Step 5: Download the Data

After bot finishes:

1. Click the completed run
2. Click **"Download"** → Choose **"CSV"**
3. Save as: `recreation-gov-california.csv`
4. Repeat for Campendium data

---

### Step 6: Convert to GeoJSON

Now use the converter script I made for you:

```bash
# If you have the project locally:
cd kamptrail

# Convert Recreation.gov data
node scripts/convert_axiom_to_geojson.js \
  --input=recreation-gov-california.csv \
  --state=CA \
  --source=recreation.gov

# Convert Campendium data
node scripts/convert_axiom_to_geojson.js \
  --input=campendium-california.csv \
  --state=CA \
  --source=campendium

# Merge the two sources
node scripts/merge_campsite_data.js --state=CA
```

**Don't have Node.js?** Use the web converter below ⬇️

---

## 🌐 Web-Based Converter (No Installation)

If you don't want to install Node.js, I can create a simple HTML page where you paste your CSV and it converts to GeoJSON. Let me know if you'd prefer this!

---

## 📊 Example Axiom Template

Here's what your Axiom scraper should extract:

### Recreation.gov Template

| Field Name | What to Select | Example |
|------------|----------------|---------|
| `name` | Campground title | "Yosemite Valley Campground" |
| `link` | Detail page URL | "https://recreation.gov/camping/..." |
| `coordinates` | GPS text | "37.7343, -119.5866" |
| `description` | Overview text | "Located in Yosemite Valley..." |
| `amenities` | Features list | "Toilets, Water, Fire rings" |
| `price` | Cost per night | "$26" |

### Campendium Template

| Field Name | What to Select | Example |
|------------|----------------|---------|
| `name` | Campground title | "Joshua Tree Jumbo Rocks" |
| `rating` | Star rating | "4.8" |
| `reviews` | Review count | "342 reviews" |
| `coordinates` | GPS coordinates | "33.9887, -116.0517" |

---

## 🎬 Video Tutorial (Conceptual)

**Recording a scraper:**
1. Navigate to the page
2. Click Axiom → "Build bot"
3. Click elements you want to extract
4. Axiom highlights similar elements
5. Click "Select all similar"
6. Add steps to click into detail pages
7. Save and run!

---

## 💰 Pricing Guide

| Plan | Price | Runtime | States/Month |
|------|-------|---------|--------------|
| **Free** | $0 | 2 hours | ~5 states |
| **Starter** | $15/mo | 10 hours | ~25 states |
| **Pro** | $50/mo | 50 hours | 100+ states |

**Tip:** Use the free tier to test, then upgrade if you want all 50 states.

---

## 🔧 Troubleshooting

### Bot gets stuck or errors

**Common causes:**
- Website changed layout
- Loading too fast (add delays)
- Hit rate limit (add 2-3 second delays)

**Fix:** Edit the bot and add more "Wait" steps.

---

### Can't find GPS coordinates

Recreation.gov and Campendium sometimes hide coordinates. Try:
1. Look in the page source (right-click → "Inspect")
2. Search for "latitude" or "coordinates"
3. Add that text field to your extraction

---

### CSV has weird formatting

**Fix:** Use the converter script - it handles most CSV quirks automatically.

---

## ✅ Quality Check

After converting, check your GeoJSON:

```bash
# View first campground
cat data/campsites/CA.geojson | head -50

# Count total campsites
cat data/campsites/CA.geojson | grep '"type": "Feature"' | wc -l
```

Should show real names like:
- ✅ "Joshua Tree Jumbo Rocks Campground"
- ❌ "California Campground 5"

---

## 🚀 Scaling to All States

Once you're happy with California:

1. **Clone your bot** in Axiom
2. Change the URL to next state (e.g., `state=CO`)
3. Rename bot: `Recreation.gov - Colorado`
4. Run and download
5. Convert and merge
6. Repeat!

**Time per state:** ~10 minutes of bot runtime + 2 minutes conversion

---

## 🆚 Axiom vs. Scripts Comparison

| Feature | Axiom | Scripts |
|---------|-------|---------|
| **Technical skill** | None | Moderate |
| **Setup time** | 5 min | 15 min |
| **Cost** | $0-15/mo | Free |
| **Speed** | Medium | Fast |
| **Reliability** | High | Medium |
| **Customization** | Visual | Code |

**Best for:** People who prefer clicking over typing commands!

---

## 💡 Pro Tips

1. **Test with limit=10** first to validate
2. **Run overnight** if doing many states
3. **Save bot templates** for reuse across states
4. **Export to Google Sheets** for easy viewing
5. **Schedule runs** to keep data fresh automatically

---

## 🎓 Learning Resources

- [Axiom Getting Started Guide](https://axiom.ai/docs)
- [Axiom Video Tutorials](https://www.youtube.com/c/AxiomAI)
- [Scraping Best Practices](https://axiom.ai/blog/web-scraping-guide)

---

## 🤝 Need Help?

If you get stuck:
1. Check the Axiom bot logs (shows errors)
2. Slow down the bot (add more delays)
3. Ask in the Axiom Discord community
4. Or reach out and I can help debug your bot!

---

**Axiom = The easiest way to get real campsite data without touching code!** 🎉
