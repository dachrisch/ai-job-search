#!/bin/zsh
set -e

# Initialize MongoDB and Redis on servyy-test.lxd for development
echo "📦 Initializing test database on servyy-test.lxd..."

FRESH_FLAG=""
for arg in "$@"; do
    [[ "$arg" == "--fresh" ]] && FRESH_FLAG="--fresh"
done

# SSH into servyy-test and start services
ssh servyy-test.lxd << 'EOF'
  set -e

  # Stop existing containers if --fresh
  if [[ "$FRESH_FLAG" == "--fresh" ]]; then
    echo "🔄 Cleaning up existing containers..."
    docker rm -f job-search-mongo job-search-redis 2>/dev/null || true
  fi

  # Check if containers already exist
  if ! docker ps -a | grep -q job-search-mongo; then
    echo "🚀 Starting job-search-mongo..."
    docker run -d --name job-search-mongo -p 0.0.0.0:27018:27017 mongo:8
  fi

  if ! docker ps -a | grep -q job-search-redis; then
    echo "🚀 Starting job-search-redis..."
    docker run -d --name job-search-redis -p 0.0.0.0:6380:6379 redis:7-alpine
  fi

  # Wait for services to be ready
  sleep 5

  echo "✅ Services started:"
  docker ps | grep job-search
EOF

echo "✅ Test database initialized on servyy-test.lxd"
echo "📌 MongoDB: servyy-test.lxd:27018"
echo "📌 Redis: servyy-test.lxd:6380"
