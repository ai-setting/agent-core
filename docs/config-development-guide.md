# Agent Core 配置开发手册

> 本文档面向开发者，描述如何新增配置项、理解配置机制的实现细节，以及维护应用级别的配置规范。

---

## 一、配置系统概述

### 1.1 核心概念

**Environment（运行时环境）**：

> ⚠️ **重要概念澄清**：本文档中的 **Environment** 指的是 **Agent 运行时上下文**（如 OsEnv、WebEnv），**不是**传统软件行业中的部署环境（dev/staging/prod）。

- **Environment**：Agent 的运行时上下文，提供工具执行、事件订阅、日志查询等能力
- **示例**：`os_env`（操作系统环境）、`web_env`（Web 环境）、`mcp_env`（MCP 环境）
- **配置内容**：每个 Environment 目录包含该环境的 Agents 配置、Models 配置、工具配置等

**配置分层**：

- **Global 配置**：`~/.config/tong_work/agent-core/tong_work.jsonc` - 应用级默认配置
- **Environment 配置**：`~/.config/tong_work/agent-core/environments/{env-name}/` - Environment 运行时配置
- **State 状态**：`~/.local/state/tong_work/agent-core/` - 运行时状态（模型选择等）

### 1.2 配置优先级

配置按以下优先级加载（后加载的覆盖先加载的）：

1. Global 配置（`tong_work.jsonc`）
2. Environment 运行时配置（`environments/{activeEnv}/`）
3. Inline 配置（`AGENT_CORE_CONFIG_CONTENT` 环境变量）
4. Custom 配置（`AGENT_CORE_CONFIG` 指向的文件）

### 1.3 核心实现文件

| 文件路径 | 职责 |
|---------|------|
| `packages/core/src/config/types.ts` | 配置 Schema 定义（Zod） |
| `packages/core/src/config/paths.ts` | 配置目录路径定义 |
| `packages/core/src/config/config.ts` | 配置读取 API（Config_get 等） |
| `packages/core/src/config/auth.ts` | **Auth 认证配置 API（Auth_get 等）** |
| `packages/core/src/config/resolver.ts` | **变量引用解析（${auth:...} / ${ENV}）** |
| `packages/core/src/config/loader.ts` | 配置加载与合并逻辑 |
| `packages/core/src/config/sources/global.ts` | Global 配置源 |
| `packages/core/src/config/sources/file.ts` | 文件配置源 |
| `packages/core/src/config/sources/inline.ts` | Inline 配置源 |
| `packages/core/src/config/sources/environment.ts` | **Environment 运行时配置源** |
| `packages/core/src/config/registry.ts` | 配置源注册中心 |
| `packages/core/src/config/merge.ts` | 配置合并策略 |
| `packages/core/src/config/default-sources.ts` | 默认配置源初始化 |

---

## 二、配置规范

### 2.1 Global 配置（tong_work.jsonc）

**文件位置**：`~/.config/tong_work/agent-core/tong_work.jsonc`

**作用**：定义应用级别的默认配置，包括当前激活的 Agent 运行时 Environment。

**示例结构**：

```jsonc
{
  // 当前激活的 Agent 运行时 Environment
  "activeEnvironment": "os_env",
  
  // 全局默认模型配置（当 Environment 未指定时回退到此配置）
  "defaultModel": "anthropic/claude-sonnet-4-5",
  "baseURL": "https://api.anthropic.com",
  
  // 使用 ${auth:provider-name} 引用 auth.json 中的认证配置
  "apiKey": "${auth:anthropic-claude}",
  
  // Provider 配置 - 同样使用 ${auth:...} 引用
  "provider": {
    "anthropic": {
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "${auth:anthropic-claude}",
      "defaultModel": "claude-sonnet-4-5"
    },
    "openai": {
      "baseURL": "https://api.openai.com/v1",
      "apiKey": "${auth:openai-gpt}",
      "defaultModel": "gpt-4o"
    },
    // 国内 Provider 配置
    "zhipuai": {
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${auth:zhipuai-coding-plan}",
      "defaultModel": "glm-4"
    }
  }
}
```

### 2.2 Auth 认证配置（auth.json）

**文件位置**：`~/.local/share/tong_work/agent-core/auth.json`

**作用**：存储 Provider 的认证信息（API Key、Token 等），与主配置分离以提高安全性。

**目录结构**：

```
~/.local/share/tong_work/agent-core/
├── auth.json                       # 认证信息（API Keys、Tokens）
├── mcp-auth.json                   # MCP 认证
└── storage/                        # Session/Message 存储
```

