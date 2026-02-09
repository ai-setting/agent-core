#!/bin/bash
# Test script for TUI integration testing

echo "=========================================="
echo "TUI Integration Test Script"
echo "=========================================="
echo ""

# Configuration
SERVER_LOG="./logs/server.log"
TUI_LOG="./logs/tui.log"
SERVER_URL="http://localhost:3001"

# Clean up old logs
echo "Cleaning up old logs..."
> "$SERVER_LOG"
> "$TUI_LOG"

# Test 1: Basic connection
echo ""
echo "Test 1: Basic connection test"
echo "------------------------------"
TUI_TEST_INPUTS="hello;delay:3000;exit" \
  LOG_FILE="$TUI_LOG" \
  LOG_LEVEL=debug \
  bun run dev attach "$SERVER_URL" &

TUI_PID=$!

# Wait for test to complete
sleep 8

# Kill TUI if still running
if ps -p $TUI_PID > /dev/null; then
    kill $TUI_PID 2>/dev/null
fi

echo ""
echo "Checking logs..."
echo ""

# Check server logs
echo "Server events:"
grep -c "Sending event to client" "$SERVER_LOG" 2>/dev/null || echo "0"

# Check TUI logs  
echo "TUI events received:"
grep -c "Received event" "$TUI_LOG" 2>/dev/null || echo "0"

echo ""
echo "Errors:"
grep "ERROR" "$SERVER_LOG" "$TUI_LOG" 2>/dev/null || echo "None"

echo ""
echo "=========================================="
echo "Test complete. Check logs/ directory for details."
echo "=========================================="
