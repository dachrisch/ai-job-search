# Crawler Startup Guide

The job-search application REQUIRES the Python crawler service to be running before the API can function properly.

## Prerequisites

Ensure Python dependencies are installed:

```bash
cd /home/cda/dev/job-search/crawler
pip install -r requirements.txt
```

## Starting Services (In Order)

### 1. Start Python Crawler Service (MUST be first)

```bash
cd /home/cda/dev/job-search/crawler
python3 server.py
```

Expected output:
```
Running on http://0.0.0.0:5000
```

Verify it's running:
```bash
curl http://localhost:5000/health
# Expected: 200 OK
```

### 2. Start Node API Server

In a new terminal:

```bash
cd /home/cda/dev/job-search/packages/api
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"
npm run dev
```

Expected output:
```
✅ MongoDB connected
✅ Redis queue initialized
✅ Server running on port 3000
```

Verify it's running:
```bash
curl http://localhost:3000/api/health
# Expected: {"status":"ok"}
```

### 3. Start Frontend Dev Server

In a new terminal:

```bash
cd /home/cda/dev/job-search/packages/frontend
npm run dev
```

Expected output:
```
Local: http://localhost:5173
```

Open browser to http://localhost:5173

## Testing the Crawler Integration

Once all services are running, test the crawler:

```bash
curl -X POST http://localhost:5000/crawler/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "sites": ["https://www.linkedin.com/jobs"],
    "keywords": "engineer"
  }'
```

Expected: 200 response with job data array

## Troubleshooting

**"ModuleNotFoundError: No module named 'pydantic'"**
- Install dependencies: `pip install -q --no-cache-dir -r requirements.txt`

**"Address already in use" on port 5000**
- Check what's using the port: `lsof -i :5000`
- Kill it: `pkill -f "python3 server.py"`

**"Connection refused" when API tries to reach crawler**
- Ensure crawler is started first (port 5000)
- Check crawler is listening: `curl http://localhost:5000/health`
- Check API logs for connection attempts

**Tests fail with "CrawlerSource failed"**
- This is expected behavior - crawler is mandatory
- Ensure crawler service is running before running tests

## Important Notes

- **Crawler is mandatory** - The API will fail searches if the crawler is not running
- **Service startup order matters** - Start crawler first, then API, then frontend
- **Environment variables** - Always export MONGODB_URI and REDIS_URL before starting API
- **Ports used:**
  - Crawler: 5000
  - API: 3000
  - Frontend: 5173
  - MongoDB: 10.185.182.250:27017
  - Redis: 10.185.182.250:6379
