# Session 上下文自动压缩实现方案

## 一、需求概述

实现对话上下文自动压缩功能，当 session 的 token 使用量达到一定阈值时，自动创建新 session 并保留摘要信息，形成压缩链条。

### 核心目标

1. **动态阈值判断**：根据模型 context window 动态计算压缩阈值
2. **自动压缩**：达到阈值时自动创建压缩 session
3. **压缩链条**：支持多层压缩，形成可追溯的 session 链
4. **透明切换**：前端无需感知压缩过程，始终使用原 session ID

---

## 二、架构设计

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────────────┐
│                        压缩触发层                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ SessionContextManager                                   │    │
│  │ - 监听 updateContextUsage                               │    │
│  │ - 判断是否触发压缩                                       │    │
│  │ - 协调压缩流程                                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        压缩执行层                                │
│  ┌───────────────────┐  ┌───────────────────┐                   │
│  │ SessionCompaction │  │ SummaryGenerator  │                   │
│  │ - 创建压缩session  │  │ - 调用LLM生成摘要  │                   │
│  │ - 链接压缩链条     │  │ - 提取关键信息     │                   │
│  └───────────────────┘  └───────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        存储层                                    │
│  ┌───────────────────┐  ┌───────────────────┐                   │
│  │ Session Storage   │  │ SQLite Persistence │                   │
│  │ - 压缩链追踪      │  │ - 元数据持久化     │                   │
│  └───────────────────┘  └───────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据结构扩展

#### SessionInfo 扩展

```typescript
interface SessionInfo {
  id: string;
  parentID?: string;
  // ... 现有字段
  
  // ===== 新增字段 =====
  /** 压缩链信息 */
  compactionChain?: {
    /** 原始 session ID（压缩链顶端） */
    rootSessionId: string;
    /** 压缩产生的 session 标记 */
    isCompressedSession: boolean;
    /** 上一个压缩 session ID */
    previousSessionId?: string;
    /** 压缩级别（0=原始, 1=第一次压缩, 2=第二次压缩...） */
    compactionLevel: number;
    /** 压缩时间戳 */
    compactedAt?: number;
  };
  
  /** 模型上下文限制（用于压缩阈值计算） */
  modelContextLimit?: number;
}
```

#### ContextUsage 扩展

```typescript
interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  usagePercent: number;
  requestCount: number;
  lastUpdated: number;
  
  // ===== 新增字段 =====
  /** 是否已触发压缩 */
  compacted?: boolean;
  /** 压缩后的新 session ID */
  compactedSessionId?: string;
}
```

---

## 三、详细设计

### 3.1 配置读取 - Model Limits

#### 3.1.1 ProviderConfig 扩展

```typescript
// config/sources/providers.ts

export interface ModelLimits {
  contextWindow: number;
  maxOutputTokens?: number;
  maxInputTokens?: number;
  
  // ===== 新增字段 =====
  /** 压缩阈值百分比（默认 80%） */
  compactionThreshold?: number;
}

export interface ProviderConfig {
  // ... 现有字段
  limits?: Record<string, ModelLimits>;
}
```

#### 3.1.2 默认配置

```typescript
// 默认压缩阈值
const DEFAULT_COMPACTION_THRESHOLD = 0.8; // 80%
const DEFAULT_CONTEXT_WINDOW = 200000;    // 200K tokens
```

#### 3.1.3 获取 Model Limits

```typescript
// 新建文件: core/session/model-limits.ts

import { loadProvidersConfig } from "../config/sources/providers.js";

export class ModelLimitsManager {
  private limitsCache: Map<string, ModelLimits> = new Map();
  
  async getLimits(modelId: string): Promise<ModelLimits> {
    // 1. 检查缓存
    if (this.limitsCache.has(modelId)) {
      return this.limitsCache.get(modelId)!;
    }
    
    // 2. 从 providers.jsonc 加载
    const config = await loadProvidersConfig();
    if (config?.providers) {
      for (const provider of Object.values(config.providers)) {
        if (provider.limits?.[modelId]) {
          const limits = provider.limits[modelId];
          this.limitsCache.set(modelId, limits);
          return limits;
        }
      }
    }
    
    // 3. 返回默认值
    return {
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    };
  }
  
  getCompactionThreshold(modelId: string, limits: ModelLimits): number {
    return limits.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  }
}

export const modelLimitsManager = new ModelLimitsManager();
```

