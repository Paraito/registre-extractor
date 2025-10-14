#!/bin/bash

###############################################################################
# Deploy OCR Worker Pool to Server
# 
# This script updates the server to use the new unified OCR worker pool
# instead of the old OCR monitor.
###############################################################################

set -e  # Exit on error

echo ""
echo "================================================================================"
echo "🚀 DEPLOYING UNIFIED OCR WORKER POOL"
echo "================================================================================"
echo ""

# Check if we're on the server or local
if [ -f "/etc/systemd/system/registre-monitor.service" ]; then
    ON_SERVER=true
    echo "📍 Detected: Running on server (systemd detected)"
else
    ON_SERVER=false
    echo "📍 Detected: Running locally"
fi

echo ""

# Step 1: Build the project
echo "================================================================================"
echo "📦 Step 1: Building Project"
echo "================================================================================"
echo ""

npm run build

if [ ! -f "dist/ocr/start-worker-pool.js" ]; then
    echo "❌ ERROR: dist/ocr/start-worker-pool.js not found after build!"
    echo "   Make sure the build completed successfully."
    exit 1
fi

echo "✅ Build complete"
echo ""

# Step 2: Check PM2 status
echo "================================================================================"
echo "📊 Step 2: Checking Current PM2 Status"
echo "================================================================================"
echo ""

if command -v pm2 &> /dev/null; then
    echo "Current PM2 processes:"
    pm2 list || true
    echo ""
else
    echo "⚠️  PM2 not found. Installing PM2..."
    npm install -g pm2
    echo "✅ PM2 installed"
    echo ""
fi

# Step 3: Stop old OCR worker
echo "================================================================================"
echo "🛑 Step 3: Stopping Old OCR Worker"
echo "================================================================================"
echo ""

echo "Stopping 'registre-ocr' (old OCR monitor)..."
pm2 stop registre-ocr 2>/dev/null || echo "   (not running)"

echo "Deleting 'registre-ocr' from PM2..."
pm2 delete registre-ocr 2>/dev/null || echo "   (not found)"

echo "✅ Old OCR worker stopped"
echo ""

# Step 4: Start new OCR worker pool
echo "================================================================================"
echo "🚀 Step 4: Starting New OCR Worker Pool"
echo "================================================================================"
echo ""

echo "Starting 'ocr-pool' with new configuration..."
pm2 start ecosystem.config.js --only ocr-pool

echo ""
echo "✅ OCR worker pool started"
echo ""

# Step 5: Restart registre workers (to use new system)
echo "================================================================================"
echo "🔄 Step 5: Restarting Registre Workers"
echo "================================================================================"
echo ""

echo "Stopping old 'registre-worker'..."
pm2 stop registre-worker 2>/dev/null || echo "   (not running)"
pm2 delete registre-worker 2>/dev/null || echo "   (not found)"

echo "Starting new 'registre-workers'..."
pm2 start ecosystem.config.js --only registre-workers

echo ""
echo "✅ Registre workers restarted"
echo ""

# Step 6: Ensure monitor and API are running
echo "================================================================================"
echo "🔄 Step 6: Ensuring Monitor and API are Running"
echo "================================================================================"
echo ""

echo "Restarting monitor..."
pm2 restart registre-monitor 2>/dev/null || pm2 start ecosystem.config.js --only registre-monitor

echo "Restarting API..."
pm2 restart registre-api 2>/dev/null || pm2 start ecosystem.config.js --only registre-api

echo ""
echo "✅ Monitor and API running"
echo ""

# Step 7: Save PM2 configuration
echo "================================================================================"
echo "💾 Step 7: Saving PM2 Configuration"
echo "================================================================================"
echo ""

pm2 save

echo "✅ PM2 configuration saved"
echo ""

# Step 8: Show final status
echo "================================================================================"
echo "📊 Step 8: Final Status"
echo "================================================================================"
echo ""

pm2 list

echo ""
echo "================================================================================"
echo "✅ DEPLOYMENT COMPLETE!"
echo "================================================================================"
echo ""
echo "📋 Summary:"
echo "   ✅ Old 'registre-ocr' (OCR monitor) → REMOVED"
echo "   ✅ New 'ocr-pool' (unified worker pool) → RUNNING"
echo "   ✅ 'registre-workers' → RUNNING"
echo "   ✅ 'registre-monitor' → RUNNING"
echo "   ✅ 'registre-api' → RUNNING"
echo ""
echo "🔍 Next Steps:"
echo "   1. Check logs: pm2 logs ocr-pool"
echo "   2. Monitor queue: npx tsx check-ocr-queue.ts"
echo "   3. Watch processing: pm2 logs ocr-pool --lines 50"
echo ""
echo "💡 The OCR workers should now pick up the 19 waiting documents!"
echo ""

