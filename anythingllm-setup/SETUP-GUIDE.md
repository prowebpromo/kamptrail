# AnythingLLM Setup Guide for Boondock or Bust

Complete guide to deploying AnythingLLM with Docker, configuring OpenRouter, and replacing Expertise.ai.

---

## Hosting Options

### Option A: Oracle Cloud Free Tier (Recommended - FREE)

Deploy on Oracle's always-free tier VM. See **[ORACLE-CLOUD-SETUP.md](ORACLE-CLOUD-SETUP.md)** for complete instructions.

**What you get FREE:**
- 1 OCPU, 1-6GB RAM VM (forever free)
- 50GB storage
- 10TB/month bandwidth

### Option B: Your Own VPS/Server

Use this guide if you already have a server with Docker.

---

## Prerequisites Checklist

- [ ] Server with Docker installed (Ubuntu 20.04+ recommended)
- [ ] At least 2GB RAM available (1GB works with swap)
- [ ] At least 10GB disk space
- [ ] Domain name (optional, for HTTPS)
- [ ] OpenRouter account with API key

---

## Phase 1: Deploy AnythingLLM with Docker

### Quick Deploy (Automated)

```bash
# Download and run the deployment script
chmod +x deploy-anythingllm.sh
./deploy-anythingllm.sh
```

### Manual Deploy

```bash
# 1. Create directory structure
mkdir -p ~/anythingllm
cd ~/anythingllm

# 2. Set up storage
export STORAGE_LOCATION="$HOME/anythingllm"
touch "$STORAGE_LOCATION/.env"

# 3. Pull the image
docker pull mintplexlabs/anythingllm:master

# 4. Run the container
docker run -d -p 3001:3001 \
  --name anythingllm \
  --cap-add SYS_ADMIN \
  --restart unless-stopped \
  -v ${STORAGE_LOCATION}:/app/server/storage \
  -v ${STORAGE_LOCATION}/.env:/app/server/.env \
  -e STORAGE_DIR="/app/server/storage" \
  mintplexlabs/anythingllm:master
```

### Verify Deployment

```bash
# Check container is running
docker ps | grep anythingllm

# View logs
docker logs -f anythingllm

# Access in browser
# http://localhost:3001 or http://YOUR_SERVER_IP:3001
```

### Phase 1 Checklist
- [ ] Docker container is running
- [ ] Can access AnythingLLM web interface
- [ ] Completed initial setup wizard (create admin account)

---

## Phase 2: Configure OpenRouter

### Step 2A: Get OpenRouter API Key

1. Go to https://openrouter.ai/
2. Sign up / Log in
3. Navigate to API Keys section
4. Create a new API key
5. **Important**: Set spending limits in OpenRouter dashboard
   - Monthly budget: Start with $10-30/month
   - Enable alerts at 50%, 75%, 90%

### Step 2B: Configure in AnythingLLM

1. Log into AnythingLLM admin panel
2. Go to **Settings** (gear icon)
3. Navigate to **LLM Configuration**
4. Select **OpenRouter** as provider
5. Paste your OpenRouter API key
6. Select your model (see recommendations below)

### Recommended Models (Cost vs Quality)

| Model | Cost (per 1M tokens) | Best For |
|-------|---------------------|----------|
| `deepseek/deepseek-r1` | Free tier available | Budget testing |
| `google/gemini-flash-1.5` | ~$0.075/$0.30 | Best budget option |
| `meta-llama/llama-3.1-8b-instruct` | Very low | High volume |
| `mistral/mistral-small` | Low | Good balance |
| `anthropic/claude-3-haiku` | ~$0.25/$1.25 | Better quality |

### Recommended Settings

```
Max Tokens: 500-700 (keeps responses concise)
Temperature: 0.3 (reduces randomness)
Top P: 0.9 (standard)
```

### Phase 2 Checklist
- [ ] OpenRouter account created
- [ ] API key generated
- [ ] Spending limits set in OpenRouter
- [ ] OpenRouter configured in AnythingLLM
- [ ] Model selected and tested

---

## Phase 3: Website-First Configuration

### Step 3A: Create Workspace

1. In AnythingLLM, click **New Workspace**
2. Name it: `BoondockorBust` (or your site name)
3. Click Create

### Step 3B: Ingest Website Content

