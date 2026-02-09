# Integration Test Script for Windows PowerShell
# Run this from agent-core root directory

param(
    [int]$Port = 3001,
    [int]$TestTimeout = 20
)

$ErrorActionPreference = "Continue"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Agent Core TUI Integration Test" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$script:ServerLog = "./logs/server.log"
$script:TuiLog = "./logs/tui.log"
$script:ServerUrl = "http://localhost:$Port"
$script:ServerPid = $null

# Step 1: Clean up
Write-Host "[1/5] Cleaning up old logs..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "./logs" | Out-Null
Clear-Content -Path $script:ServerLog -ErrorAction SilentlyContinue
Clear-Content -Path $script:TuiLog -ErrorAction SilentlyContinue
Write-Host "✓ Logs cleaned" -ForegroundColor Green

# Kill any existing processes on the port
Write-Host "    Checking for existing processes on port $Port..." -ForegroundColor Gray
$existingProcess = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingProcess) {
    Write-Host "    Stopping existing process (PID: $($existingProcess.OwningProcess))..." -ForegroundColor Yellow
    Stop-Process -Id $existingProcess.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Step 2: Start server
Write-Host ""
Write-Host "[2/5] Starting server on port $Port..." -ForegroundColor Yellow
$serverScript = {
    param($Port, $LogFile)
    cd $using:PWD\packages\core
    $env:PORT = $Port
    $env:LOG_FILE = $LogFile
    $env:LOG_LEVEL = "debug"
    bun run start 2>&1
}

$serverJob = Start-Job -ScriptBlock $serverScript -ArgumentList $Port, (Resolve-Path $script:ServerLog).Path

# Wait for server
Write-Host "    Waiting for server to be ready..." -ForegroundColor Gray
$serverReady = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri "$script:ServerUrl/health" -UseBasicParsing -ErrorAction Stop -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            $serverReady = $true
            Write-Host "✓ Server ready" -ForegroundColor Green
            break
        }
    } catch {
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
}

if (-not $serverReady) {
    Write-Host ""
    Write-Host "✗ Server failed to start" -ForegroundColor Red
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -ErrorAction SilentlyContinue
    exit 1
}

# Give server a moment to fully initialize
Start-Sleep -Seconds 2

# Step 3: Run TUI test
Write-Host ""
Write-Host "[3/5] Starting TUI with mock inputs..." -ForegroundColor Yellow
Write-Host "    Test inputs: hello → delay:3s → exit" -ForegroundColor Gray

cd packages\core
$env:TUI_TEST_INPUTS = "hello;delay:3000;exit"
$env:LOG_FILE = "../../../logs/tui.log"
$env:LOG_LEVEL = "debug"

try {
    $tuiOutput = bun run dev attach $script:ServerUrl 2>&1
    $tuiOutput | Out-String | Write-Host
} catch {
    Write-Host "TUI completed (may have errors): $_" -ForegroundColor Yellow
}

cd ..\..

Write-Host "✓ TUI test completed" -ForegroundColor Green

# Step 4: Analyze logs
Write-Host ""
Write-Host "[4/5] Analyzing logs..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Test Results" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Server checks
Write-Host ""
Write-Host "[Server Side]" -ForegroundColor Yellow
$serverContent = Get-Content $script:ServerLog -ErrorAction SilentlyContinue | Out-String

if ($serverContent -match "Client connected") {
    Write-Host "  ✓ Client connected" -ForegroundColor Green
} else {
    Write-Host "  ✗ Client NOT connected" -ForegroundColor Red
}

if ($serverContent -match "Received prompt request") {
    Write-Host "  ✓ Prompt received" -ForegroundColor Green
} else {
    Write-Host "  ✗ Prompt NOT received" -ForegroundColor Red
}

if ($serverContent -match "Starting AI processing") {
    Write-Host "  ✓ AI processing started" -ForegroundColor Green
} else {
    Write-Host "  ✗ AI processing NOT started" -ForegroundColor Red
}

$eventCount = ([regex]::Matches($serverContent, "Sending event to client")).Count
if ($eventCount -gt 0) {
    Write-Host "  ✓ Events sent: $eventCount" -ForegroundColor Green
} else {
    Write-Host "  ✗ No events sent" -ForegroundColor Red
}

if ($serverContent -match "AI processing completed") {
    Write-Host "  ✓ AI processing completed" -ForegroundColor Green
} else {
    Write-Host "  ⚠ AI processing NOT completed (may still be running or LLM not configured)" -ForegroundColor Yellow
}

# Client checks
Write-Host ""
Write-Host "[Client Side]" -ForegroundColor Yellow
$tuiContent = Get-Content $script:TuiLog -ErrorAction SilentlyContinue | Out-String

if ($tuiContent -match "Connected to event stream") {
    Write-Host "  ✓ Connected to event stream" -ForegroundColor Green
} else {
    Write-Host "  ✗ NOT connected to event stream" -ForegroundColor Red
}

if ($tuiContent -match "Sending prompt") {
    Write-Host "  ✓ Prompt sent" -ForegroundColor Green
} else {
    Write-Host "  ✗ Prompt NOT sent" -ForegroundColor Red
}

$receivedEvents = ([regex]::Matches($tuiContent, "Received event")).Count
if ($receivedEvents -gt 0) {
    Write-Host "  ✓ Events received: $receivedEvents" -ForegroundColor Green
} else {
    Write-Host "  ✗ No events received" -ForegroundColor Red
}

if ($tuiContent -match "Stream completed") {
    Write-Host "  ✓ Stream completed" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Stream NOT completed" -ForegroundColor Yellow
}

# Error checks
Write-Host ""
Write-Host "[Error Check]" -ForegroundColor Yellow
$serverErrors = ([regex]::Matches($serverContent, "ERROR|Error:")).Count
$tuiErrors = ([regex]::Matches($tuiContent, "ERROR|Error:")).Count

if ($serverErrors -eq 0 -and $tuiErrors -eq 0) {
    Write-Host "  ✓ No errors found" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Potential issues found: Server=$serverErrors, TUI=$tuiErrors" -ForegroundColor Yellow
    
    $serverErrorLines = Get-Content $script:ServerLog -ErrorAction SilentlyContinue | Select-String "ERROR|Error:" | Select-Object -First 3
    if ($serverErrorLines) {
        Write-Host "  Server issues:" -ForegroundColor Gray
        $serverErrorLines | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
    }
}

# Show recent events
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Recent Server Events (last 15 lines)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Get-Content $script:ServerLog -ErrorAction SilentlyContinue | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Recent TUI Events (last 15 lines)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Get-Content $script:TuiLog -ErrorAction SilentlyContinue | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" }

# Cleanup
Write-Host ""
Write-Host "[5/5] Cleaning up..." -ForegroundColor Yellow
Stop-Job $serverJob -ErrorAction SilentlyContinue
Remove-Job $serverJob -ErrorAction SilentlyContinue
Write-Host "✓ Server stopped" -ForegroundColor Green

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Test Complete" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Full logs available at:" -ForegroundColor White
Write-Host "  - $((Resolve-Path $script:ServerLog).Path)" -ForegroundColor Gray
Write-Host "  - $((Resolve-Path $script:TuiLog).Path)" -ForegroundColor Gray
Write-Host ""
Write-Host "To run again:" -ForegroundColor White
Write-Host "  .\test-integration.ps1" -ForegroundColor Cyan
