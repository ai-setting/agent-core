# LLM Provider 架构设计

## 当前实现状态 ✅ 已完成基础架构

### 目录结构
```
src/llm/
├── index.ts              # 主入口
├── client.ts             # LLM Client
├── provider/
│   ├── index.ts         # Provider Factory
│   ├── registry.ts      # Provider 注册表
│   └── models.ts        # Provider/Model 定义
├── transform/
│   ├── index.ts         # Transform 主入口
│   ├── messages.ts      # 消息格式转换
│   └── options.ts       # Provider 参数转换
```

### 已支持的 Providers
- OpenAI ✅
- Anthropic ✅
- Google ✅
- Kimi (Moonshot) ✅
- DeepSeek ✅
- Mistral ✅
- Groq ✅
- xAI ✅
- Cerebras ✅
- DeepInfra ✅
- Together AI ✅
- Perplexity ✅
- Cohere ✅

---

## 1. 概述

本文档描述 Agent Core 的 LLM Provider 架构，基于 OpenCode 的最佳实践设计，支持多 Provider 扩展（OpenAI、Anthropic、Gemini、DeepSeek 等）。

### 设计目标

- **多 Provider 支持**：通过 AI SDK 抽象层支持 20+ LLM Provider
- **个性化适配**：通过 Transform Layer 处理各 Provider 的差异
- **可扩展性**：易于添加新的 Provider 和自定义配置
- **统一接口**：对上层提供一致的 LLM 调用接口

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Core                               │
├─────────────────────────────────────────────────────────────────┤
│  Agent / Tool / Environment (调用层)                             │
├─────────────────────────────────────────────────────────────────┤
│  LLM Module (统一接口层)                                          │
│  ┌──────────────────┐  ┌──────────────────────────────────┐    │
│  │ LLM Client       │  │ Tool Executor                    │    │
│  │ - chat()         │  │ - 工具调用协调                    │    │
│  │ - stream()       │  │ - 结果解析                      │    │
│  │ - embeddings()   │  │ - 重试逻辑                      │    │
│  └──────────────────┘  └──────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Provider Layer (Provider 抽象层)                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Provider Factory                                          │  │
│  │ - getProvider(model) → SDK Instance                      │  │
│  │ - Provider Registry (bundled + custom)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Transform Layer (格式转换层)                              │  │
│  │ - message(): 消息格式标准化                               │  │
│  │ - options(): Provider 特定参数                          │  │
│  │ - schema(): Tool Schema 转换                            │  │
│  │ - temperature/topP/topK: 默认参数                        │  │
│  │ - error(): 错误规范化                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  AI SDK Layer (SDK 抽象层)                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ @ai-sdk/openai (OpenAI, Azure, OpenRouter)               │  │
│  │ @ai-sdk/anthropic (Claude)                               │  │
│  │ @ai-sdk/google (Gemini)                                  │  │
│  │ @ai-sdk/openai-compatible (Kimi, DeepSeek, 1Panel)        │  │
│  │ @ai-sdk/amazon-bedrock                                   │  │
│  │ ... 20+ Providers                                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 目录结构

```
src/
├── llm/
│   ├── index.ts              # 主入口，导出 LLM Client
│   ├── client.ts             # LLM Client 实现
│   │
│   ├── provider/             # Provider 抽象层
│   │   ├── index.ts          # Provider Factory
│   │   ├── registry.ts       # Provider 注册表
│   │   ├── models.ts         # Provider/Model 定义
│   │   └── config.ts         # Provider 配置
│   │
│   ├── transform/            # Transform Layer
│   │   ├── index.ts          # Transform 主入口
│   │   ├── messages.ts      # 消息格式转换
│   │   ├── options.ts        # Provider 参数转换
│   │   ├── schema.ts         # Tool Schema 转换
│   │   └── errors.ts         # 错误规范化
│   │
│   └── tools/               # 工具相关
│       ├── definitions.ts    # Tool 定义
│       ├── executor.ts       # Tool 调用执行
│       └── parser.ts         # Tool Call/Result 解析
│
├── environment/
│   └── base/
│       ├── base-environment.ts    # BaseEnvironment (使用 LLM Client)
│       └── invoke-llm.ts          # invoke_llm 工具 (使用 Transform Layer)
```

## 4. 核心组件设计

### 4.1 Provider Registry

