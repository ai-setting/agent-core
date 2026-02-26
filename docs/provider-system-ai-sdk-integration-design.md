# Provider System with AI SDK Integration Design

## 概述

本文档描述如何将 opencode 的 Provider 系统和 Transform 机制引入 agent-core，同时保留现有的 `providers.jsonc` 配置机制，并使用 AI SDK 替换底层的 HTTP fetch 调用。

## 设计目标

1. **保留现有配置**：继续使用 `providers.jsonc` 定义 providers、models、apiKey、baseURL
2. **借鉴 opencode 架构**：引入 Provider 元数据管理和 Transform 转换层
3. **AI SDK 集成**：使用 `ai` SDK 替代原生 fetch 调用
4. **保持 Stream Event**：维持现有的 `onStart/onText/onReasoning/onToolCall/onCompleted` 事件机制

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     invoke_llm (入口)                        │
│  - 接收 LLMOptions + StreamEventHandler                     │
│  - 调用 ProviderManager 获取 Provider 实例                   │
│  - 调用 Transform 层处理消息转换                              │
│  - 使用 AI SDK 进行流式调用                                   │
│  - 触发 StreamEventHandler 回调                               │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  ProviderManager                             │
│  - 加载 providers.jsonc 配置                                │
│  - 解析环境变量（${ENV_VAR} → 实际值）                        │
│  - 创建 Provider 实例缓存                                    │
│  - 提供 getProvider(providerId) 接口                        │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    Provider 层                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   OpenAI     │  │  Anthropic   │  │   Custom     │       │
│  │  Provider    │  │   Provider   │  │  Provider    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  每个 Provider 包含：                                         │
│  - metadata: ProviderMetadata（能力、限制、成本）              │
│  - sdk: AI SDK Provider 实例                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   Transform 层                               │
│  - normalizeMessages(): 消息格式规范化                        │
│  - applyCaching(): 缓存控制参数注入                           │
│  - convertProviderOptions(): Provider 特定选项转换            │
│  - handleModelSpecifics(): 模型特殊处理                       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    AI SDK 层                                 │
│  - streamText(): 流式文本生成                                │
│  - generateObject(): 结构化输出                              │
│  - 统一的流式接口，屏蔽底层 HTTP 差异                          │
└─────────────────────────────────────────────────────────────┘
```

## 核心数据结构

### 1. ProviderMetadata（Provider 元数据）

```typescript
// packages/core/src/llm/types.ts

export interface ProviderMetadata {
  id: string;                    // 如 "zhipuai", "openai"
  name: string;                  // 显示名称
  description?: string;
  
  // API 配置
  baseURL: string;
  apiKey: string;               // 已解析后的实际值
  headers?: Record<string, string>;
  
  // 模型列表
  models: ModelMetadata[];
  defaultModel: string;
  
  // SDK 类型
  sdkType: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
}

export interface ModelMetadata {
  id: string;                   // 如 "glm-4", "gpt-4o"
  name?: string;
  
  // 能力声明（借鉴 opencode）
  capabilities: {
    temperature: boolean;       // 是否支持温度参数
    reasoning: boolean;         // 是否支持思考/推理
    toolcall: boolean;          // 是否支持工具调用
    attachment: boolean;        // 是否支持附件上传
    input: {
      text: boolean;
      image: boolean;
      audio: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      image: boolean;
      audio: boolean;
    };
  };
  
  // 限制
  limits: {
    contextWindow: number;      // 上下文窗口大小
    maxOutputTokens?: number;   // 最大输出 token
  };
  
  // 成本（可选）
  cost?: {
    input: number;              // 每 1K tokens 成本
    output: number;
  };
}
```

### 2. 扩展现有配置类型

```typescript
// packages/core/src/config/providers.ts（扩展现有类型）

export interface ProviderConfig {
  name: string;
  description?: string;
  baseURL: string;
  apiKey: string;              // 可以是 ${ENV_VAR} 格式
  models: string[];
  defaultModel: string;
  
  // 新增：SDK 类型声明
  sdkType?: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  
  // 新增：模型能力覆盖（可选）
  capabilities?: Partial<ModelMetadata['capabilities']>;
  
