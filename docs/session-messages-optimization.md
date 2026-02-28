# Session Messages 流程梳理与优化改造文档

## 一、当前流程详述

### 1.1 整体架构概览

```
用户消息 → USER_QUERY事件 → Session存储 → toHistory()转换 
    → handle_query(history) → Agent.run() → onMessageAdded回调 
    → Session存储 → 完成
```

### 1.2 完整流程步骤

#### 步骤1: 用户发送消息 (environment.ts)

**文件**: `packages/core/src/server/environment.ts`

**代码位置**: `initEventRules()` 方法中处理 `USER_QUERY` 事件

```typescript
bus.registerRule({
  eventType: EventTypes.USER_QUERY,
  handler: {
    type: "function",
    fn: async (event: EnvEvent) => {
      const { sessionId, content } = event.payload;
      
      // 1. 获取历史消息 (AI SDK ModelMessage格式)
      const session = await this.getSession!(sessionId);
      const history = session?.toHistory() || [];
      
      // 2. 添加用户消息到Session
      session?.addUserMessage(content);
      
      // 3. 调用handle_query，传入history和onMessageAdded回调
      const response = await this.handle_query(content, { 
        session_id: sessionId,
        onMessageAdded: (msg) => { /* 处理assistant/tool消息 */ }
      }, history);
      
      // 4. 保存最终assistant消息
      session?.addAssistantMessage(response);
    }
  }
});
```

#### 步骤2: Session消息转History (history.ts)

**文件**: `packages/core/src/core/session/history.ts`

**核心函数**: `sessionToHistory(session: Session): ModelMessage[]`

```typescript
export function sessionToHistory(session: Session): ModelMessage[] {
  const messages = session.getMessages();
  const history: ModelMessage[] = [];
  
  for (const msg of messages) {
    const converted = convertMessage(msg);
    if (converted) {
      history.push(converted);
    }
  }
  return history;
}
```

**转换函数**:
- `convertUserMessage(msg)` → user消息
- `convertAssistantMessage(msg)` → assistant消息(含tool-call)
- `convertToolMessage(msg)` → tool消息(含tool-result)
- `convertSystemMessage(msg)` → system消息

#### 步骤3: handle_query接收history (base-environment.ts)

**文件**: `packages/core/src/core/environment/base/base-environment.ts`

**接口定义** (Environment interface):

```typescript
handle_query(query: string, context?: Context, history?: ModelMessage[]): Promise<string>;
```

**Context 必须包含 onMessageAdded**（用于实时持久化 Agent 产生的消息）:

```typescript
interface Context {
  session_id?: string;
  /** 消息添加回调，Agent 每产生 assistant/tool 消息时调用，用于实时写入 Session */
  onMessageAdded?: (message: AddedMessage) => void;
  // ... 其他字段
}
```

**实现示例**:

```typescript
async handle_query(query: string, context?: Context, history?: ModelMessage[]): Promise<string> {
  // context 中必须传入 onMessageAdded，以便 Agent 将产生的消息实时回写 Session
  const agent = new Agent(event, this as Environment, this.listTools(), agentContext, { agentId: "system" }, history);
  return agent.run();
}
```

#### 步骤4: Agent.react循环 (agent/index.ts)

**文件**: `packages/core/src/core/agent/index.ts`

**核心逻辑**:
```typescript
async run(): Promise<string> {
  // 1. 合并history到messages数组
  const messages: ModelMessage[] = [...(this.history || [])];
  
  // 添加当前用户消息
  messages.push({
    role: "user",
    content: this.event.content,
  });

  // 2. React循环
  while (/* 条件 */) {
    // 调用LLM
    const output = await this.env.invokeLLM(messages, /* tools */);
    
    // 3. 构建assistant消息
    const assistantContent = [];
    if (output.content) {
      assistantContent.push({ type: "text", text: output.content });
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.function.name,
        input: parsedArgs,
      });
    }
    
    messages.push({
      role: "assistant",
      content: assistantContent,
    } as ModelMessage);
    
    // 4. 通知消息添加 (关键!)
    this.notifyMessageAdded({ role: "assistant", content: output.content || "" }, assistantContent);
    
    // 5. 处理tool调用...
    // 添加工具结果消息
    messages.push({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: tc.id, toolName: tc.function.name, output: {...} }],
    } as ModelMessage);
    
    // 通知tool消息添加
    this.notifyMessageAdded({ role: "tool", content: toolOutputText, toolCallId: tc.id, name: tc.function.name });
  }
}
```

