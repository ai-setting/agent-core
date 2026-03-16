# MiniMax Thinking 标签 Text Delta 处理实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 invoke_llm 流式处理中，从 text-delta 检测并提取 `<thinking></thinking>` 标签内容，触发 reasoning 事件，并从最终输出中移除 thinking 标签。

**Architecture:** 通过 providers.jsonc 配置 `thinkingTags` 字段，标识模型是否将 thinking 放到 text delta 中。在 invoke-llm.ts 流式处理时，检测配置的标签格式，提取 thinking 内容并触发 onReasoning 事件，同时净化输出内容。

**Tech Stack:** TypeScript, AI SDK, Vercel AI SDK Provider

---

## 方案设计

### 1. 配置扩展

在 `ModelCapabilities` 中添加新配置项：

```typescript
// packages/core/src/llm/types.ts

export interface ModelCapabilities {
  // ... existing fields ...
  
  /** 
   * Thinking 标签配置（用于从 text delta 中提取 thinking 内容）
   * 某些 provider 如 MiniMax 2.5 会将 thinking 放到 text delta 中
   * 需要配置要检测的标签格式
   */
  thinkingInText?: {
    /** 是否启用从 text delta 中提取 thinking */
    enabled: boolean;
    /** thinking 标签格式数组，支持自定义标签如 ['thinking', 'reasoning', 'reflection'] */
    tags?: string[];
    /** 是否从输出中移除 thinking 标签内容（默认 true） */
    removeFromOutput?: boolean;
  };
}
```

### 2. 配置示例

```jsonc
// tong_work.jsonc
{
  "provider": {
    "minimax": {
      "defaultModel": "abab6.5s",
      "capabilities": {
        "reasoning": true,
        "toolcall": true,
        "thinkingInText": {
          "enabled": true,
          "tags": ["thinking", "reasoning"],
          "removeFromOutput": true
        }
      }
    }
  }
}
```

### 3. 实现位置

核心修改在 `packages/core/src/core/environment/base/invoke-llm.ts`：
- 在 `text-delta` 处理分支中添加标签检测逻辑
- 添加 `processThinkingFromText` 函数处理标签提取
- 修改最终输出构建逻辑，确保移除 thinking 内容

---

## 文件修改清单

| 文件 | 操作 | 描述 |
|------|------|------|
| `packages/core/src/llm/types.ts` | 修改 | 添加 `thinkingInText` 配置类型 |
| `packages/core/src/config/sources/providers.ts` | 修改 | 解析 thinkingInText 配置 |
| `packages/core/src/core/environment/base/invoke-llm.ts` | 修改 | 流式处理中添加 thinking 标签检测和提取 |
| `packages/core/src/llm/transform.test.ts` | 修改 | 添加测试用例 |

---

## 实现步骤

### Task 1: 添加 thinkingInText 配置类型

**Files:**
- Modify: `packages/core/src/llm/types.ts:30-50`

- [ ] **Step 1: 在 ModelCapabilities 接口中添加 thinkingInText 配置**

```typescript
// packages/core/src/llm/types.ts
// 在 ModelCapabilities 接口中添加

export interface ModelCapabilities {
  // ... existing fields ...

  /** 
   * Thinking 标签配置（用于从 text delta 中提取 thinking 内容）
   * 某些 provider 如 MiniMax 2.5 会将 thinking 放到 text delta 中
   * 需要配置要检测的标签格式
   */
  thinkingInText?: {
    /** 是否启用从 text delta 中提取 thinking */
    enabled: boolean;
    /** thinking 标签格式数组，支持自定义标签如 ['thinking', 'reasoning', 'reflection'] */
    tags?: string[];
    /** 是否从输出中移除 thinking 标签内容（默认 true） */
    removeFromOutput?: boolean;
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/llm/types.ts
git commit -m "feat(llm): add thinkingInText config to ModelCapabilities"
```

---

### Task 2: 解析 thinkingInText 配置

**Files:**
- Modify: `packages/core/src/config/sources/providers.ts`

- [ ] **Step 1: 查看现有 providers.ts 配置解析逻辑**

```bash
# 查看如何解析 capabilities
grep -n "capabilities" packages/core/src/config/sources/providers.ts | head -20
```

- [ ] **Step 2: 添加 thinkingInText 配置解析**

在 capabilities 解析部分添加 thinkingInText 字段的处理。

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/config/sources/providers.ts
git commit -m "feat(config): parse thinkingInText from providers.jsonc"
```

---

### Task 3: 实现 thinking 标签检测和提取逻辑

**Files:**
- Modify: `packages/core/src/core/environment/base/invoke-llm.ts:385-450`

- [ ] **Step 1: 添加 processThinkingFromText 辅助函数**

在 `invoke-llm.ts` 文件末尾添加：

```typescript
/**
 * 从 text delta 中检测并提取 thinking 标签内容
 * 用于处理某些 provider 将 thinking 放到 text delta 的情况
 * 
 * @param textDelta 当前的 text delta
 * @param config thinkingInText 配置
 * @returns 提取后的结果：净化后的文本和 thinking 内容
 */
