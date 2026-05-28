#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Job Search..."

# Setup containers
echo "📦 Setting up MongoDB & Redis..."
./spinup_test_db.sh 2>&1 | grep "✅"

# Export env vars
export MONGODB_URI="mongodb://10.185.182.250:27017/job_search"
export REDIS_URL="redis://10.185.182.250:6379"

# Start API
echo "🔵 Starting API (port 3000)..."
(cd packages/api && npm run dev) &
API_PID=$!

# Start Frontend
sleep 3
echo "🟢 Starting Frontend (port 5173)..."
(cd packages/frontend && npm run dev) &
FRONTEND_PID=$!

# Wait for both
wait $API_PID $FRONTEND_PID
