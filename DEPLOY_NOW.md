# 🚀 Deploy to Server - Quick Start Guide

**Last Updated**: October 31, 2025  
**Estimated Time**: 15-20 minutes

---

## Prerequisites Checklist

Before you begin, ensure you have:

- [ ] **Server Access**: SSH access to your Ubuntu/Debian server
- [ ] **Supabase Account**: At least one environment configured (prod/staging/dev)
- [ ] **API Keys**: AgentQL, Gemini, BrowserBase (optional)
- [ ] **RDPRM Account**: Username, password, security answer
- [ ] **Worker Accounts**: 20 Quebec Registry accounts ready to insert

---

## Step 1: Server Setup (5 minutes)

SSH into your server and run these commands:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Redis
sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Verify installations
node --version   # Should be v20.x.x
npm --version    # Should be v10.x.x
pm2 --version    # Should be v5.x.x
redis-cli ping   # Should return PONG
```

---

## Step 2: Clone Repository (2 minutes)

```bash
# Clone the repository
git clone https://github.com/Paraito/registre-extractor.git
cd registre-extractor

# Verify you're on main branch
git branch
```

---

## Step 3: Configure Environment (5 minutes)

```bash
# Copy example environment file
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required Variables** (minimum for production):

```bash
# Supabase Production
PROD_SUPABASE_URL=https://your-project.supabase.co
PROD_SUPABASE_ANON_KEY=your-anon-key
PROD_SUPABASE_SERVICE_KEY=your-service-key

# Redis (default is fine if running locally)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# AgentQL (for AI extraction)
AGENTQL_API_KEY=your-agentql-key

# Gemini (for OCR)
GEMINI_API_KEY=your-gemini-key

# BrowserBase (for REQ scraping)
BROWSERBASE_API_KEY=your-browserbase-key
BROWSERBASE_PROJECT_ID=your-project-id

# RDPRM Credentials
RDPRM_USER=your-rdprm-username
RDPRM_PASS=your-rdprm-password
RDPRM_SEC=RDPRM

# Environment
NODE_ENV=production
HEADLESS=true

# OCR Control (enable for production)
OCR_PROD=true
OCR_STAGING=false
OCR_DEV=false

# Worker Configuration
WORKER_COUNT=3
WORKER_CONCURRENCY=20
OCR_WORKER_COUNT=5
```

**Save and exit**: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 4: Database Setup (3 minutes)

### Run Migrations in Supabase

1. Go to your Supabase project: https://app.supabase.com
2. Navigate to **SQL Editor**
3. Run each migration file in order:

```sql
-- Run these in order:
-- 1. supabase/migrations/001_create_extraction_tables.sql
-- 2. supabase/migrations/002_add_document_types.sql
-- 3. supabase/migrations/003_add_ocr_support.sql
-- 4. supabase/migrations/004_add_boosted_file_content.sql
-- 5. supabase/migrations/005_add_ocr_tracking.sql
```

### Insert Worker Accounts

```sql
-- Insert your 20 Quebec Registry accounts
INSERT INTO worker_accounts (username, password, is_active) VALUES
  ('account1', 'password1', true),
  ('account2', 'password2', true),
  ('account3', 'password3', true),
  -- ... add all 20 accounts
  ('account20', 'password20', true);
```

### Create Storage Bucket

1. Go to **Storage** in Supabase
2. Create a new bucket named: `registre-documents`
3. Set it to **Private**
4. Enable RLS policies as needed

---

## Step 5: Build & Deploy (3 minutes)

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Copy and run the command it outputs
```

---

## Step 6: Verify Deployment (2 minutes)

### Check PM2 Status

```bash
pm2 status
```

**Expected output**:
```
┌────┬────────────────────┬─────────┬─────────┬──────────┐
│ id │ name               │ status  │ restart │ uptime   │
├────┼────────────────────┼─────────┼─────────┼──────────┤
│ 0  │ unified-worker     │ online  │ 0       │ 10s      │
│ 1  │ unified-worker     │ online  │ 0       │ 10s      │
│ 2  │ unified-worker     │ online  │ 0       │ 10s      │
│ 3  │ registre-ocr       │ online  │ 0       │ 10s      │
│ 4  │ registre-monitor   │ online  │ 0       │ 10s      │
│ 5  │ registre-api       │ online  │ 0       │ 10s      │
└────┴────────────────────┴─────────┴─────────┴──────────┘
```

### Check Logs

```bash
# View unified worker logs
pm2 logs unified-worker --lines 20
```

**Look for**:
```
✅ Unified Worker registered and ready
```

```bash
# View OCR worker logs
pm2 logs registre-ocr --lines 20
```

**Look for**:
```
✅ OCR WORKERS STARTED SUCCESSFULLY
```

### Test API

```bash
# Test health endpoint
curl http://localhost:3000/health
```

**Expected**:
```json
{"status":"ok","timestamp":"2025-10-31T..."}
```

### Access Dashboard

Open browser: `http://your-server-ip:3000/`

