#!/bin/bash
# Integration test script for TUI

set -e

echo "=========================================="
echo "Agent Core TUI Integration Test"
echo "=========================================="
echo ""

# Configuration
SERVER_LOG="./logs/server.log"
TUI_LOG="./logs/tui.log"
SERVER_URL="http://localhost:3001"
TEST_TIMEOUT=15

# Clean up old logs
echo "[1/5] Cleaning up old logs..."
> "$SERVER_LOG" 2>/dev/null || true
> "$TUI_LOG" 2>/dev/null || true
echo "✓ Logs cleaned"

# Start server in background
echo ""
echo "[2/5] Starting server..."
cd packages/core
LOG_FILE="../../../logs/server.log" LOG_LEVEL=debug bun run start &
SERVER_PID=$!
cd ../..

# Wait for server to be ready
echo "    Waiting for server to be ready..."
for i in {1..30}; do
    if curl -s "$SERVER_URL/health" > /dev/null 2>&1; then
        echo "✓ Server ready (PID: $SERVER_PID)"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo "✗ Server failed to start"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
done

# Start TUI with mock inputs
echo ""
echo "[3/5] Starting TUI with mock inputs..."
echo "    Test inputs: hello → delay:3s → exit"
cd packages/core
TUI_TEST_INPUTS="hello;delay:3000;exit" \
    LOG_FILE="../../../logs/tui.log" \
    LOG_LEVEL=debug \
    timeout $TEST_TIMEOUT bun run dev attach "$SERVER_URL" 2>&1 || true
cd ../..
echo "✓ TUI test completed"

# Wait a bit for logs to flush
echo ""
echo "[4/5] Analyzing logs..."
sleep 2

# Analyze logs
echo ""
echo "=========================================="
echo "Test Results"
echo "=========================================="

# Server side checks
echo ""
echo "[Server Side]"
if grep -q "Client connected" "$SERVER_LOG" 2>/dev/null; then
    echo "  ✓ Client connected"
else
    echo "  ✗ Client NOT connected"
fi

if grep -q "Received prompt request" "$SERVER_LOG" 2>/dev/null; then
    echo "  ✓ Prompt received"
else
    echo "  ✗ Prompt NOT received"
fi

if grep -q "Starting AI processing" "$SERVER_LOG" 2>/dev/null; then
    echo "  ✓ AI processing started"
else
    echo "  ✗ AI processing NOT started"
fi

EVENT_COUNT=$(grep -c "Sending event to client" "$SERVER_LOG" 2>/dev/null || echo "0")
if [ "$EVENT_COUNT" -gt 0 ]; then
    echo "  ✓ Events sent: $EVENT_COUNT"
else
    echo "  ✗ No events sent"
fi

if grep -q "AI processing completed" "$SERVER_LOG" 2>/dev/null; then
    echo "  ✓ AI processing completed"
else
    echo "  ✗ AI processing NOT completed (or still running)"
fi

# Client side checks
echo ""
echo "[Client Side]"
if grep -q "Connected to event stream" "$TUI_LOG" 2>/dev/null; then
    echo "  ✓ Connected to event stream"
else
    echo "  ✗ NOT connected to event stream"
fi

if grep -q "Sending prompt" "$TUI_LOG" 2>/dev/null; then
    echo "  ✓ Prompt sent"
else
    echo "  ✗ Prompt NOT sent"
fi

RECEIVED_EVENTS=$(grep -c "Received event" "$TUI_LOG" 2>/dev/null || echo "0")
if [ "$RECEIVED_EVENTS" -gt 0 ]; then
    echo "  ✓ Events received: $RECEIVED_EVENTS"
else
    echo "  ✗ No events received"
fi

if grep -q "Stream completed" "$TUI_LOG" 2>/dev/null; then
    echo "  ✓ Stream completed"
else
    echo "  ✗ Stream NOT completed"
fi

# Error checks
echo ""
echo "[Error Check]"
SERVER_ERRORS=$(grep -c "ERROR" "$SERVER_LOG" 2>/dev/null || echo "0")
TUI_ERRORS=$(grep -c "ERROR" "$TUI_LOG" 2>/dev/null || echo "0")
if [ "$SERVER_ERRORS" -eq 0 ] && [ "$TUI_ERRORS" -eq 0 ]; then
    echo "  ✓ No errors found"
else
    echo "  ✗ Errors found: Server=$SERVER_ERRORS, TUI=$TUI_ERRORS"
    echo ""
    echo "Server errors:"
    grep "ERROR" "$SERVER_LOG" 2>/dev/null | head -5 || echo "    None"
    echo ""
    echo "TUI errors:"
    grep "ERROR" "$TUI_LOG" 2>/dev/null | head -5 || echo "    None"
fi

# Show recent log entries
echo ""
echo "=========================================="
echo "Recent Server Events"
echo "=========================================="
tail -20 "$SERVER_LOG" 2>/dev/null || echo "No server log"

echo ""
echo "=========================================="
echo "Recent TUI Events"
echo "=========================================="
tail -20 "$TUI_LOG" 2>/dev/null || echo "No TUI log"

# Cleanup
echo ""
echo "[5/5] Cleaning up..."
kill $SERVER_PID 2>/dev/null || true
echo "✓ Server stopped"

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Full logs available at:"
echo "  - $SERVER_LOG"
echo "  - $TUI_LOG"
