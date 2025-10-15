#!/bin/bash

# Registre Extractor Deployment Verification Script
# This script verifies that the deployment is working correctly

set -e

echo "=========================================="
echo "🔍 Registre Extractor Deployment Verification"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect deployment type
DEPLOYMENT_TYPE=""
if command -v docker &> /dev/null && docker compose ps &> /dev/null; then
    DEPLOYMENT_TYPE="docker"
    echo "✅ Detected Docker deployment"
elif command -v pm2 &> /dev/null && pm2 list &> /dev/null; then
    DEPLOYMENT_TYPE="pm2"
    echo "✅ Detected PM2 deployment"
else
    echo -e "${RED}❌ Could not detect deployment type${NC}"
    echo "Please ensure either Docker or PM2 is running"
    exit 1
fi

echo ""
echo "=========================================="
echo "1️⃣  Checking Services Status"
echo "=========================================="

if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    echo "Docker containers:"
    docker compose ps
    
    # Check if all containers are running
    RUNNING=$(docker compose ps --services --filter "status=running" | wc -l)
    TOTAL=$(docker compose ps --services | wc -l)
    
    if [ "$RUNNING" -eq "$TOTAL" ]; then
        echo -e "${GREEN}✅ All $TOTAL containers are running${NC}"
    else
        echo -e "${YELLOW}⚠️  Only $RUNNING/$TOTAL containers are running${NC}"
    fi
else
    echo "PM2 processes:"
    pm2 list
    
    # Check if all processes are online
    ONLINE=$(pm2 jlist | jq '[.[] | select(.pm2_env.status == "online")] | length')
    TOTAL=$(pm2 jlist | jq 'length')
    
    if [ "$ONLINE" -eq "$TOTAL" ]; then
        echo -e "${GREEN}✅ All $TOTAL processes are online${NC}"
    else
        echo -e "${YELLOW}⚠️  Only $ONLINE/$TOTAL processes are online${NC}"
    fi
fi

echo ""
echo "=========================================="
echo "2️⃣  Checking Playwright Installation"
echo "=========================================="

if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    echo "Checking Playwright in worker container..."
    PLAYWRIGHT_CHECK=$(docker compose exec -T registre-worker-1 npx playwright --version 2>&1 || echo "FAILED")
    
    if [[ "$PLAYWRIGHT_CHECK" == *"Version"* ]]; then
        echo -e "${GREEN}✅ Playwright is installed: $PLAYWRIGHT_CHECK${NC}"
    else
        echo -e "${RED}❌ Playwright check failed${NC}"
        echo "$PLAYWRIGHT_CHECK"
    fi
else
    echo "Checking Playwright installation..."
    if npx playwright --version &> /dev/null; then
        VERSION=$(npx playwright --version)
        echo -e "${GREEN}✅ Playwright is installed: $VERSION${NC}"
    else
        echo -e "${RED}❌ Playwright is not installed${NC}"
        echo "Run: npx playwright install chromium"
    fi
fi

echo ""
echo "=========================================="
echo "3️⃣  Checking Environment Variables"
echo "=========================================="

check_env_var() {
    local var_name=$1
    local required=$2
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        VALUE=$(docker compose exec -T registre-worker-1 printenv "$var_name" 2>/dev/null || echo "")
    else
        VALUE=$(printenv "$var_name" || echo "")
    fi
    
    if [ -n "$VALUE" ]; then
        # Mask the value for security
        MASKED="${VALUE:0:10}..."
        echo -e "${GREEN}✅ $var_name is set ($MASKED)${NC}"
    else
        if [ "$required" = "true" ]; then
            echo -e "${RED}❌ $var_name is NOT set (REQUIRED)${NC}"
        else
            echo -e "${YELLOW}⚠️  $var_name is NOT set (optional)${NC}"
        fi
    fi
}

echo "Checking required environment variables..."
check_env_var "AGENTQL_API_KEY" "true"
check_env_var "OPENAI_API_KEY" "true"
check_env_var "GEMINI_API_KEY" "true"
check_env_var "PROD_SUPABASE_URL" "true"
check_env_var "PROD_SUPABASE_SERVICE_KEY" "true"

echo ""
echo "Checking optional environment variables..."
check_env_var "CLAUDE_API_KEY" "false"
check_env_var "DEV_SUPABASE_URL" "false"
check_env_var "STAGING_SUPABASE_URL" "false"