  // 新增：请求头
  headers?: Record<string, string>;
}
```

## 模块设计

### 1. ProviderManager（Provider 管理器）

```typescript
// packages/core/src/llm/provider-manager.ts

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export class ProviderManager {
  private providers: Map<string, ProviderInstance> = new Map();
  private metadata: Map<string, ProviderMetadata> = new Map();
  
  /**
   * 初始化：加载 providers.jsonc 并创建所有 Provider 实例
   */
  async initialize(): Promise<void> {
    const config = await loadProvidersConfig(); // 读取 providers.jsonc
    
    for (const [providerId, providerConfig] of Object.entries(config.providers)) {
      // 1. 解析环境变量
      const resolvedConfig = await this.resolveEnvVars(providerConfig);
      
      // 2. 创建 Provider 元数据
      const metadata = this.createMetadata(providerId, resolvedConfig);
      this.metadata.set(providerId, metadata);
      
      // 3. 创建 AI SDK Provider 实例
      const sdkProvider = this.createSDKProvider(resolvedConfig);
      
      // 4. 缓存 Provider 实例
      this.providers.set(providerId, {
        metadata,
        sdk: sdkProvider,
      });
    }
  }
  
  /**
   * 获取 Provider 实例
   */
  getProvider(providerId: string): ProviderInstance | undefined {
    return this.providers.get(providerId);
  }
  
  /**
   * 获取 Provider 元数据
   */
  getMetadata(providerId: string): ProviderMetadata | undefined {
    return this.metadata.get(providerId);
  }
  
  /**
   * 列出所有可用 Providers
   */
  listProviders(): ProviderMetadata[] {
    return Array.from(this.metadata.values());
  }
  
  /**
   * 解析环境变量占位符
   * "${ZHIPUAI_API_KEY}" → process.env.ZHIPUAI_API_KEY
   */
  private async resolveEnvVars(config: ProviderConfig): Promise<ResolvedProviderConfig> {
    const resolved = { ...config };
    
    if (config.apiKey.startsWith('${') && config.apiKey.endsWith('}')) {
      const envVar = config.apiKey.slice(2, -1);
      const value = process.env[envVar];
      if (!value) {
        throw new Error(`Environment variable ${envVar} not found for provider ${config.name}`);
      }
      resolved.apiKey = value;
    }
    
    return resolved as ResolvedProviderConfig;
  }
  
  /**
   * 根据 sdkType 创建对应的 AI SDK Provider
   */
  private createSDKProvider(config: ResolvedProviderConfig): any {
    const { sdkType, baseURL, apiKey, headers } = config;
    
    switch (sdkType) {
      case 'openai':
        return createOpenAI({ baseURL, apiKey, headers });
        
      case 'anthropic':
        return createAnthropic({ baseURL, apiKey, headers });
        
      case 'google':
        // 需要安装 @ai-sdk/google
        const { createGoogleGenerativeAI } = require('@ai-sdk/google');
        return createGoogleGenerativeAI({ baseURL, apiKey, headers });
        
      case 'openai-compatible':
      default:
        return createOpenAICompatible({
          name: config.name.toLowerCase().replace(/\s+/g, '-'),
          baseURL,
          apiKey,
          headers,
        });
    }
  }
  
  /**
   * 从配置创建 ProviderMetadata
   */
  private createMetadata(providerId: string, config: ResolvedProviderConfig): ProviderMetadata {
    return {
      id: providerId,
      name: config.name,
      description: config.description,
      baseURL: config.baseURL,
      apiKey: config.apiKey, // 注意：这里存的是解析后的值，实际使用时要小心安全
      headers: config.headers,
      sdkType: config.sdkType || 'openai-compatible',
      defaultModel: config.defaultModel,
      models: config.models.map(modelId => ({
        id: modelId,
        // 默认能力（可被配置覆盖）
        capabilities: {
          temperature: true,
          reasoning: false,
          toolcall: true,
          attachment: false,
          input: { text: true, image: false, audio: false, video: false, pdf: false },
          output: { text: true, image: false, audio: false },
          ...config.capabilities,
        },
        limits: {
          contextWindow: 8192, // 默认值
        },
      })),
    };
  }
}

interface ProviderInstance {
  metadata: ProviderMetadata;
  sdk: any; // AI SDK Provider 实例
}
```

### 2. Transform 层

```typescript
// packages/core/src/llm/transform.ts

import type { ModelMessage } from 'ai';
import type { ProviderMetadata, ModelMetadata } from './types.js';

export namespace LLMTransform {
  
  /**
   * 消息格式规范化
   * 处理不同厂商对消息格式的特殊要求
   */
  export function normalizeMessages(
    messages: ModelMessage[],
    provider: ProviderMetadata,
    model: ModelMetadata
  ): ModelMessage[] {
    let result = [...messages];
    
    // 根据 provider 类型应用不同的转换
    switch (provider.sdkType) {
      case 'anthropic':
        result = handleAnthropicMessages(result);
        break;
      case 'openai':
        result = handleOpenAIMessages(result);
        break;
      default:
        // openai-compatible 通常不需要特殊处理
        break;
    }
    
    // 模型特定处理
    if (model.id.includes('mistral')) {
      result = handleMistralMessages(result);
    }
    
    return result;
  }
  
