# OpenCode Compaction 机制详解

## 1. 概述

Compaction 是 OpenCode 的上下文压缩机制，用于在对话过长、token 使用量接近模型限制时，自动将历史对话压缩为摘要，释放上下文空间。

## 2. 核心组件

### 2.1 核心文件

- `packages/opencode/src/session/compaction.ts` - compaction 核心逻辑
- `packages/opencode/src/session/prompt.ts` - 触发逻辑
- `packages/opencode/src/session/processor.ts` - LLM 调用处理
- `packages/opencode/src/agent/prompt/compaction.txt` - 摘要生成 prompt
- `packages/opencode/src/agent/agent.ts` - compaction agent 定义

### 2.2 关键类型定义

```typescript
// CompactionPart - 标记 compaction 任务
export const CompactionPart = PartBase.extend({
  type: z.literal("compaction"),
  auto: z.boolean(),  // 是否自动继续对话
})

// Compaction Agent 配置
compaction: {
  name: "compaction",
  mode: "primary",
  native: true,
  hidden: true,
  prompt: PROMPT_COMPACTION,
}
```

## 3. 触发条件

### 3.1 Token 溢出检查 `isOverflow()`

```typescript
export async function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  const config = await Config.get()
  if (config.compaction?.auto === false) return false

  const context = input.model.limit.context
  if (context === 0) return false

  // 计算总 token: input + cache.read + output
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output

  // 预留 output 空间
  const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX)
  const usable = input.model.limit.input || context - output

  return count > usable
}
```

### 3.2 触发场景

| 场景 | 位置 | 说明 |
|------|------|------|
| 响应完成检查 | `processor.ts:274` | LLM 响应完成后检查是否溢出 |
| 上下文溢出 | `prompt.ts:507` | 处理消息前检查最后一条 assistant 消息 |
| 手动触发 | `prompt.ts:625` | 用户执行 `/compact` 命令 |

### 3.3 配置控制

```json
{
  "compaction": {
    "auto": true,   // 自动触发 compaction (默认: true)
    "prune": true   // 自动清理旧 tool 输出 (默认: true)
  }
}

OPENCODE_DISABLE_AUTOCOMPACT=true  // 环境变量禁用
```

## 4. 工作流程

### 4.1 流程图

```
用户消息 → LLM 处理 → 响应完成
                    ↓
            检查 isOverflow()
                    ↓
              ┌───是───┐
              ↓        ↓
        创建 compaction  执行 SessionProcessor.process()
        part (type: compaction)    ↓
              ↓              调用 compaction agent
        标记 needsCompaction     生成摘要
              ↓              创建 summary: true 消息
        返回 "compact"    发布 session.compacted 事件
              ↓
        SessionPrompt 继续处理 compaction part
              ↓
        调用 SessionCompaction.process()
              ↓
        生成摘要后可自动添加 "Continue" 继续对话
```

### 4.2 Compaction 处理 `process()`

```typescript
export async function process(input: {
  parentID: string
  messages: MessageV2.WithParts[]
  sessionID: string
  abort: AbortSignal
  auto: boolean
}) {
  // 1. 获取用户消息和 agent/model
  const userMessage = input.messages.findLast((m) => m.info.id === input.parentID)!
  const agent = await Agent.get("compaction")

  // 2. 创建 compaction 消息
  const msg = await Session.updateMessage({
    id: Identifier.ascending("message"),
    role: "assistant",
    parentID: input.parentID,
    sessionID: input.sessionID,
    mode: "compaction",
    agent: "compaction",
    summary: true,  // 标记为摘要消息
  })

  // 3. 创建 processor
  const processor = SessionProcessor.create({...})

  // 4. 插件钩子：允许注入上下文或替换 prompt
  const compacting = await Plugin.trigger(
    "experimental.session.compacting",
    { sessionID: input.sessionID },
    { context: [], prompt: undefined },
  )

  // 5. 构建 prompt
  const defaultPrompt = "Provide a detailed prompt for continuing our conversation above..."
  const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")

  // 6. 调用 LLM 生成摘要
  const result = await processor.process({
    messages: [...],
    system: [],
    user: userMessage,
  })

  // 7. 可选：自动添加继续消息
  if (result === "continue" && input.auto) {
    await Session.updatePart({
      type: "text",
      synthetic: true,
      text: "Continue if you have next steps",
    })
  }

  return "continue"
}
```