```typescript
// src/llm/provider/registry.ts

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createMistral } from "@ai-sdk/mistral";
import { createGroq } from "@ai-sdk/groq";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createCohere } from "@ai-sdk/cohere";
import { createXai } from "@ai-sdk/xai";
import { createCerebras } from "@ai-sdk/cerebras";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createPerplexity } from "@ai-sdk/perplexity";
import type { Provider as SDK } from "ai";

export interface ProviderConfig {
  id: string;
  name: string;
  npmPackage: string;
  factory: (options: Record<string, unknown>) => SDK;
  defaultBaseURL?: string;
  defaultModel?: string;
  customLoader?: CustomLoader;
}

export interface CustomLoader {
  autoload: boolean;
  options?: Record<string, unknown>;
  getModel?: (sdk: SDK, modelID: string, options?: Record<string, unknown>) => Promise<unknown>;
}

const BUNDLED_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npmPackage: "@ai-sdk/openai",
    factory: createOpenAI as any,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npmPackage: "@ai-sdk/anthropic",
    factory: createAnthropic as any,
    defaultBaseURL: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
  },
  google: {
    id: "google",
    name: "Google",
    npmPackage: "@ai-sdk/google",
    factory: createGoogleGenerativeAI as any,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
  },
  "openai-compatible": {
    id: "openai-compatible",
    name: "OpenAI Compatible",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as any,
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    npmPackage: "@ai-sdk/mistral",
    factory: createMistral as any,
    defaultBaseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  groq: {
    id: "groq",
    name: "Groq",
    npmPackage: "@ai-sdk/groq",
    factory: createGroq as any,
    defaultBaseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as any,
    defaultBaseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    customLoader: {
      autoload: false,
      options: {},
    },
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as any,
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    customLoader: {
      autoload: false,
      options: {},
    },
  },
  // ... 其他 providers
};

export function getProviderConfig(providerID: string): ProviderConfig | undefined {
  return BUNDLED_PROVIDERS[providerID];
}

export function listProviders(): ProviderConfig[] {
  return Object.values(BUNDLED_PROVIDERS);
}
```

### 4.2 Transform Layer

```typescript
// src/llm/transform/index.ts

import type { ModelMessage } from "ai";
import type { Provider } from "../provider/models.js";
import { message as messageTransform } from "./messages.js";
import { options as optionsTransform } from "./options.js";
import { temperature, topP, topK } from "./parameters.js";
import { schema as schemaTransform } from "./schema.js";
import { normalizeError } from "./errors.js";

export interface TransformContext {
  model: Provider.Model;
  providerOptions?: Record<string, unknown>;
}

export interface TransformResult<T> {
  value: T;
  providerOptions?: Record<string, unknown>;
}

export namespace LLMTransform {
  export function transformMessages(
    messages: ModelMessage[],
    model: Provider.Model,
    options?: Record<string, unknown>,
  ): ModelMessage[] {
    return messageTransform(messages, model, options);
  }

  export function transformOptions(
    input: {
      model: Provider.Model;
      sessionID?: string;
      providerOptions?: Record<string, unknown>;
    },
  ): Record<string, unknown> {
    return optionsTransform(input);
  }

  export function transformTemperature(model: Provider.Model): number | undefined {
    return temperature(model);
  }

  export function transformTopP(model: Provider.Model): number | undefined {
    return topP(model);
  }

  export function transformTopK(model: Provider.Model): number | undefined {
    return topK(model);
  }

  export function transformSchema(
    schema: Record<string, unknown> | unknown,
    model: Provider.Model,
  ): Record<string, unknown> {
    return schemaTransform(schema, model);
  }

  export function transformError(providerID: string, error: Error): string {
    return normalizeError(providerID, error);
  }
}
```

### 4.3 Message Transform

