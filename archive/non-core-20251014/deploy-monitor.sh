#!/bin/bash

# Deploy Health Monitor Script
# Automatically sets up the health monitor based on your environment

set -e

echo "🏥 Registre Extractor - Health Monitor Deployment"
echo "=================================================="
echo ""

# Detect deployment method
if [ -f "docker-compose.yml" ] && command -v docker-compose &> /dev/null; then
    DEPLOY_METHOD="docker"
elif command -v systemctl &> /dev/null; then
    DEPLOY_METHOD="systemd"
elif command -v pm2 &> /dev/null; then
    DEPLOY_METHOD="pm2"
else
    DEPLOY_METHOD="manual"
fi

echo "Detected deployment method: $DEPLOY_METHOD"
echo ""

case $DEPLOY_METHOD in
    docker)
        echo "📦 Deploying with Docker Compose..."
        echo ""
        
        # Build the project
        echo "Building project..."
        npm run build
        
        # Start/restart the monitor service
        echo "Starting health monitor..."
        docker-compose up -d --build monitor
        
        echo ""
        echo "✅ Health monitor deployed!"
        echo ""
        echo "Check status:"
        echo "  docker-compose ps monitor"
        echo ""
        echo "View logs:"
        echo "  docker-compose logs -f monitor"
        ;;
        
    systemd)
        echo "🐧 Deploying with systemd..."
        echo ""
        
        # Build the project
        echo "Building project..."
        npm run build
        
        # Create log directory
        echo "Creating log directory..."
        sudo mkdir -p /var/log/registre-extractor
        sudo chown $USER:$USER /var/log/registre-extractor
        
        # Copy service file
        echo "Installing systemd service..."
        sudo cp systemd/registre-monitor.service /etc/systemd/system/
        
        # Update service file with current directory
        sudo sed -i "s|/opt/registre-extractor|$(pwd)|g" /etc/systemd/system/registre-monitor.service
        sudo sed -i "s|User=registre|User=$USER|g" /etc/systemd/system/registre-monitor.service
        
        # Reload systemd
        sudo systemctl daemon-reload
        
        # Enable and start service
        echo "Starting health monitor..."
        sudo systemctl enable registre-monitor
        sudo systemctl restart registre-monitor
        
        echo ""
        echo "✅ Health monitor deployed!"
        echo ""
        echo "Check status:"
        echo "  sudo systemctl status registre-monitor"
        echo ""
        echo "View logs:"
        echo "  sudo journalctl -u registre-monitor -f"
        ;;
        
    pm2)
        echo "⚡ Deploying with PM2..."
        echo ""
        
        # Build the project
        echo "Building project..."
        npm run build
        
        # Stop existing monitor if running
        pm2 delete registre-monitor 2>/dev/null || true
        
        # Start monitor
        echo "Starting health monitor..."
        pm2 start dist/monitor/index.js --name registre-monitor
        
        # Save PM2 configuration
        pm2 save
        
        echo ""
        echo "✅ Health monitor deployed!"
        echo ""
        echo "Check status:"
        echo "  pm2 list"
        echo ""
        echo "View logs:"
        echo "  pm2 logs registre-monitor"
        echo ""
        echo "Setup auto-start on boot:"
        echo "  pm2 startup"
        ;;
        
    manual)
        echo "📝 Manual deployment..."
        echo ""
        
        # Build the project
        echo "Building project..."
        npm run build
        
        echo ""
        echo "✅ Build complete!"
        echo ""
        echo "To run the health monitor:"
        echo "  npm run monitor"
        echo ""
        echo "Or in development mode:"
        echo "  npm run monitor:dev"
        echo ""
        echo "For production, consider using:"
        echo "  - Docker Compose (recommended)"
        echo "  - systemd (Linux servers)"
        echo "  - PM2 (Node.js process manager)"
        ;;
esac

echo ""
echo "=================================================="
echo "🎉 Deployment complete!"
echo ""
echo "The health monitor will now automatically:"
echo "  ✅ Reset stuck jobs every 30 seconds"
echo "  ✅ Cleanup dead workers every 30 seconds"
echo "  ✅ Monitor system health continuously"
echo "  ✅ Alert on anomalies"
echo ""
echo "No manual intervention required!"
echo "=================================================="