**Schema 类型**（`Config.Auth`）：

```typescript
interface AuthProviderConfig {
  type: "api" | "oauth" | "basic";
  key: string;                    // API key 或 token
  baseURL?: string;               // 可选：自定义 provider base URL
  metadata?: Record<string, unknown>;  // 额外元数据
}

type AuthConfig = Record<string, AuthProviderConfig>;
```

**配置示例**（`auth.json`）：

```json
{
  // 智谱 AI
  "zhipuai-coding-plan": {
    "type": "api",
    "key": "90637d406dca4467bfc966b46d2fb9b0.xxx",
    "metadata": {
      "provider": "zhipuai",
      "model": "glm-4"
    }
  },
  
  // Kimi (Moonshot)
  "kimi-for-coding": {
    "type": "api",
    "key": "sk-opPZNOiVQ3XJyijNjn23Ss1OMSPLl9AqLH8jfVaZnPGPoBEL",
    "baseURL": "https://api.moonshot.cn/v1",
    "metadata": {
      "provider": "moonshot",
      "model": "moonshot-v1-128k"
    }
  },
  
  // MiniMax
  "minimax-cn": {
    "type": "api",
    "key": "sk-api-WvTdHo0hzr1Es0E1pfc3C7JQYiz9qBrUdoOKEnOxaQCz0fY9c4PazTdMdXXb0L8s1xxx"
  },
  
  // Moonshot AI
  "moonshotai-cn": {
    "type": "api",
    "key": "sk-GTnLVUbrH5oBZ2zDDKtZxDW61Ca9iTad0Grs3KzVVA0ib8qP"
  },
  
  // Anthropic（使用环境变量）
  "anthropic-claude": {
    "type": "api",
    "key": "${ANTHROPIC_API_KEY}"
  },
  
  // OpenAI（使用环境变量）
  "openai-gpt": {
    "type": "api",
    "key": "${OPENAI_API_KEY}",
    "baseURL": "https://api.openai.com/v1"
  }
}
```

**使用 API**：

```typescript
import { 
  Auth_get, 
  Auth_getApiKey, 
  Auth_getProvider,
  Auth_setProvider,
  Auth_removeProvider 
} from "@tong_work/config";

// 获取所有认证配置
const auth = await Auth_get();

// 获取特定 provider 的 API Key
const apiKey = await Auth_getApiKey("zhipuai-coding-plan");

// 获取完整 provider 配置
const provider = await Auth_getProvider("kimi-for-coding");
console.log(provider.key);      // API key
console.log(provider.baseURL);  // 自定义 base URL

// 设置新的 provider
await Auth_setProvider("new-provider", {
  type: "api",
  key: "sk-xxx",
  metadata: { provider: "custom" }
});

// 删除 provider
await Auth_removeProvider("old-provider");
```

**安全最佳实践**：

1. **文件权限**：建议设置 `auth.json` 权限为 `600`（仅所有者可读写）
   ```bash
   chmod 600 ~/.local/share/tong_work/agent-core/auth.json
   ```

2. **环境变量**：对于敏感 key，使用环境变量占位符
   ```json
   { "key": "${ANTHROPIC_API_KEY}" }
   ```

3. **分离存储**：`auth.json` 位于 `~/.local/share/`（data 目录），与配置（`~/.config/`）分离

4. **不要提交到版本控制**：确保 `auth.json` 在 `.gitignore` 中

**变量引用解析**（配置加载时自动处理）：

配置文件支持两种变量引用格式，在加载时自动解析：

1. **Auth 引用**：`${auth:provider-name}` - 从 `auth.json` 读取对应 provider 的 key
   ```jsonc
   {
     "apiKey": "${auth:anthropic-claude}",
     "provider": {
       "zhipuai": {
         "apiKey": "${auth:zhipuai-coding-plan}"
       }
     }
   }
   ```

2. **环境变量**：`${ENV_VAR}` - 从 `process.env` 读取环境变量
   ```jsonc
   {
     "apiKey": "${ANTHROPIC_API_KEY}",
     "baseURL": "${CUSTOM_API_URL}"
   }
   ```

**解析时机**：变量引用在 `Config_get()` 加载配置时自动解析，解析后的值会被缓存。

**手动解析 API**：
```typescript
import { resolveValue, resolveObject, resolveConfig } from "@tong_work/config";

// 解析单个值
const apiKey = await resolveValue("${auth:anthropic-claude}");

// 解析对象
const config = await resolveObject({
  apiKey: "${auth:my-provider}",
  baseURL: "${API_URL}"
});

// 解析完整 Config.Info
const resolvedConfig = await resolveConfig(rawConfig);
```

