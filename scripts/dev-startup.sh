#!/bin/bash
set -euo pipefail

# Job Search Platform - Idempotent Dev Startup Script
# Starts all required services: servyy-test container, MongoDB, Redis, Crawler, API, Frontend

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONGO_PORT=27017
REDIS_PORT=6379
CRAWLER_PORT=5000
API_PORT=3000
FRONTEND_PORT=5173

# Dynamically get servyy-test.lxd IP (will be set in setup_servyy_test_container)
SERVYY_TEST_IP=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# Check if command exists
command_exists() {
    command -v "$1" &>/dev/null
}

# Wait for port to be available
wait_for_port() {
    local port=$1
    local timeout=$2
    local elapsed=0

    while ! nc -z localhost "$port" 2>/dev/null; do
        if [ $elapsed -ge "$timeout" ]; then
            return 1
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    return 0
}

# Wait for HTTP endpoint
wait_for_http() {
    local url=$1
    local timeout=$2
    local elapsed=0

    while ! curl -sf "$url" >/dev/null 2>&1; do
        if [ $elapsed -ge "$timeout" ]; then
            return 1
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    return 0
}

# Kill process running on port
kill_port() {
    local port=$1
    if lsof -i ":$port" >/dev/null 2>&1; then
        log_warn "Killing process on port $port"
        lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Step 1: Ensure servyy-test.lxd container is running and get its IP
setup_servyy_test_container() {
    log_info "Step 1: Ensuring servyy-test.lxd container is available"

    if ! ssh servyy-test.lxd "docker ps >/dev/null 2>&1"; then
        log_info "Starting servyy-test.lxd container..."
        if [ -f "$HOME/dev/infrastructure/container/scripts/setup_test_container.sh" ]; then
            "$HOME/dev/infrastructure/container/scripts/setup_test_container.sh"
        else
            log_error "setup_test_container.sh not found. Start manually or check infrastructure repo."
            return 1
        fi
    fi

    # Discover servyy-test.lxd IP dynamically
    log_info "Discovering servyy-test.lxd IP address..."
    SERVYY_TEST_IP=$(getent hosts servyy-test.lxd | awk '{print $1}' | grep -E '^[0-9]+\.[0-9]+' || echo "")

    if [ -z "$SERVYY_TEST_IP" ]; then
        log_error "Could not resolve servyy-test.lxd IP address"
        return 1
    fi

    log_success "servyy-test.lxd is running at $SERVYY_TEST_IP"
}

# Step 2: Setup MongoDB and Redis containers on servyy-test.lxd
setup_databases() {
    log_info "Step 2: Setting up MongoDB and Redis containers"

    ssh servyy-test.lxd << 'EOF'
#!/bin/bash

# Remove old containers if they exist (idempotent cleanup)
docker rm -f job-search-mongo job-search-redis 2>/dev/null || true

# Wait a bit for cleanup
sleep 2

# Remove old volumes if they're causing issues (optional - comment out if you want to keep data)
# docker volume rm job-search_mongo_data job-search_mongo_config job-search_redis_data 2>/dev/null || true

# Check if containers already exist and are running
if docker ps | grep -q job-search-mongo; then
    echo "MongoDB container already running"
else
    echo "Starting MongoDB container..."
    docker run \
      --name job-search-mongo \
      -p 0.0.0.0:27017:27017 \
      -v job-search_mongo_data:/data/db \
      -v job-search_mongo_config:/data/configdb \
      --restart unless-stopped \
      -d mongo:8
fi

if docker ps | grep -q job-search-redis; then
    echo "Redis container already running"
else
    echo "Starting Redis container..."
    docker run \
      --name job-search-redis \
      -p 0.0.0.0:6379:6379 \
      -v job-search_redis_data:/data \
      --restart unless-stopped \
      -d redis:7-alpine
fi

# Wait for services to be ready
sleep 3
docker ps | grep job-search
EOF

    log_success "MongoDB and Redis containers are running"
}

# Step 3: Verify database connectivity
verify_databases() {
    log_info "Step 3: Verifying database connectivity"

    # Test MongoDB connectivity from within the container
    log_info "Checking MongoDB from container..."
    if ssh servyy-test.lxd "docker exec job-search-mongo mongosh --eval 'db.adminCommand(\"ping\")' >/dev/null 2>&1"; then
        log_success "MongoDB is responding (container: OK)"
    else
        log_error "MongoDB on servyy-test.lxd is NOT responding"
        log_error "Troubleshooting:"
        log_error "  1. Check container status: ssh servyy-test.lxd 'docker ps | grep job-search-mongo'"
        log_error "  2. Check MongoDB logs: ssh servyy-test.lxd 'docker logs job-search-mongo | tail -20'"
        log_error "  3. Restart MongoDB: ssh servyy-test.lxd 'docker restart job-search-mongo'"
        return 1
    fi

    # Test Redis connectivity from within the container
    log_info "Checking Redis from container..."
    if ssh servyy-test.lxd "docker exec job-search-redis redis-cli ping 2>/dev/null | grep -q PONG"; then
        log_success "Redis is responding (container: OK)"
    else
        log_error "Redis on servyy-test.lxd is NOT responding"
        log_error "Troubleshooting:"
        log_error "  1. Check container status: ssh servyy-test.lxd 'docker ps | grep job-search-redis'"
        log_error "  2. Check Redis logs: ssh servyy-test.lxd 'docker logs job-search-redis | tail -20'"
        log_error "  3. Restart Redis: ssh servyy-test.lxd 'docker restart job-search-redis'"
        return 1
    fi

    # Test MongoDB connectivity from localhost (critical - API needs this)
    log_info "Checking MongoDB reachability from localhost ($SERVYY_TEST_IP:$MONGO_PORT)..."
    if timeout 10 bash -c "while ! nc -z $SERVYY_TEST_IP $MONGO_PORT 2>/dev/null; do sleep 0.5; done"; then
        log_success "MongoDB is reachable from localhost"
    else
        log_error "MongoDB on $SERVYY_TEST_IP:$MONGO_PORT is NOT reachable from localhost"
        log_error "The API running on localhost won't be able to connect to the database."
        log_error ""
        log_error "Troubleshooting:"
        log_error "  1. Verify IP is correct: ping servyy-test.lxd"
        log_error "  2. Test connectivity: nc -zv $SERVYY_TEST_IP $MONGO_PORT"
        log_error "  3. Check network routing: ip route | grep $SERVYY_TEST_IP"
        log_error "  4. Verify SSH access: ssh servyy-test.lxd 'docker ps'"
        return 1
    fi

    # Test Redis connectivity from localhost
    log_info "Checking Redis reachability from localhost ($SERVYY_TEST_IP:$REDIS_PORT)..."
    if timeout 10 bash -c "while ! nc -z $SERVYY_TEST_IP $REDIS_PORT 2>/dev/null; do sleep 0.5; done"; then
        log_success "Redis is reachable from localhost"
    else
        log_error "Redis on $SERVYY_TEST_IP:$REDIS_PORT is NOT reachable from localhost"
        return 1
    fi
}

# Step 4: Start Python crawler service
start_crawler() {
    log_info "Step 4: Starting Python crawler service"

    # Kill any existing crawler
    pkill -f "python3.*server.py" 2>/dev/null || true
    kill_port $CRAWLER_PORT
    sleep 1

    cd "$PROJECT_ROOT/crawler"

    # Kill any process using port 8000 (default crawler port)
    kill_port 8000

    # Start crawler in background with explicit port
    log_info "Starting crawler on port $CRAWLER_PORT..."
    nohup env CRAWLER_PORT=$CRAWLER_PORT python3 server.py >crawler.log 2>&1 &
    CRAWLER_PID=$!
    echo $CRAWLER_PID > .crawler.pid

    # Wait for crawler port to be open (it will respond with 404 if no health endpoint)
    if wait_for_port $CRAWLER_PORT 30; then
        # Verify it's actually responding
        if curl -sf "http://localhost:$CRAWLER_PORT/" >/dev/null 2>&1 || curl -s "http://localhost:$CRAWLER_PORT/" | grep -q "404\|Not Found"; then
            log_success "Crawler is running (PID: $CRAWLER_PID)"
        else
            log_error "Crawler port open but not responding"
            return 1
        fi
    else
        log_error "Crawler failed to start. Check $PROJECT_ROOT/crawler/crawler.log"
        tail -20 crawler.log 2>/dev/null || true
        return 1
    fi
}

# Step 5: Create test user if needed
create_test_user() {
    log_info "Step 5: Setting up test user account"

    local TEST_EMAIL="test@example.com"
    local TEST_PASSWORD="TestPassword123!"

    # Create a temporary Node.js script to hash password and create user
    local TEMP_SCRIPT=$(mktemp)
    cat > "$TEMP_SCRIPT" << 'NODESCRIPT'
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI;
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'TestPassword123!';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  claudeApiToken: { type: String },
}, { timestamps: true });