echo ""
echo "=========================================="
echo "4️⃣  Checking Worker Configuration"
echo "=========================================="

if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    WORKER_COUNT=$(docker compose exec -T registre-worker-1 printenv WORKER_COUNT 2>/dev/null || echo "1")
    CONTAINER_COUNT=$(docker compose ps --services --filter "name=registre-worker" | wc -l)
    echo "Worker containers: $CONTAINER_COUNT"
    echo "Workers per container: $WORKER_COUNT"
    TOTAL_WORKERS=$((CONTAINER_COUNT * WORKER_COUNT))
    echo -e "${GREEN}Total workers: $TOTAL_WORKERS${NC}"
else
    INSTANCES=$(pm2 jlist | jq '[.[] | select(.name == "registre-worker")] | length')
    WORKER_COUNT=$(pm2 jlist | jq -r '[.[] | select(.name == "registre-worker")] | .[0].pm2_env.WORKER_COUNT // "1"')
    echo "PM2 instances: $INSTANCES"
    echo "Workers per instance: $WORKER_COUNT"
    TOTAL_WORKERS=$((INSTANCES * WORKER_COUNT))
    echo -e "${GREEN}Total workers: $TOTAL_WORKERS${NC}"
fi

if [ "$TOTAL_WORKERS" -ge 3 ]; then
    echo -e "${GREEN}✅ Good concurrency configuration${NC}"
else
    echo -e "${YELLOW}⚠️  Low concurrency (recommended: 3+ workers)${NC}"
fi

echo ""
echo "=========================================="
echo "5️⃣  Checking Recent Logs for Errors"
echo "=========================================="

echo "Checking for Playwright errors..."
if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    PLAYWRIGHT_ERRORS=$(docker compose logs --tail=100 registre-worker-1 2>&1 | grep -i "playwright\|browser\|chromium" | grep -i "error\|fail" || echo "")
else
    PLAYWRIGHT_ERRORS=$(pm2 logs registre-worker --lines 100 --nostream 2>&1 | grep -i "playwright\|browser\|chromium" | grep -i "error\|fail" || echo "")
fi

if [ -z "$PLAYWRIGHT_ERRORS" ]; then
    echo -e "${GREEN}✅ No Playwright errors found${NC}"
else
    echo -e "${RED}❌ Playwright errors detected:${NC}"
    echo "$PLAYWRIGHT_ERRORS" | head -5
fi

echo ""
echo "Checking for extraction errors..."
if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    EXTRACTION_ERRORS=$(docker compose logs --tail=100 registre-worker-1 2>&1 | grep -i "error" | grep -v "playwright" || echo "")
else
    EXTRACTION_ERRORS=$(pm2 logs registre-worker --lines 100 --nostream 2>&1 | grep -i "error" | grep -v "playwright" || echo "")
fi

if [ -z "$EXTRACTION_ERRORS" ]; then
    echo -e "${GREEN}✅ No extraction errors found${NC}"
else
    echo -e "${YELLOW}⚠️  Some extraction errors detected (may be normal):${NC}"
    echo "$EXTRACTION_ERRORS" | head -3
fi

echo ""
echo "=========================================="
echo "6️⃣  Checking API Health"
echo "=========================================="

if curl -s http://localhost:3000/health &> /dev/null; then
    HEALTH=$(curl -s http://localhost:3000/health)
    echo -e "${GREEN}✅ API is responding${NC}"
    echo "Response: $HEALTH"
else
    echo -e "${YELLOW}⚠️  API is not responding on port 3000${NC}"
    echo "This may be normal if API is not deployed"
fi

echo ""
echo "=========================================="
echo "📊 Summary"
echo "=========================================="

# Count checks
TOTAL_CHECKS=6
PASSED=0

# This is a simplified summary - in production you'd track each check
echo "Deployment Type: $DEPLOYMENT_TYPE"
echo "Total Workers: $TOTAL_WORKERS"
echo ""

if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
    echo "Quick commands:"
    echo "  View logs:        docker compose logs -f"
    echo "  Restart workers:  docker compose restart registre-worker-1"
    echo "  Check status:     docker compose ps"
else
    echo "Quick commands:"
    echo "  View logs:        pm2 logs"
    echo "  Restart workers:  pm2 restart registre-worker"
    echo "  Check status:     pm2 list"
fi

echo ""
echo "=========================================="
echo "✅ Verification Complete"
echo "=========================================="

