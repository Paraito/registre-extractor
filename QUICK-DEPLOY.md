# Quick Deployment Guide

## 🚀 Super Quick Deploy

If you're in a hurry and everything is already configured:

```bash
./deploy-pm2.sh
```

That's it! ✅

---

## 📝 First Time Setup (5 minutes)

### 1. Configure Environment

```bash
cp .env.example .env
nano .env  # Edit these required variables
```

**Required variables:**

```bash
# Supabase (at least one environment)
PROD_SUPABASE_URL=https://xxx.supabase.co
PROD_SUPABASE_SERVICE_KEY=xxx

# BrowserBase (for REQ)
BROWSERBASE_API_KEY=xxx
BROWSERBASE_PROJECT_ID=xxx

# RDPRM credentials
RDPRM_USER=xxx
RDPRM_PASS=xxx
RDPRM_SEC=RDPRM

# AgentQL (for Land Registry)
AGENTQL_API_KEY=xxx
```

### 2. Deploy

```bash
chmod +x deploy-pm2.sh
./deploy-pm2.sh
```

### 3. Verify

```bash
pm2 logs unified-worker
```

You should see:
```
✅ Unified Worker registered and ready
🔄 Polling for jobs across environments
```

---

## 📊 What's Running

After deployment, you'll have:

- **9 extraction workers** - Handles Land Registry, REQ, RDPRM
- **5 OCR workers** - Processes extracted documents
- **1 monitor** - Health monitoring
- **1 API server** - Port 3000

Total: **4 PM2 apps, 15 workers**

---

## 🔍 Quick Commands

```bash
# View all services
pm2 list

# View logs
pm2 logs unified-worker

# Restart
pm2 restart unified-worker

# Monitor in real-time
pm2 monit

# Stop everything
pm2 stop all
```

---

## 🧪 Test It Works

### Test REQ Job

```sql
INSERT INTO search_sessions (initial_search_query, status, req_completed)
VALUES ('Bombardier', 'pending_company_selection', false);
```

Watch logs: `pm2 logs unified-worker`

You should see it process the job automatically!

### Test RDPRM Job

```sql
INSERT INTO rdprm_searches (search_session_id, search_name, status)
VALUES ('your-session-id', 'John Doe', 'pending');
```

---

## ⚠️ Troubleshooting

**Workers not starting?**
```bash
npm run build  # Rebuild
pm2 logs --err  # Check errors
```

**Jobs not being picked up?**
- Check `.env` has correct Supabase credentials
- Verify jobs are in correct status (see DEPLOYMENT.md)

**Need more help?**
- See full documentation: `DEPLOYMENT.md`
- Check logs: `pm2 logs unified-worker --lines 100`

---

## ✅ You're Done!

The unified worker will now automatically:
- ✅ Pick up Land Registry extraction jobs
- ✅ Pick up REQ scraping jobs
- ✅ Pick up RDPRM scraping jobs
- ✅ Process them across all environments
- ✅ Restart automatically if it crashes

No manual intervention needed!
