# Providers 集中配置设计文档

本文档描述将 providers、models、baseURL、API keys 等配置集中到 `providers.jsonc` 的设计方案。

---

## 一、现状分析

### 1.1 当前配置分散问题

| 配置项 | 当前位置 | 问题 |
|--------|----------|------|
| Provider 元信息 (baseURL, models) | `providers.ts` 硬编码 + `providers.jsonc` | 分散在代码和文件中 |
| Provider 配置 (baseURL, apiKey) | `tong_work.jsonc` 中 `provider.*` | 与 provider 元信息分离 |
| API Key | `auth.json` (data 目录) | 与 provider 配置分离 |
| 环境变量引用 | `${ANTHROPIC_API_KEY}` 形式 | 需要手动设置环境变量 |

### 1.2 当前配置加载顺序

```
1. Auth_loadToEnv()     → auth.json → process.env
2. globalSource (0)     → tong_work.jsonc
3. environmentSource    → environments/{env}/config.jsonc
4. inlineSource (100)   → AGENT_CORE_CONFIG_CONTENT
5. fileSource (200)     → AGENT_CORE_CONFIG
```

**问题**：
- `auth.json` 和 `tong_work.jsonc` 分离，配置时需要同时编辑两个文件
- Provider 的元信息 (baseURL, models) 和认证信息 (apiKey) 分离
- 环境变量需要手动在系统中配置

---

## 二、设计目标

### 2.1 集中化配置

将以下配置集中到 `~/.config/tong_work/agent-core/providers.jsonc`：

1. **Provider 元信息**：id, name, description, baseURL, models, defaultModel
2. **认证信息**：apiKey (支持环境变量引用，如 `${ZHIPUAI_API_KEY}`)
3. **其他配置**：timeout, retry 等治理配置 (预留)

### 2.2 向后兼容

- 保留 `auth.json` 作为启动时的环境变量来源
- 保留 `tong_work.jsonc` 中的 `provider.*` 配置作为补充/覆盖
- 新的 `providers.jsonc` 作为 **主要** Provider 配置来源

### 2.3 加载流程优化

```
1. Auth_loadToEnv()     → auth.json → process.env (保留)
2. providersSource (1)  → providers.jsonc (新增，主要来源)
3. globalSource (0)     → tong_work.jsonc (作为补充)
4. environmentSource    → environments/{env}/config.jsonc
```

---

## 三、配置结构设计

### 3.1 providers.jsonc 文件结构

```jsonc
{
  // 默认模型选择
  "defaultModel": "zhipuai/glm-4",

  // Provider 列表
  "providers": {
    "zhipuai": {
      "name": "ZhipuAI",
      "description": "GLM models by ZhipuAI",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZHIPUAI_API_KEY}",  // 支持环境变量引用
      "models": ["glm-5", "glm-4", "glm-4-plus", "glm-3-turbo"],
      "defaultModel": "glm-4"
    },
    "anthropic": {
      "name": "Anthropic",
      "description": "Claude models by Anthropic",
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku", "claude-3-5-sonnet"],
      "defaultModel": "claude-3-5-sonnet"
    },
    "openai": {
      "name": "OpenAI",
      "description": "GPT models by OpenAI",
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "models": ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
      "defaultModel": "gpt-4o"
    },
    "google": {
      "name": "Google",
      "description": "Gemini models by Google",
      "baseURL": "https://generativelanguage.googleapis.com/v1",
      "apiKey": "${GOOGLE_API_KEY}",
      "models": ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
      "defaultModel": "gemini-1.5-flash"
    },
    "deepseek": {
      "name": "DeepSeek",
      "description": "DeepSeek models",
      "baseURL": "https://api.deepseek.com/v1",
      "apiKey": "${DEEPSEEK_API_KEY}",
      "models": ["deepseek-chat", "deepseek-coder"],
      "defaultModel": "deepseek-chat"
    },
    "kimi": {
      "name": "Kimi",
      "description": "Moonshot AI Kimi models",
      "baseURL": "https://api.moonshot.cn/v1",
      "apiKey": "${MOONSHOT_API_KEY}",
      "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
      "defaultModel": "moonshot-v1-8k"
    },
    "ollama": {
      "name": "Ollama",
      "description": "Local LLM with Ollama",
      "baseURL": "http://localhost:11434",
      "models": ["llama3.2", "qwen2.5", "mistral"],
      "defaultModel": "llama3.2"
    }
  }
}
```

