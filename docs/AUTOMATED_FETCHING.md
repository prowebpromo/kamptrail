# 🤖 Automated Campsite Data Fetching

## Zero Technical Skills Required - Just Click Buttons!

This guide shows you how to fetch **real campsite data automatically** using GitHub Actions - no command line, no local installation, just clicking buttons in your browser.

---

## 🎯 What This Does

When you click a button on GitHub:
1. ✅ **GitHub's servers** run the browser automation scripts
2. ✅ Scrapes **Recreation.gov** for federal campgrounds
3. ✅ Scrapes **Campendium** for user ratings & reviews
4. ✅ Merges data intelligently (removes duplicates)
5. ✅ Automatically commits results to your repository
6. ✅ **You don't do anything** - it's all automatic!

**Cost:** $0 - GitHub Actions is free for public repositories!

---

## 🚀 Quick Start (First Time Setup - 2 minutes)

### Step 1: Enable GitHub Actions

1. Go to your repository: `https://github.com/prowebpromo/kamptrail`
2. Click **"Settings"** (top menu)
3. Click **"Actions"** → **"General"** (left sidebar)
4. Under **"Workflow permissions"**, select:
   - ✅ **"Read and write permissions"**
5. Click **"Save"**

**That's it!** Setup complete. You only do this once.

---

## 🎬 How to Fetch Data (Every Time)

### Option 1: Single State (Quick Fetch - 5 minutes)

Perfect for testing or updating just one state:

1. Go to: `https://github.com/prowebpromo/kamptrail/actions`
2. Click **"🎯 Quick Fetch (Single State)"** in the left sidebar
3. Click the **"Run workflow"** dropdown button (right side)
4. Choose your state (e.g., **California**)
5. Set max campsites (e.g., **50**)
6. Click **"Run workflow"** (green button)
7. ☕ Wait 5-10 minutes
8. ✅ Data is automatically committed!

**Example settings:**
```
State: CA
Max campsites: 50
```

---

### Option 2: Multiple States (Full Fetch - 30-60 minutes)

Perfect for updating many states at once:

1. Go to: `https://github.com/prowebpromo/kamptrail/actions`
2. Click **"🏕️ Fetch Campsite Data (Automated)"** in the left sidebar
3. Click **"Run workflow"** dropdown
4. Enter states (space-separated): `CA CO UT AZ OR WA MT WY`
5. Set max per state: `50`
6. Click **"Run workflow"**
7. ☕ Wait 30-60 minutes (depending on number of states)
8. ✅ All data committed automatically!

**Example settings:**
```
States to fetch: CA CO UT AZ OR WA MT WY
Max campsites per state: 50
```

---

### Option 3: Automatic Weekly Updates

Set it and forget it!

The workflow is **already configured** to run automatically:
- **Every Sunday at 3 AM UTC**
- Fetches popular camping states
- You don't need to do anything!

To disable automatic runs:
1. Go to `.github/workflows/fetch-campsite-data.yml`
2. Comment out the `schedule:` section

---

## 📊 Monitoring Your Workflow

### While It's Running:

1. Go to **Actions** tab
2. Click on the running workflow (orange dot)
3. Click **"fetch-data"** or **"quick-fetch"** job
4. Watch real-time logs! You'll see:
   ```
   🗺️  Processing: CA
   📍 [1/3] Fetching Recreation.gov data...
   ✅ Recreation.gov data fetched
   ⭐ [2/3] Fetching Campendium reviews...
   ✅ Campendium data fetched
   🔄 [3/3] Merging data sources...
   ✅ CA: 45 campsites
   ```

### When It's Done:

1. Green checkmark ✅ = Success!
2. Red X ❌ = Failed (check logs)
3. Click on the run → **"Summary"** tab to see:
   - States processed
   - Total campsites fetched
   - Files updated

---

## 📁 Where's My Data?

After the workflow completes:

1. Go to your repository
2. Navigate to: `data/campsites/`
3. You'll see files like:
   - `CA.geojson` (California campgrounds)
   - `CO.geojson` (Colorado campgrounds)
   - `index.json` (summary of all states)

**The data is automatically committed** - you don't need to download anything!

---

## 🎨 Visual Guide

```
┌─────────────────────────────────────────────────────────┐
│  GitHub.com → Your Repository → Actions Tab            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Workflows (Left Sidebar):                              │
│  • 🏕️ Fetch Campsite Data (Automated)   ← All states   │
│  • 🎯 Quick Fetch (Single State)        ← One state    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Click "Run workflow" dropdown (right side)             │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ State: [California ▼]                       │       │
│  │ Max campsites: [50____________]             │       │
│  │                                             │       │
│  │        [ Run workflow ]                     │       │
│  └─────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  ⏳ Workflow Running...                                 │
│  (Click to see live logs)                               │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  ✅ Workflow Complete!                                  │
│                                                         │
│  📊 States Processed: 1                                 │
│  🏕️  Total Campsites: 45                                │
│  📁 Files Updated: CA.geojson                           │
└─────────────────────────────────────────────────────────┘
```

