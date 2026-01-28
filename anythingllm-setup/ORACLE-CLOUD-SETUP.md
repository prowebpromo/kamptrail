# AnythingLLM on Oracle Cloud Free Tier

Complete guide to deploying AnythingLLM for **FREE** on Oracle Cloud Infrastructure (OCI).

## What You Get (Always Free)

- **1 AMD VM** with 1 OCPU, 1GB RAM (or up to 4 ARM Ampere OCPUs, 24GB RAM)
- **50GB boot volume** storage
- **10TB/month outbound data**
- **No time limit** - truly free forever (not a trial)

---

## Phase 1: Create Oracle Cloud Account

### Step 1: Sign Up

1. Go to: https://www.oracle.com/cloud/free/
2. Click **"Start for free"**
3. Fill in your details:
   - Email address
   - Country (select your actual country)
   - Name
4. Verify your email
5. Set a password
6. **Payment method required** (for verification only - free tier won't charge)
   - Credit card is verified but NOT charged for free tier resources
   - You'll be on "Always Free" tier, not a trial

### Step 2: Choose Home Region

**Important:** Select a region close to your website visitors:
- US East (Ashburn) - US visitors
- US West (Phoenix) - US West Coast
- UK South (London) - European visitors

Your home region **cannot be changed later**.

### Step 3: Complete Setup

- Wait for account provisioning (can take 10-30 minutes)
- You'll receive email when ready

### Phase 1 Checklist
- [ ] Oracle Cloud account created
- [ ] Email verified
- [ ] Payment method added (for verification)
- [ ] Home region selected
- [ ] Account activated (check email)

---

## Phase 2: Create Free Tier VM Instance

### Step 1: Navigate to Compute

1. Log into Oracle Cloud Console: https://cloud.oracle.com/
2. Click the hamburger menu (☰) top-left
3. Go to **Compute** → **Instances**
4. Click **"Create instance"**

### Step 2: Configure Instance

**Name and Compartment:**
```
Name: anythingllm-server
Compartment: (leave as default/root)
```

**Placement:**
```
Availability domain: (leave default)
```

**Image and Shape (CRITICAL - Select Free Tier):**

Click **"Edit"** in the Image and shape section:

**Option A: AMD (Simpler, 1GB RAM)**
```
Image: Oracle Linux 8 (or Ubuntu 22.04)
Shape: VM.Standard.E2.1.Micro (Always Free eligible)
  - 1 OCPU
  - 1 GB RAM
```

**Option B: ARM Ampere (More powerful, recommended)**
```
Image: Oracle Linux 8 (or Ubuntu 22.04) - Aarch64
Shape: VM.Standard.A1.Flex (Always Free eligible)
  - OCPUs: 1 (can use up to 4 free)
  - Memory: 6 GB (can use up to 24GB free)
```

**Recommended:** ARM Ampere with 1 OCPU and 6GB RAM gives better performance.

### Step 3: Networking

```
Virtual cloud network: Create new VCN
  - Name: anythingllm-vcn
Subnet: Create new public subnet
  - Name: anythingllm-subnet
Public IPv4 address: Assign a public IPv4 address (REQUIRED)
```

### Step 4: SSH Keys

**Option A: Generate new key pair**
1. Select "Generate a key pair for me"
2. Click **"Save private key"** - SAVE THIS FILE! (e.g., `ssh-key-anythingllm.key`)
3. Also save public key

**Option B: Upload your existing public key**
- If you have `~/.ssh/id_rsa.pub`, paste it here

### Step 5: Boot Volume

```
Boot volume size: 50 GB (default, free)
Use in-transit encryption: checked
```

### Step 6: Create Instance

1. Click **"Create"**
2. Wait for instance to be **RUNNING** (2-5 minutes)
3. Copy the **Public IP address** shown

### Phase 2 Checklist
- [ ] Instance created with Always Free shape
- [ ] Public IP address assigned
- [ ] SSH private key saved locally
- [ ] Instance status is RUNNING

---

## Phase 3: Configure Firewall (Allow Port 3001)

Oracle Cloud has TWO firewalls - you need to open both.

### Step 1: OCI Security List (Cloud Firewall)

1. Go to **Networking** → **Virtual Cloud Networks**
2. Click on your VCN (anythingllm-vcn)
3. Click on your **Subnet** (anythingllm-subnet)
4. Click on the **Security List** (Default Security List...)
5. Click **"Add Ingress Rules"**

Add these rules:

**Rule 1: HTTP (Port 80)**
```
Source Type: CIDR
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Destination Port Range: 80
Description: HTTP
```

**Rule 2: HTTPS (Port 443)**
```
Source Type: CIDR
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Destination Port Range: 443
Description: HTTPS
```

**Rule 3: AnythingLLM (Port 3001)**
```
Source Type: CIDR
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Destination Port Range: 3001
Description: AnythingLLM
```

### Step 2: OS Firewall (Inside the VM)

This will be done after connecting via SSH (next phase).

### Phase 3 Checklist
- [ ] Port 80 ingress rule added
- [ ] Port 443 ingress rule added
- [ ] Port 3001 ingress rule added

---

## Phase 4: Connect to Your Server

### Step 1: Set SSH Key Permissions (Mac/Linux)

```bash
chmod 400 ~/Downloads/ssh-key-anythingllm.key
```

### Step 2: SSH into Server

**For Oracle Linux / Ubuntu:**
```bash
# Oracle Linux default user is 'opc'
ssh -i ~/Downloads/ssh-key-anythingllm.key opc@YOUR_PUBLIC_IP

# Ubuntu default user is 'ubuntu'
ssh -i ~/Downloads/ssh-key-anythingllm.key ubuntu@YOUR_PUBLIC_IP
```

Replace `YOUR_PUBLIC_IP` with the IP from your instance.

### Step 3: Open OS Firewall Ports

Once connected via SSH, run:

**For Oracle Linux 8:**
```bash
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

**For Ubuntu:**
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3001 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Phase 4 Checklist
- [ ] Successfully connected via SSH
- [ ] OS firewall ports opened (3001, 80, 443)

---

## Phase 5: Install Docker

### For Oracle Linux 8:

```bash
# Install Docker
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker
sudo systemctl enable docker
sudo systemctl start docker

# Add your user to docker group (avoid using sudo)
sudo usermod -aG docker $USER

# Log out and back in for group change to take effect
exit
```

Then SSH back in and verify:
```bash
docker --version
docker run hello-world
```

### For Ubuntu 22.04:

```bash
# Update and install prerequisites
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

# Add Docker's GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in
exit
```

SSH back in and verify:
```bash
docker --version
docker run hello-world
```

### Phase 5 Checklist
- [ ] Docker installed
- [ ] Docker service running
- [ ] Can run `docker run hello-world` without sudo

---

## Phase 6: Deploy AnythingLLM

### Step 1: Create Directory Structure

```bash
mkdir -p ~/anythingllm
cd ~/anythingllm
touch .env
```

### Step 2: Pull and Run AnythingLLM

```bash
export STORAGE_LOCATION="$HOME/anythingllm"

docker run -d -p 3001:3001 \
  --name anythingllm \
  --cap-add SYS_ADMIN \
  --restart unless-stopped \
  -v ${STORAGE_LOCATION}:/app/server/storage \
  -v ${STORAGE_LOCATION}/.env:/app/server/.env \
  -e STORAGE_DIR="/app/server/storage" \
  mintplexlabs/anythingllm:master
```

### Step 3: Verify It's Running

```bash
# Check container status
docker ps

# View logs
docker logs -f anythingllm
```

### Step 4: Access AnythingLLM

Open in your browser:
```
http://YOUR_PUBLIC_IP:3001
```

You should see the AnythingLLM setup wizard!

### Phase 6 Checklist
- [ ] AnythingLLM container running
- [ ] Can access web interface at http://IP:3001
- [ ] Completed initial setup wizard

---

## Phase 7: Set Up Custom Domain with HTTPS (Recommended)

### Step 1: Point Domain to Oracle Cloud

In your domain's DNS settings, add an A record:
```
Type: A
Name: chat (or @ for root domain)
Value: YOUR_ORACLE_PUBLIC_IP
TTL: 300
```

Example: `chat.boondockorbust.com` → `YOUR_IP`

### Step 2: Install Nginx and Certbot

**Oracle Linux 8:**
```bash
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

**Ubuntu:**
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Step 3: Configure Nginx

```bash
sudo nano /etc/nginx/conf.d/anythingllm.conf
```

Paste this (replace `chat.yourdomain.com`):

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
```

Test and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 4: Get SSL Certificate

```bash
sudo certbot --nginx -d chat.yourdomain.com
```

Follow the prompts:
- Enter email
- Agree to terms
- Choose to redirect HTTP to HTTPS (recommended)

### Step 5: Verify HTTPS

Open: `https://chat.yourdomain.com`

### Phase 7 Checklist
- [ ] Domain DNS pointing to Oracle IP
- [ ] Nginx installed and configured
- [ ] SSL certificate obtained
- [ ] HTTPS working

---

## Phase 8: Configure AnythingLLM

Now follow the main setup guide for:

1. **Configure OpenRouter** - Add API key in Settings → LLM
2. **Create Workspace** - Name it for your site
3. **Ingest Website Content** - Add your sitemap
4. **Set Query Mode** - Website-first behavior
5. **Add System Prompt** - Copy from `system-prompt.txt`
6. **Create Embed Widget** - Get code for WordPress

---

## Maintenance Commands

```bash
# View logs
docker logs -f anythingllm

# Restart container
docker restart anythingllm

# Update AnythingLLM
docker pull mintplexlabs/anythingllm:master
docker stop anythingllm
docker rm anythingllm
# Then re-run the docker run command from Phase 6

# Backup data
tar -czvf anythingllm-backup-$(date +%Y%m%d).tar.gz ~/anythingllm

# Check disk space
df -h
```

---

## Troubleshooting

### Can't connect to port 3001
1. Check OCI Security List has ingress rule for 3001
2. Check OS firewall: `sudo firewall-cmd --list-all` (Oracle Linux)
3. Verify container is running: `docker ps`

### Container won't start
```bash
docker logs anythingllm
```
Usually a port conflict or storage permission issue.

### Out of memory (1GB RAM)
The 1GB AMD instance might struggle. Options:
- Use ARM Ampere instance with 6GB RAM instead
- Reduce AnythingLLM cache settings
- Add swap space:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### SSL certificate renewal
Certbot auto-renews, but test with:
```bash
sudo certbot renew --dry-run
```

---

## Cost Summary

| Item | Cost |
|------|------|
| Oracle Cloud VM | **FREE** (Always Free tier) |
| Storage (50GB) | **FREE** |
| Bandwidth (10TB/mo) | **FREE** |
| Domain (optional) | ~$10-15/year |
| OpenRouter API | $5-30/month (usage-based) |
| **Total** | **$5-30/month** |

---

## Quick Reference

```
Oracle Cloud Console: https://cloud.oracle.com/
Your Instance IP: ________________
SSH Command: ssh -i ~/path/to/key opc@YOUR_IP
AnythingLLM URL: http://YOUR_IP:3001
Custom Domain: https://chat.yourdomain.com
```