### 2.3 Environment 运行时配置

**目录结构**：

```
~/.config/tong_work/agent-core/
├── tong_work.jsonc              # Global 配置
└── environments/                # Agent 运行时 Environment 配置目录
    ├── os_env/                  # OS Environment（操作系统环境）
    │   ├── config.jsonc         # Environment 主配置
    │   ├── agents.jsonc         # Agents 配置
    │   └── models.jsonc         # Models 配置（可选）
    ├── web_env/                 # Web Environment（Web 环境）
    │   ├── config.jsonc
    │   ├── agents.jsonc
    │   └── models.jsonc
    ├── mcp_env/                 # MCP Environment（MCP 工具环境）
    │   ├── config.jsonc
    │   ├── agents.jsonc
    │   └── models.jsonc
    └── custom_env/              # 用户自定义 Environment
        ├── config.jsonc
        ├── agents.jsonc
        └── models.jsonc
```

**重要概念**：

- **`os_env`**：提供 bash、file 等操作系统工具的环境
- **`web_env`**：提供浏览器自动化、HTTP 请求等 Web 工具的环境  
- **`mcp_env`**：通过 MCP 协议连接外部工具的环境
- **`custom_env`**：用户自定义的 Environment

**Environment 主配置示例**（`environments/os_env/config.jsonc`）：

```jsonc
{
  // Environment 标识
  "id": "os_env",
  "displayName": "OS Environment",
  "description": "Operating system environment with bash/file tools",
  
  // 模型配置
  "defaultModel": "anthropic/claude-sonnet-4-5",
  "baseURL": "https://api.anthropic.com",
  "apiKey": "${ANTHROPIC_API_KEY}",
  
  // Provider 配置
  "provider": {
    "anthropic": {
      "baseURL": "https://api.anthropic.com/v1",
      "defaultModel": "claude-sonnet-4-5"
    }
  },
  
  // Environment 能力声明
  "capabilities": {
    "logs": true,
    "events": true,
    "metrics": true,
    "profiles": true,
    "mcpTools": false
  },
  
  // Environment Profiles
  "profiles": [
    {
      "id": "default",
      "displayName": "Default Profile",
      "primaryAgents": [
        {
          "id": "os_agent",
          "role": "primary",
          "promptId": "system",
          "allowedTools": ["bash", "file_read", "file_write"]
        }
      ]
    }
  ],
  
  // 元数据
  "metadata": {
    "version": "1.0.0",
    "author": "tong_work"
  }
}
```

**Agents 配置示例**（`environments/os_env/agents.jsonc`）：

```jsonc
[
  {
    "id": "os_agent",
    "role": "primary",
    "promptId": "system",
    "promptOverride": "You are a helpful assistant that can execute bash commands and file operations.",
    "allowedTools": ["bash", "file_read", "file_write", "file_glob"],
    "deniedTools": ["file_delete"],
    "metadata": {
      "maxConcurrency": 5
    }
  },
  {
    "id": "file_agent",
    "role": "sub",
    "promptId": "file_expert",
    "allowedTools": ["file_read", "file_write", "file_glob", "grep"]
  }
]
```

**Models 配置示例**（`environments/os_env/models.jsonc`）：

```jsonc
{
  "claude-sonnet": {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-5",
    "displayName": "Claude Sonnet 4.5",
    "capabilities": ["code", "analysis", "writing"]
  },
  "gpt-4o": {
    "provider": "openai",
    "modelId": "gpt-4o",
    "displayName": "GPT-4o",
    "capabilities": ["vision", "code", "analysis"]
  }
}
```

### 2.3 配置合并规则

当同时存在 Global 和 Environment 配置时：

1. **Global 配置**作为基础
2. **Environment 配置**覆盖 Global 中的同名配置
3. **环境变量**（`AGENT_CORE_CONFIG_CONTENT`）覆盖 Environment 配置
4. **Custom 文件**（`AGENT_CORE_CONFIG`）优先级最高

**示例**：

```
Global (tong_work.jsonc):
  activeEnvironment: "os_env"
  defaultModel: "gpt-4"
  baseURL: "https://api.openai.com"

OS Environment (environments/os_env/config.jsonc):
  defaultModel: "claude-sonnet-4-5"
  baseURL: "https://api.anthropic.com"

Merged Result:
  activeEnvironment: "os_env"
  defaultModel: "claude-sonnet-4-5"  // Environment 覆盖 Global
  baseURL: "https://api.anthropic.com"  // Environment 覆盖 Global
```

---

## 三、新增配置项开发流程

