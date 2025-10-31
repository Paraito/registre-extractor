#!/bin/bash

# ============================================================================
# Pre-Deployment Verification Script
# ============================================================================
# Run this script before deploying to verify everything is ready
# Usage: ./verify-deployment.sh
# ============================================================================

set +e  # Don't exit on error, we want to show all issues

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Pre-Deployment Verification${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# Check 1: Node.js version
echo -e "${YELLOW}[1/10] Checking Node.js version...${NC}"
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -eq 0 ]; then
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -ge 20 ]; then
        echo -e "${GREEN}✓ Node.js $NODE_VERSION (OK)${NC}"
    else
        echo -e "${RED}✗ Node.js $NODE_VERSION (Need v20+)${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ Node.js not found${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 2: TypeScript compilation
echo -e "${YELLOW}[2/10] Checking TypeScript compilation...${NC}"
npm run typecheck > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ TypeScript compiles without errors${NC}"
else
    echo -e "${RED}✗ TypeScript compilation failed${NC}"
    echo -e "${RED}   Run: npm run typecheck${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 3: Build
echo -e "${YELLOW}[3/10] Checking build...${NC}"
if [ -f "dist/worker/unified-worker.js" ] && \
   [ -f "dist/req/scraper.js" ] && \
   [ -f "dist/rdprm/scraper.js" ]; then
    echo -e "${GREEN}✓ All required dist files exist${NC}"
else
    echo -e "${RED}✗ Missing dist files${NC}"
    echo -e "${RED}   Run: npm run build${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 4: .env.example
echo -e "${YELLOW}[4/10] Checking .env.example...${NC}"
if grep -q "BROWSERBASE_API_KEY" .env.example && \
   grep -q "RDPRM_USER" .env.example; then
    echo -e "${GREEN}✓ .env.example has REQ/RDPRM config${NC}"
else
    echo -e "${RED}✗ .env.example missing REQ/RDPRM config${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 5: Package.json scripts
echo -e "${YELLOW}[5/10] Checking package.json scripts...${NC}"
if grep -q "unified:start" package.json && \
   grep -q "unified:dev" package.json; then
    echo -e "${GREEN}✓ Unified worker scripts exist${NC}"
else
    echo -e "${RED}✗ Missing unified worker scripts${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 6: PM2 ecosystem config
echo -e "${YELLOW}[6/10] Checking PM2 ecosystem config...${NC}"
if [ -f "ecosystem.config.js" ]; then
    if grep -q "unified-worker" ecosystem.config.js; then
        echo -e "${GREEN}✓ PM2 config has unified-worker${NC}"
    else
        echo -e "${RED}✗ PM2 config missing unified-worker${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}✗ ecosystem.config.js not found${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 7: Deploy script
echo -e "${YELLOW}[7/10] Checking deploy script...${NC}"
if [ -f "deploy-pm2.sh" ]; then
    if [ -x "deploy-pm2.sh" ]; then
        echo -e "${GREEN}✓ deploy-pm2.sh exists and is executable${NC}"
    else
        echo -e "${YELLOW}⚠ deploy-pm2.sh not executable${NC}"
        echo -e "${YELLOW}   Run: chmod +x deploy-pm2.sh${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ deploy-pm2.sh not found${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 8: Documentation
echo -e "${YELLOW}[8/10] Checking documentation...${NC}"
DOC_COUNT=0
if [ -f "DEPLOYMENT.md" ]; then
    DOC_COUNT=$((DOC_COUNT + 1))
fi
if [ -f "QUICK-DEPLOY.md" ]; then
    DOC_COUNT=$((DOC_COUNT + 1))
fi
if [ $DOC_COUNT -eq 2 ]; then
    echo -e "${GREEN}✓ All deployment docs exist${NC}"
else
    echo -e "${YELLOW}⚠ Missing some deployment docs (found $DOC_COUNT/2)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# Check 9: Git status
echo -e "${YELLOW}[9/10] Checking git status...${NC}"
if git rev-parse --git-dir > /dev/null 2>&1; then
    UNCOMMITTED=$(git status --porcelain | wc -l)
    if [ $UNCOMMITTED -gt 0 ]; then
        echo -e "${YELLOW}⚠ You have $UNCOMMITTED uncommitted changes${NC}"
        echo -e "${YELLOW}   Review with: git status${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓ No uncommitted changes${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Not a git repository${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo ""

# Check 10: Dependencies
echo -e "${YELLOW}[10/10] Checking dependencies...${NC}"
if [ -d "node_modules" ]; then
    if [ -f "package-lock.json" ]; then
        echo -e "${GREEN}✓ Dependencies installed${NC}"
    else
        echo -e "${YELLOW}⚠ package-lock.json not found${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${RED}✗ node_modules not found${NC}"
    echo -e "${RED}   Run: npm install${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}  Verification Summary${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ All checks passed! Ready to deploy!${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo -e "  1. git add ."
    echo -e "  2. git commit -m \"feat: Add REQ and RDPRM scrapers\""
    echo -e "  3. git push origin main"
    echo -e "  4. SSH to server and run: ./deploy-pm2.sh"
    echo ""
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo -e "${YELLOW}You can deploy, but review warnings above${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found${NC}"
    echo -e "${RED}Please fix errors before deploying${NC}"
    echo ""
    exit 1
fi