```typescript
// src/llm/transform/messages.ts

import type { ModelMessage } from "ai";
import type { Provider } from "../provider/models.js";

export function message(
  msgs: ModelMessage[],
  model: Provider.Model,
  _options?: Record<string, unknown>,
): ModelMessage[] {
  const npm = model.api.npm;

  // Anthropic: 过滤空内容
  if (npm === "@ai-sdk/anthropic") {
    msgs = msgs
      .map((msg) => {
        if (typeof msg.content === "string") {
          if (msg.content === "") return undefined;
          return msg;
        }
        if (!Array.isArray(msg.content)) return msg;
        const filtered = msg.content.filter((part) => {
          if (part.type === "text" || part.type === "reasoning") {
            return part.text !== "";
          }
          return true;
        });
        if (filtered.length === 0) return undefined;
        return { ...msg, content: filtered };
      })
      .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "");
  }

  // Claude: toolCallId 规范化（只允许字母数字下划线）
  if (model.api.id.includes("claude")) {
    msgs = msgs.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = msg.content.map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            return {
              ...part,
              toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
            };
          }
          return part;
        });
      }
      return msg;
    });
  }

  // Mistral: toolCallId 必须是 9 位数字
  if (model.providerID === "mistral" || model.api.id.toLowerCase().includes("mistral")) {
    msgs = msgs.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = msg.content.map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            const normalizedId = part.toolCallId
              .replace(/[^a-zA-Z0-9]/g, "")
              .substring(0, 9)
              .padEnd(9, "0");
            return { ...part, toolCallId: normalizedId };
          }
          return part;
        });
      }
      return msg;
    });
  }

  // Kimi/DeepSeek: tool_calls.arguments 已经是 JSON 字符串，无需额外处理
  // @ai-sdk/openai-compatible 会自动处理

  return msgs;
}
```

### 4.4 Options Transform

```typescript
// src/llm/transform/options.ts

import type { Provider } from "../provider/models.js";

export function options(input: {
  model: Provider.Model;
  sessionID?: string;
  providerOptions?: Record<string, unknown>;
}): Record<string, unknown> {
  const { model, sessionID } = input;
  const result: Record<string, unknown> = {};

  // OpenAI: 默认 store=false
  if (model.api.npm === "@ai-sdk/openai") {
    result["store"] = false;
  }

  // OpenRouter: include usage
  if (model.api.npm === "@openrouter/ai-sdk-provider") {
    result["usage"] = { include: true };
  }

  // Kimi: thinking 模式
  if (model.api.id.toLowerCase().includes("kimi-k2") && model.api.npm === "@ai-sdk/openai-compatible") {
    result["thinking"] = { type: "enabled", clear_thinking: false };
  }

  // Google: thinkingConfig
  if (model.api.npm === "@ai-sdk/google") {
    result["thinkingConfig"] = { includeThoughts: true };
  }

  // Session-based prompt caching
  if (sessionID && (model.api.npm === "@ai-sdk/openai" || model.providerID === "openai")) {
    result["promptCacheKey"] = sessionID;
  }

  return result;
}
```

### 4.5 Default Parameters

```typescript
// src/llm/transform/parameters.ts

import type { Provider } from "../provider/models.js";

export function temperature(model: Provider.Model): number | undefined {
  const id = model.id.toLowerCase();

  // Kimi 系列
  if (id.includes("kimi-k2")) {
    if (id.includes("thinking") || id.includes("k2.") || id.includes("k2p")) {
      return 1.0;
    }
    return 0.6;
  }

  // Qwen
  if (id.includes("qwen")) return 0.55;

  // Claude/Gemini: 使用默认值
  if (id.includes("claude") || id.includes("gemini")) return undefined;

  return undefined;
}

export function topP(model: Provider.Model): number | undefined {
  const id = model.id.toLowerCase();

  // Kimi/DeepSeek/MiniMax
  if (id.includes("kimi") || id.includes("minimax") || id.includes("deepseek")) {
    return 0.95;
  }

  // Gemini
  if (id.includes("gemini")) return undefined;

  return undefined;
}

export function topK(model: Provider.Model): number | undefined {
  const id = model.id.toLowerCase();

  // MiniMax
  if (id.includes("minimax")) {
    return id.includes("m2.1") ? 40 : 20;
  }

  // Gemini
  if (id.includes("gemini")) return 64;

  return undefined;
}
```

### 4.6 LLM Client

