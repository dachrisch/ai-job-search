---
name: job-search-dev-startup
description: Use when starting the job-search development environment and need MongoDB/Redis containers with correct port/network configuration
---

# Job Search Dev Startup

## Overview

Starting job-search dev requires three critical pieces: MongoDB and Redis containers running on servyy-test.lxd with persistent volumes, environment variables exported directly (NOT via .env files), and proper port binding. A single misconfiguration cascades into connection failures that waste hours.

## When to Use

Use when:
- Starting development on job-search for the first time
- Containers need cleanup/restart
- MongoDB or Redis connections fail
- You see errors like `ECONNREFUSED 127.0.0.1:6379` or `connect ECONNREFUSED 10.185.182.250:27017`

## The Sequence

Follow in exact order. Skip nothing.

### 1. Verify Test Container is Running

```bash
ssh servyy-test.lxd "docker ps | head -5"
```

If connection fails or Docker isn't running, start the container:
```bash
./setup_test_container.sh  # in ~/dev/infrastructure/container/scripts/
```

### 2. Clean and Create Fresh Containers

**CRITICAL:** Always remove old volumes - stale data causes SIGSEGV crashes and featureCompatibilityVersion errors.

```bash
ssh servyy-test.lxd << 'EOF'
docker rm -f job-search-mongo job-search-redis
docker volume rm job-search_mongo_data job-search_mongo_config job-search_redis_data 2>/dev/null || true

# Create with persistent volumes + auto-restart
docker run \
  --name job-search-mongo \
  -p 0.0.0.0:27017:27017 \
  -v job-search_mongo_data:/data/db \
  -v job-search_mongo_config:/data/configdb \
  --restart unless-stopped \
  -d mongo:8

docker run \
  --name job-search-redis \
  -p 0.0.0.0:6379:6379 \
  -v job-search_redis_data:/data \
  --restart unless-stopped \
  -d redis:7-alpine

sleep 5
docker ps | grep job-search
EOF
```

### 3. Verify Services Are Ready

```bash
timeout 3 nc -zv 10.185.182.250 27017 && echo "MongoDB ready"
timeout 3 nc -zv 10.185.182.250 6379 && echo "Redis ready"
```

### 4. Start the App

**One command starts both API and frontend:**

```bash
npm run start:dev
```

Or manually with env vars:
```bash
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"
npm run dev
```

Wait for:
```
✅ MongoDB connected
✅ Redis queue initialized
✅ Server running on port 3000
```

### 6. Test the API

```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}
```

## Pitfalls and Fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| `SIGSEGV` or `Exited (139)` | Stale MongoDB data from different mongo version | Remove volumes: `docker volume rm job-search_mongo_*` |
| `Wrong mongod version` / featureCompatibilityVersion 8.2 | mongo:7 reading mongo:8 data | Use mongo:8 only, delete old volumes |
| `MongoDB cannot start: kernel incompatible` | mongo:8.3 on Linux 7.0.0 kernel | Use mongo:8.0 or mongo:8 (not 8.3) |
| `ECONNREFUSED 127.0.0.1:6379` | Env vars not loaded (dotenv broken) | Export directly: `export REDIS_URL=...` |
| `ECONNREFUSED 10.185.182.250:27018` | Wrong port in .env (old config) | Verify .env has 27017, export env vars directly |
| `Port 27017 still not responding` | MongoDB still initializing | Wait 5+ seconds, then verify with `nc -zv` |
| No root route (404 on `/`) | API doesn't have root endpoint | Use `/api/health` or `/api/auth` endpoints |
| `Error: connect ECONNREFUSED` during startup | Event queue trying to connect before servers ready | This is normal, server continues - just wait |

## Environment Variables

**REQUIRED - Must be set before `npm run dev`:**

```bash
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"
```

**Why not .env files?**
- dotenv doesn't respect the path specified in index.ts
- npm child processes don't inherit custom dotenv loading
- Direct export is the only reliable method

**DO NOT RELY ON:**
- `/home/cda/dev/job-search/.env`
- `/home/cda/dev/job-search/packages/api/.env`
- These files exist but are NOT read by the app

## Common Mistakes

- ❌ Using mongo:8.3 (kernel incompatible on Linux 7.0.0)
- ❌ Reusing old volumes (data corruption, featureCompatibilityVersion errors)
- ❌ Forgetting to export env vars (ECONNREFUSED 127.0.0.1)
- ❌ Using port 27018 (old config, should be 27017)
- ❌ Running `npm run dev` without exporting env vars first
- ❌ Trying to use .env files instead of direct export
- ❌ Not waiting 5+ seconds for MongoDB to initialize

## Quick Diagnostic

If something fails, run this:

```bash
# Check containers exist and are healthy
ssh servyy-test.lxd "docker ps | grep job-search"

# Check ports are open from local machine
nc -zv 10.185.182.250 27017
nc -zv 10.185.182.250 6379

# Check env vars are set
echo $MONGODB_URI
echo $REDIS_URL

# Check what the app is trying to connect to
npm run dev 2>&1 | grep "Connecting to\|Redis\|listening"
```

## Real-World Impact

**Without this guide:** 1 hour of debugging connection issues, container crashes, port conflicts.

**With this guide:** 2 minutes to start the dev environment.

Key insight: MongoDB crashes with SIGSEGV if volumes contain data from a different mongo version. Always clean volumes when switching versions or starting fresh.