---

### 3.2 压缩触发逻辑

#### 3.2.1 修改 updateContextUsage

```typescript
// core/session/session.ts

export class Session {
  // ... 现有方法
  
  updateContextUsage(usage: UsageInfo, limit?: number): void {
    // 1. 获取模型限制
    const modelLimits = this.getModelLimits();
    const contextWindow = limit || modelLimits?.contextWindow || DEFAULT_CONTEXT_WINDOW;
    const threshold = modelLimits?.compactionThreshold || DEFAULT_COMPACTION_THRESHOLD;
    
    // 2. 计算使用率
    const usagePercent = (usage.totalTokens / contextWindow) * 100;
    
    // 3. 更新 usage（现有逻辑）
    this.doUpdateContextUsage(usage, contextWindow);
    
    // 4. 检查是否触发压缩（新增逻辑）
    if (usagePercent >= threshold * 100 && !this._info.contextUsage?.compacted) {
      // 异步触发压缩，不阻塞主流程
      this.triggerCompaction().catch(err => {
        console.error(`[Session] Compaction failed:`, err);
      });
    }
  }
}
```

#### 3.2.2 压缩触发器

```typescript
// core/session/session.ts - 新增方法

private async triggerCompaction(): Promise<void> {
  // 1. 检查是否正在压缩，避免重复触发
  if (this._info.contextUsage?.compacted) {
    return;
  }
  
  // 2. 标记为正在压缩
  this._info.contextUsage = {
    ...this._info.contextUsage!,
    compacted: true,
  };
  
  // 3. 获取环境引用（通过事件或存储）
  const env = await this.getEnvironment();
  if (!env) {
    console.warn(`[Session] No environment available for compaction`);
    return;
  }
  
  // 4. 执行压缩
  const compactedSession = await this.compact(env, {
    keepMessages: 20,
  });
  
  // 5. 建立压缩链接
  await this.linkCompactionChain(compactedSession);
  
  // 6. 更新当前 session 的压缩标记
  this._info.contextUsage.compactedSessionId = compactedSession.id;
  Storage.saveSession(this);
}

private async getEnvironment(): Promise<BaseEnvironment | null> {
  // TODO: 需要根据实际架构实现
  // 可以通过事件总线或依赖注入获取
  return null;
}
```

---

### 3.3 压缩执行 - SessionCompaction

#### 3.3.1 压缩调用 LLM 的方式

压缩直接使用 `env.invokeLLM` 接口来调用 LLM 生成摘要（不需要启动完整的 Agent run）：

```typescript
// core/session/session.ts - compact 方法中
import type { ModelMessage } from "ai";
import type { ToolInfo, Context, LLMOptions } from "../environment/types.js";

async compact(
  env: {
    // 直接调用 invokeLLM，一次 LLM 调用即可生成摘要
    invokeLLM: (
      messages: ModelMessage[], 
      tools?: ToolInfo[], 
      context?: Context, 
      options?: LLMOptions
    ) => Promise<ToolResult>;
  },
  options?: CompactionOptions
): Promise<Session> {
  // ... 构建摘要消息数组
  
  let summary = "Session summary unavailable";
  try {
    // 直接调用 invokeLLM，一次 LLM 调用完成摘要生成
    const result = await env.invokeLLM(
      [
        {
          role: "user",
          content: {
            type: "text",
            text: fullPrompt
          }
        }
      ],
      [],  // 不需要 tools
      { session_id: this.id },  // 传入 session_id
      {
        // 限制输出长度
        maxTokens: 2000,
        // 可选：使用更小的模型进行摘要（更快速、更便宜）
        model: options?.summaryModel,
      }
    );
    
    if (result.success && result.output) {
      // 尝试解析 JSON 摘要
      try {
        const parsed = JSON.parse(result.output);
        summary = this.formatSummaryAsText(parsed);
      } catch {
        // JSON 解析失败，使用原始输出
        summary = result.output;
      }
    }
  } catch (err) {
    console.warn(`[Session] Compaction LLM call failed:`, err);
  }
  
  // ...
}
```