```typescript
// src/llm/client.ts

import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2Response } from "ai";
import type { ToolInfo, ToolResult } from "../types/tool.js";
import { LLMTransform, TransformContext } from "./transform/index.js";
import type { Provider } from "./provider/models.js";

export interface LLMClientOptions {
  model: string; // format: "provider/model" or just "model"
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  sessionID?: string;
}

export class LLMClient {
  private model: Provider.Model;
  private provider: Provider.Info;
  private languageModel: LanguageModelV2;
  private defaultOptions: Record<string, unknown>;

  constructor(options: LLMClientOptions) {
    // 解析 provider/model 格式
    const { providerID, modelID } = this.parseModel(options.model);

    // 获取 Provider 配置
    const providerConfig = Provider.getProvider(providerID);
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${providerID}`);
    }

    // 获取 Model 配置
    this.model = Provider.getModel(providerID, modelID);
    this.provider = providerConfig;

    // 创建 SDK 实例
    this.languageModel = Provider.getLanguageModel(this.model);

    // 计算默认参数
    this.defaultOptions = {
      temperature: LLMTransform.transformTemperature(this.model),
      topP: LLMTransform.transformTopP(this.model),
      topK: LLMTransform.transformTopK(this.model),
      maxTokens: options.maxTokens,
      ...LLMTransform.transformOptions({
        model: this.model,
        sessionID: options.sessionID,
      }),
    };
  }

  private parseModel(model: string): { providerID: string; modelID: string } {
    const parts = model.split("/");
    if (parts.length === 1) {
      return { providerID: "openai", modelID: model };
    }
    return { providerID: parts[0], modelID: parts.slice(1).join("/") };
  }

  async complete(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolInfo[],
  ): Promise<{ content: string; toolCalls?: Array<{ name: string; arguments: string }> }> {
    // 转换消息格式
    const modelMessages = this.convertMessages(messages);

    // 转换工具
    const sdkTools = tools?.map((t) => this.convertTool(t));

    // 构建选项
    const options: LanguageModelV2CallOptions = {
      mode: {
        type: "regular",
        tools: sdkTools,
      },
      ...this.defaultOptions,
    };

    // 调用
    const result = await this.languageModel.doCall({
      messages: modelMessages,
      ...options,
    });

    // 解析结果
    return this.parseResponse(result);
  }

  async *stream(
    messages: Array<{ role: string; content: string }>,
    tools?: ToolInfo[],
  ): AsyncGenerator<{ chunk: string; toolCalls?: Array<{ name: string; arguments: string }> }> {
    // 转换消息格式
    const modelMessages = this.convertMessages(messages);

    // 转换工具
    const sdkTools = tools?.map((t) => this.convertTool(t));

    // 构建选项
    const options: LanguageModelV2CallOptions = {
      mode: {
        type: "streaming",
        tools: sdkTools,
      },
      ...this.defaultOptions,
    };

    // 流式调用
    const result = await this.languageModel.doCall({
      messages: modelMessages,
      ...options,
    });

    for await (const chunk of result.output) {
      yield this.parseChunk(chunk);
    }
  }

  private convertMessages(
    messages: Array<{ role: string; content: string; name?: string }>,
  ): ModelMessage[] {
    const modelMessages: ModelMessage[] = messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant" | "tool",
      content: m.content,
      ...(m.name && { name: m.name }),
    }));

    return LLMTransform.transformMessages(modelMessages, this.model);
  }

  private convertTool(tool: ToolInfo): unknown {
    const schema = tool.parameters;
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: schema,
    };
  }

  private parseResponse(response: LanguageModelV2Response): {
    content: string;
    toolCalls?: Array<{ name: string; arguments: string }>;
  } {
    const content = response.messages
      .filter((m) => m.role === "assistant")
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return m.content
            .filter((p) => p.type === "text")
            .map((p) => (p as { type: "text"; text: string }).text)
            .join("");
        }
        return "";
      })
      .join("\n");

    const toolCalls = response.toolCalls?.map((tc) => ({
      name: tc.toolName,
      arguments: JSON.stringify(tc.input),
    }));

    return { content, toolCalls };
  }

  private parseChunk(chunk: unknown): { chunk: string; toolCalls?: Array<{ name: string; arguments: string }> } {
    // 简化处理，实际需要根据 AI SDK 的 chunk 类型处理
    return { chunk: JSON.stringify(chunk) };
  }
}
```

## 5. Provider 配置

### 5.1 环境变量配置

```bash
# 通用配置
LLM_MODEL=openai/gpt-4o

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# Anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Google
GOOGLE_API_KEY=...
GOOGLE_BASE_URL=https://generativelanguage.googleapis.com/v1beta

# Kimi/Moonshot
KIMI_API_KEY=...
KIMI_BASE_URL=https://api.moonshot.cn/v1

# DeepSeek
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

### 5.2 代码配置