### 4.3 插件钩子

```typescript
// 插件可注入额外上下文
export const CompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.context.push(`
## Custom Context
- Current task status
- Important decisions made
- Files being actively worked on
      `)
    },
  }
}

// 或完全替换 prompt
export const CustomCompactionPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async (input, output) => {
      output.prompt = `You are generating a continuation prompt...`
    },
  }
}
```

## 5. Prune 机制

自动清理旧 tool 输出的 token 消耗。

```typescript
export const PRUNE_MINIMUM = 20_000   // 最小清理阈值
export const PRUNE_PROTECT = 40_000   // 最大保护阈值
const PRUNE_PROTECTED_TOOLS = ["skill"]  // 保护的 tool

export async function prune(input: { sessionID: string }) {
  const config = await Config.get()
  if (config.compaction?.prune === false) return

  const msgs = await Session.messages({ sessionID: input.sessionID })
  let total = 0

  // 从后往前遍历，找到 40_000 tokens 的 tool calls
  for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = msgs[msgIndex]
    if (msg.info.role === "assistant" && msg.info.summary) break

    for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = msg.parts[partIndex]
      if (part.type === "tool" && part.state.status === "completed") {
        if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
        if (part.state.time.compacted) break

        const estimate = Token.estimate(part.state.output)
        total += estimate

        if (total > PRUNE_PROTECT) {
          part.state.time.compacted = Date.now()  // 标记已压缩
          await Session.updatePart(part)
        }
      }
    }
  }
}
```

## 6. 与 TaskTool 的区别

| 方面 | TaskTool | Compaction |
|------|----------|------------|
| **调用方式** | 工具调用 → 创建新 session | 直接 `SessionProcessor.process()` |
| **Session** | 创建独立子 session | 在原消息内生成摘要 |
| **返回结果** | 输出返回给原对话 | 生成 `summary: true` 的 assistant 消息 |
| **Mode** | `mode: subagent` 或 `all` | `mode: "compaction"` (特殊值) |
| **可见性** | 列在 TaskTool 参数中 | 隐藏的内部 agent |

## 7. Mode 概念

### 7.1 Agent Mode 类型

| Mode | 含义 | 调用方式 |
|------|------|----------|
| `primary` | 主 agent | 用户直接使用 `@agent` 选择 |
| `subagent` | 子 agent | 通过 TaskTool 调用 |
| `all` | 两者皆可 | 既可单独使用，也可被 TaskTool 调用 |

### 7.2 使用示例

```typescript
// TaskTool 只列出 subagent 和 all
const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

// 默认 agent 不能是 subagent
if (agent.mode === "subagent") throw new Error("default agent cannot be a subagent")
```

## 8. 关注点

### 8.1 性能相关

- **Token 计算**: 包含 `input + cache.read + output`，需要准确估算
- **Prune 阈值**: 40_000 tokens 保护阈值，避免过度清理
- **Plugin 钩子**: 注入过多上下文可能适得其反

### 8.2 正确性相关

- **摘要质量**: `compaction.txt` prompt 确保生成有意义的摘要
- **上下文保留**: 关键决策、文件状态、需要继续的工作应保留
- **不清理内容**: 已压缩的 tool 输出不应再次压缩 (`time.compacted` 检查)

### 8.3 可配置性

- **禁用自动**: `compaction.auto: false` 关闭自动触发
- **禁用清理**: `compaction.prune: false` 关闭 prune
- **自定义**: 插件可完全替换 compaction prompt

### 8.4 事件追踪

```typescript
// 发布 compaction 完成事件
Bus.publish(Event.Compacted, { sessionID: input.sessionID })

// 监听示例
Bus.subscribe(SessionCompaction.Event.Compacted, (evt) => {
  console.log(`Session ${evt.properties.sessionID} compacted`)
})
```

## 9. 测试文件

- `packages/opencode/test/session/compaction.test.ts` - isOverflow 测试
- `packages/opencode/test/session/revert-compact.test.ts` - revert + compact 工作流测试