**优点**：
- 一次 LLM 调用即可完成
- 不触发 agent run，没有中间步骤
- 不产生额外的 session 消息
- 更快、更节省资源

#### 3.3.2 压缩使用的 System Prompt

```typescript
// 压缩摘要提示词模板

const COMPACTION_PROMPT_TEMPLATE = `你是一个对话摘要专家。请仔细阅读以下对话历史，然后生成一个简洁的JSON格式摘要。

## 摘要要求

请按照以下JSON格式输出：
{
  "user_intent": "用户的主要需求或问题",
  "key_decisions": ["关键决定1", "关键决定2"],
  "current_status": "当前任务的进度或状态",
  "next_steps": ["待完成的步骤1", "待完成的步骤2"],
  "important_context": ["重要的上下文信息1", "重要的上下文信息2"]
}

## 对话历史

{{HISTORY}}

## 输出要求

1. 只输出JSON，不要有其他文字
2. 如果某个字段没有信息，使用空数组 [] 或 "无"
3. 保持简洁，每项不超过50个字
4. 重要上下文应该包含：使用的工具、修改的文件、重要的错误或解决方案

请生成摘要：`;

// 备用的简单提示词（如果JSON解析失败）
const COMPACTION_PROMPT_SIMPLE = `请用简洁的语言总结上面的对话，包含：
1. 用户的主要需求
2. 关键讨论点和决定
3. 当前状态和后续方向

=== 对话历史 ===
{{HISTORY}}
=== 结束 ===

请总结：`;
```

#### 3.3.3 压缩后新 Session 的消息结构

压缩完成后，新创建的 session 会包含以下消息：

```typescript
// 1. 系统消息 - 包含摘要信息
compactedSession.addSystemMessage(summary, {
  // 标记这是压缩产生的摘要
  isCompactionSummary: true,
  // 原始 session ID
  originalSessionId: this.id,
  // 压缩时间
  compactedAt: Date.now(),
  // 摘要了多少条消息
  summarizedMessageCount: messagesToSummarize.length,
});

// 2. 最新一次用户 query 及之后的所有消息（完整保留）
//    这样可以避免 tool result 没有对应 tool call 的问题
for (const msg of recentMessages) {
  compactedSession.addMessage(msg);
}
```

**消息结构示例**：

```
新 Session 消息:
├── [0] system: 摘要 JSON (user_intent, key_decisions, current_status, next_steps, important_context)
├── [1] user: 最新一次用户 query
├── [2] assistant: 对应的 assistant 回复
├── [3] tool: tool call (如果有)
├── [4] tool: tool result (如果有)
...
└── [N] (后续所有消息)
```

**为什么这样设计**：
- 只保留**最新一次用户 query 及之后的所有消息**，确保每条 tool result 都有对应的 tool call
- 避免出现保留的消息中只有 tool result 而没有 tool call 的情况，导致 LLM 理解出错

#### 3.3.4 完整的 compact 方法实现

