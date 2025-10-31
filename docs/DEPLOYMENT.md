# 🚀 Registre Extractor - Production Deployment Guide

**Deployment Method**: PM2  
**Server Type**: Single Droplet (DigitalOcean/VPS)  
**Last Updated**: October 31, 2025

---

## 📋 Quick Start

### One-Command Deployment

```bash
./scripts/deploy-pm2.sh
```

This script will:
1. Pull latest code from git
2. Install dependencies
3. Build TypeScript
4. Restart PM2 services
5. Show service status

---

## 🎯 System Overview

### Services Running

| Service | Instances | Workers | Purpose |
|---------|-----------|---------|---------|
| **unified-worker** | 3 PM2 instances | 9 total | Handles extraction, REQ, RDPRM jobs |
| **registre-ocr** | 1 PM2 instance | 5 workers | OCR processing with Gemini/Claude |
| **registre-monitor** | 1 PM2 instance | 1 worker | Health monitoring |
| **registre-api** | 1 PM2 instance | 1 worker | REST API (port 3000) |

**Total**: 4 PM2 services, 16 concurrent workers

### Job Types Handled

1. **Land Registry Extraction** (`extraction_queue` table)
   - Actes (deeds)
   - Index (property index)
   - Plans cadastraux (cadastral plans)

2. **REQ Scraping** (`search_sessions` table)
   - Company information from Registre des Entreprises du Québec

3. **RDPRM Scraping** (`rdprm_searches` table)
   - Personal and movable real rights documents

---

## 🔧 Prerequisites

### Server Requirements

- **OS**: Ubuntu 20.04+ or Debian 11+
- **RAM**: 4GB minimum, 8GB recommended
- **CPU**: 2 cores minimum, 4 cores recommended
- **Disk**: 20GB minimum
- **Node.js**: v20+ (LTS)

### Required Accounts & API Keys

1. **Supabase** (at least one environment)
   - Get credentials: https://app.supabase.com/project/_/settings/api
   - Required tables: `extraction_queue`, `search_sessions`, `req_companies`, `rdprm_searches`, `worker_accounts`, `worker_status`

2. **BrowserBase** (for REQ scraping)
   - Sign up: https://www.browserbase.com/
   - Get API key and Project ID

3. **RDPRM Account** (for RDPRM scraping)
   - Create account: https://www.rdprm.gouv.qc.ca/
   - Note username, password, security answer

4. **AgentQL** (for AI-powered extraction)
   - Sign up: https://www.agentql.com/
   - Get API key

5. **Google Gemini** (for OCR - optional)
   - Get API key: https://aistudio.google.com/app/apikey

---

## 📦 Initial Setup

### 1. Install Node.js

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version  # Should be v20.x.x
npm --version   # Should be v10.x.x
```

### 2. Install PM2 Globally

```bash
sudo npm install -g pm2

# Verify installation
pm2 --version
```

### 3. Clone Repository

```bash
cd /opt  # Or your preferred location
git clone <your-repo-url> registre-extractor
cd registre-extractor
```

### 4. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required Environment Variables:**

```bash
# Supabase (at least one environment)
SUPABASE_URL_PROD=https://your-project.supabase.co
SUPABASE_SERVICE_KEY_PROD=your-service-key
SUPABASE_ANON_KEY_PROD=your-anon-key

# Optional: Staging/Dev environments
# SUPABASE_URL_STAGING=...
# SUPABASE_URL_DEV=...

# BrowserBase (for REQ scraping)
BROWSERBASE_API_KEY=your-browserbase-key
BROWSERBASE_PROJECT_ID=your-project-id

# RDPRM Credentials
RDPRM_USERNAME=your-username
RDPRM_PASSWORD=your-password
RDPRM_SECURITY_ANSWER=your-answer

# AgentQL
AGENTQL_API_KEY=your-agentql-key

# OCR (optional)
GEMINI_API_KEY=your-gemini-key
OCR_PROD=true  # Enable OCR for prod environment

# Worker Configuration
WORKER_COUNT=3  # Workers per PM2 instance
OCR_WORKER_COUNT=5  # OCR workers
```

### 5. Install Dependencies & Build

```bash
npm install
npm run build
```

### 6. Start Services

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow instructions to enable auto-start on boot
```

---

## 🔄 Deployment Workflow

### Standard Deployment

```bash
# Use the deployment script
./scripts/deploy-pm2.sh

# Or manually:
git pull origin main
npm install
npm run build
pm2 restart all
pm2 logs --lines 50
```

### Quick Restart (no code changes)

```bash
./scripts/deploy-pm2.sh --quick
```

### Deploy and Monitor

```bash
./scripts/deploy-pm2.sh --logs
```

---

## 📊 Monitoring

### Check Service Status

```bash
# List all services
pm2 list

# Monitor in real-time
pm2 monit

# View logs
pm2 logs

# View specific service logs
pm2 logs unified-worker
pm2 logs registre-ocr
pm2 logs registre-api
pm2 logs registre-monitor
```

### Check Worker Health

```bash
# Run verification script
./scripts/verify-workers.sh

# Check deployment
./scripts/verify-deployment.sh
```

### View Logs

```bash
# All logs
pm2 logs

# Last 100 lines
pm2 logs --lines 100

# Follow logs in real-time
pm2 logs --lines 0

# Clear all logs
pm2 flush
```

---

## 🔍 Troubleshooting

### Services Not Starting

```bash
# Check PM2 status
pm2 list

# View error logs
pm2 logs --err

# Restart specific service
pm2 restart unified-worker

# Delete and restart all
pm2 delete all
pm2 start ecosystem.config.js
```

### High Memory Usage

```bash
# Check memory usage
pm2 monit

# Restart service with memory issues
pm2 restart unified-worker

# Adjust memory limits in ecosystem.config.js
# max_memory_restart: '1G'
```

### Jobs Not Processing

```bash
# Check worker status in database
npm run diagnose

# Check logs for errors
pm2 logs unified-worker --lines 100

# Verify environment variables
pm2 env 0  # Check env for first process
```

### Playwright Browser Issues

```bash
# Reinstall Playwright browsers
npx playwright install --with-deps chromium

# Verify installation
npx playwright install --dry-run chromium
```

---

## 🛡️ Security Best Practices

1. **Environment Variables**: Never commit `.env` file
2. **API Keys**: Rotate keys regularly
3. **Firewall**: Only expose necessary ports (3000 for API)
4. **Updates**: Keep Node.js and dependencies updated
5. **Logs**: Monitor logs for suspicious activity

---

## 📚 Additional Resources

- **PM2 Documentation**: https://pm2.keymetrics.io/docs/usage/quick-start/
- **Detailed Deployment Guide**: `docs/DEPLOYMENT.md`
- **PM2 Deployment Guide**: `docs/PM2-DEPLOYMENT.md`
- **Worker Status**: `docs/WORKER-STATUS.md`
- **Worker Accounts**: `docs/WORKER_ACCOUNTS.md`

---

## 🆘 Support

If you encounter issues:

1. Check logs: `pm2 logs --lines 100`
2. Run diagnostics: `npm run diagnose`
3. Verify deployment: `./scripts/verify-deployment.sh`
4. Check worker health: `./scripts/verify-workers.sh`

---

**Last Updated**: October 31, 2025  
**Deployment Method**: PM2 only (Docker archived)  
**Configuration**: `ecosystem.config.js`