```typescript
// 直接使用
const client = new LLMClient({
  model: "anthropic/claude-sonnet-4-20250514",
  apiKey: process.env.ANTHROPIC_API_KEY,
  sessionID: "session-123",
});

// 通过环境变量
const config = ProviderConfig.fromEnv("anthropic");
const client = new LLMClient({
  model: config.models[0],
  ...config.credentials,
});
```

## 6. Tool Executor 集成

```typescript
// src/llm/tools/executor.ts

import type { ToolInfo, ToolResult, ToolContext } from "../../types/tool.js";
import { LLMClient } from "../client.js";

export class ToolExecutor {
  private client: LLMClient;
  private tools: Map<string, ToolInfo>;

  constructor(client: LLMClient) {
    this.client = client;
    this.tools = new Map();
  }

  registerTool(tool: ToolInfo): void {
    this.tools.set(tool.name, tool);
  }

  async executeToolCall(
    toolCall: { name: string; arguments: Record<string, unknown> },
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    try {
      const result = await tool.execute(toolCall.arguments, context);
      return result;
    } catch (error) {
      return {
        success: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runWithTools(
    messages: Array<{ role: string; content: string }>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const toolInfos = Array.from(this.tools.values());

    const response = await this.client.complete(messages, toolInfos);

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        success: true,
        output: response.content,
      };
    }

    // 执行工具调用
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const args = JSON.parse(tc.arguments);
        return this.executeToolCall({ name: tc.name, arguments: args }, context);
      }),
    );

    // 构建工具结果消息
    const toolMessages = toolResults.map((r, i) => ({
      role: "tool" as const,
      content: r.success
        ? JSON.stringify({ result: r.output })
        : JSON.stringify({ error: r.error }),
      name: response.toolCalls![i].name,
    }));

    // 继续对话
    return this.runWithTools([...messages, ...toolMessages], context);
  }
}
```

## 7. BaseEnvironment 集成

```typescript
// src/environment/base/base-environment.ts

import { LLMClient } from "../../llm/client.js";
import { ToolExecutor } from "../../llm/tools/executor.js";
import { Provider } from "../../llm/provider/index.js";

export abstract class BaseEnvironment {
  private llmClient?: LLMClient;
  private toolExecutor?: ToolExecutor;

  protected configureLLM(model: string, apiKey?: string, baseURL?: string): void {
    this.llmClient = new LLMClient({
      model,
      apiKey,
      baseURL,
      sessionID: this.getSessionID(),
    });

    this.toolExecutor = new ToolExecutor(this.llmClient);

    // 注册内置工具
    this.registerBuiltInTools();
  }

  protected async configureLLMWithModel(model: string): Promise<void> {
    const { providerID, modelID } = this.parseModel(model);
    const provider = Provider.getProvider(providerID);

    if (!provider) {
      throw new Error(`Unknown provider: ${providerID}`);
    }

    const envVar = provider.envVars?.[0] || `${providerID.toUpperCase()}_API_KEY`;
    const apiKey = process.env[envVar];

    const baseURLEnvVar = `${providerID.toUpperCase()}_BASE_URL`;
    const baseURL = process.env[baseURLEnvVar] || provider.defaultBaseURL;

    this.configureLLM(`${providerID}/${modelID}`, apiKey, baseURL);
  }

  protected async invokeLLM(
    messages: Array<{ role: string; content: string }>,
    context: ToolContext,
  ): Promise<ToolResult> {
    if (!this.toolExecutor) {
      throw new Error("LLM not configured");
    }
    return this.toolExecutor.runWithTools(messages, context);
  }

  private parseModel(model: string): { providerID: string; modelID: string } {
    const parts = model.split("/");
    if (parts.length === 1) {
      return { providerID: "openai", modelID: model };
    }
    return { providerID: parts[0], modelID: parts.slice(1).join("/") };
  }

  private registerBuiltInTools(): void {
    // 注册其他工具
  }
}
```

## 8. 错误处理

```typescript
// src/llm/transform/errors.ts

export function normalizeError(providerID: string, error: Error): string {
  const message = error.message;

  // Anthropic 特定错误
  if (providerID === "anthropic") {
    if (message.includes("overloaded")) {
      return "Anthropic 服务暂时繁忙，请稍后重试";
    }
    if (message.includes("rate limit")) {
      return "已达到 Anthropic 速率限制，请降低请求频率";
    }
  }

  // OpenAI 特定错误
  if (providerID === "openai") {
    if (message.includes("invalid_api_key")) {
      return "API Key 无效，请检查配置";
    }
    if (message.includes("insufficient_quota")) {
      return "API 配额已用完，请检查账户余额";
    }
  }

  // Kimi/DeepSeek
  if (providerID === "kimi" || providerID === "deepseek") {
    if (message.includes("invalid api key")) {
      return "API Key 无效，请检查配置";
    }
  }

  return message;
}
```