**Option 1: Sitemap Ingestion (Recommended)**

1. Go to workspace
2. Click **Upload Documents** or **Add Content**
3. Select **Website/URL** option
4. Enter your sitemap URL: `https://boondockorbust.com/sitemap.xml`
5. Select pages to index (exclude thin content)

**Option 2: Manual URL Addition**

Add important pages individually:
- Homepage
- Key category pages
- Popular articles
- FAQ/About pages

**Pages to EXCLUDE:**
- `/tag/*` (tag archives)
- `/author/*` (author pages)
- `/page/*` (pagination)
- Outdated or thin content

### Step 3C: Configure Query Mode (CRITICAL)

1. Go to **Workspace Settings**
2. Find **Chat Mode** or **Query Settings**
3. Set to **Query Mode**
4. This ensures the bot only answers from your documents!

### Step 3D: Add System Prompt

1. Go to **Workspace Settings** → **System Prompt**
2. Copy contents from `system-prompt.txt` (included in this folder)
3. Save changes

### Phase 3 Checklist
- [ ] Workspace created
- [ ] Website content ingested
- [ ] Unnecessary pages excluded
- [ ] Query mode enabled
- [ ] System prompt configured
- [ ] Test chat returns website-based answers

---

## Phase 4: Widget Deployment

### Step 4A: Remove Expertise.ai

Search your WordPress for Expertise.ai code and remove:

**In Theme Files:**
- `header.php`
- `footer.php`
- `functions.php`

**In Google Tag Manager:**
- Custom HTML tags with Expertise.ai scripts

**What to look for:**
```html
<!-- Remove anything like this -->
<script src="...expertise.ai..."></script>
<script>...expertise...widget...</script>
```

### Step 4B: Create AnythingLLM Embed Widget

1. In AnythingLLM, go to your workspace
2. Navigate to **Settings** → **Chat Widget** or **Embed**
3. Configure the widget:

```
Chat Method: Query (website-first!)
Domain Whitelist:
  - boondockorbust.com
  - www.boondockorbust.com
Chat Limits:
  - Per session: 20
  - Daily per IP: 50
Appearance:
  - Position: bottom-right
  - Assistant Name: Boondock or Bust Assistant
  - Colors: Match your brand
```

4. Copy the generated embed code

### Step 4C: Add Widget to WordPress

**Option 1: Theme Header (Recommended)**

Add to `header.php` before `</head>`:

```html
<script
  defer
  src="https://YOUR-ANYTHINGLLM-DOMAIN:3001/api/embed/YOUR-WORKSPACE-ID"
  data-embed-id="YOUR-EMBED-ID"
  data-position="bottom-right"
  data-assistant-name="Boondock or Bust Assistant"
  data-window-height="70vh"
  data-window-width="400px">
</script>
```

**Option 2: Plugin Method**

1. Install "Insert Headers and Footers" plugin
2. Go to Settings → Insert Headers and Footers
3. Paste embed code in "Scripts in Header" section
4. Save

**Option 3: GTM**

1. In GTM, create new Tag
2. Type: Custom HTML
3. Paste embed code
4. Trigger: All Pages
5. Publish

### Phase 4 Checklist
- [ ] Expertise.ai code removed
- [ ] AnythingLLM embed widget configured
- [ ] Domain whitelist set
- [ ] Widget embedded in WordPress
- [ ] Widget appears on site

---

## Phase 5: Production Setup (HTTPS)

### Set Up Reverse Proxy with Nginx

