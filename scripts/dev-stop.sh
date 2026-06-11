#!/bin/bash
set -euo pipefail

# Job Search Platform - Dev Cleanup/Stop Script
# Kills all running development services

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

main() {
    log_info "=========================================="
    log_info "Job Search Platform - Dev Stop"
    log_info "=========================================="
    echo ""

    # Kill API server
    log_info "Stopping API server..."
    if [ -f "$PROJECT_ROOT/packages/api/.api.pid" ]; then
        PID=$(cat "$PROJECT_ROOT/packages/api/.api.pid")
        if kill "$PID" 2>/dev/null; then
            log_success "API server stopped (PID: $PID)"
            rm -f "$PROJECT_ROOT/packages/api/.api.pid"
        else
            log_warn "API server (PID: $PID) not running"
        fi
    else
        pkill -f "npm run dev" 2>/dev/null || true
        log_warn "No API PID file, killed npm processes"
    fi

    # Kill Frontend server
    log_info "Stopping Frontend server..."
    if [ -f "$PROJECT_ROOT/packages/frontend/.frontend.pid" ]; then
        PID=$(cat "$PROJECT_ROOT/packages/frontend/.frontend.pid")
        if kill "$PID" 2>/dev/null; then
            log_success "Frontend server stopped (PID: $PID)"
            rm -f "$PROJECT_ROOT/packages/frontend/.frontend.pid"
        else
            log_warn "Frontend server (PID: $PID) not running"
        fi
    else
        log_warn "No Frontend PID file"
    fi

    # Kill Crawler
    log_info "Stopping Crawler service..."
    if [ -f "$PROJECT_ROOT/crawler/.crawler.pid" ]; then
        PID=$(cat "$PROJECT_ROOT/crawler/.crawler.pid")
        if kill "$PID" 2>/dev/null; then
            log_success "Crawler service stopped (PID: $PID)"
            rm -f "$PROJECT_ROOT/crawler/.crawler.pid"
        else
            log_warn "Crawler service (PID: $PID) not running"
        fi
    else
        pkill -f "python3.*server.py" 2>/dev/null || true
        log_warn "No Crawler PID file, killed Python processes"
    fi

    # Kill any remaining npm processes on dev ports
    log_info "Cleaning up stray processes..."
    lsof -ti :5173 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
    lsof -ti :5000 2>/dev/null | xargs kill -9 2>/dev/null || true

    sleep 1

    # Verify ports are free
    if ! lsof -i :3000 >/dev/null 2>&1 && \
       ! lsof -i :5173 >/dev/null 2>&1 && \
       ! lsof -i :5000 >/dev/null 2>&1; then
        log_success "All ports cleaned up"
    else
        log_warn "Some ports still in use"
    fi

    echo ""
    log_info "=========================================="
    log_success "Development environment stopped"
    log_info "=========================================="
    echo ""
    echo "To restart:"
    echo "  npm run startup"
    echo ""
}

main "$@"