```typescript
// core/session/session.ts
import type { ModelMessage } from "ai";
import type { ToolInfo, Context, LLMOptions, ToolResult } from "../environment/types.js";

@Traced({ name: "session.compact", log: true, recordParams: true, recordResult: false })
async compact(
  env: {
    // 直接调用 invokeLLM，一次 LLM 调用生成摘要
    invokeLLM: (
      messages: ModelMessage[], 
      tools?: ToolInfo[], 
      context?: Context, 
      options?: LLMOptions
    ) => Promise<ToolResult>;
  },
  options?: CompactionOptions
): Promise<Session> {
  // 1. 获取所有消息
  const allMessages = this.getMessages();
  
  // 2. 找到最后一次用户消息的位置，保留该消息及之后的所有消息
  //    这样可以避免保留的消息有 tool result 没有 tool call 的情况
  let lastUserMessageIndex = -1;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].info.role === "user") {
      lastUserMessageIndex = i;
      break;
    }
  }
  
  // 分离要摘要的消息和保留的消息
  const messagesToSummarize = lastUserMessageIndex > 0 
    ? allMessages.slice(0, lastUserMessageIndex) 
    : [];  // 如果没有更早的消息，就不需要摘要
  const recentMessages = allMessages.slice(lastUserMessageIndex);
  
  // 3. 构建对话历史文本（只对需要摘要的消息进行摘要）
  const historyText = this.buildHistoryText(messagesToSummarize);
  
  // 4. 构建压缩提示词
  const fullPrompt = COMPACTION_PROMPT_TEMPLATE.replace('{{HISTORY}}', historyText);
  
  // 5. 直接调用 invokeLLM 生成摘要（一次 LLM 调用）
  let summary = "Summary unavailable";
  try {
    const result = await env.invokeLLM(
      [
        {
          role: "user",
          content: {
            type: "text",
            text: fullPrompt
          }
        }
      ],
      [],  // 不需要 tools
      { session_id: this.id },
      {
        maxTokens: 2000,
        model: options?.summaryModel,
      }
    );
    
    if (result.success && result.output) {
      // 尝试解析 JSON，如果失败则使用原始结果
      try {
        const parsed = JSON.parse(result.output);
        summary = this.formatSummaryAsText(parsed);
      } catch {
        summary = result.output || summary;
      }
    }
  } catch (err) {
    console.warn(`[Session] Compaction LLM call failed:`, err);
  }
  
  // 6. 创建新的压缩 session
  const compactedSession = Session.create({
    parentID: this.id,
    title: `Compacted: ${this.title}`,
    directory: this._info.directory,
    metadata: {
      isCompressedSession: true,
      compactionLevel: ((this._info.metadata?.compactionLevel) as number || 0) + 1,
      rootSessionId: (this._info.metadata?.rootSessionId as string) || this.id,
      compactedAt: Date.now(),
    },
  });
  
  // 7. 添加摘要作为系统消息（带 metadata）
  compactedSession.addSystemMessage(summary, {
    isCompactionSummary: true,
    originalSessionId: this.id,
    compactedAt: Date.now(),
    summarizedMessageCount: messagesToSummarize.length,
  });
  
  // 8. 添加保留的最近消息
  for (const msg of recentMessages) {
    compactedSession.addMessage({
      ...msg.info,
      id: ID.ascending("message"), // 重新生成 ID
      sessionID: compactedSession.id,
    }, msg.parts.map(p => ({ ...p, id: ID.ascending("part") })));
  }
  
  // 9. 持久化
  Storage.saveSession(compactedSession);
  
  return compactedSession;
}

// 辅助方法：构建历史文本
private buildHistoryText(messages: MessageWithParts[]): string {
  return messages.map(msg => {
    const parts = msg.parts.map(part => {
      if (part.type === "text") return (part as TextPart).text;
      if (part.type === "tool") {
        const tool = part as ToolPart;
        const output = tool.output 
          ? tool.output.substring(0, 500) + (tool.output.length > 500 ? "..." : "")
          : "(pending)";
        return `[Tool: ${tool.tool}] ${output}`;
      }
      if (part.type === "reasoning") {
        return `[Reasoning] ${(part as ReasoningPart).text}`;
      }
      if (part.type === "file") {
        return `[File] ${(part as FilePart).filename || (part as FilePart).url}`;
      }
      return "";
    }).filter(Boolean).join("\n");
    
    const role = msg.info.role === "assistant" ? "AI" : msg.info.role;
    return `[${role}] ${parts}`;
  }).join("\n\n---\n\n");
}

// 辅助方法：将 JSON 摘要格式化为可读文本
private formatSummaryAsText(parsed: any): string {
  const parts = [];
  
  if (parsed.user_intent) {
    parts.push(`用户需求: ${parsed.user_intent}`);
  }
  
  if (parsed.key_decisions && parsed.key_decisions.length > 0) {
    parts.push(`关键决定: ${parsed.key_decisions.join(", ")}`);
  }
  
  if (parsed.current_status) {
    parts.push(`当前状态: ${parsed.current_status}`);
  }
  
  if (parsed.next_steps && parsed.next_steps.length > 0) {
    parts.push(`后续步骤: ${parsed.next_steps.join(", ")}`);
  }
  
  if (parsed.important_context && parsed.important_context.length > 0) {
    parts.push(`重要上下文: ${parsed.important_context.join(", ")}`);
  }
  
  return parts.join("\n");
}
```

