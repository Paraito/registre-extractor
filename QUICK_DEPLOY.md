# 🚀 Quick Deployment Guide - Your Server

**Server**: doc-extractor  
**User**: registry  
**Path**: ~/apps/registre-extractor  
**Current State**: PM2 running (broken), Docker not installed

---

## Step 1: Install Docker

```bash
# You're currently logged in as 'registry' user
# Exit to root first
exit

# Now as root, install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add registry user to docker group (so they can run docker without sudo)
sudo usermod -aG docker registry

# Install Docker Compose plugin
sudo apt-get update
sudo apt-get install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version

# Start Docker service
sudo systemctl enable docker
sudo systemctl start docker
```

---

## Step 2: Switch Back to Registry User

```bash
# IMPORTANT: You need to log out and log back in for group changes to take effect
exit  # Exit from root

# Log back in as registry
su - registry

# Verify you can run docker
docker ps
# Should show empty list (no containers yet) without permission errors
```

---

## Step 3: Stop PM2 Services

```bash
cd ~/apps/registre-extractor

# Check what's running
pm2 list

# Stop all PM2 services
pm2 stop all

# Delete all PM2 services (we'll use Docker instead)
pm2 delete all

# Save PM2 state (empty)
pm2 save

# Optional: Disable PM2 from starting on boot
pm2 unstartup
```

---

## Step 4: Verify Environment Variables

```bash
cd ~/apps/registre-extractor

# Check if .env file exists
ls -la .env

# If it doesn't exist, create it
cp .env.example .env

# Edit .env file
nano .env
```

**Required variables** (make sure these are set):
```bash
# Supabase (at least one environment)
PROD_SUPABASE_URL=https://your-project.supabase.co
PROD_SUPABASE_ANON_KEY=eyJ...
PROD_SUPABASE_SERVICE_KEY=eyJ...

# AI Services
AGENTQL_API_KEY=your_key
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...

# OCR (optional but recommended)
CLAUDE_API_KEY=sk-ant-...

# OCR Flags
OCR_PROD=true

# Redis (use 'redis' for Docker)
REDIS_HOST=redis
REDIS_PORT=6379
```

**Save and exit**: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 5: Build and Deploy with Docker

```bash
cd ~/apps/registre-extractor

# Build Docker images (this will take 5-10 minutes)
docker compose build

# Start all services
docker compose up -d

# Check status
docker compose ps
```

**Expected output**:
```
NAME                  STATUS
registre-worker-1     Up
registre-worker-2     Up
registre-worker-3     Up
registre-ocr          Up
registre-monitor      Up
registre-api          Up
registre-redis        Up
```

---

## Step 6: Verify Deployment

```bash
# Run verification script
./scripts/verify-deployment.sh

# Check logs
docker compose logs -f registre-worker-1

# Look for these SUCCESS indicators:
# ✅ "Worker registered and ready"
# ✅ "Extractor initialized and logged in"
# ✅ "Claimed job from environment"
# ✅ No Playwright errors
```

---

## Step 7: Monitor

```bash
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f registre-worker-1
docker compose logs -f registre-ocr

# Check container status
docker compose ps

# Check resource usage
docker stats

# Restart if needed
docker compose restart
```

---

## 🔍 Troubleshooting

### If Docker build fails

```bash
# Check Docker is running
sudo systemctl status docker

# Try building with no cache
docker compose build --no-cache

# Check disk space
df -h
```

### If containers won't start

```bash
# Check logs for errors
docker compose logs

# Check specific container
docker compose logs registre-worker-1

# Restart services
docker compose restart
```

### If "permission denied" errors

```bash
# Make sure you're in docker group
groups
# Should show: registry docker ...

# If not, log out and back in
exit
su - registry
```

### If workers can't connect to database

```bash
# Check environment variables in container
docker compose exec registre-worker-1 env | grep SUPABASE

# Verify .env file has correct values
cat .env | grep SUPABASE
```

---

## 📊 Expected Results

After successful deployment:

- ✅ 3 extraction workers running concurrently
- ✅ 5 OCR workers processing documents
- ✅ No Playwright browser errors
- ✅ Jobs moving from "En attente" → "En traitement" → "Complété"
- ✅ OCR picking up completed jobs automatically

---

## 🎯 Quick Commands Reference

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Restart services
docker compose restart

# View logs
docker compose logs -f

# Check status
docker compose ps

# Update code and redeploy
git pull
docker compose build
docker compose up -d

# Scale workers (if needed)
docker compose up -d --scale registre-worker-1=2
```

---

## ⚠️ Important Notes

1. **PM2 is no longer needed** - Docker manages all processes
2. **Redis is included** - No need for external Redis
3. **Worker accounts** - Make sure they're in the database (see docs/WORKER_ACCOUNTS.md)
4. **Logs location** - Use `docker compose logs`, not PM2 logs
5. **Auto-restart** - Docker will automatically restart crashed containers

---

## 🔗 Next Steps

After deployment is working:

1. **Add worker accounts** to database (if not already done):
   ```sql
   -- In Supabase SQL Editor
   INSERT INTO worker_accounts (username, password, is_active) VALUES
     ('account1', 'password1', true),
     ('account2', 'password2', true);
   ```

2. **Monitor performance**:
   ```bash
   docker stats
   docker compose logs -f
   ```

3. **Set up auto-start on boot** (Docker handles this automatically)

4. **Test with real jobs** and verify extraction quality

---

## 📞 If You Get Stuck

**Check these in order**:

1. Docker installed? `docker --version`
2. Docker running? `sudo systemctl status docker`
3. In docker group? `groups` (should show "docker")
4. .env file exists? `ls -la .env`
5. Environment variables set? `cat .env | grep SUPABASE`
6. Containers running? `docker compose ps`
7. Any errors in logs? `docker compose logs`

**Common fixes**:
- Log out and back in (for group permissions)
- Restart Docker: `sudo systemctl restart docker`
- Rebuild images: `docker compose build --no-cache`
- Check disk space: `df -h`

