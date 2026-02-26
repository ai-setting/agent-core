# LLM Interleaved Reasoning 处理机制

> 本文档记录 agent-core 如何处理具有推理能力的 LLM 模型（如 Kimi k2.5、DeepSeek R1）的 reasoning content。

## 问题背景

某些具有推理能力的 LLM 模型（如 Kimi k2.5、DeepSeek R1、Qwen3 等）会在响应中输出推理内容（thinking/reasoning）。这些内容通常以两种方式呈现：

1. **分离式**：reasoning 内容在单独的字段中（如 `reasoning_content`）
2. **交错式（Interleaved）**：reasoning 内容与常规内容交错在一起

对于交错式模型，AI SDK 需要特殊处理，否则会出现错误：

```
AI_APICallError: thinking is enabled but reasoning_content is missing 
in assistant tool call message at index 2
```

## 解决方案

我们采用 opencode 的配置驱动方案，通过 `capabilities.interleaved` 字段来标识需要特殊处理的模型。

## 类型定义

```typescript
// packages/core/src/llm/types.ts

/**
 * Interleaved reasoning configuration
 * For models that output reasoning/thinking content interleaved with regular content
 */
export interface InterleavedReasoning {
  /** Field name for reasoning content in provider options */
  field: "reasoning_content" | "reasoning_details";
}

export interface ModelCapabilities {
  // ... other capabilities ...
  
  /** 
   * Interleaved reasoning configuration
   * When present, reasoning content will be extracted from messages and placed
   * in the specified field of providerOptions
   */
  interleaved?: InterleavedReasoning;
}
```

## 配置示例

在 `tong_work.jsonc` 中配置具有推理能力的模型：

```jsonc
{
  "providers": {
    "kimi": {
      "baseURL": "https://api.moonshot.cn/v1",
      "apiKey": "${auth:kimi-api-key}",
      "defaultModel": "kimi-k2.5",
      "capabilities": {
        "reasoning": true,
        "toolcall": true,
        // 启用 interleaved reasoning 处理
        "interleaved": {
          "field": "reasoning_content"
        }
      }
    },
    "deepseek": {
      "baseURL": "https://api.deepseek.com/v1",
      "apiKey": "${auth:deepseek-api-key}",
      "defaultModel": "deepseek-chat",
      "capabilities": {
        "reasoning": true,
        "interleaved": {
          "field": "reasoning_content"
        }
      }
    }
  }
}
```

## 实现机制

### 1. 消息转换（transform.ts）

在 `normalizeMessages` 函数中检查模型的 `interleaved` 配置：

```typescript
// packages/core/src/llm/transform.ts

export function normalizeMessages(
  messages: ModelMessage[],
  provider: ProviderMetadata,
  model: ModelMetadata
): ModelMessage[] {
  let result = [...messages];

  // Handle interleaved reasoning for models with reasoning capability
  if (model.capabilities.interleaved?.field) {
    result = handleInterleavedReasoning(result, model);
  }

  return result;
}
```

### 2. Reasoning 提取

`handleInterleavedReasoning` 函数负责：

1. 扫描 assistant 消息中的 reasoning 内容
2. 提取 `type: "reasoning"` 的 parts
3. 提取 `<think>` 标签包裹的文本
4. 将 reasoning 内容放入 `providerOptions.openaiCompatible[field]`
5. 从消息内容中移除 reasoning parts

```typescript
function handleInterleavedReasoning(
  msgs: ModelMessage[],
  model: ModelMetadata
): ModelMessage[] {
  const field = model.capabilities.interleaved?.field;
  
  return msgs.map((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      return msg;
    }

    // 提取 reasoning parts
    const reasoningParts: string[] = [];
    const otherParts: any[] = [];

    for (const part of msg.content as any[]) {
      if (part.type === "reasoning") {
        reasoningParts.push(part.text);
      } else if (part.type === "text" && part.text?.startsWith("<think>")) {
        // 从 <think> 标签中提取 reasoning
        const reasoning = part.text.slice(7, -8);
        reasoningParts.push(reasoning);
      } else {
        otherParts.push(part);
      }
    }

    // 将 reasoning 放入 providerOptions
    if (reasoningParts.length > 0) {
      const reasoningText = reasoningParts.join("\n");
      return {
        ...msg,
        content: otherParts,
        providerOptions: {
          ...msg.providerOptions,
          openaiCompatible: {
            [field]: reasoningText,
          },
        },
      };
    }

    return msg;
  });
}
```

## 支持 interleaved reasoning 的模型

| 模型 | Provider | interleaved.field |
|------|----------|-------------------|
| Kimi k2.5 | kimi | `reasoning_content` |
| DeepSeek R1 | deepseek | `reasoning_content` |
| Qwen3 | alibaba-cn | `reasoning_content` |
| QwQ | alibaba-cn | `reasoning_content` |
| GLM-4.6 | zhipuai | `reasoning_content` |

## 参考实现

本实现参考了 opencode 的 provider transform 设计：

- [opencode/packages/opencode/src/provider/transform.ts](https://github.com/opencode-ai/opencode/blob/main/packages/opencode/src/provider/transform.ts)
- [opencode/packages/opencode/src/provider/models.ts](https://github.com/opencode-ai/opencode/blob/main/packages/opencode/src/provider/models.ts)

## 调试

启用 DEBUG 日志查看 reasoning content 处理：

```bash
# Windows PowerShell
$env:LOG_LEVEL="DEBUG"; bun run start

# Linux/macOS
LOG_LEVEL=DEBUG bun run start
```

日志关键词：
- `[normalizeMessages] Applying interleaved reasoning handler`
- `[handleInterleavedReasoning] Adding reasoning to providerOptions`

## 常见问题

### Q: 为什么需要移除 reasoning parts？
A: AI SDK 在处理 tool-call 时会验证消息格式。如果 assistant 消息包含 reasoning content 但没有正确放入 providerOptions，API 会报错。

### Q: 可以支持其他 field 名称吗？
A: 可以，目前支持 `reasoning_content` 和 `reasoning_details` 两种。某些 provider 可能使用不同的字段名。

### Q: 是否所有 reasoning 模型都需要这个配置？
A: 不是。只有那些 output reasoning 与 regular content 交错的模型才需要。例如：
- Claude 3.7 Sonnet：使用独立的 `thinking` providerOption，不需要 interleaved
- Kimi k2.5：reasoning 与 content 交错，需要 interleaved 配置

## 更新历史

- **2026-02-26**: 初始实现，支持 Kimi k2.5 和 DeepSeek R1
- 参考 opencode 架构，采用配置驱动的设计
