# tong_work CLI 非TUI 命令设计

## 目标

完善 tong_work 命令行机制，将加载环境、切换环境、加载 session、在 session 中对话等能力通过命令行触发（排除 TUI），方便调试。

## 方案概述

扩展现有的 `run` 命令，支持：
1. 环境参数：启动时指定使用的环境
2. Session 参数：继续指定 session 或列出已有 sessions
3. 对话模式：直接发送消息，返回文本响应
4. 日志分离：日志写到文件，AI 响应输出到 stdout

## 命令设计

### 基本用法

```bash
# 基本对话
tong_work run "帮我写一个 hello world"

# 指定环境
tong_work run "任务" --env agent-core-zst-env

# 继续上次 session
tong_work run "继续" --continue

# 列出已有 sessions
tong_work run --list-sessions

# 指定 session ID
tong_work run "任务" --session sess_xxx

# 指定模型
tong_work run "任务" --model gpt-4

# 日志写到文件（stdout 只有 AI 响应）
tong_work run "任务" --log-file ./logs/run.log

# 完整示例
tong_work run "任务" --env dev --session sess_xxx --model gpt-4 --log-file ./logs/run.log
```

### 新增参数

| 参数 | 简写 | 说明 | 默认值 |
|------|------|------|--------|
| `--env` | `-e` | 使用的环境名称 | 当前工作目录 |
| `--continue` | `-c` | 继续上次会话 | false |
| `--session` | `-s` | 指定 session ID | 新建 session |
| `--list-sessions` | `-l` | 列出所有 sessions | false |
| `--model` | `-m` | 使用的模型 | 配置默认值 |
| `--log-file` | 无 | 日志输出文件 | stdout |
| `--port` | `-p` | 服务器端口 | 4096 |

## 实现思路

### 1. 扩展 RunCommand

```typescript
interface RunOptions {
  message?: string;
  continue?: boolean;
  session?: string;
  listSessions?: boolean;
  model?: string;
  env?: string;
  logFile?: string;
  port?: number;
}
```

### 2. 日志分离机制

- 使用 `--log-file` 参数指定日志文件路径
- 如果指定了 `--log-file`：
  - 配置 logger 将日志写入文件
  - stdout 只输出 AI 响应
- 如果没有指定：
  - 保持原有行为（stdout 输出）

### 3. 环境加载

- 使用 `ServerEnvironment` 加载机制
- 从 `environments/{envName}/config.jsonc` 读取配置
- 支持全局环境 (`~/.tong_work/environments/`) 和本地环境 (`./.tong_work/environments/`)

### 4. Session 管理

- 使用现有的 session API (`TongWorkClient`)
- 本地文件存储 session 映射（可选）
- `--list-sessions` 列出服务器上所有 sessions
- `--continue` 自动获取最近使用的 session

### 5. 对话输出格式

```
# AI 响应输出到 stdout
🤖 开始执行任务...

[AI 响应内容]

✅ 任务完成
Session: sess_xxx
```

### 6. 日志文件格式

```
[2026-03-17 14:30:00] INFO: Starting tong_work run...
[2026-03-17 14:30:00] INFO: Loading environment: agent-core-zst-env
[2026-03-17 14:30:01] INFO: Session created: sess_xxx
[2026-03-17 14:30:02] INFO: Sending prompt: "帮我写一个 hello world"
[2026-03-17 14:30:05] INFO: Tool call: read_file
[2026-03-17 14:30:06] INFO: Tool result: success
...
```

## 文件变更

### 新增文件
- 无

### 修改文件
- `packages/core/src/cli/commands/run.ts` - 扩展命令参数和实现

## 验收标准

1. ✅ `tong_work run "message"` 能正常执行并返回 AI 响应
2. ✅ `tong_work run "message" --env xxx` 能使用指定环境
3. ✅ `tong_work run "message" --continue` 能继续上次 session
4. ✅ `tong_work run --list-sessions` 能列出所有 sessions
5. ✅ `tong_work run "message" --log-file ./log.txt` 日志写到文件，stdout 只有响应
6. ✅ 日志和 AI 响应完全分离
