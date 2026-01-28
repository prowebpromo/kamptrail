#!/bin/bash

#################################################################
# AnythingLLM Docker Deployment Script
# For: Boondock or Bust / KampTrail
#
# Prerequisites:
#   - Docker installed and running
#   - At least 2GB RAM available
#   - At least 10GB disk space
#################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}   AnythingLLM Docker Deployment Script    ${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}"
    echo ""
    echo "Install Docker first:"
    echo "  Ubuntu/Debian: curl -fsSL https://get.docker.com | sh"
    echo "  Then add your user to docker group: sudo usermod -aG docker \$USER"
    echo "  Log out and back in, then run this script again."
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    echo -e "${RED}ERROR: Docker daemon is not running.${NC}"
    echo "Start Docker with: sudo systemctl start docker"
    exit 1
fi

echo -e "${GREEN}✓ Docker is installed and running${NC}"

# Set storage location
export STORAGE_LOCATION="${ANYTHINGLLM_STORAGE:-$HOME/anythingllm}"

echo ""
echo -e "${YELLOW}Storage location: ${STORAGE_LOCATION}${NC}"
echo ""

# Step 1: Create directory structure
echo -e "${BLUE}Step 1: Setting up directory structure...${NC}"
mkdir -p "$STORAGE_LOCATION"
touch "$STORAGE_LOCATION/.env"
echo -e "${GREEN}✓ Directory structure created${NC}"

# Step 2: Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^anythingllm$"; then
    echo ""
    echo -e "${YELLOW}AnythingLLM container already exists.${NC}"
    read -p "Do you want to remove it and create a fresh one? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping and removing existing container..."
        docker stop anythingllm 2>/dev/null || true
        docker rm anythingllm 2>/dev/null || true
        echo -e "${GREEN}✓ Old container removed${NC}"
    else
        echo "Keeping existing container. Exiting."
        exit 0
    fi
fi

# Step 3: Pull the latest image
echo ""
echo -e "${BLUE}Step 2: Pulling latest AnythingLLM image...${NC}"
echo "(This may take a few minutes)"
docker pull mintplexlabs/anythingllm:master
echo -e "${GREEN}✓ Image pulled successfully${NC}"

# Step 4: Run the container
echo ""
echo -e "${BLUE}Step 3: Starting AnythingLLM container...${NC}"
docker run -d -p 3001:3001 \
    --name anythingllm \
    --cap-add SYS_ADMIN \
    --restart unless-stopped \
    -v "${STORAGE_LOCATION}:/app/server/storage" \
    -v "${STORAGE_LOCATION}/.env:/app/server/.env" \
    -e STORAGE_DIR="/app/server/storage" \
    mintplexlabs/anythingllm:master

echo -e "${GREEN}✓ Container started successfully${NC}"

# Wait for container to be ready
echo ""
echo -e "${BLUE}Step 4: Waiting for AnythingLLM to start...${NC}"
sleep 5

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^anythingllm$"; then
    echo -e "${GREEN}✓ AnythingLLM is running!${NC}"
else
    echo -e "${RED}ERROR: Container failed to start${NC}"
    echo "Check logs with: docker logs anythingllm"
    exit 1
fi

# Get IP addresses
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_PUBLIC_IP")

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}   AnythingLLM Deployed Successfully!      ${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo "  Local:    http://localhost:3001"
echo "  Network:  http://${LOCAL_IP}:3001"
if [ "$PUBLIC_IP" != "YOUR_PUBLIC_IP" ]; then
    echo "  Public:   http://${PUBLIC_IP}:3001"
fi
echo ""
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo "1. Open http://localhost:3001 in your browser"
echo "2. Complete the initial setup wizard"
echo "3. Configure OpenRouter (Settings → LLM Configuration)"
echo "4. Create your workspace and ingest your website content"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  View logs:      docker logs -f anythingllm"
echo "  Stop:           docker stop anythingllm"
echo "  Start:          docker start anythingllm"
echo "  Restart:        docker restart anythingllm"
echo "  Remove:         docker rm -f anythingllm"
echo ""
echo -e "${YELLOW}Storage location: ${STORAGE_LOCATION}${NC}"
echo "  Back up this directory regularly!"
echo ""