### 3.2 Schema 定义

```typescript
// packages/core/src/config/types.ts 新增

// Provider 配置 (providers.jsonc)
const ProviderConfigV2 = z.object({
  id: z.string().optional().describe("Provider ID (key from providers object)"),
  name: z.string().describe("Provider display name"),
  description: z.string().optional().describe("Provider description"),
  baseURL: z.string().describe("Provider API base URL"),
  apiKey: z.string().optional().describe("API key (supports ${ENV_VAR} syntax)"),
  models: z.array(z.string()).optional().describe("Available models"),
  defaultModel: z.string().optional().describe("Default model for this provider"),
});

// Main config with providers.jsonc
const ConfigInfoV2 = z.object({
  // === 新增：Providers 配置 (从 providers.jsonc 加载) ===
  defaultModel: z.string().optional().describe("Default LLM model, format: provider/model"),
  
  providers: z.record(ProviderConfigV2).optional().describe("Provider configurations from providers.jsonc"),
  
  // === 保留：原有 Provider 配置 (作为补充/覆盖) ===
  provider: z.record(ProviderConfig).optional().describe("Legacy provider configurations (tong_work.jsonc)"),
  
  // ... 其他字段保持不变
});
```

---

## 四、实现方案

### 4.1 文件结构变更

```
packages/core/src/config/
├── providers.ts              # 修改：providers.jsonc 加载逻辑
├── providers-v2.ts           # 新增：providers.jsonc 专用加载器
├── sources/
│   ├── providers.ts          # 新增：providers.jsonc 配置源
│   └── ...
├── default-sources.ts        # 修改：注册 providersSource
└── types.ts                 # 修改：添加 ProviderConfigV2 Schema
```

### 4.2 新增 providers.jsonc 配置源

**文件**：`packages/core/src/config/sources/providers.ts`

```typescript
import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

const PROVIDERS_CONFIG_FILE = path.join(ConfigPaths.config, "providers.jsonc");

export interface ProviderConfigV2 {
  id?: string;
  name: string;
  description?: string;
  baseURL: string;
  apiKey?: string;  // 支持 ${ENV_VAR} 语法
  models?: string[];
  defaultModel?: string;
}

export interface ProvidersConfig {
  defaultModel?: string;
  providers: Record<string, ProviderConfigV2>;
}

export async function loadProvidersConfig(): Promise<ProvidersConfig | null> {
  try {
    const content = await fs.readFile(PROVIDERS_CONFIG_FILE, "utf-8");
    const cleaned = content
      .replace(/\/\/.*$/gm, '')  // 移除行注释
      .replace(/\/\*[\s\S]*?\*\//g, '');  // 移除块注释
    
    if (!cleaned.trim()) {
      return null;
    }
    
    return JSON.parse(cleaned);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;  // 文件不存在，返回 null
    }
    console.warn("[Config] Failed to load providers.jsonc:", error);
    return null;
  }
}

export const providersSource: ConfigSource = {
  name: "providers",
  priority: 1,  // 高于 global (0)，低于 environment (10)
  load: loadProvidersConfig,
};
```

### 4.3 修改 types.ts 添加 Schema

```typescript
// packages/core/src/config/types.ts

// Provider 配置 V2 (providers.jsonc)
const ProviderConfigV2 = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  baseURL: z.string(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
});

// 主配置 Schema 扩展
export const ConfigInfo = z.object({
  // ... existing fields ...
  
  // === 新增：Providers 配置 (providers.jsonc) ===
  defaultModel: z.string().optional(),
  providers: z.record(ProviderConfigV2).optional(),
  
  // === 保留：原有 Provider 配置 (tong_work.jsonc) ===
  provider: z.record(ProviderConfig).optional(),
}).strict();
```

### 4.4 修改 providers.ts 统一 API

