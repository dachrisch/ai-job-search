#!/bin/bash
set -euo pipefail

# Delegate to the comprehensive startup script
exec ./scripts/dev-startup.sh "$@"
