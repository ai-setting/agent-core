# SessionProcessor 详解

## 1. 概述

SessionProcessor 是 OpenCode 的**LLM 响应处理器**，负责：
- 调用 LLM stream 接口
- 处理 stream 事件（text、tool call、reasoning 等）
- 管理消息 parts 的生命周期
- 追踪 token 使用和成本
- 处理错误和重试逻辑

它是所有 agent 响应（包括 compaction）的通用处理引擎。

## 2. 核心职责

```
┌─────────────────────────────────────────────────────────────────┐
│                      SessionProcessor                            │
├─────────────────────────────────────────────────────────────────┤
│  1. LLM 调用                                                     │
│     - 构建 stream 输入（messages、tools、system prompt）         │
│     - 调用 Provider 的 stream 接口                               │
│                                                                 │
│  2. Stream 事件处理                                              │
│     - text (start/delta/end)                                    │
│     - tool (input-start/input-end/call/result/error)            │
│     - reasoning (start/delta/end)                              │
│     - step (start/finish)                                       │
│                                                                 │
│  3. Part 生命周期管理                                            │
│     - 创建/更新/完成 message parts                               │
│     - 持久化到数据库                                             │
│                                                                 │
│  4. 副作用处理                                                   │
│     - 文件 snapshot/patch 追踪                                   │
│     - Session summary 更新                                       │
│     - Compaction 溢出检查                                        │
│                                                                 │
│  5. 错误处理                                                     │
│     - API 错误重试                                               │
│     - 权限拒绝处理                                               │
│     - Doom loop 检测                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 接口定义

### 3.1 创建参数

```typescript
export function create(input: {
  assistantMessage: MessageV2.Assistant  // 当前 assistant 消息
  sessionID: string                       // 会话 ID
  model: Provider.Model                   // 使用的模型
  abort: AbortSignal                      // 中止信号
})
```

### 3.2 返回值

```typescript
const processor = SessionProcessor.create({...})

// 属性
processor.message        // 当前 assistantMessage 的引用

// 方法
processor.partFromToolCall(toolCallID)  // 根据 callID 查找 tool part

// 核心方法
processor.process(streamInput)  // 处理 LLM stream，返回 Result
```

### 3.3 Process 结果类型

```typescript
export type Result = "continue" | "stop" | "compact"

"continue"  // 正常完成，可继续下一轮
"stop"      // 被阻止/错误/权限拒绝，停止处理
"compact"   // Token 溢出，需要 compaction
```

## 4. 内部状态

```typescript
function create(input) {
  // 工具调用追踪：callID -> ToolPart
  const toolcalls: Record<string, MessageV2.ToolPart> = {}

  // 文件变更 snapshot
  let snapshot: string | undefined

  // 是否被权限阻止
  let blocked = false

  // 重试次数
  let attempt = 0

  // 是否需要 compaction
  let needsCompaction = false

  // ...
}
```

## 5. Stream 事件处理

### 5.1 事件类型总览

| 事件 | 含义 | 处理动作 |
|------|------|----------|
| `start` | Stream 开始 | 设置 session status 为 busy |
| `text-start/delta/end` | 文本输出 | 创建/更新/完成 text part |
| `tool-input-start/end` | 工具输入 | 追踪 pending tool |
| `tool-call` | 工具调用 | 创建 running tool part |
| `tool-result` | 工具完成 | 更新 tool part 为 completed |
| `tool-error` | 工具错误 | 更新 tool part 为 error |
| `reasoning-start/delta/end` | 推理输出 | 创建/更新/完成 reasoning part |
| `start-step/finish-step` | 步骤边界 | Snapshot 追踪、usage 统计 |
| `finish` | Stream 结束 | 清理状态 |
| `error` | API 错误 | 抛出异常 |

### 5.2 Text 处理

```typescript
case "text-start":
  currentText = {
    id: Identifier.ascending("part"),
    type: "text",
    text: "",
    time: { start: Date.now() },
  }
  break

case "text-delta":
  currentText.text += value.text
  await Session.updatePart({ part, delta: value.text })  // 增量更新
  break

case "text-end":
  currentText.text = currentText.text.trimEnd()
  // 插件钩子：允许转换文本
  const textOutput = await Plugin.trigger(
    "experimental.text.complete",
    { sessionID, messageID, partID },
    { text: currentText.text },
  )
  currentText.text = textOutput.text
  currentText.time.end = Date.now()
  await Session.updatePart(currentText)  // 持久化
  break
```

### 5.3 Tool Call 处理

```typescript
case "tool-call": {
  // Doom Loop 检测：连续 3 次相同工具调用
  const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)
  if (lastThree.length === 3 &&
      lastThree.every(p => p.tool === value.toolName &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input))) {
    await PermissionNext.ask({ permission: "doom_loop", ... })
  }

  // 创建 running tool part
  const part = await Session.updatePart({
    tool: value.toolName,
    state: {
      status: "running",
      input: value.input,
      time: { start: Date.now() },
    },
  })
  toolcalls[value.toolCallId] = part
  break
}

case "tool-result": {
  // 更新为 completed
  await Session.updatePart({
    ...match,
    state: {
      status: "completed",
      input: value.input,
      output: value.output.output,
      title: value.output.title,
      time: { start, end: Date.now() },
    },
  })
  delete toolcalls[value.toolCallId]
  break
}

