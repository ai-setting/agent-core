#!/bin/bash
# Quick integration test - 10s timeout max

set -e

echo "=== Agent Core Quick Integration Test ==="
echo ""

PORT=3002
SERVER_PID=""

cleanup() {
    echo ""
    echo "Cleaning up..."
    if [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
    fi
}
trap cleanup EXIT

# 1. Start server
echo "[1/3] Starting server on port $PORT..."
cd packages/core
PORT=$PORT \
LOG_FILE="../../../logs/server.log" \
LOG_LEVEL=debug \
bun run start &
SERVER_PID=$!
cd ../..

# 2. Wait for ready (max 10s)
echo "[2/3] Waiting for server (max 10s)..."
for i in {1..10}; do
    if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
        echo "✓ Server ready"
        break
    fi
    sleep 1
    if [ $i -eq 10 ]; then
        echo "✗ Timeout"
        exit 1
    fi
done

# 3. Run TUI test
echo "[3/3] Running TUI test (hello → 3s → exit)..."
cd packages/core
TUI_TEST_INPUTS="hello;delay:3000;exit" \
LOG_FILE="../../../logs/tui.log" \
LOG_LEVEL=debug \
timeout 10 bun run dev attach "http://localhost:$PORT" 2>&1 || true
cd ../..

echo ""
echo "=== Test Complete ==="
echo ""

# Show results
echo "Server log (last 10 lines):"
tail -10 logs/server.log 2>/dev/null || echo "No log"

echo ""
echo "TUI log (last 10 lines):"
tail -10 logs/tui.log 2>/dev/null || echo "No log"

echo ""
echo "Quick check:"
grep -c "Client connected" logs/server.log 2>/dev/null && echo "✓ Server: Client connected" || echo "✗ Server: No connection"
grep -c "Received prompt" logs/server.log 2>/dev/null && echo "✓ Server: Prompt received" || echo "✗ Server: No prompt"
grep -c "Connected to event stream" logs/tui.log 2>/dev/null && echo "✓ TUI: Connected" || echo "✗ TUI: Not connected"
grep -c "Received event" logs/tui.log 2>/dev/null && echo "✓ TUI: Events received" || echo "✗ TUI: No events"
