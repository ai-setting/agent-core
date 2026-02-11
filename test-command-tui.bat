@echo off
chcp 65001 >nul
echo === Agent Core Command TUI 测试 (Windows) ===
echo.
echo 这个脚本将帮助你验证 Command 机制在 TUI 中是否正常工作
echo.

echo [步骤 1] 检查 Server 状态...
curl -s http://localhost:3003/commands > temp_cmds.json 2>nul
if %errorlevel% == 0 (
    echo [OK] Server 正在运行 (端口 3003)
    echo   可用命令:
    type temp_cmds.json
) else (
    echo [错误] Server 未运行，请先启动 Server
    echo   运行: bun run start
    goto :cleanup
)
echo.

echo [步骤 2] 测试 Command API...
curl -s -X POST http://localhost:3003/commands/echo -H "Content-Type: application/json" -d "{\"args\":\"test\"}" > temp_result.json
type temp_result.json | findstr "success" >nul
if %errorlevel% == 0 (
    echo [OK] Echo 命令执行成功
    type temp_result.json
) else (
    echo [错误] Echo 命令执行失败
)
echo.

echo [步骤 3] TUI 手动测试指南
echo ==========================================
echo.
echo 1. 如果 TUI 正在运行，请先停止 (按 Ctrl+C)
echo.
echo 2. 重新启动 TUI:
echo    bun run attach http://localhost:3003
echo.
echo 3. 在 TUI 输入框中输入 / (斜杠)
echo.
echo 4. 观察:
echo    - 应该弹出 Command Palette (命令选择面板)
echo    - 面板中应该显示 'echo' 命令
echo.
echo 5. 如果面板没有弹出，在新终端运行以下命令查看日志:
echo    Get-Content "$env:USERPROFILE/.config/tong_work/logs/tui.log" -Wait ^| Select-String "InputBox|CommandContext|CommandPalette|Error"
echo.
echo 6. 正常应该看到以下日志:
echo    [InputBox] onChange ...
echo    [InputBox] Detected '/' input ...
echo    [InputBox] Opening command palette
echo    [CommandContext] Opening command palette called
echo    [CommandPalette] Component mounted
echo.
echo 7. 输入 '/echo hello world' 并回车测试命令执行
echo.
echo ==========================================
echo.

:cleanup
if exist temp_cmds.json del temp_cmds.json
if exist temp_result.json del temp_result.json

pause
