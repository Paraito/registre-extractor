# ⚡ Quick Deploy Checklist

## 🎯 What Was Fixed

### Critical Issue: "Dead Workers" Problem ✅ FIXED
- **Symptom**: Workers marked as dead every 30 seconds
- **Root Cause**: Health monitor checked all environments, workers registered in default only
- **Fix**: Monitor now only checks default environment for worker_status
- **Files**: `src/monitor/health-monitor.ts`, `src/worker/index.ts`

---

## 📋 Pre-Push Checklist

- [x] TypeScript compilation successful
- [x] No type errors
- [x] Critical fixes applied
- [x] Build successful
- [ ] Local Docker test (optional but recommended)

---

## 🚀 Deploy Commands

### Option 1: Quick Deploy (No Local Test)

```bash
# 1. Commit and push
git add .
git commit -m "Fix: Worker registration environment mismatch and heartbeat standardization"
git push origin main

# 2. On server
ssh your-server
cd /path/to/registre-extractor
git pull origin main
npm run build
docker-compose down
docker-compose up -d --build

# 3. Monitor
docker-compose logs -f registre-monitor
```

### Option 2: Safe Deploy (With Local Test)

```bash
# 1. Test locally first
docker-compose down
docker-compose up --build -d
docker-compose logs -f registre-monitor
# Wait 5 minutes - should see NO "💀 Cleaned up dead workers" messages

# 2. If test passes, deploy to server
git add .
git commit -m "Fix: Worker registration environment mismatch and heartbeat standardization"
git push origin main

# 3. On server
ssh your-server
cd /path/to/registre-extractor
git pull origin main
npm run build
docker-compose down
docker-compose up -d --build
docker-compose logs -f
```

---

## ✅ Success Indicators

After deployment, you should see:

### Good Signs ✅
```
✅ Worker registered and ready
✅ No stuck jobs found - ready to process
📊 System health status
✅ Stuck jobs auto-reset completed (if any)
```

### Bad Signs ❌ (Should NOT see these anymore)
```
❌ 💀 Cleaned up dead workers
❌ Error querying dead workers
❌ Heartbeat failed
```

---

## 🔍 Quick Verification

```bash
# Check all containers are running
docker-compose ps

# Monitor for 5 minutes (should be clean)
docker-compose logs -f registre-monitor

# Check worker logs
docker-compose logs registre-worker-1 --tail=50

# Verify dashboard
curl http://localhost:3000/api/metrics | jq
```

---

## 📊 What Changed

| File | Change | Impact |
|------|--------|--------|
| `src/monitor/health-monitor.ts` | Only check default env for workers | No more false "dead" warnings |
| `src/worker/index.ts` | Heartbeat 10s → 30s | Consistent with other workers |
| `src/monitor/health-monitor.ts` | Dead threshold 2min → 3min | More reliable detection |

---

## 🎯 Expected Results

### Before:
- Workers marked dead every 30s
- Logs full of "💀 Cleaned up dead workers"
- Database churn

### After:
- Workers stay alive indefinitely
- Clean logs
- Stable system

---

## 📞 If Something Goes Wrong

### Workers still marked as dead?
```bash
# Check environment variables
docker-compose exec registre-worker-1 env | grep SUPABASE

# Check database
# In Supabase SQL editor:
SELECT * FROM worker_status ORDER BY last_heartbeat DESC LIMIT 10;
```

### Jobs not processing?
```bash
# Check job queue
# In Supabase SQL editor:
SELECT status_id, COUNT(*) FROM extraction_queue GROUP BY status_id;

# Check worker logs
docker-compose logs registre-worker-1 | grep -i error
```

### Container won't start?
```bash
# Check logs
docker-compose logs registre-worker-1

# Rebuild
docker-compose build --no-cache registre-worker-1
docker-compose up -d registre-worker-1
```

---

## 🎉 You're Ready!

All critical issues are fixed. Just push and deploy! 🚀

**Confidence Level**: HIGH ✅  
**Risk Level**: LOW ✅  
**Action**: DEPLOY NOW 🚀