### 3.1 步骤总览

```
1. 更新 Schema (types.ts)
2. 添加默认值（如需要）
3. 更新加载器（loader.ts）
4. 更新文档
5. 添加测试
```

### 3.2 详细步骤

#### 步骤 1：更新 Schema

**文件**：`packages/core/src/config/types.ts`

在 `ConfigInfo` zod schema 中添加新配置项：

```typescript
export const ConfigInfo = z.object({
  // 现有配置...
  
  // === 新增配置项 ===
  newConfigField: z.string().optional().describe("描述新配置项的作用"),
  
  // 或者添加嵌套配置对象
  newConfigSection: z.object({
    field1: z.string().optional(),
    field2: z.number().optional(),
  }).optional().describe("新配置区块"),
});
```

#### 步骤 2：添加 Environment 配置支持（如适用）

**文件**：`packages/core/src/config/sources/environment.ts`

如果新配置项需要在 Environment 级别配置，确保加载该字段：

```typescript
// 在 loadEnvironmentConfig 函数中
export async function loadEnvironmentConfig(envName: string): Promise<Config.Info | null> {
  const envDir = path.join(ConfigPaths.environments, envName);
  const configPath = path.join(envDir, "config.jsonc");
  // 加载逻辑...
}
```

#### 步骤 3：更新加载器

**文件**：`packages/core/src/config/loader.ts`

如果需要默认值处理，在加载逻辑中添加：

```typescript
export async function loadConfig(): Promise<Config.Info> {
  // 加载所有配置源...
  
  // 合并逻辑...
  
  return result;
}
```

#### 步骤 4：更新路径常量（如需要新目录）

**文件**：`packages/core/src/config/paths.ts`

```typescript
export namespace ConfigPaths {
  // 现有路径...
  
  // Environment 配置目录
  export const environments = path.join(config, "environments");
}
```

#### 步骤 5：使用配置

在代码中使用 `Config_get()` 获取配置：

```typescript
import { Config_get } from "@tong_work/config";

async function someFunction() {
  const config = await Config_get();
  
  // 访问配置项
  const value = config.newConfigField;
  
  // 访问 Environment 配置
  const envConfig = config.environment;
  const agents = config.agents;
}
```

#### 步骤 6：更新文档

1. 更新本文档的「配置规范」章节
2. 更新 `docs/config-design.md`
3. 在 `docs/DEVELOPMENT_PROGRESS.md` 中记录变更

#### 步骤 7：添加测试

**文件**：`packages/core/src/config/config.test.ts`（如存在）或新建

```typescript
import { describe, it, expect } from "bun:test";
import { Config_get, Config_reload } from "./config.js";

describe("Config", () => {
  it("should load new config field", async () => {
    // 设置测试配置...
    
    const config = await Config_reload();
    expect(config.newConfigField).toBe("expected_value");
  });
});
```

---

## 四、技术实现细节

### 4.1 配置源注册机制

配置源通过 `ConfigSourceRegistry` 注册，按优先级排序：

```typescript
// packages/core/src/config/registry.ts
class ConfigSourceRegistryImpl implements ConfigSourceRegistry {
  private sources: ConfigSource[] = [];
  
  register(source: ConfigSource): void {
    this.sources.push(source);
  }
  
  getSources(): ConfigSource[] {
    // 按 priority 排序（小值优先）
    return [...this.sources].sort((a, b) => a.priority - b.priority);
  }
}
```

**默认配置源优先级**：

| 来源 | 优先级 | 说明 |
|-----|-------|------|
| Global | 0 | 始终加载 |
| Environment | 10 | 基于 `activeEnvironment` |
| Inline | 100 | `AGENT_CORE_CONFIG_CONTENT` |
| Custom | 200 | `AGENT_CORE_CONFIG` 文件 |

### 4.2 Environment 配置加载流程

```
1. 加载 Global 配置 (tong_work.jsonc)
   ↓
2. 检查 activeEnvironment 字段
   ↓
3. 如果存在，加载对应的 Environment 配置
   - environments/{env-name}/config.jsonc
   - environments/{env-name}/agents.jsonc (可选)
   - environments/{env-name}/models.jsonc (可选)
   ↓
4. 合并所有配置（优先级：Environment > Global）
   ↓
5. 应用 Inline/Custom 覆盖
```

### 4.3 配置缓存机制

```typescript
// packages/core/src/config/config.ts
let cachedConfig: Config.Info | null = null;
let configLoaded = false;

export async function Config_get(): Promise<Config.Info> {
  if (!configLoaded) {
    cachedConfig = await loadConfig();
    configLoaded = true;
  }
  return cachedConfig ?? {};
}
```