```typescript
// packages/core/src/config/providers.ts

import { loadProvidersConfig } from "./sources/providers.js";
import { Config_get } from "./config.js";

export interface ProviderInfo {
  id: string;
  name: string;
  description?: string;
  baseURL: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
}

/**
 * 获取所有 Provider (合并内置 + providers.jsonc + tong_work.jsonc)
 * 优先级: providers.jsonc > tong_work.jsonc > 内置
 */
export async function Providers_getAll(): Promise<ProviderInfo[]> {
  // 1. 内置 Provider
  const builtin: ProviderInfo[] = [...];
  
  // 2. 加载 providers.jsonc
  const providersConfig = await loadProvidersConfig();
  
  // 3. 加载 tong_work.jsonc 中的 provider 配置
  const globalConfig = await Config_get();
  
  // 4. 合并 (后面覆盖前面)
  const merged: Record<string, ProviderInfo> = {};
  
  // 先添加内置
  for (const p of builtin) {
    merged[p.id] = p;
  }
  
  // 用 providers.jsonc 覆盖
  if (providersConfig?.providers) {
    for (const [id, config] of Object.entries(providersConfig.providers)) {
      merged[id] = { id, ...config };
    }
  }
  
  // 用 tong_work.jsonc 覆盖
  if (globalConfig.provider) {
    for (const [id, config] of Object.entries(globalConfig.provider)) {
      merged[id] = {
        ...merged[id],
        ...config,
        id,
      };
    }
  }
  
  return Object.values(merged);
}

/**
 * 获取单个 Provider 配置
 */
export async function Providers_get(id: string): Promise<ProviderInfo | undefined> {
  const all = await Providers_getAll();
  return all.find(p => p.id === id);
}
```

### 4.5 修改 default-sources.ts 注册顺序

```typescript
// packages/core/src/config/default-sources.ts

import { configRegistry } from "./registry.js";
import { globalSource } from "./sources/global.js";
import { providersSource } from "./sources/providers.js";
import { createEnvironmentSource } from "./sources/environment.js";
import { createFileSource } from "./sources/file.js";
import { createInlineSource } from "./sources/inline.js";
import { Auth_loadToEnv } from "./auth.js";

export async function initWithEnvOverrides(): Promise<void> {
  // 1. 先从 auth.json 加载 API keys 到环境变量
  await Auth_loadToEnv();
  
  // 2. 初始化默认来源
  configRegistry.clear();
  
  // 3. 注册配置源 (按优先级)
  configRegistry.register(globalSource);      // priority: 0
  configRegistry.register(providersSource);   // priority: 1
  
  // 4. 获取 activeEnvironment
  const globalConfig = await globalSource.load();
  const activeEnv = globalConfig?.activeEnvironment;
  
  // 5. 注册 Environment 配置源
  if (activeEnv) {
    configRegistry.register(createEnvironmentSource(activeEnv, 10));
  }
  
  // 6. 注册 Inline/Custom 来源
  if (process.env.AGENT_CORE_CONFIG_CONTENT) {
    configRegistry.register(
      createInlineSource(process.env.AGENT_CORE_CONFIG_CONTENT, 100)
    );
  }
  
  if (process.env.AGENT_CORE_CONFIG) {
    configRegistry.register(
      createFileSource(process.env.AGENT_CORE_CONFIG, 200)
    );
  }
}
```

### 4.6 配置解析支持环境变量

```typescript
// packages/core/src/config/resolver.ts 扩展

export async function resolveConfig(config: Config.Info): Promise<Config.Info> {
  // ... 现有逻辑 ...
  
  // 新增：处理 providers 中的 ${ENV_VAR}
  if (config.providers) {
    for (const [providerId, provider] of Object.entries(config.providers)) {
      if (provider.apiKey) {
        provider.apiKey = resolveEnvVar(provider.apiKey);
      }
    }
  }
  
  return result;
}

function resolveEnvVar(value: string): string {
  // 支持 ${VAR} 和 ${VAR:-default} 语法
  const match = value.match(/^\$\{([^}]+)\}$/);
  if (match) {
    const [varName, defaultValue] = match[1].split(':-');
    return process.env[varName] || defaultValue || '';
  }
  return value;
}
```

---

## 五、配置加载流程

### 5.1 启动时配置加载顺序

