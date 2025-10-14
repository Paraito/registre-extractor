#!/bin/bash

# Hetzner VPS Deployment Script
# This script sets up the Registre Extractor on a fresh Ubuntu server

echo "🚀 Registre Extractor - Hetzner VPS Deployment"
echo "=============================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (use sudo)"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install dependencies
echo "🔧 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
apt install docker-compose git -y

# Create app directory
echo "📁 Creating application directory..."
mkdir -p /opt/registre_extractor
cd /opt/registre_extractor

# Clone repository (replace with your repo)
echo "📥 Cloning repository..."
# git clone https://github.com/yourusername/registre_extractor.git .

# For now, copy files
echo "📋 Please upload your project files to /opt/registre_extractor"
echo "Press Enter when ready..."
read

# Set up environment
echo "🔐 Setting up environment variables..."
if [ ! -f .env ]; then
    cp .env.production .env
    echo "⚠️  Please edit .env file with your credentials"
    nano .env
fi

# Create systemd service
echo "⚙️  Creating systemd service..."
cat > /etc/systemd/system/registre-extractor.service << EOF
[Unit]
Description=Registre Extractor Service
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
WorkingDirectory=/opt/registre_extractor
ExecStart=/usr/bin/docker-compose up
ExecStop=/usr/bin/docker-compose down
StandardOutput=append:/var/log/registre-extractor.log
StandardError=append:/var/log/registre-extractor.log

[Install]
WantedBy=multi-user.target
EOF

# Build and start services
echo "🐳 Building Docker images..."
docker-compose build

echo "▶️  Starting services..."
systemctl daemon-reload
systemctl enable registre-extractor
systemctl start registre-extractor

# Set up firewall
echo "🔒 Configuring firewall..."
ufw allow 22/tcp
ufw allow 3000/tcp
ufw --force enable

# Set up log rotation
echo "📝 Setting up log rotation..."
cat > /etc/logrotate.d/registre-extractor << EOF
/var/log/registre-extractor.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF

# Create monitoring script
echo "📊 Creating monitoring script..."
cat > /usr/local/bin/check-registre-extractor.sh << 'EOF'
#!/bin/bash
if ! systemctl is-active --quiet registre-extractor; then
    echo "Registre Extractor is down! Restarting..."
    systemctl restart registre-extractor
    # Send alert (configure your alert method)
    # curl -X POST https://your-webhook.com/alert -d "Service restarted"
fi
EOF
chmod +x /usr/local/bin/check-registre-extractor.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/check-registre-extractor.sh") | crontab -

echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Check service status: systemctl status registre-extractor"
echo "2. View logs: journalctl -u registre-extractor -f"
echo "3. Access dashboard: http://$(curl -s ifconfig.me):3000"
echo "4. Add worker accounts to Supabase"
echo ""
echo "🔍 Useful commands:"
echo "- Start service: systemctl start registre-extractor"
echo "- Stop service: systemctl stop registre-extractor"
echo "- Restart service: systemctl restart registre-extractor"
echo "- View logs: tail -f /var/log/registre-extractor.log"
echo "- Check workers: docker ps"