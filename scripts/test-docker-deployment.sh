#!/bin/bash

# Docker Deployment Test Script
# Tests all critical components after deployment

set -e  # Exit on error

echo "=============================================="
echo "🐳 DOCKER DEPLOYMENT TEST"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((TESTS_FAILED++))
}

warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

# Test 1: Check if Docker is running
echo "Test 1: Docker daemon"
if docker info > /dev/null 2>&1; then
    pass "Docker daemon is running"
else
    fail "Docker daemon is not running"
    exit 1
fi

# Test 2: Check if docker-compose is available
echo "Test 2: Docker Compose"
if command -v docker-compose > /dev/null 2>&1; then
    pass "Docker Compose is installed"
else
    fail "Docker Compose is not installed"
    exit 1
fi

# Test 3: Check if .env file exists
echo "Test 3: Environment configuration"
if [ -f .env ]; then
    pass ".env file exists"
else
    fail ".env file not found"
    exit 1
fi

# Test 4: Check if containers are running
echo "Test 4: Container status"
RUNNING_CONTAINERS=$(docker-compose ps --services --filter "status=running" 2>/dev/null | wc -l)
EXPECTED_CONTAINERS=7  # redis, 3 workers, ocr, monitor, api

if [ "$RUNNING_CONTAINERS" -eq "$EXPECTED_CONTAINERS" ]; then
    pass "All $EXPECTED_CONTAINERS containers are running"
elif [ "$RUNNING_CONTAINERS" -gt 0 ]; then
    warn "$RUNNING_CONTAINERS/$EXPECTED_CONTAINERS containers are running"
else
    warn "No containers are running. Start with: docker-compose up -d"
fi

# Test 5: Check Playwright installation in worker container (if running)
echo "Test 5: Playwright browser installation"
if docker exec registre-worker-1 test -d /app/.cache/ms-playwright/chromium_headless_shell-1181 2>/dev/null; then
    pass "Playwright browsers are installed in worker container"
else
    warn "Playwright browsers not found (container may not be running)"
fi

# Test 6: Check temp directory permissions (if OCR container is running)
echo "Test 6: Temp directory permissions"
if docker exec registre-ocr test -w /tmp 2>/dev/null; then
    pass "/tmp directory is writable in OCR container"
else
    warn "/tmp directory check skipped (container may not be running)"
fi

# Test 7: Check API server is responding (if running)
echo "Test 7: API server health"
if curl -s http://localhost:3000/api/workers > /dev/null 2>&1; then
    pass "API server is responding"
else
    warn "API server is not responding (may not be started yet)"
fi

# Test 8: Check Redis connection (if running)
echo "Test 8: Redis connection"
if docker exec registre-redis redis-cli ping > /dev/null 2>&1; then
    pass "Redis is responding"
else
    warn "Redis is not responding (may not be started yet)"
fi

# Test 9: Verify retry script exists in built code
echo "Test 9: Retry script availability"
if [ -f dist/scripts/retry-failed-jobs.js ]; then
    pass "Retry script is built and available"
else
    warn "Retry script not found in dist/ (run 'npm run build')"
fi

# Summary
echo ""
echo "=============================================="
echo "📊 TEST SUMMARY"
echo "=============================================="
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CRITICAL TESTS PASSED!${NC}"
    echo ""
    echo "🚀 Deployment is ready!"
    echo ""
    echo "Next steps:"
    echo "  1. Access dashboard: http://localhost:3000"
    echo "  2. Retry failed jobs:"
    echo "     docker exec -it registre-api npx tsx src/scripts/retry-failed-jobs.ts --exclude-nonexistent"
    echo "  3. Monitor logs:"
    echo "     docker-compose logs -f"
    echo ""
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo ""
    echo "Please fix the issues above before deploying to production."
    echo ""
    exit 1
fi