function processThinkingFromText(
  textDelta: string,
  config: {
    enabled: boolean;
    tags?: string[];
    removeFromOutput?: boolean;
  }
): { cleanedText: string; thinkingContent?: string } {
  if (!config.enabled || !textDelta) {
    return { cleanedText: textDelta };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let extractedThinking = '';

  for (const tag of tags) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    
    // 匹配标签内容（支持跨多个 delta 的情况，这里简化处理）
    const regex = new RegExp(`${openTag}([\\s\\S]*?)${closeTag}`, 'g');
    const matches = remainingText.match(regex);
    
    if (matches) {
      for (const match of matches) {
        // 提取标签内的内容
        const content = match.slice(openTag.length, -closeTag.length);
        extractedThinking += content;
        
        // 如果需要从输出中移除，则替换为空字符串
        if (config.removeFromOutput !== false) {
          remainingText = remainingText.replace(match, '');
        }
      }
    }
  }

  return {
    cleanedText: remainingText,
    thinkingContent: extractedThinking || undefined
  };
}
```

- [ ] **Step 2: 修改 text-delta 处理逻辑**

在 `for await (const part of result.fullStream)` 的 `text-delta` case 中：

```typescript
case "text-delta":
  const textDelta = streamPart.text as string;
  
  // 检查模型是否配置了 thinkingInText
  const modelThinkingConfig = modelMetadata?.capabilities?.thinkingInText;
  
  if (modelThinkingConfig?.enabled) {
    // 处理 thinking 标签提取
    const processed = processThinkingFromText(textDelta, modelThinkingConfig);
    
    // 更新 fullContent（使用净化后的文本）
    fullContent += processed.cleanedText;
    
    // 如果提取到 thinking 内容，触发 reasoning 事件
    if (processed.thinkingContent) {
      reasoningContent += processed.thinkingContent;
      if (eventHandler?.onReasoning) {
        eventHandler.onReasoning(reasoningContent);
      }
    }
    
    // 同时也触发 text 事件（使用净化后的文本）
    if (eventHandler?.onText) {
      eventHandler.onText(fullContent, processed.cleanedText);
    }
  } else {
    // 原有的处理逻辑
    fullContent += textDelta;
    if (eventHandler?.onText) {
      eventHandler.onText(fullContent, textDelta);
    }
  }
  break;
```

- [ ] **Step 3: 传递 modelMetadata 到流式处理中**

需要确保在流式处理循环中可以访问 modelMetadata（当前已通过 `modelMetadata` 变量可用）。

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/core/environment/base/invoke-llm.ts
git commit -m "feat(invoke-llm): extract thinking tags from text delta"
```

---

### Task 4: 编写测试用例

**Files:**
- Modify: `packages/core/src/llm/transform.test.ts` 或新建测试文件

- [ ] **Step 1: 编写 processThinkingFromText 单元测试**

```typescript
import { describe, it, expect } from 'vitest';

describe('processThinkingFromText', () => {
  // 需要从 invoke-llm.ts 导出这个函数进行测试
  // 或者将逻辑移到单独的模块中
  
  it('should extract thinking content from text delta', () => {
    // 测试用例
  });
  
  it('should remove thinking tags from output when enabled', () => {
    // 测试用例
  });
  
  it('should support custom tags', () => {
    // 测试用例
  });
});
```

- [ ] **Step 2: 运行测试验证**

```bash
npm test -- --run packages/core/src/llm/transform.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/llm/transform.test.ts
git commit -m "test: add thinkingInText processing tests"
```

---

### Task 5: 更新配置示例文档

**Files:**
- Modify: `docs/llm-interleaved-reasoning.md` 或新建文档

- [ ] **Step 1: 添加 thinkingInText 配置文档**

- [ ] **Step 2: Commit**

---

## 关键设计决策

1. **为什么在 invoke-llm.ts 而非 transform.ts 中处理？**
   - 因为这是流式处理时的事件转换，需要在 text-delta 产生时立即处理
   - transform.ts 主要处理消息规范化，在调用 LLM 前执行

2. **为什么支持多标签？**
   - 不同模型可能使用不同的标签格式（thinking, reasoning, reflection 等）
   - 通过配置化支持更多 provider

3. **是否需要考虑跨 delta 的标签？**
   - 简单实现假设标签在单个 delta 内完成
   - 如需支持跨 delta，需要维护状态（标签是否正在"打开"中）
   - 建议先实现简单版本，后续根据实际需求扩展

---

## 验证方式

1. 使用 MiniMax 2.5 模型进行实际测试
2. 验证：
   - 流式事件中 `reasoning` 事件正常触发
   - 最终 `output.content` 不包含 `<thinking>` 标签
   - `output.reasoning` 或单独的 reasoning 输出包含 thinking 内容
