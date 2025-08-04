#!/bin/bash

# Deployment script for Registre Extractor

set -e

echo "🚀 Starting deployment of Registre Extractor..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env file from .env.example and configure it."
    exit 1
fi

# Generate docker-compose.yml if needed
if [ ! -f docker-compose.yml ] || [ scripts/generate-docker-compose.js -nt docker-compose.yml ]; then
    echo "📝 Generating docker-compose.yml..."
    node scripts/generate-docker-compose.js
fi

# Build Docker images
echo "🔨 Building Docker images..."
docker-compose build --parallel

# Start Redis first
echo "🔴 Starting Redis..."
docker-compose up -d redis

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
until docker-compose exec -T redis redis-cli ping | grep -q PONG; do
    sleep 1
done
echo "✅ Redis is ready!"

# Start API service
echo "🌐 Starting API service..."
docker-compose up -d api

# Wait for API to be ready
echo "⏳ Waiting for API to be ready..."
until curl -s http://localhost:3000/health | grep -q "ok"; do
    sleep 1
done
echo "✅ API is ready!"

# Start all workers
echo "👷 Starting workers..."
for i in {1..20}; do
    docker-compose up -d worker-$i
    echo "  ✓ Started worker-$i"
done

# Show status
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Services Status:"
docker-compose ps

echo ""
echo "🔗 Access points:"
echo "  - API: http://localhost:3000/api"
echo "  - Dashboard: http://localhost:3000/"
echo "  - Health Check: http://localhost:3000/health"
echo ""
echo "📝 View logs with: npm run docker:logs"
echo "🛑 Stop services with: npm run docker:down"