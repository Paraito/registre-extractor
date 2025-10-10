# Automated Health Monitoring

## Overview

The system now includes **fully automated health monitoring** that runs independently and requires zero manual intervention. The health monitor automatically:

- ✅ **Resets stuck jobs** every 30 seconds (jobs stuck > 3 minutes)
- ✅ **Cleans up dead workers** every 30 seconds (workers with no heartbeat > 2 minutes)
- ✅ **Monitors system health** continuously
- ✅ **Alerts on anomalies** (no workers, too many errors, etc.)
- ✅ **Self-heals** without human intervention

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Health Monitor                          │
│  (Runs independently, auto-restarts on failure)            │
│                                                             │
│  Every 30 seconds:                                          │
│  • Reset jobs stuck > 3 minutes                             │
│  • Cleanup workers with no heartbeat > 2 minutes            │
│  • Monitor queue health                                     │
│  • Log system status                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase Database                        │
│                                                             │
│  • extraction_queue (jobs)                                  │
│  • worker_status (worker heartbeats)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Workers (1-20)                           │
│  • Process jobs                                             │
│  • Send heartbeats every 10s                                │
│  • Auto-recover from errors                                 │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Options

### Option 1: Docker Compose (Recommended)

The health monitor is **automatically included** in the Docker Compose setup:

```bash
# Build and start everything (including monitor)
docker-compose up -d

# Check monitor logs
docker-compose logs -f monitor

# Monitor is automatically restarted if it crashes
```

The monitor service in `docker-compose.yml`:
- Uses minimal resources (0.1 CPU, 256MB RAM)
- Restarts automatically on failure
- Runs independently from workers
- No manual intervention needed

### Option 2: Systemd Service (Linux Servers)

For non-Docker deployments, use systemd:

```bash
# 1. Copy the service file
sudo cp systemd/registre-monitor.service /etc/systemd/system/

# 2. Create log directory
sudo mkdir -p /var/log/registre-extractor
sudo chown registre:registre /var/log/registre-extractor

# 3. Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable registre-monitor
sudo systemctl start registre-monitor

# 4. Check status
sudo systemctl status registre-monitor

# 5. View logs
sudo journalctl -u registre-monitor -f
```

The systemd service:
- Starts automatically on boot
- Restarts automatically on failure (10s delay)
- Logs to `/var/log/registre-extractor/monitor.log`
- Runs with security hardening

### Option 3: PM2 Process Manager

For Node.js-based deployments:

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Start the monitor
pm2 start dist/monitor/index.js --name registre-monitor

# 3. Save PM2 configuration
pm2 save

# 4. Setup PM2 to start on boot
pm2 startup

# 5. Monitor
pm2 logs registre-monitor
pm2 monit
```

### Option 4: Development Mode

For local development:

```bash
# Run with auto-reload
npm run monitor:dev

# Or run built version
npm run build
npm run monitor
```

## Configuration

The monitor uses these environment variables (same as workers):

```env
# Supabase environments (at least one required)
DEV_SUPABASE_URL=...
DEV_SUPABASE_SERVICE_KEY=...

STAGING_SUPABASE_URL=...
STAGING_SUPABASE_SERVICE_KEY=...

PROD_SUPABASE_URL=...
PROD_SUPABASE_SERVICE_KEY=...

# Optional: Logging
LOG_LEVEL=info  # error, warn, info, debug
```

**No additional configuration needed!** The monitor automatically:
- Detects all configured environments
- Uses optimal check intervals (30s)
- Sets appropriate thresholds (3min for jobs, 2min for workers)

## What Gets Automated

### 1. Stuck Job Recovery

**Before:** Jobs could get stuck indefinitely, requiring manual intervention

**Now:** 
- Monitor checks every 30 seconds
- Any job in "En traitement" for > 3 minutes is automatically reset
- Job is released back to queue for another worker to pick up
- Original worker is cleared from the job

**Example log:**
```
🔄 Auto-reset stuck jobs
   environment: dev
   count: 2
   jobs: [
     { id: 'c0641b62', worker: 'worker-ac', doc: 'index:12345' },
     { id: '1f3a232a', worker: 'worker-ac', doc: 'acte:67890' }
   ]
```

### 2. Dead Worker Cleanup

**Before:** If a worker crashed, its jobs remained stuck until manually reset

**Now:**
- Monitor checks worker heartbeats every 30 seconds
- Workers with no heartbeat for > 2 minutes are marked as dead
- Any jobs held by dead workers are automatically released
- Dead workers are marked as "offline" in the database

**Example log:**
```
💀 Cleaned up dead workers
   environment: dev
   count: 1
   workers: ['worker-ac']