#### 3.3.5 压缩后 Session 的消息示例

压缩后，新 session 的消息结构如下：

```json
{
  "messages": [
    {
      "id": "msg_new_001",
      "sessionID": "ses_new_xxx",
      "role": "system",
      "timestamp": 1773443918000,
      "metadata": {
        "isCompactionSummary": true,
        "originalSessionId": "ses_old_xxx",
        "compactedAt": 1773443918000,
        "summarizedMessageCount": 45
      },
      "parts": [
        {
          "id": "prt_new_001",
          "type": "text",
          "text": "用户需求: 帮我实现一个用户登录功能\n关键决定: 使用JWT令牌，前端存储在localStorage\n当前状态: 登录API已完成，后端接口已就绪\n后续步骤: 实现登出功能，添加token刷新机制\n重要上下文: 使用了bcrypt加密，session存储在Redis"
        }
      ]
    },
    {
      "id": "msg_new_002",
      "sessionID": "ses_new_xxx",
      "role": "user",
      "timestamp": 1773443918500,
      "parts": [{"type": "text", "text": "hello"}]
    },
    {
      "id": "msg_new_003",
      "sessionID": "ses_new_xxx", 
      "role": "assistant",
      "timestamp": 1773443919000,
      "parts": [{"type": "text", "text": "你好！有什么可以帮你的？"}]
    }
  ]
}
```

#### 3.3.6 CompactionOptions 扩展

```typescript
// core/session/types.ts 或 session.ts

export interface CompactionOptions {
  /** 
   * 是否保留最新一次用户 query 及之后的所有消息（默认: true）
   * 设为 true 可避免保留的消息有 tool result 没有 tool call 的情况
   */
  keepFromLastUserMessage?: boolean;
  /** 自定义提示词 */
  customPrompt?: string;
  /** 备用提示词（当自定义提示词解析失败时使用）*/
  fallbackPrompt?: string;
  /** 是否自动压缩（自动压缩使用更保守的策略）*/
  auto?: boolean;
  /** 用于摘要生成的模型（可选，默认使用当前会话模型）*/
  summaryModel?: string;
}
```

---

### 3.4 压缩链管理

#### 3.4.1 建立压缩链接

```typescript
// core/session/session.ts - 新增方法

private async linkCompactionChain(newSession: Session): Promise<void> {
  // 1. 获取根 session ID
  const rootSessionId = this._info.metadata?.rootSessionId as string || this.id;
  
  // 2. 更新新 session 的压缩链信息
  newSession._info.metadata = {
    ...newSession._info.metadata,
    rootSessionId,
    isCompressedSession: true,
    previousSessionId: this.id,
    compactionLevel: (this._info.metadata?.compactionLevel as number || 0) + 1,
    compactedAt: Date.now(),
  };
  
  // 3. 保存新 session
  Storage.saveSession(newSession);
  
  // 4. 更新当前 session，指向新 session
  this._info.contextUsage = {
    ...this._info.contextUsage!,
    compacted: true,
    compactedSessionId: newSession.id,
  };
  Storage.saveSession(this);
}
```

#### 3.4.2 获取压缩链末端 Session

```typescript
// core/session/session.ts - 新增静态方法

static getLatestSession(sessionId: string): Session {
  let current = Storage.getSession(sessionId);
  
  while (current) {
    const nextSessionId = current._info.contextUsage?.compactedSessionId;
    if (!nextSessionId) {
      break; // 没有更多压缩，找到末端
    }
    
    const next = Storage.getSession(nextSessionId);
    if (!next) {
      break; // session 不存在，停止追踪
    }
    
    current = next;
  }
  
  return current;
}
```

---

### 3.5 所有获取 Session 的地方需要透明切换