---

## ⚙️ Configuration Options

### Workflow Inputs:

| Setting | Description | Example | Default |
|---------|-------------|---------|---------|
| **States** | Space-separated state codes | `CA CO UT` | `CA CO UT AZ OR WA MT WY` |
| **Max campsites** | Limit per state | `50` | `50` |

### Best Practices:

- **Testing**: Start with 1 state, limit=25
- **Production**: Use limit=50-100 per state
- **Rate limiting**: Built-in 10-second delays between states

---

## 🔧 Troubleshooting

### Workflow Fails with "Permission Denied"

**Fix:**
1. Settings → Actions → General
2. Enable "Read and write permissions"
3. Save and re-run

### No Data Fetched (0 campsites)

**Cause:** Website structure changed or rate limit hit

**Fix:**
1. Check the logs for specific errors
2. Try again in 30 minutes
3. Reduce the limit to 25

### Workflow Times Out

**Cause:** Too many states or slow network

**Fix:**
1. Reduce number of states
2. Run multiple smaller batches
3. Use "Quick Fetch" for individual states

---

## 📈 Example Workflow Run

```yaml
Trigger: Manual button click
Input: States = "CA CO UT", Limit = 50

Timeline:
00:00 - Workflow starts
00:30 - Setup complete
01:00 - California: 45 campsites ✅
12:00 - Colorado: 52 campsites ✅
23:00 - Utah: 38 campsites ✅
24:00 - Data merged & committed ✅
25:00 - Workflow complete! 🎉

Result:
✅ 3 states processed
✅ 135 total campsites
✅ Automatically committed to repository
```

---

## 🆚 Comparison: Manual vs Automated

| Task | Manual (Local) | **Automated (GitHub)** |
|------|----------------|----------------------|
| Install Node.js | ✅ Required | ❌ Not needed |
| Install Playwright | ✅ Required | ❌ Not needed |
| Run commands | ✅ Required | ❌ Just click button |
| Commit changes | ✅ Manual | ✅ Automatic |
| Technical skill | High | **Zero** |
| Your effort | 30+ minutes | **30 seconds** |
| Cost | Free | **Free** |

**Winner:** Automated! 🏆

---

## 💡 Pro Tips

1. **Test first**: Run California with limit=10 to verify
2. **Monitor logs**: Watch the live progress in Actions tab
3. **Check commits**: See the auto-generated commit messages
4. **Schedule wisely**: Sunday 3 AM = low traffic time
5. **Batch processing**: Do 3-5 states at a time for reliability

---

## 📋 Checklist: First Data Fetch

- [ ] Enable GitHub Actions write permissions (Settings → Actions)
- [ ] Go to Actions tab
- [ ] Click "🎯 Quick Fetch (Single State)"
- [ ] Click "Run workflow"
- [ ] Select state: **California**
- [ ] Set limit: **25** (for testing)
- [ ] Click "Run workflow" button
- [ ] Wait 5-10 minutes
- [ ] Check for green checkmark ✅
- [ ] View data at `data/campsites/CA.geojson`
- [ ] Success! Now try more states 🎉

---

## 🎓 Next Steps

After your first successful fetch:

1. **Test the data**: Open your KampTrail app and verify campgrounds appear
2. **Fetch more states**: Run workflow for other popular states
3. **Enable auto-updates**: Let it run weekly automatically
4. **Relax**: You now have real campsite data with zero effort!

---

## 🆘 Need Help?

If something goes wrong:

1. **Check the logs**: Actions → Click on run → View logs
2. **Look for errors**: Red error messages tell you what failed
3. **Try again**: Many errors are temporary (network issues)
4. **Reduce scope**: Fetch fewer states or lower the limit

Common error patterns:
- `403 Forbidden` → Website blocking, try again later
- `Timeout` → Too slow, reduce limit or states
- `Permission denied` → Enable write permissions in Settings

---

## 🎉 You're Done!

**Congratulations!** You now have:
- ✅ Zero-effort campsite data fetching
- ✅ Automatic weekly updates
- ✅ Real campground names, ratings, and GPS coordinates
- ✅ No command line required
- ✅ Completely free!

Just click a button, wait, and your data is updated. It doesn't get easier than this! 🚀