```

### 3. System Health Monitoring

**Before:** No visibility into system health without manual queries

**Now:**
- Continuous monitoring of all environments
- Automatic detection of anomalies:
  - No active workers but jobs pending
  - More processing jobs than expected
  - High number of failed jobs (> 10)
- Periodic health status logs (every ~5 minutes)

**Example log:**
```
📊 System health status
   environment: dev
   activeWorkers: 5
   pendingJobs: 23
   processingJobs: 5
   errorJobs: 2
```

### 4. Anomaly Alerts

**Before:** Issues went unnoticed until manually checked

**Now:**
- Automatic warnings for common issues
- Logged at WARN level for easy filtering
- Helps identify problems before they become critical

**Example alerts:**
```
⚠️  No active workers but jobs are pending!
   environment: dev
   pendingJobs: 50

⚠️  More processing jobs than expected for active workers
   environment: dev
   processingJobs: 20
   activeWorkers: 3

⚠️  High number of failed jobs
   environment: dev
   errorJobs: 15
```

## Monitoring the Monitor

### Health Checks

The monitor itself is designed to be resilient:

1. **Automatic Restart**: If it crashes, Docker/systemd/PM2 restarts it
2. **Error Isolation**: Errors in one check don't stop other checks
3. **Graceful Degradation**: If one environment fails, others continue
4. **No External Dependencies**: Only needs Supabase connection

### Logs

Monitor logs include:

```bash
# Docker
docker-compose logs -f monitor

# Systemd
sudo journalctl -u registre-monitor -f

# PM2
pm2 logs registre-monitor

# Development
# Logs to console
```

### Metrics

The monitor logs these metrics periodically:

- **Active workers** per environment
- **Job counts** by status (pending, processing, error)
- **Stuck jobs** detected and reset
- **Dead workers** detected and cleaned
- **Anomalies** detected

## Troubleshooting

### Monitor Not Starting

```bash
# Check if it's running
docker-compose ps monitor  # Docker
sudo systemctl status registre-monitor  # Systemd
pm2 list  # PM2

# Check logs for errors
docker-compose logs monitor  # Docker
sudo journalctl -u registre-monitor -n 50  # Systemd
pm2 logs registre-monitor  # PM2
```

### Monitor Running But Not Resetting Jobs

1. **Check Supabase connection:**
   ```bash
   npm run check-redis  # Also checks Supabase
   ```

2. **Verify environment variables:**
   ```bash
   # Ensure at least one Supabase environment is configured
   echo $DEV_SUPABASE_URL
   echo $DEV_SUPABASE_SERVICE_KEY
   ```

3. **Check monitor logs for errors:**
   Look for "Error in resetStuckJobs" or "Error querying stuck jobs"

### Too Many Resets

If jobs are being reset too frequently:

1. **Check worker health:**
   ```bash
   npm run diagnose
   ```

2. **Increase timeout threshold:**
   Edit `src/monitor/health-monitor.ts`:
   ```typescript
   constructor(
     checkIntervalMs: number = 30000,
     staleJobThresholdMs: number = 5 * 60 * 1000, // Increase from 3 to 5 minutes
     deadWorkerThresholdMs: number = 2 * 60 * 1000
   )
   ```

3. **Rebuild and restart:**
   ```bash
   npm run build
   docker-compose up -d --build monitor  # Docker
   sudo systemctl restart registre-monitor  # Systemd
   pm2 restart registre-monitor  # PM2
   ```

## Manual Scripts (Still Available)

While the monitor handles everything automatically, manual scripts are still available for debugging:

```bash
# Full system diagnostic
npm run diagnose

# Check Redis health
npm run check-redis

# Manually reset stuck jobs (if needed)
npm run reset-stuck-jobs
```

## Best Practices

1. **Always run the monitor** in production
2. **Monitor the monitor** - set up alerts if it stops
3. **Review logs periodically** for anomalies
4. **Adjust thresholds** if needed for your workload
5. **Keep it updated** when deploying new code

## Summary

✅ **Zero manual intervention required**
✅ **Automatic stuck job recovery**
✅ **Automatic dead worker cleanup**
✅ **Continuous health monitoring**
✅ **Self-healing system**
✅ **Production-ready**

The health monitor runs 24/7, automatically fixing issues before they impact your system. Just deploy it once and forget about it!

