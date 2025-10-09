# Quick Start: Automated Monitoring

## TL;DR - Deploy in 30 Seconds

```bash
# One command to deploy everything
./deploy-monitor.sh
```

That's it! The health monitor is now running and will automatically:
- ✅ Reset stuck jobs every 30 seconds
- ✅ Cleanup dead workers every 30 seconds  
- ✅ Monitor system health 24/7
- ✅ Self-heal without any manual intervention

## What Just Happened?

The deployment script automatically:

1. **Detected your environment** (Docker, systemd, PM2, or manual)
2. **Built the project** (`npm run build`)
3. **Deployed the health monitor** using the best method for your setup
4. **Started monitoring** immediately

## Verify It's Working

### Docker Compose
```bash
# Check if monitor is running
docker-compose ps monitor

# View logs
docker-compose logs -f monitor
```

### Systemd (Linux)
```bash
# Check status
sudo systemctl status registre-monitor

# View logs
sudo journalctl -u registre-monitor -f
```

### PM2
```bash
# Check status
pm2 list

# View logs
pm2 logs registre-monitor
```

## What You'll See in Logs

### Normal Operation
```
🏥 Health monitor started
   checkIntervalMs: 30000
   staleJobThresholdMs: 180000
   deadWorkerThresholdMs: 120000

📊 System health status
   environment: dev
   activeWorkers: 5
   pendingJobs: 23
   processingJobs: 5
   errorJobs: 0
```

### When Issues Are Auto-Fixed
```
🔄 Auto-reset stuck jobs
   environment: dev
   count: 2
   jobs: [...]

💀 Cleaned up dead workers
   environment: dev
   count: 1
   workers: [...]
```

### When Anomalies Are Detected
```
⚠️  No active workers but jobs are pending!
   environment: dev
   pendingJobs: 50
```

## Immediate Actions for Your Current Issue

Since you have jobs stuck right now:

```bash
# 1. Deploy the monitor (if not already done)
./deploy-monitor.sh

# 2. The monitor will automatically reset stuck jobs within 30 seconds
#    No manual intervention needed!

# 3. (Optional) Check what was fixed
docker-compose logs monitor | grep "Auto-reset"
# or
sudo journalctl -u registre-monitor | grep "Auto-reset"
# or
pm2 logs registre-monitor | grep "Auto-reset"
```

## Configuration (Optional)

The monitor works out-of-the-box with sensible defaults. If you need to adjust:

### Change Check Frequency

Edit `src/monitor/health-monitor.ts`:
```typescript
constructor(
  checkIntervalMs: number = 30000,        // Check every 30s (default)
  staleJobThresholdMs: number = 3 * 60 * 1000,  // 3 min threshold (default)
  deadWorkerThresholdMs: number = 2 * 60 * 1000 // 2 min threshold (default)
)
```

Then rebuild and redeploy:
```bash
npm run build
./deploy-monitor.sh
```

## Troubleshooting

### Monitor Not Running?

```bash
# Check if it's running
docker-compose ps monitor          # Docker
sudo systemctl status registre-monitor  # Systemd
pm2 list                           # PM2

# If not, start it
docker-compose up -d monitor       # Docker
sudo systemctl start registre-monitor   # Systemd
pm2 start registre-monitor         # PM2
```

### Monitor Running But Not Fixing Jobs?

1. Check logs for errors:
   ```bash
   docker-compose logs monitor | grep -i error
   ```

2. Verify Supabase connection:
   ```bash
   npm run diagnose
   ```

3. Check environment variables are set:
   ```bash
   # At least one of these should be set
   echo $DEV_SUPABASE_URL
   echo $STAGING_SUPABASE_URL
   echo $PROD_SUPABASE_URL
   ```

## Production Deployment

### Docker Compose (Recommended)

Already included in `docker-compose.yml`:
```bash
docker-compose up -d
```

The monitor service:
- Starts automatically with other services
- Restarts on failure
- Uses minimal resources (0.1 CPU, 256MB RAM)
- Runs independently from workers

### Systemd (Linux Servers)

```bash
# Deploy once
./deploy-monitor.sh

# Enable auto-start on boot (already done by script)
sudo systemctl enable registre-monitor

# Monitor will start automatically on:
# - Server boot
# - Service crash
# - Manual restart
```

### PM2 (Node.js Deployments)

```bash
# Deploy once
./deploy-monitor.sh

# Setup auto-start on boot
pm2 startup
pm2 save

# Monitor will start automatically on:
# - Server boot
# - Process crash
# - Manual restart
```

## Monitoring the Monitor

The monitor is designed to be resilient, but you should still monitor it:

### Set Up Alerts

1. **Docker**: Use container health checks
2. **Systemd**: Use systemd monitoring tools
3. **PM2**: Use PM2 monitoring features

### Check Periodically

```bash
# Quick health check
npm run diagnose

# Full system check
docker-compose ps  # All services should be "Up"
```

## Next Steps

1. ✅ **Deploy the monitor** (done with `./deploy-monitor.sh`)
2. ✅ **Verify it's running** (check logs)
3. ✅ **Relax** - the system is now self-healing!

## Support

If you encounter issues:

1. Check logs for errors
2. Run `npm run diagnose` for system health
3. Review `AUTOMATED-MONITORING.md` for detailed docs
4. Check `TROUBLESHOOTING.md` for common issues

---

**Remember:** Once deployed, the health monitor runs 24/7 and requires zero manual intervention. It will automatically fix stuck jobs, cleanup dead workers, and alert you to anomalies. Just deploy it once and forget about it!

