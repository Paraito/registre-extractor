#!/bin/bash

###############################################################################
# Verify OCR Worker Pool Setup
# 
# This script verifies that all required files and configurations are in place
# before deploying to the server.
###############################################################################

echo ""
echo "================================================================================"
echo "🔍 VERIFYING OCR WORKER POOL SETUP"
echo "================================================================================"
echo ""

ERRORS=0
WARNINGS=0

# Function to check file exists
check_file() {
    local file=$1
    local description=$2
    
    if [ -f "$file" ]; then
        echo "✅ $description: $file"
    else
        echo "❌ $description: $file (NOT FOUND)"
        ((ERRORS++))
    fi
}

# Function to check directory exists
check_dir() {
    local dir=$1
    local description=$2
    
    if [ -d "$dir" ]; then
        echo "✅ $description: $dir"
    else
        echo "❌ $description: $dir (NOT FOUND)"
        ((ERRORS++))
    fi
}

# Check source files
echo "📁 Checking Source Files..."
echo "---"
check_file "src/ocr/start-worker-pool.ts" "OCR Worker Pool Source"
check_file "src/ocr/generic-ocr-worker.ts" "Generic OCR Worker Source"
check_file "src/worker/start-registre-workers.ts" "Registre Workers Source"
check_file "src/shared/rate-limiter.ts" "Rate Limiter Source"
check_file "src/shared/capacity-manager.ts" "Capacity Manager Source"
check_file "src/shared/worker-pool-manager.ts" "Worker Pool Manager Source"
echo ""

# Check configuration files
echo "⚙️  Checking Configuration Files..."
echo "---"
check_file "ecosystem.config.js" "PM2 Configuration"
check_file ".env" "Environment Variables"
check_file "package.json" "Package Configuration"
echo ""

# Check deployment scripts
echo "🚀 Checking Deployment Scripts..."
echo "---"
check_file "deploy-ocr-workers.sh" "Deployment Script"
check_file "OCR_WORKER_DEPLOYMENT.md" "Deployment Guide"
check_file "DEPLOYMENT_INSTRUCTIONS.md" "Quick Instructions"

if [ -x "deploy-ocr-workers.sh" ]; then
    echo "✅ Deployment script is executable"
else
    echo "⚠️  Deployment script is not executable (run: chmod +x deploy-ocr-workers.sh)"
    ((WARNINGS++))
fi
echo ""

# Check if project is built
echo "🔨 Checking Build Output..."
echo "---"
check_dir "dist" "Build Directory"
check_file "dist/ocr/start-worker-pool.js" "OCR Worker Pool (Built)"
check_file "dist/ocr/generic-ocr-worker.js" "Generic OCR Worker (Built)"
check_file "dist/worker/start-registre-workers.js" "Registre Workers (Built)"
check_file "dist/shared/rate-limiter.js" "Rate Limiter (Built)"
check_file "dist/shared/capacity-manager.js" "Capacity Manager (Built)"
check_file "dist/shared/worker-pool-manager.js" "Worker Pool Manager (Built)"
echo ""

# Check ecosystem.config.js content
echo "📋 Checking PM2 Configuration Content..."
echo "---"

if grep -q "ocr-pool" ecosystem.config.js; then
    echo "✅ 'ocr-pool' process found in ecosystem.config.js"
else
    echo "❌ 'ocr-pool' process NOT found in ecosystem.config.js"
    ((ERRORS++))
fi

if grep -q "dist/ocr/start-worker-pool.js" ecosystem.config.js; then
    echo "✅ Correct script path for ocr-pool"
else
    echo "❌ Incorrect script path for ocr-pool"
    ((ERRORS++))
fi

if grep -q "registre-workers" ecosystem.config.js; then
    echo "✅ 'registre-workers' process found in ecosystem.config.js"
else
    echo "❌ 'registre-workers' process NOT found in ecosystem.config.js"
    ((ERRORS++))
fi

if grep -q "dist/worker/start-registre-workers.js" ecosystem.config.js; then
    echo "✅ Correct script path for registre-workers"
else
    echo "❌ Incorrect script path for registre-workers"
    ((ERRORS++))
fi

# Check for old processes (should NOT be present)
if grep -q "registre-ocr" ecosystem.config.js && grep -q "dist/ocr/monitor.js" ecosystem.config.js; then
    echo "⚠️  Old 'registre-ocr' process still in ecosystem.config.js (should be removed)"
    ((WARNINGS++))
fi

if grep -q "name: 'registre-worker'" ecosystem.config.js && grep -q "dist/worker/index.js" ecosystem.config.js; then
    echo "⚠️  Old 'registre-worker' process still in ecosystem.config.js (should be removed)"
    ((WARNINGS++))
fi

echo ""

# Check environment variables
echo "🌍 Checking Environment Variables..."
echo "---"

if [ -f ".env" ]; then
    if grep -q "OCR_WORKER_POOL_SIZE" .env; then
        POOL_SIZE=$(grep "OCR_WORKER_POOL_SIZE" .env | cut -d'=' -f2)
        echo "✅ OCR_WORKER_POOL_SIZE=$POOL_SIZE"
    else
        echo "⚠️  OCR_WORKER_POOL_SIZE not set in .env (will use default: 4)"
        ((WARNINGS++))
    fi
    
    if grep -q "OCR_DEV" .env; then
        OCR_DEV=$(grep "OCR_DEV" .env | cut -d'=' -f2)
        echo "✅ OCR_DEV=$OCR_DEV"
    else
        echo "⚠️  OCR_DEV not set in .env"
        ((WARNINGS++))
    fi
    
    if grep -q "REDIS_URL" .env; then
        echo "✅ REDIS_URL configured"
    else
        echo "❌ REDIS_URL not set in .env"
        ((ERRORS++))
    fi
fi

echo ""

# Check Redis connection (if running locally)
echo "🔴 Checking Redis Connection..."
echo "---"

if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo "✅ Redis is running and accessible"
    else
        echo "⚠️  Redis is not running (required for workers)"
        ((WARNINGS++))
    fi
else
    echo "ℹ️  redis-cli not found (skipping Redis check)"
fi

echo ""

# Summary
echo "================================================================================"
echo "📊 VERIFICATION SUMMARY"
echo "================================================================================"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ ALL CHECKS PASSED!"
    echo ""
    echo "🚀 Ready to deploy to server:"
    echo "   1. Commit and push changes: git add . && git commit -m 'Fix: Update to unified OCR worker pool' && git push"
    echo "   2. SSH to server: ssh your-server"
    echo "   3. Pull changes: cd /path/to/registre-extractor && git pull"
    echo "   4. Run deployment: ./deploy-ocr-workers.sh"
    echo ""
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  PASSED WITH WARNINGS"
    echo ""
    echo "   Errors: $ERRORS"
    echo "   Warnings: $WARNINGS"
    echo ""
    echo "You can proceed with deployment, but review the warnings above."
    echo ""
else
    echo "❌ VERIFICATION FAILED"
    echo ""
    echo "   Errors: $ERRORS"
    echo "   Warnings: $WARNINGS"
    echo ""
    echo "Please fix the errors above before deploying."
    echo ""
    
    if [ ! -d "dist" ] || [ ! -f "dist/ocr/start-worker-pool.js" ]; then
        echo "💡 Tip: Run 'npm run build' to build the project"
    fi
    
    echo ""
    exit 1
fi

echo "================================================================================"
echo ""

