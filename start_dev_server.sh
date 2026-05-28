#!/bin/zsh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting Job Search dev server..."

# Initialize test database on servyy-test
echo "📦 Setting up database..."
./spinup_test_db.sh "$@"

# Start dev servers with environment variables
echo "🎯 Starting dev servers (API on :3000, Frontend on :5173)..."
npm run start:dev