#### 步骤5: onMessageAdded回调处理 (environment.ts)

**文件**: `packages/core/src/server/environment.ts`

```typescript
onMessageAdded: (msg) => {
  if (msg.role === "assistant" && msg.content) {
    // 检查是否有assistantContent (含tool-call的信息)
    if (msg.assistantContent && Array.isArray(msg.assistantContent)) {
      const hasToolCall = msg.assistantContent.some((p: any) => p.type === "tool-call");
      const hasText = msg.assistantContent.some((p: any) => p.type === "text");
      const textPart = msg.assistantContent.find((p: any) => p.type === "text");
      const toolCallPart = msg.assistantContent.find((p: any) => p.type === "tool-call");
      
      if (hasToolCall && hasText && textPart && toolCallPart) {
        // 同时有text和tool-call → 调用addAssistantMessageWithTextAndTool
        session?.addAssistantMessageWithTextAndTool(...);
      } else if (hasToolCall && toolCallPart) {
        // 只有tool-call → 调用addAssistantMessageWithTool
        session?.addAssistantMessageWithTool(...);
      } else {
        // 只有text → 调用addAssistantMessage
        session?.addAssistantMessage(msg.content);
      }
    } else {
      session?.addAssistantMessage(msg.content);
    }
  } else if (msg.role === "tool" && msg.name) {
    // tool消息 → 调用addToolMessage
    session?.addToolMessage(msg.name, msg.tool_call_id || `call_${Date.now()}`, msg.content, {});
  }
}
```

---

## 二、核心节点分析

### 2.1 核心转换节点

| 节点 | 位置 | 输入格式 | 输出格式 | 功能 |
|------|------|----------|----------|------|
| Session存储 | session.ts | MessageInfo + Parts | Session内部格式 | 持久化消息 |
| toHistory() | history.ts | Session内部格式 | AI SDK ModelMessage | 格式转换1 |
| handle_query | base-environment.ts | AI SDK ModelMessage[] | string | 传递history |
| Agent.run | agent/index.ts | AI SDK ModelMessage[] | AI SDK ModelMessage[] | React循环 |
| onMessageAdded | environment.ts | 自定义消息对象 | Session方法调用 | 格式转换2 |

### 2.2 消息格式对比

**Session内部格式** (session/types.ts):
```typescript
interface MessageWithParts {
  info: MessageInfo;
  parts: Part[];  // TextPart | ReasoningPart | ToolPart | FilePart
}
```

**AI SDK ModelMessage格式** (ai package):
```typescript
type ModelMessage = 
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | ContentPart[] }
  | { role: "tool"; content: ContentPart[]; toolCallId: string }
  | { role: "system"; content: string };

interface ContentPart {
  type: "text" | "tool-call" | "tool-result" | "image" | "file";
  // ... type-specific fields
}
```

**onMessageAdded回调格式** (自定义):
```typescript
interface AddedMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  assistantContent?: ContentPart[];  // 用于传递tool-call信息
  tool_call_id?: string;
  name?: string;  // tool名称
}
```

---

## 三、当前问题识别

### 3.1 中间格式转换繁琐

**问题1: 多层格式转换**
- Session格式 → ModelMessage (toHistory)
- Agent内ModelMessage → onMessageAdded自定义格式
- onMessageAdded自定义格式 → Session方法调用

**问题2: onMessageAdded回调逻辑复杂**
```typescript
// 需要解析assistantContent数组，判断多种组合
if (msg.assistantContent && Array.isArray(msg.assistantContent)) {
  const hasToolCall = msg.assistantContent.some((p: any) => p.type === "tool-call");
  const hasText = msg.assistantContent.some((p: any) => p.type === "text");
  // ... 多种分支判断
}
```

**问题3: Session方法过多**
- `addAssistantMessage` - 普通文本
- `addAssistantMessageWithTool` - 仅tool-call
- `addAssistantMessageWithTextAndTool` - 文本+tool-call
- `addToolMessage` - 工具结果

### 3.2 数据一致性风险

每次转换都可能丢失信息:
- Session Parts → ModelMessage: 可能丢失部分part信息
- ModelMessage → onMessageAdded: 自定义格式需要手动传递额外字段
- onMessageAdded → Session: 需要根据类型选择不同方法

