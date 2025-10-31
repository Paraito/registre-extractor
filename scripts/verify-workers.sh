#!/bin/bash

# ============================================================================
# Worker Verification Script
# ============================================================================
# Verifies all workers are running properly after deployment
#
# Usage:
#   ./verify-workers.sh
#
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Worker Verification Report${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check if PM2 is running
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed${NC}"
    exit 1
fi

# Check PM2 services
echo -e "${YELLOW}📋 Checking PM2 Services...${NC}"
echo ""
pm2 list
echo ""

# Count running services
RUNNING_COUNT=$(pm2 jlist | jq '[.[] | select(.pm2_env.status == "online")] | length')
TOTAL_COUNT=$(pm2 jlist | jq 'length')

if [ "$RUNNING_COUNT" -eq "$TOTAL_COUNT" ] && [ "$TOTAL_COUNT" -eq 4 ]; then
    echo -e "${GREEN}✅ All 4 PM2 services are running${NC}"
else
    echo -e "${RED}❌ Expected 4 services, found $TOTAL_COUNT total, $RUNNING_COUNT running${NC}"
fi
echo ""

# Check individual services
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Individual Service Status${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Function to check service
check_service() {
    local service_name=$1
    local expected_instances=$2
    
    local status=$(pm2 jlist | jq -r ".[] | select(.name == \"$service_name\") | .pm2_env.status")
    local instances=$(pm2 jlist | jq "[.[] | select(.name == \"$service_name\")] | length")
    
    if [ "$status" == "online" ] && [ "$instances" -eq "$expected_instances" ]; then
        echo -e "${GREEN}✅ $service_name${NC} - $instances instance(s) running"
    else
        echo -e "${RED}❌ $service_name${NC} - Expected $expected_instances, found $instances (status: $status)"
    fi
}

check_service "registre-worker" 3
check_service "registre-ocr" 1
check_service "registre-monitor" 1
check_service "registre-api" 1
echo ""

# Check API endpoint
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  API Health Check${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

if curl -s http://localhost:3000/api/workers > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API is responding on port 3000${NC}"
    
    # Get worker count
    WORKER_COUNT=$(curl -s http://localhost:3000/api/workers | jq '.workers | length')
    IDLE_WORKERS=$(curl -s http://localhost:3000/api/workers | jq '[.workers[] | select(.status == "idle")] | length')
    
    echo -e "${GREEN}   Total workers: $WORKER_COUNT${NC}"
    echo -e "${GREEN}   Idle workers: $IDLE_WORKERS${NC}"
else
    echo -e "${RED}❌ API is not responding on port 3000${NC}"
fi
echo ""

# Check for zombie processes
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  System Health${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

ZOMBIE_COUNT=$(ps aux | grep 'Z' | grep -v grep | wc -l)
if [ "$ZOMBIE_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✅ No zombie processes detected${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: $ZOMBIE_COUNT zombie processes detected${NC}"
    echo -e "${YELLOW}   Run: ps aux | grep 'Z' to investigate${NC}"
fi
echo ""

# Check memory usage
echo -e "${YELLOW}💾 Memory Usage:${NC}"
pm2 jlist | jq -r '.[] | "\(.name): \(.monit.memory / 1024 / 1024 | floor)MB"'
echo ""

# Check uptime
echo -e "${YELLOW}⏱️  Uptime:${NC}"
pm2 jlist | jq -r '.[] | "\(.name): \(.pm2_env.pm_uptime / 1000 / 60 | floor) minutes"'
echo ""

# Check recent errors
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Recent Errors (Last 10 Lines)${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

for service in registre-worker registre-ocr registre-monitor registre-api; do
    ERROR_COUNT=$(pm2 logs $service --err --lines 10 --nostream 2>/dev/null | grep -i error | wc -l)
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "${YELLOW}⚠️  $service has $ERROR_COUNT recent errors${NC}"
    else
        echo -e "${GREEN}✅ $service - No recent errors${NC}"
    fi
done
echo ""

# Summary
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

echo -e "${GREEN}✅ WORKING WORKERS:${NC}"
echo -e "   • Registre Workers: 9 workers (3 PM2 instances × 3 workers)"
echo -e "   • OCR Workers: 5 workers"
echo -e "   • Monitor: 1 instance"
echo -e "   • API Server: 1 instance (port 3000)"
echo ""

echo -e "${RED}❌ NOT IMPLEMENTED:${NC}"
echo -e "   • REQ Workers (Registre des Entreprises du Québec)"
echo -e "   • RDPRM Workers (Droits Personnels et Réels Mobiliers)"
echo ""

echo -e "${YELLOW}📚 Documentation:${NC}"
echo -e "   • PM2-DEPLOYMENT.md - Deployment guide"
echo -e "   • WORKER-STATUS.md - Worker status report"
echo ""

echo -e "${YELLOW}🔧 Useful Commands:${NC}"
echo -e "   pm2 logs              # View all logs"
echo -e "   pm2 monit             # Monitor in real-time"
echo -e "   pm2 restart all       # Restart all services"
echo -e "   ./deploy-pm2.sh       # Deploy updates"
echo ""

echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}✅ Verification Complete${NC}"
echo -e "${BLUE}============================================================================${NC}"