const User = mongoose.model('User', userSchema, 'users');

async function createTestUser() {
  try {
    await mongoose.connect(MONGODB_URI);

    // Check if test user already exists
    const existing = await User.findOne({ email: TEST_EMAIL });
    if (existing) {
      console.log(`User ${TEST_EMAIL} already exists`);
      process.exit(0);
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const user = await User.create({ email: TEST_EMAIL, passwordHash });

    console.log(`Created test user: ${TEST_EMAIL}`);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

createTestUser();
NODESCRIPT

    # Run the script with environment variables
    MONGODB_URI="mongodb://$SERVYY_TEST_IP:$MONGO_PORT/job_search" \
    node "$TEMP_SCRIPT" 2>/dev/null || true

    rm -f "$TEMP_SCRIPT"

    log_success "Test user account ready"
    TEST_USER_EMAIL="$TEST_EMAIL"
    TEST_USER_PASSWORD="$TEST_PASSWORD"
}

# Step 6: Set environment variables
setup_env_vars() {
    log_info "Step 6: Setting up environment variables"

    export MONGODB_URI="mongodb://$SERVYY_TEST_IP:$MONGO_PORT/job_search"
    export REDIS_URL="redis://$SERVYY_TEST_IP:$REDIS_PORT"
    export NODE_ENV="development"
    export LOG_LEVEL="info"

    log_success "Environment variables set:"
    echo "  MONGODB_URI=$MONGODB_URI"
    echo "  REDIS_URL=$REDIS_URL"
}

# Step 7: Start API and Frontend in background
start_services() {
    log_info "Step 7: Starting API and Frontend"

    log_info "Starting API in background..."
    cd "$PROJECT_ROOT/packages/api"
    nohup npm run dev >api.log 2>&1 &
    API_PID=$!
    echo $API_PID > .api.pid

    sleep 3

    log_info "Starting Frontend in background..."
    cd "$PROJECT_ROOT/packages/frontend"
    nohup npm run dev >frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > .frontend.pid

    log_success "Services started in background"
    log_info "API logs: tail -f $PROJECT_ROOT/packages/api/api.log"
    log_info "Frontend logs: tail -f $PROJECT_ROOT/packages/frontend/frontend.log"
}

# Step 8: Verify all services are running
verify_services() {
    log_info "Step 8: Verifying all services"

    # Give services time to start
    sleep 5

    # Check API
    if wait_for_http "http://localhost:$API_PORT/api/health" 30; then
        log_success "API is running on port $API_PORT"
    else
        log_error "API failed to start. Check logs."
        return 1
    fi

    # Check Frontend
    if wait_for_port $FRONTEND_PORT 30; then
        log_success "Frontend is running on port $FRONTEND_PORT"
    else
        log_error "Frontend failed to start. Check logs."
        return 1
    fi

    # Check Crawler (just check if port is open)
    if wait_for_port $CRAWLER_PORT 5; then
        log_success "Crawler is running on port $CRAWLER_PORT"
    else
        log_warn "Crawler not responding on port $CRAWLER_PORT"
    fi
}

# Main execution
main() {
    log_info "=========================================="
    log_info "Job Search Platform - Dev Startup"
    log_info "=========================================="

    cd "$PROJECT_ROOT"

    # Execute steps
    setup_servyy_test_container || exit 1
    setup_databases || exit 1
    verify_databases
    start_crawler || exit 1
    create_test_user
    setup_env_vars
    start_services
    verify_services || exit 1

    log_info "=========================================="
    log_success "Development environment is ready!"
    log_info "=========================================="
    echo ""
    echo "Services running:"
    echo "  - API: http://localhost:3000/api/health"
    echo "  - Frontend: http://localhost:5173"
    echo "  - Crawler: http://localhost:5000/health"
    echo ""
    echo "📧 Test Account (ready to login):"
    echo "  Email: $TEST_USER_EMAIL"
    echo "  Password: $TEST_USER_PASSWORD"
    echo ""
    echo "🚀 Getting Started:"
    echo "  1. Open: http://localhost:5173"
    echo "  2. Login with credentials above"
    echo "  3. Add your Claude API key in settings"
    echo "  4. Start searching for jobs!"
    echo ""
    echo "📊 View logs:"
    echo "  tail -f $PROJECT_ROOT/packages/api/api.log"
    echo "  tail -f $PROJECT_ROOT/packages/frontend/frontend.log"
    echo "  tail -f $PROJECT_ROOT/crawler/crawler.log"
}

# Run main function
main "$@"