case "tool-error": {
  // 更新为 error
  await Session.updatePart({
    ...match,
    state: {
      status: "error",
      error: value.error.toString(),
      time: { start, end: Date.now() },
    },
  })

  // 权限拒绝/问题拒绝 -> blocked
  if (value.error instanceof RejectedError) {
    blocked = shouldBreak
  }
  break
}
```

### 5.4 Step 处理

```typescript
case "start-step":
  snapshot = await Snapshot.track()  // 开始追踪文件变更
  await Session.updatePart({
    type: "step-start",
    snapshot,
  })
  break

case "finish-step": {
  // 计算 token 使用和成本
  const usage = Session.getUsage({ model, usage, metadata })

  // 更新消息的 usage
  input.assistantMessage.tokens = usage.tokens
  input.assistantMessage.cost += usage.cost

  // 创建 step-finish part
  await Session.updatePart({
    type: "step-finish",
    tokens: usage.tokens,
    cost: usage.cost,
  })

  // 生成 patch
  if (snapshot) {
    const patch = await Snapshot.patch(snapshot)
    if (patch.files.length) {
      await Session.updatePart({
        type: "patch",
        hash: patch.hash,
        files: patch.files,
      })
    }
    snapshot = undefined
  }

  // 更新 summary
  SessionSummary.summarize({ sessionID, messageID: parentID })

  // 检查是否需要 compaction
  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model })) {
    needsCompaction = true
  }
  break
}
```

## 6. 错误处理

### 6.1 重试机制

```typescript
try {
  // 处理 stream
} catch (e) {
  const error = MessageV2.fromError(e, { providerID })

  // 检查是否可重试
  const retry = SessionRetry.retryable(error)
  if (retry !== undefined) {
    attempt++
    const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)

    // 设置重试状态
    SessionStatus.set(sessionID, {
      type: "retry",
      attempt,
      message: retry,
      next: Date.now() + delay,
    })

    // 等待后重试
    await SessionRetry.sleep(delay, abort)
    continue  // 重试整个循环
  }

  // 不可重试，发布错误事件
  input.assistantMessage.error = error
  Bus.publish(Session.Event.Error, { sessionID, error })
  return "stop"
}
```

### 6.2 中止处理

```typescript
// Stream 结束后，清理未完成的 tools
for (const part of p) {
  if (part.type === "tool" &&
      part.state.status !== "completed" &&
      part.state.status !== "error") {
    await Session.updatePart({
      ...part,
      state: {
        ...part.state,
        status: "error",
        error: "Tool execution aborted",
        time: { start: Date.now(), end: Date.now() },
      },
    })
  }
}

// 标记消息完成
input.assistantMessage.time.completed = Date.now()
await Session.updateMessage(input.assistantMessage)
```

## 7. 调用示例

### 7.1 普通 agent 调用

```typescript
const processor = SessionProcessor.create({
  assistantMessage: assistantMsg,
  sessionID,
  model,
  abort,
})

const result = await processor.process({
  user: lastUser,
  agent,
  system: [...SystemPrompt.environment(model), ...InstructionPrompt.system()],
  messages: [...MessageV2.toModelMessages(msgs, model)],
  tools,
  model,
})

if (result === "stop") break
if (result === "compact") {
  await SessionCompaction.create({...})
}
```

### 7.2 Compaction 调用

```typescript
const processor = SessionProcessor.create({
  assistantMessage: msg,  // mode: "compaction" 的消息
  sessionID: input.sessionID,
  model,
  abort: input.abort,
})

const result = await processor.process({
  user: userMessage,
  agent: compactionAgent,
  messages: [...],
  system: [],
  tools: {},
  model,
})
```

## 8. 插件钩子

| 钩子 | 时机 | 用途 |
|------|------|------|
| `experimental.text.complete` | text-end | 转换/清理最终文本 |
| `experimental.chat.system.transform` | stream 前 | 修改 system prompt |

## 9. 关键依赖

```typescript
import { LLM } from "./llm"              // LLM stream 接口
import { Session } from "."               // 消息/parts 更新
import { SessionCompaction } from "./compaction"  // 溢出检查
import { SessionSummary } from "./summary"        // Summary 更新
import { Snapshot } from "@/snapshot"             // 文件追踪
import { SessionRetry } from "./retry"           // 重试逻辑
import { SessionStatus } from "./status"         // 状态管理
import { PermissionNext } from "@/permission/next" // 权限
import { Question } from "@/question"             // 交互
import { Plugin } from "@/plugin"                  // 插件
```

## 10. 与其他组件的关系

```
┌─────────────┐     create      ┌─────────────────────┐
│   Prompt    │ ──────────────▶ │  SessionProcessor   │
│   (prompt.ts)│                 │                     │
└─────────────┘                 │  - 处理 stream       │
                                │  - 管理 parts        │
                                │  - 错误处理          │
                                └──────────┬──────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
            │     LLM      │      │   Session   │      │ Compaction  │
            │  (llm.ts)    │      │  (session)  │      │ (compaction)│
            └─────────────┘      └─────────────┘      └─────────────┘
```

## 11. 关注点

### 11.1 性能
- **增量更新**: text/tool parts 使用 delta 增量更新，减少数据库写入
- **Doom Loop 检测**: 防止无限循环调用
- **Snapshot 优化**: 只在有文件变更时创建 patch

### 11.2 正确性
- **状态流转**: tool 从 pending → running → completed/error
- **时间戳记录**: 准确的 start/end 时间
- **Token 统计**: 包含 reasoning 和 cache tokens

### 11.3 可观测性
- **日志**: 每个事件都有 log.info
- **Bus 事件**: 发布 Error 事件供监控
- **Status**: 设置 session 状态 (busy/retry/idle)
