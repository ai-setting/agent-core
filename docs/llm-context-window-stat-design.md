# LLM Context Window 实时统计功能设计

## 1. 概述

实现 LLM Context Window 实时统计功能，能够追踪每个会话（Session）的 token 消耗情况，包括输入/输出 token 数量、累计使用量、以及相对于模型上下文窗口的使用百分比。

---

## 2. 目标

1. **配置层面**：在 `providers.jsonc` 中支持为每个模型配置 `limits`（contextWindow、maxOutputTokens、maxInputTokens）
2. **Provider 元数据**：从配置中读取模型 limits 并存入 provider metadata
3. **Session 统计**：在 Session 层累加每次 LLM 调用的 usage 数据并持久化
4. **事件传递**：在流式事件 `completed` 中携带 usage 信息

---

## 3. 配置层面 (`packages/core/src/config/sources/providers.ts`)

### 3.1 ModelLimits 接口

```typescript
export interface ModelLimits {
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Maximum input tokens (if different from contextWindow) */
  maxInputTokens?: number;
}
```

### 3.2 ProviderConfig 扩展

在 `ProviderConfig` 中添加 `limits` 字段（每个 provider 下以 modelId 为 key）：

```typescript
export interface ProviderConfig {
  // ... existing fields
  /** Model limits configuration, keyed by modelId */
  limits?: Record<string, ModelLimits>;
}
```

### 3.3 使用示例

```jsonc
// providers.jsonc
{
  "providers": {
    "anthropic": {
      "name": "Anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-sonnet-4-20250514"],
      "limits": {
        "claude-sonnet-4-20250514": {
          "contextWindow": 200000,
          "maxOutputTokens": 8192
        }
      }
    }
  }
}
```

> **注意**：`limits` 是配置在每个 provider 下面的，key 是具体的 modelId，value 是该模型的限制配置。

### 3.4 OpenAI 兼容厂商 Usage 配置

对于 OpenAI 兼容的厂商（如 DeepSeek、ZhipuAI、Kimi 等），limits 配置方式相同：

```jsonc
// providers.jsonc
{
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "baseURL": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat"],
      "limits": {
        "deepseek-chat": {
          "contextWindow": 64000,
          "maxOutputTokens": 8192
        }
      }
    },
    "zhipuai": {
      "name": "ZhipuAI",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZHIPUAI_API_KEY}",
      "models": ["glm-4"],
      "limits": {
        "glm-4": {
          "contextWindow": 128000,
          "maxOutputTokens": 8192
        }
      }
    },
    "kimi": {
      "name": "Kimi",
      "baseURL": "https://api.moonshot.cn/v1",
      "apiKey": "${MOONSHOT_API_KEY}",
      "models": ["moonshot-v1-8k"],
      "limits": {
        "moonshot-v1-8k": {
          "contextWindow": 128000,
          "maxOutputTokens": 8192
        }
      }
    }
  }
}
```

> **注意**：Vercel AI SDK 的 `streamOptions.includeUsage: true` 选项在大多数 OpenAI 兼容厂商的流式响应中都会返回 usage 信息。如果特定厂商不支持，可通过在 `providerOptions` 中配置额外的请求参数来获取。

---

## 4. Provider 元数据扩展 (`packages/core/src/llm/provider-manager.ts`)

### 4.1 从配置读取 limits

```typescript
// 在 ProviderManager.getModel() 方法中
// config.limits 是一个 Record，key 是 modelId，value 是 ModelLimits
return {
  id: modelId,
  capabilities,
  // Read limits from provider config, fallback to default
  // config.limits?.[modelId] - 根据 modelId 查找对应的 limits
  limits: config.limits?.[modelId] || {
    contextWindow: 8192, // Default value
  },
};
```

---

## 5. Session 统计 (`packages/core/src/core/session/types.ts` & `session.ts`)

### 5.1 ContextUsage 类型定义

