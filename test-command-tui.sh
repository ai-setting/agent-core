#!/bin/bash

# Command 机制 TUI 测试脚本
# 使用方法：./test-command-tui.sh

echo "=== Agent Core Command TUI 测试脚本 ==="
echo ""
echo "这个脚本将帮助你验证 Command 机制在 TUI 中是否正常工作"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Server 是否运行
echo -e "${YELLOW}步骤 1: 检查 Server 状态...${NC}"
if curl -s http://localhost:3003/commands > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server 正在运行 (端口 3003)${NC}"
    echo "  可用命令列表:"
    curl -s http://localhost:3003/commands | jq -r '.[] | "  - /\(.name): \(.description)"' 2>/dev/null || echo "  (无法解析 JSON)"
else
    echo -e "${RED}✗ Server 未运行，请先启动 Server${NC}"
    echo "  运行: bun run start"
    exit 1
fi

echo ""
echo -e "${YELLOW}步骤 2: 检查 TUI 日志文件...${NC}"
TUI_LOG="$HOME/.config/tong_work/logs/tui.log"
if [ -f "$TUI_LOG" ]; then
    echo -e "${GREEN}✓ 找到 TUI 日志: $TUI_LOG${NC}"
    echo "  日志大小: $(ls -lh $TUI_LOG | awk '{print $5}')"
else
    echo -e "${RED}✗ 未找到 TUI 日志文件${NC}"
    echo "  日志路径: $TUI_LOG"
fi

echo ""
echo -e "${YELLOW}步骤 3: 测试 Command API...${NC}"
ECHO_RESULT=$(curl -s -X POST http://localhost:3003/commands/echo \
    -H "Content-Type: application/json" \
    -d '{"args":"test from script"}')

if echo "$ECHO_RESULT" | grep -q "success.*true"; then
    echo -e "${GREEN}✓ Echo 命令执行成功${NC}"
    echo "  响应: $ECHO_RESULT"
else
    echo -e "${RED}✗ Echo 命令执行失败${NC}"
    echo "  响应: $ECHO_RESULT"
fi

echo ""
echo -e "${YELLOW}步骤 4: 手动测试指南${NC}"
echo "请按以下步骤在 TUI 中测试 Command 机制："
echo ""
echo "1. 确保 TUI 已连接到 Server:"
echo "   bun run attach http://localhost:3003"
echo ""
echo "2. 在 TUI 输入框中输入 / (斜杠)"
echo ""
echo "3. 观察："
echo "   - 应该弹出 Command Palette (命令选择面板)"
echo "   - 面板中应该显示 'echo' 命令"
echo ""
echo "4. 如果没有弹出面板，检查日志:"
echo "   tail -f ~/.config/tong_work/logs/tui.log | grep -E '(InputBox|CommandContext|CommandPalette)'"
echo ""
echo "5. 你应该看到以下日志："
echo "   [InputBox] onChange ..."
echo "   [InputBox] Detected '/' input ..."
echo "   [InputBox] Opening command palette"
echo "   [CommandContext] Opening command palette called"
echo "   [CommandPalette] Component mounted"
echo "   [CommandPalette] isOpen state changed ..."
echo ""
echo "6. 选择 echo 命令或直接输入 '/echo hello world' 并回车"
echo ""
echo "7. 检查执行结果是否显示在消息列表中"
echo ""

# 清空旧日志以便观察新日志
echo -e "${YELLOW}步骤 5: 准备日志观察...${NC}"
echo "正在备份当前日志并准备新的观察窗口..."
if [ -f "$TUI_LOG" ]; then
    cp "$TUI_LOG" "${TUI_LOG}.backup.$(date +%Y%m%d_%H%M%S)"
    echo -e "${GREEN}✓ 日志已备份${NC}"
fi

echo ""
echo -e "${GREEN}=== 测试准备完成 ===${NC}"
echo ""
echo "提示: 在一个新终端窗口运行以下命令来实时监控日志:"
echo "  tail -f ~/.config/tong_work/logs/tui.log | grep -E '(InputBox|CommandContext|CommandPalette|Error|error)'"
echo ""