### 3.3 维护困难

- 修改格式需要同时修改多个文件
- 新增消息类型需要修改多处代码

---

## 四、优化建议

### 4.1 统一格式标准

**建议**: 以AI SDK ModelMessage为唯一标准格式

- Session内部存储直接使用ModelMessage格式
- 移除自定义的onMessageAdded回调格式
- 简化转换逻辑

### 4.2 简化Session API

**建议**: 提供统一的addMessage方法

```typescript
// 优化后
class Session {
  // 统一的添加消息方法
  addMessage(message: ModelMessage): string;
  
  // 兼容方法 (可选)
  addUserMessage(content: string): string;  // 内部转为ModelMessage
  addAssistantMessage(content: string | ModelMessage): string;
}
```

### 4.3 优化回调机制（最终方案）

**采用直接传递 ModelMessage 的方式**，保持 `onMessageAdded` 在 Context 中的设计：

```typescript
// 优化后: onMessageAdded 直接接收 ModelMessage，仍通过 Context 传入
handle_query(content, { 
  session_id: sessionId,
  onMessageAdded: (message: ModelMessage) => {
    session.addMessage(message);
  }
}, history);
```

---

## 五、改造方案

### 5.0 handle_query 接口约定（最终确定）

```typescript
handle_query(query: string, context?: Context, history?: ModelMessage[]): Promise<string>;
```

**Context 必须包含**:
- `session_id`: 会话标识
- `onMessageAdded`: 消息添加回调，Agent 每产生 assistant/tool 消息时调用，用于实时写入 Session

**调用方职责**: 调用 `handle_query` 时必须在 `context` 中传入 `onMessageAdded`，否则 Agent 产生的中间消息无法持久化到 Session。

### 5.1 总体架构改造

```
用户消息 → USER_QUERY事件 
    → Session.addUserMessage(content) 
    → handle_query(query, context{ session_id, onMessageAdded }, history: ModelMessage[]) 
    → Agent.run() 
    → onMessageAdded(ModelMessage)  // 通过 context 传入的回调
    → Session.addMessage(ModelMessage) 
    → 完成
```

### 5.2 具体改造步骤

#### 步骤1: 改造Session存储

**文件**: `packages/core/src/core/session/session.ts`

```typescript
import type { ModelMessage } from "ai";

export class Session {
  // 新增: 直接添加ModelMessage格式的消息
  addMessage(message: ModelMessage): string {
    // 解析ModelMessage，转换为内部格式存储
    // 同时保持向后兼容
  }
  
  // 改造: toHistory直接返回ModelMessage[]
  toHistory(): ModelMessage[] {
    // 无需转换，直接返回
  }
}
```

#### 步骤2: 简化history.ts

**文件**: `packages/core/src/core/session/history.ts`

```typescript
// 可以保留作为向后兼容层
// 主要是Session内部不再需要这个转换
```

#### 步骤3: 简化onMessageAdded回调（保留在 Context 中）

**文件**: `packages/core/src/server/environment.ts`

```typescript
// 优化后：onMessageAdded 仍通过 context 传入，但回调参数改为 ModelMessage
const response = await this.handle_query(content, { 
  session_id: sessionId,
  onMessageAdded: (message: ModelMessage) => {
    session.addMessage(message);
  }
}, history);
```

#### 步骤4: 调整Agent.notifyMessageAdded

**文件**: `packages/core/src/core/agent/index.ts`

```typescript
// 直接传递ModelMessage格式
notifyMessageAdded(message: ModelMessage): void {
  if (this.context.onMessageAdded) {
    this.context.onMessageAdded(message);
  }
}
```

### 5.3 改造后的数据流

