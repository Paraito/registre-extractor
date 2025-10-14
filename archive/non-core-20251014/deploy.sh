#!/bin/bash

# Production deployment script

echo "🚀 Starting production deployment..."

# Build the application
echo "📦 Building application..."
npm run build

# Build Docker images
echo "🐳 Building Docker images..."
docker-compose -f docker-compose.prod.yml build

# Start services
echo "▶️  Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Scale workers
echo "📈 Scaling to 20 workers..."
docker-compose -f docker-compose.prod.yml up -d --scale worker=20

# Show status
echo "✅ Deployment complete!"
docker-compose -f docker-compose.prod.yml ps

echo "📊 View logs with: docker-compose -f docker-compose.prod.yml logs -f"
echo "🔍 Monitor at: http://localhost:3000"