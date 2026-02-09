# Integration Test Script for Agent Core
# Run this in PowerShell

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Agent Core Integration Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$rootDir = "D:\document\zhishitong_workspace\zst_project\tong_work\agent-core"
$logDir = "$rootDir\logs"
$serverLog = "$logDir\server.log"
$tuiLog = "$logDir\tui.log"
$port = 3002
$serverUrl = "http://localhost:$port"

# Step 1: Clean up
Write-Host "[1/5] Cleaning up..." -ForegroundColor Yellow
if (Test-Path $logDir) {
    Remove-Item $logDir\*.log -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Write-Host "✓ Logs directory ready" -ForegroundColor Green

# Step 2: Check for existing processes
Write-Host ""
Write-Host "[2/5] Checking for existing processes..." -ForegroundColor Yellow
Get-Process -Name bun -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Write-Host "✓ Processes cleaned" -ForegroundColor Green

# Step 3: Start server
Write-Host ""
Write-Host "[3/5] Starting server on port $port..." -ForegroundColor Yellow
$serverJob = Start-Job -ScriptBlock {
    param($dir, $port)
    Set-Location "$dir\packages\core"
    $env:PORT = $port
    bun run start 2>&1
} -ArgumentList $rootDir, $port

# Wait for server
Write-Host "    Waiting for server..." -ForegroundColor Gray
$serverReady = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "$serverUrl/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $serverReady = $true
            Write-Host "✓ Server ready!" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
    Start-Sleep -Seconds 1
}

if (-not $serverReady) {
    Write-Host "✗ Server failed to start" -ForegroundColor Red
    Stop-Job $serverJob
    exit 1
}

# Step 4: Run TUI test
Write-Host ""
Write-Host "[4/5] Running TUI test..." -ForegroundColor Yellow
Write-Host "    Test inputs: hello -> wait 5s -> exit" -ForegroundColor Gray

$tuiJob = Start-Job -ScriptBlock {
    param($dir, $url, $tuiLog)
    Set-Location "$dir\packages\core"
    $env:TUI_TEST_INPUTS = "hello;delay:5000;exit"
    $env:LOG_FILE = $tuiLog
    $env:LOG_LEVEL = "debug"
    bun run dev attach $url 2>&1
} -ArgumentList $rootDir, $serverUrl, $tuiLog

# Wait for TUI to complete
Write-Host "    Waiting for TUI test to complete (15s)..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# Stop jobs
Stop-Job $tuiJob -ErrorAction SilentlyContinue
Stop-Job $serverJob -ErrorAction SilentlyContinue
Remove-Job $tuiJob -ErrorAction SilentlyContinue
Remove-Job $serverJob -ErrorAction SilentlyContinue

Write-Host "✓ TUI test completed" -ForegroundColor Green

# Step 5: Analyze results
Write-Host ""
Write-Host "[5/5] Analyzing results..." -ForegroundColor Yellow
Write-Host ""

# Check server log
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Server Log Analysis" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (Test-Path $serverLog) {
    $serverContent = Get-Content $serverLog -Raw -ErrorAction SilentlyContinue
    
    if ($serverContent -match "Client connected") {
        Write-Host "✓ Client connected" -ForegroundColor Green
    } else {
        Write-Host "✗ Client NOT connected" -ForegroundColor Red
    }
    
    if ($serverContent -match "Received prompt") {
        Write-Host "✓ Prompt received" -ForegroundColor Green
    } else {
        Write-Host "✗ Prompt NOT received" -ForegroundColor Red
    }
    
    $eventCount = ([regex]::Matches($serverContent, "Sending event to client")).Count
    if ($eventCount -gt 0) {
        Write-Host "✓ Events sent: $eventCount" -ForegroundColor Green
    } else {
        Write-Host "✗ No events sent" -ForegroundColor Red
    }
    
    if ($serverContent -match "AI processing completed") {
        Write-Host "✓ AI processing completed" -ForegroundColor Green
    } else {
        Write-Host "⚠ AI processing NOT completed (may still be running)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Last 10 lines of server log:" -ForegroundColor Gray
    Get-Content $serverLog -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
} else {
    Write-Host "✗ Server log not found" -ForegroundColor Red
}

# Check TUI log
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TUI Log Analysis" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (Test-Path $tuiLog) {
    $tuiContent = Get-Content $tuiLog -Raw -ErrorAction SilentlyContinue
    
    if ($tuiContent -match "Connected to event stream") {
        Write-Host "✓ Connected to event stream" -ForegroundColor Green
    } else {
        Write-Host "✗ NOT connected to event stream" -ForegroundColor Red
    }
    
    if ($tuiContent -match "Sending prompt") {
        Write-Host "✓ Prompt sent" -ForegroundColor Green
    } else {
        Write-Host "✗ Prompt NOT sent" -ForegroundColor Red
    }
    
    $receivedEvents = ([regex]::Matches($tuiContent, "Received event")).Count
    if ($receivedEvents -gt 0) {
        Write-Host "✓ Events received: $receivedEvents" -ForegroundColor Green
    } else {
        Write-Host "✗ No events received" -ForegroundColor Red
    }
    
    if ($tuiContent -match "Stream completed") {
        Write-Host "✓ Stream completed" -ForegroundColor Green
    } else {
        Write-Host "⚠ Stream NOT completed" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Last 10 lines of TUI log:" -ForegroundColor Gray
    Get-Content $tuiLog -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
} else {
    Write-Host "✗ TUI log not found" -ForegroundColor Red
}

# Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Log files location:" -ForegroundColor White
Write-Host "  Server: $serverLog" -ForegroundColor Gray
Write-Host "  TUI:    $tuiLog" -ForegroundColor Gray
Write-Host ""
Write-Host "To view full logs:" -ForegroundColor White
Write-Host "  Get-Content '$serverLog' -Tail 50" -ForegroundColor Gray
Write-Host "  Get-Content '$tuiLog' -Tail 50" -ForegroundColor Gray
