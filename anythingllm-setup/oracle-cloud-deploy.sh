#!/bin/bash

#################################################################
# AnythingLLM Deployment Script for Oracle Cloud Free Tier
#
# Supports: Oracle Linux 8, Ubuntu 22.04
#
# Run this AFTER:
#   1. Creating your Oracle Cloud VM
#   2. Connecting via SSH
#   3. Opening firewall ports in OCI Security List
#################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  AnythingLLM - Oracle Cloud Free Tier Setup   ${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Detect OS
if [ -f /etc/oracle-release ]; then
    OS="oracle"
    echo -e "${GREEN}Detected: Oracle Linux${NC}"
elif [ -f /etc/lsb-release ]; then
    OS="ubuntu"
    echo -e "${GREEN}Detected: Ubuntu${NC}"
else
    echo -e "${RED}Unsupported OS. This script supports Oracle Linux and Ubuntu.${NC}"
    exit 1
fi

echo ""

#################################################################
# STEP 1: Open OS Firewall
#################################################################
echo -e "${BLUE}Step 1: Configuring OS firewall...${NC}"

if [ "$OS" = "oracle" ]; then
    sudo firewall-cmd --permanent --add-port=3001/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=80/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=443/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
    echo -e "${GREEN}✓ Firewall configured (Oracle Linux)${NC}"
elif [ "$OS" = "ubuntu" ]; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3001 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    sudo netfilter-persistent save 2>/dev/null || sudo apt install -y iptables-persistent
    echo -e "${GREEN}✓ Firewall configured (Ubuntu)${NC}"
fi

#################################################################
# STEP 2: Install Docker
#################################################################
echo ""
echo -e "${BLUE}Step 2: Installing Docker...${NC}"

if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker already installed${NC}"
else
    if [ "$OS" = "oracle" ]; then
        sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    elif [ "$OS" = "ubuntu" ]; then
        sudo apt update
        sudo apt install -y ca-certificates curl gnupg lsb-release
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        sudo apt update
        sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    fi
    echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Start Docker
sudo systemctl enable docker
sudo systemctl start docker

# Add user to docker group
sudo usermod -aG docker $USER
echo -e "${GREEN}✓ Docker service started${NC}"

#################################################################
# STEP 3: Add Swap (Recommended for 1GB instances)
#################################################################
echo ""
echo -e "${BLUE}Step 3: Checking memory and swap...${NC}"

TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
echo "Total RAM: ${TOTAL_MEM}MB"

if [ "$TOTAL_MEM" -lt 2000 ]; then
    if [ ! -f /swapfile ]; then
        echo "Low memory detected. Adding 2GB swap..."
        sudo fallocate -l 2G /swapfile
        sudo chmod 600 /swapfile
        sudo mkswap /swapfile
        sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
        echo -e "${GREEN}✓ 2GB swap added${NC}"
    else
        echo -e "${GREEN}✓ Swap already exists${NC}"
    fi
else
    echo -e "${GREEN}✓ Sufficient memory available${NC}"
fi

#################################################################
# STEP 4: Deploy AnythingLLM
#################################################################
echo ""
echo -e "${BLUE}Step 4: Deploying AnythingLLM...${NC}"

# Set storage location
export STORAGE_LOCATION="$HOME/anythingllm"
mkdir -p "$STORAGE_LOCATION"
touch "$STORAGE_LOCATION/.env"

# Check if container exists
if docker ps -a --format '{{.Names}}' | grep -q "^anythingllm$"; then
    echo -e "${YELLOW}AnythingLLM container already exists.${NC}"
    read -p "Remove and recreate? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo docker stop anythingllm 2>/dev/null || true
        sudo docker rm anythingllm 2>/dev/null || true
    else
        echo "Keeping existing container."
        SKIP_DEPLOY=true
    fi
fi

if [ "$SKIP_DEPLOY" != "true" ]; then
    echo "Pulling AnythingLLM image (this may take a few minutes)..."
    sudo docker pull mintplexlabs/anythingllm:master

    echo "Starting container..."
    sudo docker run -d -p 3001:3001 \
        --name anythingllm \
        --cap-add SYS_ADMIN \
        --restart unless-stopped \
        -v ${STORAGE_LOCATION}:/app/server/storage \
        -v ${STORAGE_LOCATION}/.env:/app/server/.env \
        -e STORAGE_DIR="/app/server/storage" \
        mintplexlabs/anythingllm:master

    echo -e "${GREEN}✓ AnythingLLM deployed${NC}"
fi

#################################################################
# STEP 5: Get IP and Display Info
#################################################################
echo ""
sleep 3

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_PUBLIC_IP")

# Check if container is running
if sudo docker ps --format '{{.Names}}' | grep -q "^anythingllm$"; then
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}    AnythingLLM Deployed Successfully!         ${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "${BLUE}Access URL:${NC}"
    echo "  http://${PUBLIC_IP}:3001"
    echo ""
    echo -e "${YELLOW}IMPORTANT: You need to log out and back in${NC}"
    echo -e "${YELLOW}for docker group permissions to take effect.${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "1. Open http://${PUBLIC_IP}:3001 in your browser"
    echo "2. Complete the setup wizard"
    echo "3. Configure OpenRouter (Settings → LLM)"
    echo "4. Create workspace and ingest your website"
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  sudo docker logs -f anythingllm    # View logs"
    echo "  sudo docker restart anythingllm    # Restart"
    echo "  sudo docker ps                     # Check status"
    echo ""
    echo -e "${YELLOW}For HTTPS setup, see ORACLE-CLOUD-SETUP.md Phase 7${NC}"
else
    echo -e "${RED}Container failed to start. Check logs:${NC}"
    echo "  sudo docker logs anythingllm"
fi