#### 3.5.1 修改 Session.get

```typescript
// core/session/session.ts - 修改静态方法 get

static get(id: string, followChain: boolean = true): Session | undefined {
  const session = Storage.getSession(id);
  
  if (!session || !followChain) {
    return session;
  }
  
  // 透明跟随压缩链，找到最新的 session
  return Session.getLatestSession(id);
}
```

#### 3.5.2 需要修改的调用点

| 文件 | 方法 | 修改方式 |
|------|------|---------|
| `routes/sessions.ts` | `prompt` | 使用 `Session.get(id, true)` |
| `eventbus/events/session.ts` | 事件处理 | 使用 `Session.get(id, true)` |
| `base-environment.ts` | `invokeLLM` | 使用 `Session.get(id, true)` |
| `wrap-function.ts` | traced session | 使用 `Session.get(id, true)` |

---

### 3.6 Usage 读写切换

#### 3.6.1 写入时切换

```typescript
// core/environment/base/invoke-llm.ts

// 修改 usage 更新逻辑
if (session) {
  // 自动跟随压缩链，获取最新的 session 进行写入
  const latestSession = Session.getLatestSession(session.id);
  
  latestSession.updateContextUsage(usage, contextWindowLimit);
}
```

#### 3.6.2 读取时切换

```typescript
// 任何读取 contextUsage 的地方都应该自动获取最新 session 的数据

function getSessionUsage(sessionId: string): ContextUsage | undefined {
  const latestSession = Session.getLatestSession(sessionId);
  return latestSession?.getContextStats();
}
```

---

### 3.7 前端兼容层

#### 3.7.1 API 层处理

```typescript
// routes/sessions.ts

app.get('/api/sessions/:id', async (req, res) => {
  const { id } = req.params;
  
  // 前端传入的是原始 session ID，但我们需要获取最新的
  const latestSession = Session.getLatestSession(id);
  
  res.json({
    id: id,              // 返回原始 ID 给前端
    latestId: latestSession.id,  // 实际使用的 ID
    // ... 其他字段
  });
});
```

#### 3.7.2 SSE 事件推送

```typescript
// 推送事件时也使用原始 session ID
sseEmitter.send({
  type: 'usage_update',
  sessionId: originalSessionId,  // 保持前端看到的 ID
  data: latestSession.getContextStats(),
});
```

---

## 四、压缩流程完整时序图

```
用户发送消息
     │
     ▼
┌─────────────────────────────────────────────┐
│ env.handle_query → agent.run                 │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ env.invokeLLM                               │
│   - 调用 LLM                                │
│   - 获取 usage                              │
└─────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────┐
│ session.updateContextUsage(usage, limit)   │
│   - 计算 usagePercent                       │
│   - 判断是否 >= 阈值 (默认80%)              │
└─────────────────────────────────────────────┘
     │
     ├──────────────────┐
     │                  │
  usagePercent < 80%   usagePercent >= 80%
     │                  │
     ▼                  ▼
┌─────────────┐   ┌─────────────────────────────────────┐
│ 正常返回    │   │ 触发自动压缩                         │
└─────────────┘   └─────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────────┐
              │ 检查是否已压缩    │
              └───────────────────┘
                      │
             ┌────────┴────────┐
             │                 │
          已压缩            未压缩
             │                 │
             ▼                 ▼
         忽略/递归        ┌─────────────────┐
         检查            │ 执行压缩        │
                         └─────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 1. 获取最近N条消息  │
                    │ 2. 调用LLM生成摘要  │
                    │ 3. 创建新session    │
                    │ 4. 添加摘要+最近消息│
                    │ 5. 持久化           │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 建立压缩链          │
                    │ - 记录rootSessionId│
                    │ - 记录compactionLevel│
                    │ - 更新previousSessionId│
                    │ - 设置compactedSessionId│
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ 切换到新session     │
                    │ (后续usage写入新session)│
                    └─────────────────────┘
```

---

## 五、配置文件示例

### providers.jsonc 扩展