## 9. 迁移指南

### 9.1 从纯 fetch 迁移

**旧代码** (`invoke-llm.ts`):
```typescript
const response = await fetch(`${config.baseURL}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages, tools }),
});
```

**新代码** (`client.ts`):
```typescript
const client = new LLMClient({ model: "openai/gpt-4o" });
const result = await client.complete(messages, tools);
```

### 9.2 Kimi tool_calls 格式问题

**问题**: Kimi 返回的 `tool_calls.arguments` 是纯字符串，不是 JSON 字符串

**解决方案**: Transform Layer 会自动处理，通过 `@ai-sdk/openai-compatible` Provider

```typescript
// 不需要手动处理
// AI SDK + Transform Layer 自动处理
```

### 9.3 自定义 Provider

```typescript
// src/llm/provider/registry.ts

const CUSTOM_PROVIDERS: Record<string, ProviderConfig> = {
  custom: {
    id: "custom",
    name: "Custom Provider",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as any,
    defaultBaseURL: "https://api.custom.com/v1",
    defaultModel: "custom-model",
  },
};
```

## 10. 测试策略

### 10.1 单元测试

```typescript
// test/unit/transform/messages.test.ts

describe("Message Transform", () => {
  test("should filter empty content for Anthropic", () => {
    const model = { api: { npm: "@ai-sdk/anthropic" } } as Provider.Model;
    const messages = [
      { role: "user", content: "" },
      { role: "user", content: "Hello" },
    ];

    const result = message(messages, model);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello");
  });
});
```

### 10.2 集成测试

```typescript
// test/integration/provider.test.ts

describe("Provider Integration", () => {
  test("should work with OpenAI", async () => {
    const client = new LLMClient({
      model: "openai/gpt-4o",
      apiKey: process.env.OPENAI_API_KEY,
    });

    const result = await client.complete([
      { role: "user", content: "Hello" },
    ]);

    expect(result.content).toBeTruthy();
  });
});
```

## 11. 依赖

```json
{
  "dependencies": {
    "ai": "^2.0.0",
    "@ai-sdk/openai": "^3.0.0",
    "@ai-sdk/openai-compatible": "^2.0.0",
    "@ai-sdk/anthropic": "^3.0.0",
    "@ai-sdk/google": "^3.0.0",
    "@ai-sdk/mistral": "^3.0.0",
    "@ai-sdk/groq": "^3.0.0",
    "@ai-sdk/deepinfra": "^3.0.0",
    "@ai-sdk/cohere": "^3.0.0",
    "@ai-sdk/xai": "^3.0.0",
    "@ai-sdk/cerebras": "^3.0.0",
    "@ai-sdk/togetherai": "^3.0.0",
    "@ai-sdk/perplexity": "^3.0.0"
  }
}
```

## 12. 参考资料

- [OpenCode Provider Implementation](thirdparty/opencode/packages/opencode/src/provider/provider.ts)
- [OpenCode Transform Implementation](thirdparty/opencode/packages/opencode/src/provider/transform.ts)
- [AI SDK Documentation](https://v5.ai-sdk.dev/)
- [AI SDK Provider Packages](https://v5.ai-sdk.dev/providers)

---

## 附录：快速开始

### 基本用法

```typescript
import { createLLMClient } from "./llm/index.js";

const client = createLLMClient({
  model: "openai/gpt-4o",
});

const response = await client.complete([
  { role: "user", content: "Hello!" },
]);

console.log(response.content);
```

### 多 Provider 示例

```typescript
// Kimi
const kimi = createLLMClient({
  model: "kimi/kimi-k2.5",
});

// Anthropic
const claude = createLLMClient({
  model: "anthropic/claude-sonnet-4-20250514",
});
```

### 查看可用 Providers

```typescript
import { listAvailableProviders } from "./llm/provider/index.js";

const providers = listAvailableProviders();
console.log(providers);
// [
//   { id: "openai", name: "OpenAI", defaultModel: "gpt-4o" },
//   { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
//   ...
// ]
```