You should see the monitoring dashboard.

---

## Step 7: Configure Firewall (Optional)

If you want to access the API from outside:

```bash
# Allow port 3000 (API)
sudo ufw allow 3000/tcp

# Check firewall status
sudo ufw status
```

---

## 🎉 Deployment Complete!

Your system is now running with:

- ✅ **9 Extraction Workers** (handling Land Registry, REQ, RDPRM)
- ✅ **5 OCR Workers** (processing documents)
- ✅ **1 Health Monitor** (tracking system health)
- ✅ **1 API Server** (REST API on port 3000)

**Total**: 14 concurrent workers processing jobs 24/7

---

## Common Commands

### View Logs
```bash
pm2 logs                    # All logs
pm2 logs unified-worker     # Unified worker only
pm2 logs registre-ocr       # OCR worker only
pm2 logs --lines 100        # Last 100 lines
```

### Monitor in Real-Time
```bash
pm2 monit
```

### Restart Services
```bash
pm2 restart all             # Restart all
pm2 restart unified-worker  # Restart specific service
```

### Stop Services
```bash
pm2 stop all                # Stop all
pm2 stop unified-worker     # Stop specific service
```

### Update Code
```bash
# Quick update and restart
./scripts/deploy-pm2.sh

# Or manually:
git pull origin main
npm install
npm run build
pm2 restart all
```

---

## Troubleshooting

### Workers Not Starting

**Check logs**:
```bash
pm2 logs unified-worker --err
```

**Common issues**:
- Missing `.env` file → Copy from `.env.example`
- Invalid Supabase credentials → Check `.env`
- Redis not running → `sudo systemctl start redis-server`

### No Jobs Processing

**Check if workers are polling**:
```bash
pm2 logs unified-worker | grep "Polling"
```

**Check database**:
```bash
npm run diagnose
```

### Memory Issues

**Check memory usage**:
```bash
pm2 monit
```

**If workers restart frequently**:
- Reduce `WORKER_COUNT` in `.env`
- Reduce `instances` in `ecosystem.config.js`
- Increase server RAM

### API Not Accessible

**Check if API is running**:
```bash
pm2 logs registre-api
```

**Check firewall**:
```bash
sudo ufw status
sudo ufw allow 3000/tcp
```

---

## Next Steps

### 1. Test with a Job

Create a test extraction job:

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "lot_number": "2 784 195",
    "circumscription": "Montréal",
    "cadastre": "Cadastre du Québec",
    "document_source": "index"
  }'
```

### 2. Monitor Progress

Watch the logs:
```bash
pm2 logs unified-worker
```

Check the dashboard:
```
http://your-server-ip:3000/
```

### 3. Scale if Needed

To add more workers, edit `ecosystem.config.js`:

```javascript
{
  name: 'unified-worker',
  instances: 5,  // Increase from 3 to 5
  env: {
    WORKER_COUNT: 3  // Keep at 3 per instance
  }
}
// Total: 5 × 3 = 15 workers
```

Then restart:
```bash
pm2 restart ecosystem.config.js
```

---

## Support

If you encounter issues:

1. **Check logs first**: `pm2 logs`
2. **Review troubleshooting section** above
3. **Check environment variables**: `cat .env`
4. **Verify database migrations** in Supabase
5. **Check Redis**: `redis-cli ping`

---

## Summary

✅ **Server configured** with Node.js, PM2, Redis  
✅ **Code deployed** and built  
✅ **Environment configured** with credentials  
✅ **Database migrated** with all tables  
✅ **Workers running** and processing jobs  
✅ **API accessible** on port 3000  
✅ **Monitoring active** via dashboard  

**You're ready to process jobs!** 🚀

---

**Deployment Date**: _____________  
**Server IP**: _____________  
**Deployed By**: _____________