  /**
   * Anthropic 特殊处理：
   * 1. 过滤空内容消息
   * 2. toolCallId 格式规范化
   */
  function handleAnthropicMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs
      .map(msg => {
        // 过滤空内容
        if (typeof msg.content === 'string' && msg.content === '') {
          return undefined;
        }
        
        // 过滤数组中的空内容
        if (Array.isArray(msg.content)) {
          const filtered = msg.content.filter(part => {
            if (part.type === 'text' || part.type === 'reasoning') {
              return part.text !== '';
            }
            return true;
          });
          if (filtered.length === 0) return undefined;
          msg = { ...msg, content: filtered };
        }
        
        // toolCallId 规范化：只保留字母数字和下划线
        if (Array.isArray(msg.content)) {
          msg.content = msg.content.map(part => {
            if ((part.type === 'tool-call' || part.type === 'tool-result') && 'toolCallId' in part) {
              return {
                ...part,
                toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_'),
              };
            }
            return part;
          });
        }
        
        return msg;
      })
      .filter((msg): msg is ModelMessage => msg !== undefined);
  }
  
  /**
   * Mistral 特殊处理：
   * 1. toolCallId 必须是9位字母数字
   * 2. tool 消息后面不能紧跟 user 消息
   */
  function handleMistralMessages(msgs: ModelMessage[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const nextMsg = msgs[i + 1];
      
      // 处理 toolCallId
      if (Array.isArray(msg.content)) {
        msg.content = msg.content.map(part => {
          if ((part.type === 'tool-call' || part.type === 'tool-result') && 'toolCallId' in part) {
            const normalizedId = part.toolCallId
              .replace(/[^a-zA-Z0-9]/g, '')  // 移除非字母数字
              .substring(0, 9)               // 只取9位
              .padEnd(9, '0');               // 不足补零
            return { ...part, toolCallId: normalizedId };
          }
          return part;
        });
      }
      
      result.push(msg);
      
      // Mistral 要求 tool 消息后面必须是 assistant 消息
      // 如果 tool 后面是 user，插入一个空的 assistant 消息
      if (msg.role === 'tool' && nextMsg?.role === 'user') {
        result.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
        });
      }
    }
    
    return result;
  }
  
  /**
   * OpenAI 特殊处理
   */
  function handleOpenAIMessages(msgs: ModelMessage[]): ModelMessage[] {
    // 目前 OpenAI 兼容性最好，通常不需要特殊处理
    return msgs;
  }
  
  /**
   * 生成 Provider 特定选项
   * 处理不同厂商的参数命名差异
   */
  export function generateProviderOptions(
    provider: ProviderMetadata,
    model: ModelMetadata,
    options: {
      temperature?: number;
      maxTokens?: number;
      variant?: string;  // 如 "high", "max" 等思考强度
    }
  ): Record<string, any> {
    const result: Record<string, any> = {};
    
    // 基础参数
    if (options.temperature !== undefined && model.capabilities.temperature) {
      result.temperature = options.temperature;
    }
    
    if (options.maxTokens !== undefined) {
      result.maxTokens = Math.min(options.maxTokens, model.limits.maxOutputTokens || Infinity);
    }
    
    // Provider 特定参数映射
    switch (provider.sdkType) {
      case 'anthropic':
        if (model.capabilities.reasoning && options.variant) {
          // Anthropic thinking 参数
          result.thinking = {
            type: 'enabled',
            budgetTokens: getThinkingBudget(options.variant, model),
          };
        }
        break;
        
      case 'openai':
        if (model.capabilities.reasoning && options.variant) {
          // OpenAI reasoning_effort 参数
          result.reasoningEffort = options.variant;
        }
        break;
    }
    
    return result;
  }
  
  /**
   * 获取思考预算 token 数
   */
  function getThinkingBudget(variant: string, model: ModelMetadata): number {
    switch (variant) {
      case 'high':
        return Math.min(16000, Math.floor((model.limits.maxOutputTokens || 32000) / 2 - 1));
      case 'max':
        return Math.min(31999, (model.limits.maxOutputTokens || 32000) - 1);
      default:
        return 16000;
    }
  }
  
  /**
   * 应用缓存控制
   * 不同厂商的缓存参数命名不同
   */
  export function applyCaching(
    messages: ModelMessage[],
    provider: ProviderMetadata
  ): ModelMessage[] {
    // 只对最后几条消息应用缓存（系统提示 + 最新用户消息）
    const systemMsgs = messages.filter(m => m.role === 'system').slice(0, 2);
    const recentMsgs = messages.filter(m => m.role !== 'system').slice(-2);
    const toCache = [...systemMsgs, ...recentMsgs];
    
    const cacheOptions = getCacheOptions(provider.sdkType);
    
    return messages.map(msg => {
      if (!toCache.includes(msg)) return msg;
      
      // 在消息级别添加缓存选项
      return {
        ...msg,
        providerOptions: {
          ...msg.providerOptions,
          ...cacheOptions,
        },
      };
    });
  }
  
  function getCacheOptions(sdkType: string): Record<string, any> {
    switch (sdkType) {
      case 'anthropic':
        return { anthropic: { cacheControl: { type: 'ephemeral' } } };
      case 'openai':
      default:
        return {}; // OpenAI 兼容 API 通常不需要显式缓存控制
    }
  }
}
```

### 3. 改造后的 invoke_llm.ts

```typescript
// packages/core/src/core/environment/base/invoke-llm.ts

