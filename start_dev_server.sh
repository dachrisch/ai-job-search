#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Job Search dev server..."

# Initialize test database on servyy-test
echo "📦 Setting up database..."
./spinup_test_db.sh "$@"

# Configure environment for development with servyy-test
echo "⚙️ Configuring environment..."
if [ ! -f .env ]; then
  echo "NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://10.185.182.250:27018/job_search
REDIS_URL=redis://10.185.182.250:6380
CLAUDE_API_KEY=sk-test-key
JWT_SECRET=dev-secret-key-local
ENCRYPTION_KEY=12345678901234567890123456789012" > .env
fi

# Start dev servers
echo "🎯 Starting dev servers (API on :3000, Frontend on :5173)..."
npm run dev