```typescript
/**
 * Context usage statistics for tracking token usage across session
 */
export interface ContextUsage {
  /** Total input tokens used */
  inputTokens: number;
  /** Total output tokens used */
  outputTokens: number;
  /** Total tokens used (input + output) */
  totalTokens: number;
  /** Context window limit (from model configuration) */
  contextWindow?: number;
  /** Usage percentage relative to context window */
  usagePercent?: number;
  /** Number of LLM requests made */
  requestCount: number;
  /** Last updated timestamp */
  lastUpdated: number;
}
```

### 5.2 SessionInfo 扩展

```typescript
export interface SessionInfo {
  // ... existing fields
  /** Context usage statistics */
  contextUsage?: ContextUsage;
}
```

### 5.3 Session 方法

```typescript
class Session {
  /**
   * Get context usage statistics for this session.
   */
  getContextStats(): ContextUsage | undefined {
    return this._info.contextUsage;
  }

  /**
   * Update context usage statistics with new usage data from an LLM response.
   * This method accumulates usage across multiple requests within the session.
   */
  updateContextUsage(
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    limit?: number
  ): void {
    // 累加 usage 到现有统计
    // 计算使用百分比
    // 持久化到 Storage
  }
}
```

---

## 6. Stream 事件扩展 (`packages/core/src/core/environment/index.ts` & `invoke-llm.ts`)

### 6.1 StreamEvent 扩展

```typescript
export interface StreamEvent {
  type: string;
  content?: string;
  delta?: string;
  reasoning?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  error?: string;
  code?: string;
  metadata?: Record<string, unknown>;
  // 新增 usage 字段
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}
```

### 6.2 UsageInfo 类型

```typescript
export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

### 6.3 StreamEventHandler 扩展

```typescript
export interface StreamEventHandler {
  onStart?: (metadata: { model: string }) => void;
  onText?: (content: string, delta: string) => void;
  onReasoning?: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => void;
  onCompleted?: (content: string, metadata: { 
    model: string;
    usage?: UsageInfo;  // 新增
  }) => void;
}
```

---

## 7. 实现细节 (`packages/core/src/core/environment/base/invoke-llm.ts`)

### 7.1 启用 Usage 信息

```typescript
// 在调用 streamText 时启用 includeUsage
// 注意：这是 AI SDK 的通用选项，对 OpenAI 和 OpenAI 兼容厂商都有效
const result = await streamText({
  ...providerOptions,
  abortSignal: ctx.abort,
  maxRetries: 2,
  // Enable usage info in stream completion
  streamOptions: {
    includeUsage: true,
  },
});
```

### 7.2 捕获 Usage 信息

```typescript
// 在流处理中从 finish 事件捕获
case "finish":
  if (streamPart.totalUsage) {
    usageInfo = {
      inputTokens: streamPart.totalUsage.inputTokens ?? 0,
      outputTokens: streamPart.totalUsage.outputTokens ?? 0,
      totalTokens: streamPart.totalUsage.totalTokens ?? 0,
    };
  }
  break;
```

### 7.3 触发 onCompleted 回调

```typescript
// 无论是否有 tool calls 都触发 onCompleted
if (eventHandler?.onCompleted) {
  eventHandler.onCompleted(fullContent, { 
    model: `${providerId}/${modelId}`,
    usage: usageInfo
  });
}
```

---

## 8. BaseEnvironment 集成 (`packages/core/src/core/environment/base/base-environment.ts`)

### 8.1 onCompleted 回调中更新 Session

```typescript
onCompleted: async (content, metadata) => {
  this.emitStreamEvent({ 
    type: "completed", 
    content, 
    metadata,
    usage: metadata.usage 
  }, ctx);
  
  // Update session context usage stats if usage info is available
  if (metadata.usage && ctx.session_id) {
    const { Session } = await import("../../session/session.js");
    const session = Session.get(ctx.session_id);
    if (session) {
      session.updateContextUsage(metadata.usage);
    }
  }
},
```

---

## 9. 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/config/sources/providers.ts` | 新增 `ModelLimits` 接口，`ProviderConfig` 添加 `limits` 字段 |
| `packages/core/src/llm/provider-manager.ts` | 从配置读取 model limits 到 metadata |
| `packages/core/src/core/environment/index.ts` | `StreamEvent` 添加 `usage` 字段 |
| `packages/core/src/core/environment/base/invoke-llm.ts` | 添加 `UsageInfo` 类型，启用 `includeUsage`，捕获 usage 并传递给 onCompleted |
| `packages/core/src/core/environment/base/base-environment.ts` | 在 onCompleted 回调中更新 Session context usage |
| `packages/core/src/core/session/types.ts` | 新增 `ContextUsage` 类型，`SessionInfo` 添加 `contextUsage` 字段 |
| `packages/core/src/core/session/session.ts` | 新增 `getContextStats()` 和 `updateContextUsage()` 方法 |