### 4.4 Auth 认证配置实现

**文件路径**：`packages/core/src/config/auth.ts`

Auth 配置独立于主配置系统，单独存储和加载：

```typescript
// 内部缓存
let cachedAuth: Config.Auth | null = null;
let authLoaded = false;

/**
 * 加载 auth.json
 */
export async function loadAuthConfig(): Promise<Config.Auth> {
  try {
    const content = await fs.readFile(ConfigPaths.authStore, "utf-8");
    return JSON.parse(content) as Config.Auth;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {}; // 文件不存在返回空对象
    }
    console.warn("[Auth] Failed to load auth config:", error);
    return {};
  }
}

/**
 * 获取认证配置（带缓存）
 */
export async function Auth_get(): Promise<Config.Auth> {
  if (!authLoaded) {
    cachedAuth = await loadAuthConfig();
    authLoaded = true;
  }
  return cachedAuth ?? {};
}

/**
 * 获取特定 provider 的 API Key
 */
export async function Auth_getApiKey(providerName: string): Promise<string | undefined> {
  const auth = await Auth_get();
  const providerAuth = auth[providerName];
  if (providerAuth?.type === "api") {
    return providerAuth.key;
  }
  return undefined;
}

/**
 * 保存认证配置
 */
export async function Auth_save(auth: Config.Auth): Promise<void> {
  const dir = ConfigPaths.data;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(ConfigPaths.authStore, JSON.stringify(auth, null, 2));
  cachedAuth = auth;
  authLoaded = true;
}
```

**使用示例**：

```typescript
import { 
  Auth_get, 
  Auth_getApiKey, 
  Auth_setProvider 
} from "@tong_work/config";

// 读取认证配置
const auth = await Auth_get();

// 获取特定 provider 的 API key
const apiKey = await Auth_getApiKey("zhipuai-coding-plan");

// 添加新的 provider
await Auth_setProvider("my-provider", {
  type: "api",
  key: "sk-xxx",
  baseURL: "https://api.example.com/v1"
});
```

**与主配置的关系**：

- Auth 配置独立于 `Config_get()` 的缓存
- 修改 `auth.json` 后需要调用 `Auth_reload()` 刷新
- 建议在应用启动时预加载 auth 配置

### 4.5 配置变更监听

```typescript
// 订阅配置变更
const unsubscribe = Config_onChange((newConfig) => {
  console.log("Config changed:", newConfig);
});

// 取消订阅
unsubscribe();
```

---

## 五、环境变量

| 变量名 | 作用 | 示例 |
|-------|------|------|
| `AGENT_CORE_CONFIG` | 指定自定义配置文件路径 | `/path/to/custom.jsonc` |
| `AGENT_CORE_CONFIG_CONTENT` | 内联 JSON 配置 | `'{"activeEnvironment":"os_env"}'` |
| `AGENT_CORE_TEST_HOME` | 测试时覆盖 home 目录 | `/tmp/test-home` |

---

## 六、最佳实践

### 6.1 配置项命名规范

- 使用 **camelCase**（如 `activeEnvironment`）
- 保持简洁明了（如 `defaultModel` 而非 `providerDefaultModel`）
- 布尔值使用肯定语气（如 `enableFeature` 而非 `disableFeature`）

### 6.2 Environment 命名规范

- 使用 **snake_case**（如 `os_env`, `web_env`）
- 使用描述性名称（如 `mcp_slack_env` 而非 `env1`）
- 避免与部署环境概念混淆（不要用 `dev`, `prod` 等）

### 6.3 敏感信息处理

不要在配置文件中硬编码敏感信息，使用环境变量占位符：

```jsonc
{
  "apiKey": "${ANTHROPIC_API_KEY}"
}
```

### 6.4 向后兼容

新增配置项必须标记为 `optional()`，确保现有配置不会报错：

```typescript
// ✅ 正确
newField: z.string().optional()

// ❌ 错误（会破坏现有配置）
newField: z.string()
```

---

## 七、参考文档

- [配置系统设计文档](./config-design.md) - 设计原则与架构
- [Environment 设计哲学](./environment-design-philosophy.md) - Environment 架构
- [应用配置管理](./app-config-management.md) - OpenCode 配置参考
- [Env Spec 规范](../packages/core/src/env_spec/types.ts) - Environment 类型定义

---

**最后更新**：2026-02-12

**重要提示**：本文档中的 **Environment** 均指 **Agent 运行时上下文**，与传统软件行业的部署环境（dev/staging/prod）是不同的概念。
