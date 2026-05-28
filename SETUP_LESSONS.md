# Dev Environment Setup - Lessons Learned

**Session Date:** 2026-05-28  
**Time Spent:** ~1 hour  
**Issue:** Setting up job-search dev environment with MongoDB/Redis and frontend

---

## Major Pitfalls Encountered

### 1. **MongoDB Container Crashes (SIGSEGV - Exit 139)**

**Problem:** MongoDB container kept crashing with segmentation faults, even though mongo:8 worked fine in other projects for 3 weeks.

**Root Cause:** Stale volumes from previous mongo:8 sessions. When MongoDB starts, it checks `featureCompatibilityVersion` on disk. If data from mongo:8.2 exists but you try to run mongo:7, it fails with `Wrong mongod version` error and crashes.

**Solution:** Always clean volumes before starting containers:
```bash
docker volume rm job-search_mongo_data job-search_mongo_config 2>/dev/null || true
```

**Key Insight:** Persistent Docker volumes are a feature, not a bug—but they must be explicitly cleaned when switching versions or starting fresh.

---

### 2. **Environment Variables Not Being Loaded**

**Problem:** Spent 30 minutes trying to get dotenv to load environment variables from `.env` files. App kept connecting to localhost instead of `10.185.182.250`.

**Root Cause:** 
- `dotenv.config()` without a path looks in the current working directory
- When `npm run dev` runs from root, it's not in `packages/api/`
- Even specifying the path with `fileURLToPath` didn't work reliably
- npm child processes don't inherit custom dotenv loading

**Solution:** Direct environment variable export works 100%:
```bash
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"
npm run start:dev
```

**Key Insight:** Don't fight the framework. For npm scripts, environment variables should be passed directly via export or npm config, not through .env files that npm doesn't understand natively.

---

### 3. **Frontend Dev Server Not Starting with Workspaces**

**Problem:** `npm run dev --workspaces` only started the API. Frontend on port 5173 never came up.

**Root Cause:** npm's `--workspaces` flag runs all workspace dev scripts, but output buffering made it look like only API was running. Also, shell output from multiple processes was mixed/lost.

**Solution:** Use `npm-run-all --parallel` for explicit parallel execution:
```json
"start:dev": "npm-run-all --parallel start:api start:frontend"
```

**Key Insight:** For multiple servers running in parallel, use a tool designed for that (`npm-run-all`, `concurrently`) instead of relying on npm workspace features which are optimized for build/test, not dev servers.

---

### 4. **React Error: `jobs.map is not a function`**

**Problem:** Frontend crashed with "TypeError: jobs.map is not a function" when search completed.

**Root Cause:** API returns `{ jobs: [...] }` but frontend code did `setJobs(results)` directly, not extracting the `jobs` property.

**Fix:** One line change in ResultsPage.tsx:
```typescript
// Before
setJobs(results)

// After
setJobs(results.jobs || [])
```

**Key Insight:** Always check API response format. Frontend and backend must agree on data structure, or add defensive extraction.

---

### 5. **Port Confusion: 27017 vs 27018, 6379 vs 6380**

**Problem:** Initial setup used port 27018 for MongoDB and 6380 for Redis (from old spinup_test_db.sh script). This conflicted with actual container port mappings.

**Solution:** Standardize on Docker default ports:
- MongoDB: 27017 (internal) → 27017 (external)
- Redis: 6379 (internal) → 6379 (external)

**Key Insight:** Keep external port = internal port unless there's a specific reason. Reduces confusion and matches documentation expectations.

---

## What Worked Well

1. **Test Container on servyy-test.lxd** - Once set up correctly, it's stable for 3+ weeks. Persistent volumes + auto-restart policy are solid.

2. **Skill Documentation** - Creating a skill with pitfall table saved massive time. Future developers won't repeat these mistakes.

3. **Project-Level Skill** - Bundling the startup skill with the repo ensures everyone sees it automatically.

4. **API Server** - Once MongoDB/Redis connected, API worked perfectly with no issues.

---

## Permanent Solutions Implemented

### 1. **job-search-dev-startup Skill**
Location: `.claude/skills/job-search-dev-startup/SKILL.md`
- Complete startup sequence
- Pitfall table with causes and fixes
- Diagnostic commands
- Common mistakes checklist

### 2. **npm start:dev Script**
```json
"start:api": "cd packages/api && MONGODB_URI=... REDIS_URL=... npm run dev",
"start:frontend": "cd packages/frontend && npm run dev",
"start:dev": "npm-run-all --parallel start:api start:frontend"
```

### 3. **Project Memory**
- `dev_startup_setup.md` - Quick reference for future sessions
- Test container infrastructure documented

### 4. **Updated start_dev_server.sh**
Simplified to:
```bash
./spinup_test_db.sh
npm run start:dev
```

---

## Time Breakdown

| Task | Time | Result |
|------|------|--------|
| Container setup/cleanup | 20 min | MongoDB crashes isolated and fixed |
| Dotenv debugging | 20 min | Direct export proven as only solution |
| Frontend startup | 15 min | npm-run-all found and configured |
| React error fix | 5 min | Single line change, tested |
| Skill creation + documentation | 10 min | Reusable guide created |

---

## Key Takeaways

1. **Docker volumes are persistent** - Clean them explicitly when version mismatch occurs
2. **Environment variables > .env files in npm** - Export directly, don't fight dotenv
3. **Use proper parallel tools** - npm-run-all beats shell redirects for dev servers
4. **API response format matters** - Frontend must extract data correctly
5. **Standardize on defaults** - Same internal/external ports unless there's a reason
6. **Document pitfalls** - This saves future developers hours of debugging

---

## For Next Time

When starting job-search dev:
1. Run: `npm run start:dev`
2. Check: http://localhost:3000/api/health (API)
3. Check: http://localhost:5173 (Frontend)
4. That's it.

All the complexity is hidden in the setup script and this documentation.