import { streamText, type ModelMessage, type ToolSet } from 'ai';
import { providerManager } from '../../../llm/provider-manager.js';
import { LLMTransform } from '../../../llm/transform.js';
import type { ToolInfo, ToolResult, ToolContext } from '../../types/index.js';

export interface LLMOptions {
  messages: LLMMessage[];
  tools?: ToolInfo[];
  model?: string;              // 格式: "providerId/modelId"
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  variant?: string;            // 思考强度变体
}

export interface StreamEventHandler {
  onStart?: (metadata: { model: string }) => void;
  onText?: (content: string, delta: string) => void;
  onReasoning?: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => void;
  onCompleted?: (content: string, metadata: { model: string }) => void;
}

export async function invokeLLM(
  options: LLMOptions,
  ctx: ToolContext,
  eventHandler?: StreamEventHandler
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    // 1. 解析模型字符串 (providerId/modelId)
    const { providerId, modelId } = parseModelString(options.model);
    
    // 2. 获取 Provider 实例
    const provider = providerManager.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    // 3. 获取模型元数据
    const modelMetadata = provider.metadata.models.find(m => m.id === modelId);
    if (!modelMetadata) {
      throw new Error(`Model ${modelId} not found in provider ${providerId}`);
    }
    
    // 4. 转换消息格式（借鉴 opencode transform）
    let messages = convertToSDKMessages(options.messages);
    messages = LLMTransform.normalizeMessages(messages, provider.metadata, modelMetadata);
    
    // 5. 应用缓存控制（如果支持）
    if (provider.metadata.sdkType === 'anthropic') {
      messages = LLMTransform.applyCaching(messages, provider.metadata);
    }
    
    // 6. 生成 Provider 特定选项
    const providerOptions = LLMTransform.generateProviderOptions(
      provider.metadata,
      modelMetadata,
      {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        variant: options.variant,
      }
    );
    
    // 7. 转换工具格式
    const tools = options.tools ? convertToolsToSDK(options.tools) : undefined;
    
    // 8. 触发开始事件
    eventHandler?.onStart?.({ model: `${providerId}/${modelId}` });
    
    // 9. 使用 AI SDK 进行流式调用（替代 fetch）
    const result = await streamText({
      model: provider.sdk.languageModel(modelId),
      messages,
      tools,
      ...providerOptions,
      abortSignal: ctx.abort,
      maxRetries: 2,
    });
    
    // 10. 处理流式输出，触发事件
    let fullContent = '';
    let reasoningContent = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          fullContent += part.textDelta;
          eventHandler?.onText?.(fullContent, part.textDelta);
          break;
          
        case 'reasoning':
          reasoningContent += part.text;
          eventHandler?.onReasoning?.(reasoningContent);
          break;
          
        case 'tool-call':
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            args: part.args,
          });
          eventHandler?.onToolCall?.(part.toolName, part.args, part.toolCallId);
          break;
          
        case 'error':
          throw part.error;
      }
    }
    
    // 11. 触发完成事件（如果没有 tool calls）
    if (toolCalls.length === 0) {
      eventHandler?.onCompleted?.(fullContent, { model: `${providerId}/${modelId}` });
    }
    
    // 12. 返回结果
    const output: LLMOutput = {
      content: fullContent,
      reasoning: reasoningContent || undefined,
      model: `${providerId}/${modelId}`,
    };
    
    if (toolCalls.length > 0) {
      output.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
    }
    
    return {
      success: true,
      output,
      metadata: {
        execution_time_ms: Date.now() - startTime,
        provider: providerId,
        model: modelId,
      },
    };
    
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        execution_time_ms: Date.now() - startTime,
      },
    };
  }
}