---

## 10. 使用示例

### 10.1 配置模型 limits

```jsonc
// ~/.config/tong_work/agent-core/providers.jsonc
{
  "providers": [
    {
      "provider": "anthropic",
      "apiKey": "${auth:anthropic}",
      "models": [
        { "id": "claude-sonnet-4-20250514" },
        { "id": "claude-opus-4-5-20250514" }
      ],
      "limits": {
        "claude-sonnet-4-20250514": {
          "contextWindow": 200000,
          "maxOutputTokens": 8192
        },
        "claude-opus-4-5-20250514": {
          "contextWindow": 200000,
          "maxOutputTokens": 8192
        }
      }
    }
  ]
}
```

### 10.2 获取 Session 统计

```typescript
const session = Session.get(sessionId);
const stats = session.getContextStats();

console.log(stats);
// {
//   inputTokens: 15000,
//   outputTokens: 3000,
//   totalTokens: 18000,
//   contextWindow: 200000,
//   usagePercent: 9,
//   requestCount: 5,
//   lastUpdated: 1700000000000
// }
```

---

## 11. 注意事项

1. **默认值**：如果未配置 limits，默认 contextWindow 为 8192
2. **累加逻辑**：每次 LLM 调用会累加到现有统计，不是覆盖
3. **持久化**：usage 统计会随 Session 一起持久化到 SQLite
4. **异步更新**：onCompleted 是异步的，避免阻塞流式响应

---

## 12. 不同 SDK 类型的 Usage 支持

### 12.1 SDK 类型与 Usage 支持

| SDK Type | Provider 示例 | Usage 支持方式 |
|----------|--------------|----------------|
| `openai` | OpenAI 官方 | `streamOptions.includeUsage: true` |
| `anthropic` | Anthropic Claude | 通过响应头 `xanthropic-input-tokens` 等获取 |
| `google` | Google Gemini | `streamOptions.includeUsage: true` |
| `openai-compatible` | DeepSeek/ZhipuAI/Kimi 等 | `streamOptions.includeUsage: true`（大多数兼容） |

### 12.2 Usage 获取失败处理

如果特定 provider 不支持 usage 获取，系统会优雅降级：

```typescript
// 在 invoke-llm.ts 中
case "finish":
  // 尝试获取 usage，可能返回 undefined
  if (streamPart.totalUsage) {
    usageInfo = {
      inputTokens: streamPart.totalUsage.inputTokens ?? 0,
      outputTokens: streamPart.totalUsage.outputTokens ?? 0,
      totalTokens: streamPart.totalUsage.totalTokens ?? 0,
    };
  } else {
    // Provider 不支持 usage，优雅降级
    invokeLLMLogger.warn("[invokeLLM] Provider does not support usage in stream", {
      providerId,
      modelId
    });
  }
  break;
```

### 12.3 厂商兼容性参考

- **OpenAI**: 完全支持 `includeUsage`
- **Anthropic**: 使用不同的 API 机制，AI SDK 已处理
- **DeepSeek**: 支持 `includeUsage`
- **ZhipuAI (GLM)**: 支持 `includeUsage`
- **Kimi (Moonshot)**: 支持 `includeUsage`
- **Ollama (本地)**: 部分模型支持，需要测试
