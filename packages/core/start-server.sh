#!/bin/bash
# Start server with proper environment variables
# Usage: ./start-server.sh [port]

# Change to script directory
cd "$(dirname "$0")"

# Load environment variables from .env
if [ -f ../../.env ]; then
    export $(grep -v '^#' ../../.env | xargs)
fi

# Set default values if not in .env
export LOG_LEVEL=${LOG_LEVEL:-debug}
export PORT=${1:-3003}
export LOG_FILE=${LOG_FILE:-}

echo "Starting server with:"
echo "  PORT: $PORT"
echo "  LOG_LEVEL: $LOG_LEVEL"
echo "  LOG_DIR: ~/.config/tong_work/logs/"
echo ""

# Start server
exec bun run ./src/server/index.ts