```
┌─────────────────────────────────────────────────────────────┐
│ 1. initWithEnvOverrides()                                   │
├─────────────────────────────────────────────────────────────┤
│ 2. Auth_loadToEnv()                                         │
│    └── auth.json → process.env                              │
│        (保留：向后兼容，支持旧环境变量引用)                   │
├─────────────────────────────────────────────────────────────┤
│ 3. globalSource (priority: 0)                              │
│    └── tong_work.jsonc                                      │
│        - activeEnvironment                                  │
│        - provider.* (补充/覆盖)                             │
├─────────────────────────────────────────────────────────────┤
│ 4. providersSource (priority: 1)                            │
│    └── providers.jsonc                                      │
│        - defaultModel                                       │
│        - providers.* (主要来源)                             │
├─────────────────────────────────────────────────────────────┤
│ 5. environmentSource (priority: 10)                        │
│    └── environments/{env}/config.jsonc                      │
│        - agents, models, tools 等                           │
├─────────────────────────────────────────────────────────────┤
│ 6. inlineSource / fileSource                                │
│    └── AGENT_CORE_CONFIG_CONTENT / AGENT_CORE_CONFIG       │
├─────────────────────────────────────────────────────────────┤
│ 7. resolveConfig()                                          │
│    └── 解析 ${ENV_VAR} 变量                                  │
│        - providers.jsonc 中的 apiKey                        │
│        - tong_work.jsonc 中的 apiKey                       │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Provider 获取时的数据来源

```typescript
// Providers_getAll() 返回的数据来源优先级

function mergeProviderConfig(): ProviderInfo {
  // 优先级从低到高：
  // 1. 内置默认值 (最低)
  // 2. tong_work.jsonc 中的 provider.*
  // 3. providers.jsonc 中的 providers.* (最高)
  
  return merged;
}
```

---

## 六、向后兼容性

### 6.1 现有 auth.json 处理

- 启动时仍然读取 `auth.json` 并加载到 `process.env`
- `providers.jsonc` 中的 `${ZHIPUAI_API_KEY}` 会正确解析

### 6.2 现有 tong_work.jsonc 处理

- 保留 `provider.*` 配置
- 作为补充配置，优先级低于 `providers.jsonc`

### 6.3 迁移示例

**旧配置方式** (`tong_work.jsonc`):
```jsonc
{
  "defaultModel": "zhipuai/glm-4",
  "provider": {
    "zhipuai": {
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZHIPUAI_API_KEY}",
      "defaultModel": "glm-4"
    }
  }
}
```

**新配置方式** (`providers.jsonc`):
```jsonc
{
  "defaultModel": "zhipuai/glm-4",
  "providers": {
    "zhipuai": {
      "name": "ZhipuAI",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${ZHIPUAI_API_KEY}",
      "models": ["glm-4", "glm-3-turbo"],
      "defaultModel": "glm-4"
    }
  }
}
```

**tong_work.jsonc** 可简化为:
```jsonc
{
  "activeEnvironment": "zst"
}
```

---

## 七、实施计划

### Phase 1: 核心功能 (1天)

- [ ] 创建 `sources/providers.ts` 配置源
- [ ] 修改 `types.ts` 添加 ProviderConfigV2 Schema
- [ ] 修改 `providers.ts` 实现统一 API
- [ ] 修改 `default-sources.ts` 注册顺序
- [ ] 修改 `resolver.ts` 支持 providers 变量解析

### Phase 2: 测试验证 (0.5天)

- [ ] 创建 `providers.jsonc` 测试文件
- [ ] 验证配置加载流程
- [ ] 验证环境变量解析
- [ ] 验证向后兼容

### Phase 3: 文档与清理 (0.5天)

- [ ] 更新配置设计文档
- [ ] 清理旧配置 (tong_work.jsonc 中的 provider.*)

---

## 八、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `config/sources/providers.ts` | 新增 | providers.jsonc 配置源 |
| `config/providers.ts` | 修改 | 合并内置/providers.jsonc/tong_work.jsonc |
| `config/types.ts` | 修改 | 添加 ProviderConfigV2 Schema |
| `config/default-sources.ts` | 修改 | 注册 providersSource |
| `config/resolver.ts` | 修改 | 支持 providers 变量解析 |

---

## 九、总结

本设计将分散的多处配置集中到 `providers.jsonc`：

1. **集中化**：Provider 元信息 + 认证信息都在一个文件
2. **环境变量支持**：直接使用 `${ZHIPUAI_API_KEY}` 形式
3. **向后兼容**：保留 auth.json 和 tong_work.jsonc 作为补充
4. **清晰流程**：先加载环境变量，再加载配置文件，最后变量解析
