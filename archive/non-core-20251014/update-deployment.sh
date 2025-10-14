#!/bin/bash

# ============================================================================
# REGISTRE EXTRACTOR - UPDATE DEPLOYMENT SCRIPT
# ============================================================================
# This script updates the application with the latest changes including:
# - Playwright browser fixes
# - ImageMagick and poppler-utils installation
# - OCR error handling improvements
#
# IMPORTANT: This script REBUILDS Docker images (takes a few minutes)
# ============================================================================

set -e  # Exit on any error

echo "🚀 Registre Extractor - Update Deployment"
echo "=========================================="
echo ""

# Detect if running with Docker or systemd
USING_DOCKER=false
USING_SYSTEMD=false

if command -v docker-compose &> /dev/null && [ -f "docker-compose.yml" ]; then
    USING_DOCKER=true
    echo "✓ Detected Docker deployment"
fi

if command -v systemctl &> /dev/null && systemctl list-units --type=service | grep -q "registre-extractor"; then
    USING_SYSTEMD=true
    echo "✓ Detected systemd service"
fi

if [ "$USING_DOCKER" = false ] && [ "$USING_SYSTEMD" = false ]; then
    echo "❌ Error: Could not detect deployment method"
    echo "   Please ensure you're running this from the project directory"
    exit 1
fi

echo ""
echo "📥 Step 1: Pulling latest changes from Git..."
git pull

echo ""
echo "📦 Step 2: Installing/updating npm dependencies..."
npm install

echo ""
echo "🔨 Step 3: Building TypeScript..."
npm run build

# ============================================================================
# DOCKER DEPLOYMENT
# ============================================================================
if [ "$USING_DOCKER" = true ]; then
    echo ""
    echo "🐳 Step 4: Rebuilding Docker images (this may take a few minutes)..."
    echo "   ⚠️  This is REQUIRED for Playwright, ImageMagick, and poppler-utils fixes"
    
    # Determine which docker-compose file to use
    if [ -f "docker-compose.prod.yml" ]; then
        COMPOSE_FILE="docker-compose.prod.yml"
        echo "   Using: docker-compose.prod.yml"
    else
        COMPOSE_FILE="docker-compose.yml"
        echo "   Using: docker-compose.yml"
    fi
    
    # Stop services
    echo ""
    echo "🛑 Stopping services..."
    docker-compose -f "$COMPOSE_FILE" down
    
    # Rebuild images with no cache to ensure all changes are applied
    echo ""
    echo "🔧 Rebuilding images (--no-cache to ensure fresh build)..."
    docker-compose -f "$COMPOSE_FILE" build --no-cache
    
    # Start services
    echo ""
    echo "▶️  Starting services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Wait a moment for services to start
    sleep 5
    
    # Show status
    echo ""
    echo "✅ Deployment complete!"
    echo ""
    echo "📊 Services Status:"
    docker-compose -f "$COMPOSE_FILE" ps
    
    echo ""
    echo "🔍 Verification Commands:"
    echo "   Check Playwright:  docker exec \$(docker ps -q -f name=worker | head -1) ls -la /app/.cache/ms-playwright/"
    echo "   Check ImageMagick: docker exec \$(docker ps -q -f name=worker | head -1) which convert"
    echo "   Check Poppler:     docker exec \$(docker ps -q -f name=worker | head -1) which pdftoppm"
    echo "   View logs:         docker-compose -f $COMPOSE_FILE logs -f worker"
    echo "   View OCR logs:     docker-compose -f $COMPOSE_FILE logs -f ocr"
fi

# ============================================================================
# SYSTEMD DEPLOYMENT
# ============================================================================
if [ "$USING_SYSTEMD" = true ]; then
    echo ""
    echo "⚙️  Step 4: Rebuilding Docker images via systemd..."
    echo "   ⚠️  This is REQUIRED for Playwright, ImageMagick, and poppler-utils fixes"
    
    # Stop the service
    echo ""
    echo "🛑 Stopping registre-extractor service..."
    sudo systemctl stop registre-extractor
    
    # Rebuild images
    echo ""
    echo "🔧 Rebuilding Docker images (--no-cache to ensure fresh build)..."
    docker-compose build --no-cache
    
    # Reload systemd and restart service
    echo ""
    echo "▶️  Restarting service..."
    sudo systemctl daemon-reload
    sudo systemctl start registre-extractor
    
    # Wait a moment for service to start
    sleep 5
    
    # Show status
    echo ""
    echo "✅ Deployment complete!"
    echo ""
    echo "📊 Service Status:"
    sudo systemctl status registre-extractor --no-pager
    
    echo ""
    echo "🔍 Verification Commands:"
    echo "   Check Playwright:  docker exec \$(docker ps -q -f name=worker | head -1) ls -la /app/.cache/ms-playwright/"
    echo "   Check ImageMagick: docker exec \$(docker ps -q -f name=worker | head -1) which convert"
    echo "   Check Poppler:     docker exec \$(docker ps -q -f name=worker | head -1) which pdftoppm"
    echo "   View logs:         sudo journalctl -u registre-extractor -f"
    echo "   View Docker logs:  docker-compose logs -f"
fi

echo ""
echo "============================================================================"
echo "🎉 UPDATE COMPLETE!"
echo "============================================================================"
echo ""
echo "✅ Changes Applied:"
echo "   • Playwright browser installation fixed (non-root user access)"
echo "   • ImageMagick installed (PDF to image conversion)"
echo "   • poppler-utils installed (PDF to image fallback)"
echo "   • OCR error handling improved (status_id = 4 on max attempts)"
echo ""
echo "📋 Next Steps:"
echo "   1. Monitor logs for any errors"
echo "   2. Test extraction with a sample job"
echo "   3. Verify OCR processing works correctly"
echo ""
echo "🆘 If you encounter issues:"
echo "   • Check the troubleshooting section in:"
echo "     augment_work_docs/OCR_FIXES_IMAGEMAGICK_AND_ERROR_HANDLING.md"
echo ""
echo "============================================================================"

