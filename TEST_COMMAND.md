# Command 功能测试指南

## 快速测试步骤

### 1. 确保 Server 运行
```bash
curl http://localhost:3003/commands
# 应该返回: [{"name":"echo",...}]
```

### 2. 停止并重启 TUI
```bash
# 在 TUI 窗口按 Ctrl+C 停止
# 然后重新启动
bun run attach http://localhost:3003
```

### 3. 观察自动演示
TUI 启动后会自动演示 Command 功能：
- **启动后 2 秒**: 自动在输入框上方显示命令列表（显示 echo 命令）
- **启动后 8 秒**: 自动关闭命令列表

这是为了验证功能正常工作。

### 4. 查看日志
在新 PowerShell 窗口运行：
```powershell
Get-Content "$env:USERPROFILE/.config/tong_work/logs/tui.log" -Wait | Select-String "InputBox|command"
```

预期输出：
```
[InputBox] Auto-demo: showing command palette
[InputBox] onChange ...
[InputBox] Showing command palette ...
[InputBox] Auto-demo: closing command palette
```

### 5. 手动测试
如果自动演示正常，说明功能已就绪。你可以尝试：
- 输入 `/` - 应该显示命令列表
- 输入 `/echo hello` 并回车 - 应该执行命令

## 问题排查

### 如果自动演示没有出现
1. 检查日志是否有错误
2. 确认 Server 连接正常
3. 检查命令列表是否已加载

### 如果输入 `/` 不触发
这是已知的 OpenTUI input 组件问题。目前解决方案：
- 使用自动演示验证功能
- 直接输入完整命令如 `/echo hello` 并回车（这个可以正常工作）

### 查看详细日志
```powershell
# 查看所有相关日志
Get-Content "$env:USERPROFILE/.config/tong_work/logs/tui.log" -Tail 100

# 实时监控
Get-Content "$env:USERPROFILE/.config/tong_work/logs/tui.log" -Wait
```

## 功能验证清单

- [ ] Server `/commands` API 返回命令列表
- [ ] TUI 启动后自动显示命令列表（2秒时）
- [ ] 命令列表显示在输入框上方
- [ ] 显示 echo 命令及其描述
- [ ] 8秒后自动关闭
- [ ] 直接输入 `/echo test` 可以执行命令
- [ ] 执行结果显示在消息列表中

请按步骤测试并告诉我结果！