// 辅助函数
function parseModelString(model?: string): { providerId: string; modelId: string } {
  if (!model) {
    // 使用默认模型
    return { providerId: 'zhipuai', modelId: 'glm-4' };
  }
  
  const parts = model.split('/');
  if (parts.length === 2) {
    return { providerId: parts[0], modelId: parts[1] };
  }
  
  // 如果只有 modelId，尝试从 provider 中查找
  throw new Error(`Invalid model format: ${model}. Expected: providerId/modelId`);
}

function convertToSDKMessages(messages: LLMMessage[]): ModelMessage[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
    // 其他字段转换...
  })) as ModelMessage[];
}

function convertToolsToSDK(tools: ToolInfo[]): ToolSet {
  const result: ToolSet = {};
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      parameters: tool.parameters,
      // execute 函数在 agent 层处理
    };
  }
  return result;
}
```

## providers.jsonc 配置示例

```jsonc
{
  "defaultModel": "zhipuai/glm-4",
  "providers": {
    "zhipuai": {
      "name": "ZhipuAI",
      "description": "GLM models by ZhipuAI",
      "sdkType": "openai-compatible",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZHIPUAI_API_KEY}",
      "models": ["glm-4", "glm-4-plus", "glm-3-turbo"],
      "defaultModel": "glm-4",
      "capabilities": {
        "temperature": true,
        "reasoning": false,
        "toolcall": true,
        "attachment": false,
        "input": { "text": true, "image": false, "audio": false, "video": false, "pdf": false },
        "output": { "text": true, "image": false, "audio": false }
      }
    },
    "anthropic": {
      "name": "Anthropic",
      "description": "Claude models by Anthropic",
      "sdkType": "anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
      "defaultModel": "claude-3-5-sonnet-20241022",
      "capabilities": {
        "temperature": true,
        "reasoning": true,
        "toolcall": true,
        "attachment": true,
        "input": { "text": true, "image": true, "audio": false, "video": false, "pdf": true },
        "output": { "text": true, "image": false, "audio": false }
      }
    }
  }
}
```

## 依赖安装

```bash
# AI SDK 核心
npm install ai

# 标准 Provider SDK（按需安装）
npm install @ai-sdk/openai
npm install @ai-sdk/anthropic
npm install @ai-sdk/openai-compatible
npm install @ai-sdk/google  # 如果需要 Google/Gemini

# 工具库
npm install remeda  # 用于数据处理（transform 层用到）
```

## 初始化流程

```typescript
// packages/core/src/index.ts 或 server.ts

import { providerManager } from './llm/provider-manager.js';

async function initialize() {
  // 1. 初始化 ProviderManager
  await providerManager.initialize();
  
  // 2. 现在可以正常使用 invokeLLM
  // ...
}
```

## 与现有代码的兼容性

### 1. Stream Event 完全兼容

现有的 `StreamEventHandler` 回调保持不变：

```typescript
// 旧代码
invokeLLM(options, ctx, {
  onStart: (metadata) => { /* ... */ },
  onText: (content, delta) => { /* ... */ },
  onReasoning: (content) => { /* ... */ },
  onToolCall: (name, args, id) => { /* ... */ },
  onCompleted: (content, metadata) => { /* ... */ },
});

// 新实现 - 接口完全一致
```

### 2. 配置格式向后兼容

`providers.jsonc` 新增字段都是可选的：

```jsonc
{
  "providers": {
    "myprovider": {
      // 原有字段（必须）
      "name": "...",
      "baseURL": "...",
      "apiKey": "...",
      "models": [...],
      "defaultModel": "...",
      
      // 新增字段（可选，有默认值）
      "sdkType": "openai-compatible",  // 默认
      "capabilities": { /* ... */ },   // 默认全开
      "headers": {}                    // 默认无
    }
  }
}
```

## 总结

这个设计方案实现了：

1. **借鉴 opencode 的 Provider 系统**：引入元数据管理、能力声明、模型限制
2. **借鉴 opencode 的 Transform 层**：处理不同厂商的消息格式差异、缓存控制、参数映射
3. **保留 providers.jsonc**：完全兼容现有配置，新增字段可选
4. **使用 AI SDK**：替换底层 fetch 调用，获得更好的流式处理、重试机制
5. **保持 Stream Event**：`StreamEventHandler` 接口完全不变，上层无感知

通过这种设计，agent-core 可以支持多种 LLM Provider，同时保持代码的简洁性和可维护性。
