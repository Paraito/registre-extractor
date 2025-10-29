#!/bin/bash

# ============================================================================
# PM2 Deployment Script for Registre Extractor
# ============================================================================
# This script deploys the registre-extractor with PM2 process manager
# 
# Usage:
#   ./deploy-pm2.sh          # Full deployment (pull, build, restart)
#   ./deploy-pm2.sh --quick  # Quick restart (no pull/build)
#   ./deploy-pm2.sh --logs   # Show logs after deployment
#
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
QUICK_MODE=false
SHOW_LOGS=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --logs)
      SHOW_LOGS=true
      shift
      ;;
    *)
      ;;
  esac
done

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Registre Extractor - PM2 Deployment${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed${NC}"
    echo -e "${YELLOW}Installing PM2 globally...${NC}"
    npm install -g pm2
fi

# Create logs directory if it doesn't exist
mkdir -p logs

if [ "$QUICK_MODE" = false ]; then
    # Step 1: Pull latest code
    echo -e "${YELLOW}📥 Pulling latest code from GitHub...${NC}"
    git pull origin main
    echo -e "${GREEN}✅ Code updated${NC}"
    echo ""

    # Step 2: Install dependencies
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
    echo ""

    # Step 3: Build TypeScript
    echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
    npm run build
    echo -e "${GREEN}✅ Build complete${NC}"
    echo ""
fi

# Step 4: Stop Docker containers if running
echo -e "${YELLOW}🐳 Checking for Docker containers...${NC}"
if docker ps | grep -q registre; then
    echo -e "${YELLOW}Stopping Docker containers...${NC}"
    docker compose down
    echo -e "${GREEN}✅ Docker containers stopped${NC}"
else
    echo -e "${GREEN}✅ No Docker containers running${NC}"
fi
echo ""

# Step 5: Restart PM2 services
echo -e "${YELLOW}🔄 Restarting PM2 services...${NC}"
pm2 restart ecosystem.config.js
echo -e "${GREEN}✅ PM2 services restarted${NC}"
echo ""

# Step 6: Save PM2 configuration
echo -e "${YELLOW}💾 Saving PM2 configuration...${NC}"
pm2 save
echo -e "${GREEN}✅ PM2 configuration saved${NC}"
echo ""

# Step 7: Show status
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Deployment Status${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
pm2 list
echo ""

# Step 8: Show worker count
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Worker Summary${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
echo -e "${GREEN}✅ Registre Workers:${NC} 9 workers (3 PM2 instances × 3 workers each)"
echo -e "${GREEN}✅ OCR Workers:${NC} 5 workers"
echo -e "${GREEN}✅ Monitor:${NC} 1 instance"
echo -e "${GREEN}✅ API Server:${NC} 1 instance (port 3000)"
echo ""
echo -e "${YELLOW}📋 Total:${NC} 4 PM2 apps, 15 workers"
echo ""

# Step 9: Check for zombie processes
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  System Health Check${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
ZOMBIE_COUNT=$(ps aux | grep 'Z' | grep -v grep | wc -l)
if [ "$ZOMBIE_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: ${ZOMBIE_COUNT} zombie processes detected${NC}"
    echo -e "${YELLOW}   Run: ps aux | grep 'Z' to investigate${NC}"
else
    echo -e "${GREEN}✅ No zombie processes detected${NC}"
fi
echo ""

# Step 10: Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
    echo -e "${BLUE}============================================================================${NC}"
    echo -e "${BLUE}  Recent Logs${NC}"
    echo -e "${BLUE}============================================================================${NC}"
    echo ""
    pm2 logs --lines 50 --nostream
fi

echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo -e "  pm2 logs                    # View all logs"
echo -e "  pm2 logs registre-worker    # View worker logs"
echo -e "  pm2 monit                   # Monitor in real-time"
echo -e "  pm2 restart all             # Restart all services"
echo -e "  pm2 stop all                # Stop all services"
echo -e "  pm2 delete all              # Remove all services"
echo ""