```bash
# 1. Install Nginx
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx

# 2. Copy the nginx config
sudo cp nginx-anythingllm.conf /etc/nginx/sites-available/anythingllm

# 3. Edit and replace YOUR_DOMAIN
sudo nano /etc/nginx/sites-available/anythingllm

# 4. Enable the site
sudo ln -s /etc/nginx/sites-available/anythingllm /etc/nginx/sites-enabled/

# 5. Get SSL certificate
sudo certbot certonly --nginx -d YOUR_DOMAIN

# 6. Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### Update Widget URL

After setting up HTTPS, update your embed code:
```html
src="https://chat.yourdomain.com/api/embed/..."
```

### Phase 5 Checklist
- [ ] Nginx installed
- [ ] SSL certificate obtained
- [ ] Reverse proxy configured
- [ ] HTTPS working
- [ ] Widget updated to use HTTPS URL

---

## Phase 6: Cost Controls

### 1. Rate Limiting (Already in Nginx config)
- 10 requests/minute for chat endpoints
- Burst allowance of 5 requests

### 2. OpenRouter Limits
- [ ] Set monthly budget ($10-30 to start)
- [ ] Enable spending alerts
- [ ] Review usage weekly

### 3. Widget Limits
- [ ] Per-session chat limit: 20
- [ ] Daily limit per IP: 50

### 4. System Prompt Cost Controls
The system prompt includes:
- Permission gate before general knowledge
- Concise response instructions
- Abuse prevention

---

## Phase 7: Pre-Launch QA

### Functional Tests
- [ ] Widget loads on desktop
- [ ] Widget loads on mobile (doesn't cover key UI)
- [ ] Answers cite website content when available
- [ ] Permission prompt appears for general knowledge
- [ ] Widget respects domain whitelist
- [ ] Rate limits trigger correctly (test with rapid requests)

### Content Quality
- [ ] Bot doesn't invent information
- [ ] Responses are concise and relevant
- [ ] "I don't know" responses are appropriate

### Performance
- [ ] Page load speed unchanged
- [ ] Widget loads deferred (after page interactive)
- [ ] Core Web Vitals unaffected

### Security
- [ ] OpenRouter API key NOT visible in browser source
- [ ] Admin routes not publicly accessible
- [ ] Backups configured for ~/anythingllm directory

---

## Maintenance

### Weekly
- [ ] Review OpenRouter costs
- [ ] Check chat logs for quality
- [ ] Monitor for abuse patterns

### Monthly
- [ ] Update AnythingLLM: `docker pull mintplexlabs/anythingllm:master`
- [ ] Restart container: `docker restart anythingllm`
- [ ] Review and optimize system prompt

### Quarterly
- [ ] Re-ingest website content (for new articles)
- [ ] Test new cost-effective models
- [ ] Review rate limits based on traffic

---

## Troubleshooting

### Widget doesn't appear
1. Check browser console for errors
2. Verify domain is in whitelist
3. Check script URL is correct
4. Ensure container is running: `docker ps`

### Bot uses AI for everything (not documents)
1. Verify workspace is in "Query" mode
2. Check documents were properly ingested
3. Review system prompt
4. Re-ingest documents if needed

### High costs
1. Check OpenRouter dashboard for model usage
2. Reduce max_tokens setting
3. Implement stricter rate limiting
4. Review chat logs for abuse

### Container issues
```bash
# View logs
docker logs -f anythingllm

# Restart container
docker restart anythingllm

# Full reset (warning: may lose data)
docker stop anythingllm
docker rm anythingllm
./deploy-anythingllm.sh
```

---

## Useful Commands Reference

```bash
# Container management
docker ps                          # List running containers
docker logs -f anythingllm         # Follow logs
docker restart anythingllm         # Restart
docker stop anythingllm            # Stop
docker start anythingllm           # Start

# Updates
docker pull mintplexlabs/anythingllm:master  # Pull latest
docker stop anythingllm && docker rm anythingllm  # Remove old
./deploy-anythingllm.sh            # Redeploy

# Backup
tar -czvf anythingllm-backup-$(date +%Y%m%d).tar.gz ~/anythingllm

# Nginx
sudo nginx -t                      # Test config
sudo systemctl reload nginx        # Reload
sudo tail -f /var/log/nginx/anythingllm_*.log  # View logs
```

---

## Expected Costs Comparison

| Service | Monthly Cost |
|---------|--------------|
| Expertise.ai (current) | $50-200+ |
| AnythingLLM + OpenRouter | $5-30 |
| **Savings** | **~90%** |

---

## Files in This Setup Package

1. `deploy-anythingllm.sh` - Automated deployment script
2. `nginx-anythingllm.conf` - Nginx reverse proxy configuration
3. `system-prompt.txt` - System prompt for workspace
4. `SETUP-GUIDE.md` - This documentation

---

## Support Resources

- AnythingLLM Docs: https://docs.useanything.com/
- AnythingLLM Discord: https://discord.gg/anythingllm
- OpenRouter Docs: https://openrouter.ai/docs