```jsonc
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "limits": {
        "gpt-4o": {
          "contextWindow": 200000,
          "maxOutputTokens": 16384,
          "compactionThreshold": 0.8
        },
        "gpt-4o-mini": {
          "contextWindow": 200000,
          "maxOutputTokens": 16384,
          "compactionThreshold": 0.8
        }
      }
    },
    "anthropic": {
      "name": "Anthropic",
      "baseURL": "https://api.anthropic.com",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-3-5-sonnet-20241022"],
      "limits": {
        "claude-3-5-sonnet-20241022": {
          "contextWindow": 200000,
          "maxOutputTokens": 8192,
          "compactionThreshold": 0.75
        }
      }
    }
  }
}
```

---

## 六、关键实现文件清单

| 序号 | 文件路径 | 修改类型 | 说明 |
|------|----------|---------|------|
| 1 | `config/sources/providers.ts` | 扩展 | 添加 compactionThreshold 字段 |
| 2 | `core/session/model-limits.ts` | 新建 | ModelLimitsManager 类 |
| 3 | `core/session/types.ts` | 扩展 | 添加压缩链相关类型 |
| 4 | `core/session/session.ts` | 修改 | 添加压缩触发、压缩链管理 |
| 5 | `core/session/compaction.ts` | 修改 | 增强压缩逻辑 |
| 6 | `core/environment/base/invoke-llm.ts` | 修改 | usage 更新时自动跟随压缩链 |
| 7 | `server/routes/sessions.ts` | 修改 | 获取 session 时跟随压缩链 |
| 8 | `server/eventbus/events/session.ts` | 修改 | 事件处理时跟随压缩链 |

---

## 七、测试用例设计

### 7.1 单元测试

1. **ModelLimitsManager**
   - 测试从 providers.jsonc 正确读取 limits
   - 测试缓存机制
   - 测试默认值 fallback

2. **Session.compact**
   - 测试压缩后消息数量
   - 测试摘要生成
   - 测试压缩链信息正确设置

3. **Session.getLatestSession**
   - 测试单层压缩链
   - 测试多层压缩链
   - 测试链中断情况

### 7.2 集成测试

1. **自动压缩流程**
   - 模拟多次 LLM 调用
   - 验证达到阈值触发压缩
   - 验证压缩后 usage 写入新 session

2. **压缩链透明性**
   - 验证前端使用原始 session ID
   - 验证实际数据来自压缩后的 session

---

## 八、潜在问题与解决

### 8.1 并发压缩

**问题**：多个请求同时触发压缩

**解决**：使用 `compacted` 标记防止重复触发；使用分布式锁

### 8.2 压缩循环

**问题**：压缩后 usage 仍然超过阈值

**解决**：压缩时保留最近的完整消息，降低新 session 的初始 usage

### 8.3 压缩失败

**问题**：LLM 调用失败导致压缩中断

**解决**：添加重试机制；失败时记录日志但不影响正常流程

### 8.4 压缩链过长

**问题**：压缩次数过多导致链路过长

**解决**：设置最大压缩级别（如 10 级）；超过后不再压缩

---

## 九、配置参数汇总

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_CONTEXT_WINDOW` | 200000 | 默认上下文窗口 (200K) |
| `DEFAULT_COMPACTION_THRESHOLD` | 0.8 | 默认压缩阈值 (80%) |
| `DEFAULT_KEEP_MESSAGES` | 20 | 压缩时保留的消息数 |
| `DEFAULT_KEEP_RECENT_MESSAGES` | 5 | 压缩时保留的最近完整消息数 |
| `MAX_COMPACTION_LEVEL` | 10 | 最大压缩级别 |

---

## 十、总结

本方案通过以下核心设计实现上下文自动压缩：

1. **ModelLimitsManager** - 统一管理模型限制配置
2. **自动触发机制** - 在 `updateContextUsage` 中判断阈值
3. **压缩链条** - 通过 `rootSessionId` 和 `compactionLevel` 追踪压缩历史
4. **透明切换** - 所有获取 session 的地方自动跟随压缩链
5. **前端兼容** - API 层保持原始 session ID 不变

这样可以实现：用户无感知的情况下自动压缩长对话，保证系统稳定运行。