```
┌─────────────────────────────────────────────────────────────┐
│                      用户发送消息                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  ServerEnvironment.initEventRules()                         │
│  - session.addUserMessage(content) → ModelMessage           │
│  - history = session.toHistory() → ModelMessage[]           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  BaseEnvironment.handle_query(query, context, history)       │
│  - context 必须含 session_id、onMessageAdded                │
│  - history 为 ModelMessage[]，直接传递给 Agent               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent.run()                                                │
│  - 使用history作为初始messages                              │
│  - React循环中:                                             │
│    - 调用LLM得到ModelMessage                                │
│    - notifyMessageAdded(ModelMessage)                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  onMessageAdded: (message: ModelMessage)                    │
│  - session.addMessage(message)                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.4 向后兼容性

- 保留现有的Session方法(addUserMessage, addAssistantMessage等)
- 在新方法内部调用统一的addMessage
- 逐步迁移，减少break change

### 5.5 兼容代码移除与清理（优化成功后执行）

当 Phase 1～3 改造完成、单测全部通过、功能验证稳定后，需进行**兼容代码移除清理**，只保留最新逻辑，避免长期维护两套路径。

#### 5.5.1 清理时机

- 所有改造阶段已完成
- 单测、回归测试、集成测试全部通过
- 线上或预发环境运行一段时间无异常

#### 5.5.2 待移除的兼容代码

| 位置 | 待移除内容 | 保留内容 |
|------|------------|----------|
| `Session` (session.ts) | `addAssistantMessage`、`addAssistantMessageWithTool`、`addAssistantMessageWithTextAndTool` 等分散方法（若已无调用方） | `addMessage(ModelMessage)`、`addUserMessage`（可保留为便捷方法，内部调用 addMessage） |
| `environment.ts` onMessageAdded | 旧的自定义格式解析逻辑（assistantContent 分支、hasToolCall/hasText 判断） | 简化为 `session.addMessage(message)` 单行调用 |
| `history.ts` | `sessionToHistory`、`convertMessage` 等转换函数（若 Session 已直接存储 ModelMessage） | 仅保留 Session 内部需要的转换，或删除冗余转换层 |
| `Context` (context.ts) | `onMessageAdded` 回调参数中的 `AddedMessage` 自定义类型 | 统一为 `(message: ModelMessage) => void` |
| `Agent.notifyMessageAdded` | 将 ModelMessage 映射为 AddedMessage 的逻辑 | 直接传递 `ModelMessage` |

#### 5.5.3 清理步骤建议

1. **确认无外部依赖**：全局搜索上述方法/类型，确认无第三方或未迁移代码引用
2. **按模块逐个移除**：Session → environment → history → Context → Agent，每步提交并跑单测
3. **删除废弃类型**：移除 `AddedMessage` 等仅用于旧流程的类型定义
4. **更新文档与注释**：删除“兼容”“legacy”等说明，保持文档与代码一致

#### 5.5.4 清理后验证

- 全量单测通过
- 关键流程手工验证（含 tool-call、多轮对话）
- 确认代码库中无 `addAssistantMessageWithTool`、`addAssistantMessageWithTextAndTool`、`assistantContent` 等旧逻辑残留

### 5.6 优化改造涉及改动点（全面）

以下为本次优化涉及的**全部改动点**，改造时需逐一排查与适配。

#### 5.6.1 核心模块（直接改造）

| 文件 | 改动内容 | 说明 |
|------|----------|------|
| `packages/core/src/core/session/session.ts` | 新增 `addMessage(ModelMessage)`，改造 `toHistory()` | Session 存储与格式统一 |
| `packages/core/src/core/session/history.ts` | 简化或移除 `sessionToHistory`、`convertMessage` | 若 Session 直接存 ModelMessage 则转换层可简化 |
| `packages/core/src/core/types/context.ts` | `onMessageAdded` 参数类型改为 `ModelMessage` | 统一回调签名 |
| `packages/core/src/core/agent/index.ts` | `notifyMessageAdded` 直接传递 `ModelMessage` | 移除 ModelMessage→AddedMessage 映射 |
| `packages/core/src/core/environment/base/base-environment.ts` | `handle_query` 将 context 透传给 Agent | 确保 onMessageAdded 在 context 中 |

#### 5.6.2 ServerEnvironment 事件规则（initEventRules）

| 事件类型 | 文件 | 改动说明 |
|----------|------|----------|
| `USER_QUERY` | `server/environment.ts` | 主入口：onMessageAdded 回调逻辑改为 `session.addMessage(message)`，移除 assistantContent 分支 |
| `USER_QUERY` 流式/中断 | `server/environment.ts` | 流式结束、中断时的 `addAssistantMessage` 调用，可统一走 addMessage 或保留便捷方法 |
| `BACKGROUND_TASK_COMPLETED` | `server/environment.ts` | 通过 `processEventInSession` 调用 handle_query，需传入 onMessageAdded |
| `BACKGROUND_TASK_FAILED` | `server/environment.ts` | 同上 |
| `BACKGROUND_TASK_PROGRESS` | `server/environment.ts` | 同上 |
| `BACKGROUND_TASK_TIMEOUT` | `server/environment.ts` | 同上 |
| `BACKGROUND_TASK_STOPPED` | `server/environment.ts` | 同上 |
| `ENVIRONMENT_SWITCHED` | `server/environment.ts` | 切换环境事件，通过 `processEventInSession` 调用 handle_query |
| `*`（兜底） | `server/environment.ts` | 使用 EventHandlerAgent，需改造 EventHandlerAgent 的 onMessageAdded |

#### 5.6.3 EventProcessor 与 EventHandlerAgent

| 文件 | 改动说明 |
|------|----------|
| `core/event-processor.ts` | `processEventInSession` 调用 `handle_query` 时**未传 onMessageAdded**，需补充 `{ session_id, onMessageAdded }`；SessionLike 接口若需 addMessage 则扩展 |
| `core/agent/event-handler-agent.ts` | 兜底事件代理：构造 3 条 fake 消息后调用 handle_query，当前有完整 onMessageAdded 逻辑，改造为 `session.addMessage(message)` |

#### 5.6.4 Task 子会话相关

| 文件 | 改动说明 |
|------|----------|
| `core/environment/expend/task/subagent-manager.ts` | `executeWithTimeout` 中 `handle_query(query, { session_id }, history)` **未传 onMessageAdded**；子会话执行结果需实时写入 subSession，应补充 onMessageAdded |
| `core/environment/expend/task/background-task-manager.ts` | `executeWithTimeout` 中 `handle_query(prompt, { session_id: subSession.id }, subSession.toHistory())` **未传 onMessageAdded**；子任务产生的 assistant/tool 消息需写入 subSession |

#### 5.6.5 Session 压缩与 Compaction

| 文件 | 改动说明 |
|------|----------|
| `core/session/session.ts` | `compact()` 方法调用 `env.handle_query(fullPrompt, {}, llmHistory)`，用于总结对话；**无 session 回写需求**，可不传 onMessageAdded，但 context 类型需兼容 |
| `core/session/compaction.ts` | `CompactionEnv` 接口的 `handle_query` 签名，需与最终接口一致（context 可选、history 为 ModelMessage[]） |

#### 5.6.6 Examples 与 Demos

| 文件 | 改动说明 |
|------|----------|
| `examples/chat-demo.ts` | 使用 `session.toHistory()`、`handle_query`，若需持久化中间消息则传 onMessageAdded |
| `examples/chat-demo-win.ts` | 同上 |
| `examples/server-env-stream-demo.ts` | 同上 |
| `examples/compaction-demo.ts` | 使用 compaction，涉及 handle_query 调用 |

#### 5.6.7 单测文件（需同步更新）

| 文件 | 改动说明 |
|------|----------|
| `core/agent/onmessage-added.test.ts` | 回调参数类型改为 ModelMessage，断言更新 |
| `core/event-processor.test.ts` | mock Session 的 addAssistantMessageWithTool 等，改为 addMessage；handle_query 调用参数增加 onMessageAdded |
| `core/agent/event-handler-agent.test.ts` | 同上，mock Session 与 handle_query 参数 |
| `server/environment-interrupt.test.ts` | mock Session 的 addAssistantMessage，可保留或改为 addMessage |
| `core/environment/expend/task/task-tool.test.ts` | mock handle_query、Session.addUserMessage/addAssistantMessage |
| `core/environment/expend/task/background-task-notification.test.ts` | mock Session、handle_query |
| `core/environment/expend/task/background-task-manager.test.ts` | mock handle_query、Session |
| `core/event-processor.test.ts` | SessionLike 接口若扩展 addMessage，mock 需更新 |

#### 5.6.8 文档与类型定义

| 位置 | 改动说明 |
|------|----------|
| `docs/environment-event-mechanism.md` | 事件机制文档中的 handle_query、toHistory 示例 |
| `docs/environment-event-mechanism-implement.md` | 实现文档中的调用示例 |
| `core/environment/index.ts` | Environment 接口的 handle_query 定义已正确，无需改 |

#### 5.6.9 改造优先级建议

1. **P0（必须）**：session.ts、context.ts、agent/index.ts、server/environment.ts（USER_QUERY）、event-handler-agent.ts、event-processor.ts
2. **P1（重要）**：subagent-manager.ts、background-task-manager.ts（补充 onMessageAdded 以持久化子会话消息）
3. **P2（兼容）**：compaction、session.compact、examples
4. **P3（验证）**：全部单测文件

---

## 六、单测设计与说明

### 6.1 单测范围

| 模块 | 文件 | 测试重点 |
|------|------|----------|
| Agent.onMessageAdded | `core/agent/onmessage-added.test.ts` | 回调触发时机、消息格式、tool-call 场景 |
| handle_query 调用链 | `server/environment.ts` 相关 | context 传递、history 传递、onMessageAdded 注入 |
| Session.addMessage | `core/session/history-tool-calls.test.ts` 等 | ModelMessage 解析、存储正确性 |
| EventProcessor | `core/event-processor.test.ts` | handle_query 调用参数、history 透传 |
| EventHandlerAgent | `core/agent/event-handler-agent.test.ts` | 3 条 fake 消息 + handle_query 流程 |

### 6.2 单测设计要点

#### 6.2.1 handle_query 接口单测

**必须验证**:
- `context` 中 `onMessageAdded` 被正确传入并在 Agent 执行时被调用
- `history` 为 `ModelMessage[]` 格式，正确透传给 Agent
- 调用顺序：`addUserMessage` → `handle_query(..., context, history)` → `onMessageAdded` 多次调用 → 最终 `addAssistantMessage`

**Mock 示例**:
```typescript
const onMessageAdded = vi.fn();
await env.handle_query("query", { session_id: "s1", onMessageAdded }, history);
expect(onMessageAdded).toHaveBeenCalled();  // 至少被调用一次（assistant/tool 消息）
```

#### 6.2.2 onMessageAdded 回调单测

**场景覆盖**:
- 仅文本 assistant 消息
- 仅 tool-call assistant 消息
- 文本 + tool-call 混合 assistant 消息
- tool 结果消息
- 无 `onMessageAdded` 时 Agent 仍正常运行（不报错）

**参考**: `packages/core/src/core/agent/onmessage-added.test.ts`

#### 6.2.3 Session.addMessage 单测（改造后新增）

**验证点**:
- `ModelMessage` 各 role（user/assistant/tool/system）正确解析并存储
- `tool-call`、`tool-result` 等 ContentPart 信息不丢失
- `toHistory()` 返回的 `ModelMessage[]` 与写入一致

#### 6.2.4 集成单测

- USER_QUERY 事件 → Session 存储 → handle_query → onMessageAdded → Session 更新，端到端验证消息完整性
- 可复用 `event-handler-agent.test.ts`、`event-processor.test.ts` 的 mock 模式

### 6.3 改造前后单测变更

| 改造阶段 | 单测变更 |
|----------|----------|
| Phase 1: Session.addMessage | 新增 `Session.addMessage` 单测，补充 `toHistory` 断言 |
| Phase 2: onMessageAdded 简化 | 更新 `onmessage-added.test.ts` 中回调参数类型为 `ModelMessage` |
| Phase 3: Agent.notifyMessageAdded | 更新 `notifyMessageAdded` 调用处断言，确保传递 `ModelMessage` |
| Phase 4: 兼容代码清理 | 移除对旧方法的单测/ mock，确保无对废弃 API 的引用 |

---

## 七、总结

### 7.1 优化收益

1. **减少转换次数**: 从3次转换减少到1次
2. **代码简化**: 消除复杂的分支判断逻辑
3. **维护性提升**: 统一格式标准，修改影响范围小
4. **类型安全**: 统一使用AI SDK类型定义

### 7.2 实施建议

1. **分阶段实施**:
   - Phase 1: 改造Session.addMessage和toHistory
   - Phase 2: 简化onMessageAdded回调（保持 Context 中 onMessageAdded 设计）
   - Phase 3: 调整Agent.notifyMessageAdded
   - Phase 4: 优化稳定后，按 5.5 执行兼容代码移除与清理

2. **测试策略**:
   - 按 6.1～6.3 完成单测设计与补充
   - 现有功能回归测试
   - 消息完整性验证
   - 性能对比测试

3. **风险控制**:
   - 保持向后兼容
   - 逐步迁移
   - 充分日志记录
