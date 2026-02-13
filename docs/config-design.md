# Agent Core 配置系统设计文档

本文档描述 tong_work 配置系统的设计思想与实现细节，用于指导后续开发。

---

## 一、设计定位

### 1.1 核心原则

**以 Environment 为中心的配置注入**：配置能力优先落在 Environment 层，而非侵入 Agent 核心。tong_work 的架构设计中，Environment 是 Agent 的运行时上下文（见 `docs/environment-design-philosophy.md`），配置作为 Environment 的依赖注入是自然的设计延伸。

**用户级配置，不绑定项目**：tong_work 是"企业任务自主推进系统"，不局限于代码场景。项目概念会约束终端用户的适用场景，因此配置系统采用**用户级配置**，随用户走，不绑定任何项目目录。

**简洁默认 + 按需扩展**：参考 OpenCode 的可扩展配置设计（`docs/extensible-config-design.md`），但只保留 Global 一层默认配置，避免过度工程化。需要时通过注册机制扩展。

**可观测与可追溯**：每个配置来源有独立标识（`name`），便于排查配置来源问题。

### 1.2 配置系统的职责边界

| 职责 | 归属 | 说明 |
|------|------|------|
| 配置加载与合并 | Config 模块 | 多来源配置按优先级合并 |
| 配置 Schema 定义 | Config 模块 | Zod 类型约束与验证 |
| 路径管理 | Config/Paths | xdg-basedir 兼容的目录规范 |
| 状态持久化 | Config/State | 用户级状态（模型选择等）的持久化 |
| 配置注入 | Environment | 将配置应用到运行时环境 |

---

## 二、目录与路径体系

### 2.1 目录结构设计（xdg-basedir 兼容）

```
~/.config/tong_work/agent-core/     # Global 配置目录（用户级配置）
├── tong_work.jsonc                 # 主配置文件（JSONC 格式）
├── tong_work.json                  # 备用配置（JSON 格式）
├── prompts/                        # Prompt 仓库（可选，按需扩展）
└── environments/                   # Environment 运行时配置目录
    ├── os_env/                     # OS Environment 配置
    │   ├── config.jsonc            # Environment 运行时配置
    │   ├── agents.jsonc            # Agent 配置
    │   └── models.jsonc            # 模型配置（可选）
    ├── web_env/                    # Web Environment 配置
    │   ├── config.jsonc
    │   ├── agents.jsonc
    │   └── models.jsonc
    └── custom_env/                 # 用户自定义 Environment
        ├── config.jsonc
        ├── agents.jsonc
        └── models.jsonc

~/.local/state/tong_work/agent-core/  # Runtime 状态目录（用户级状态）
├── model.json                      # 模型选择（recent/favorite/variant）
└── kv.json                         # 键值状态（可选）

~/.local/share/tong_work/agent-core/  # 持久数据目录（用户级数据）
├── auth.json                       # 认证信息
├── mcp-auth.json                   # MCP 认证
└── storage/                        # Session/Message 存储（复用 core/session）

~/.cache/tong_work/agent-core/      # 缓存目录
└── models.json                     # 模型元数据缓存
```

**重要概念澄清**：

这里的 `environments/` 目录**不是**传统软件行业中的部署环境（dev/staging/prod），而是 **Agent 运行时上下文 Environment** 的配置目录。

- **Environment**：Agent 的运行时上下文，提供工具执行、事件订阅、日志查询等能力
- **示例**：`os_env`（操作系统环境）、`web_env`（Web 环境）、`mcp_env`（MCP 环境）
- **配置内容**：每个 Environment 目录包含该环境的 Agents 配置、Models 配置、工具配置等

### 2.2 路径抽象实现

**文件路径**：`packages/core/src/config/paths.ts`

```typescript
import * as xdg from "xdg-basedir";
import os from "os";
import path from "path";

const APP_NAME = "tong_work";

export namespace ConfigPaths {
  const _home = process.env.AGENT_CORE_TEST_HOME || os.homedir();

  const _xdgConfig = xdg.config || path.join(_home, ".config");
  const _xdgState = xdg.state || path.join(_home, ".local", "state");
  const _xdgData = xdg.data || path.join(_home, ".local", "share");
  const _xdgCache = xdg.cache || path.join(_home, ".cache");

  const _appDir = path.join(APP_NAME, "agent-core");

  export const home = _home;

  export const config = path.join(_xdgConfig, _appDir);

  export const state = path.join(_xdgState, _appDir);

  export const data = path.join(_xdgData, _appDir);

  export const cache = path.join(_xdgCache, _appDir);

  export const prompts = path.join(config, "prompts");

  export const modelsCache = path.join(cache, "models.json");

  export const modelStore = path.join(state, "model.json");

  export const kvStore = path.join(state, "kv.json");

  export const authStore = path.join(data, "auth.json");

  export const mcpAuthStore = path.join(data, "mcp-auth.json");

  export const storage = path.join(data, "storage");
}
```

### 2.3 跨平台行为说明

- **Windows**：`%USERPROFILE%\.config\tong_work\agent-core` 等路径
- **macOS**：`~/Library/Application Support/tong_work/agent-core` 或通过 xdg-basedir 映射
- **Linux**：`~/.config/tong_work/agent-core` 等标准 XDG 路径

**测试覆盖**：可通过 `AGENT_CORE_TEST_HOME` 环境变量覆盖 home 路径，用于测试隔离。

### 2.4 config/state/data 三者的区别

| 目录 | 用途 | 典型内容 | 用户能否直接编辑 |
|------|------|----------|------------------|
| `config` | 用户配置、偏好 | `tong_work.jsonc`、`prompts/` | 是 |
| `state` | 运行时状态 | `model.json`、`kv.json` | 否（应用自动维护） |
| `data` | 持久业务数据 | `auth.json`、`storage/` | 否（代码读写） |
| `cache` | 临时缓存 | `models.json` | 否（可随时清理） |

---

## 三、ConfigSource 核心抽象

### 3.1 接口定义

**文件路径**：`packages/core/src/config/source.ts`

```typescript
export interface ConfigSource {
  /** 来源标识，用于日志和排查 */
  readonly name: string;

  /** 优先级：低 = 先加载，高 = 后加载（覆盖前者） */
  readonly priority: number;

  /** 加载配置，返回 null 表示跳过 */
  load(): Promise<Config.Info | null>;
}

export interface ConfigSourceRegistry {
  /** 注册配置来源 */
  register(source: ConfigSource): void;

  /** 清空所有已注册来源 */
  clear(): void;

  /** 获取已注册并按优先级排序的来源列表 */
  getSources(): ConfigSource[];
}
```

### 3.2 注册机制实现

**文件路径**：`packages/core/src/config/registry.ts`

```typescript
import type { ConfigSource } from "./source.js";

class ConfigSourceRegistryImpl implements ConfigSourceRegistry {
  private sources: ConfigSource[] = [];

  register(source: ConfigSource): void {
    this.sources.push(source);
  }

  clear(): void {
    this.sources.length = 0;
  }

  getSources(): ConfigSource[] {
    return [...this.sources].sort((a, b) => a.priority - b.priority);
  }

  /** 获取注册来源数量（用于测试） */
  size(): number {
    return this.sources.length;
  }
}

export const configRegistry = new ConfigSourceRegistryImpl();
```

---

## 四、配置层级与来源

### 4.1 配置层级总览

| 优先级 | 来源 | 触发条件 | 说明 |
|--------|------|----------|------|
| 0 | **Global** | 始终 | `~/.config/tong_work/agent-core/tong_work.json{c}` |
| 10 | **Environment** | `activeEnvironment` 指定 | `~/.config/tong_work/agent-core/environments/{env-name}/` |
| 100 | **Inline** | `AGENT_CORE_CONFIG_CONTENT` | 环境变量内联 JSON |
| 200 | **Custom** | `AGENT_CORE_CONFIG` | 指定文件路径 |
| -100 | **Remote**（可选） | 企业 auth wellknown | 远程组织配置 |
| 999 | **Managed**（可选） | 企业托管目录存在 | 系统级强制配置 |

**合并顺序**：优先级从小到大依次合并，后加载的覆盖先加载的。

**重要概念**：**Environment 配置**指的是 **Agent 运行时上下文**的配置，不是部署环境（dev/staging/prod）。

**配置继承关系**：

```
Global (tong_work.jsonc)
    ↓ 被 Environment 运行时配置覆盖
Environment (environments/{os_env|web_env}/config.jsonc)
    ↓ 被 Inline/Custom 覆盖
Inline/Custom
```

示例：
- Global 设置 `defaultModel: "gpt-4"`
- `os_env` Environment 设置 `defaultModel: "claude-opus"`（用于系统操作）
- `web_env` Environment 设置 `defaultModel: "gpt-4-turbo"`（用于 Web 操作）
- 最终配置取决于当前激活的 Environment

### 4.2 Auth 认证配置

**文件位置**：`~/.local/share/tong_work/agent-core/auth.json`

**作用**：存储各 Provider 的认证信息（API Key、Token 等），与主配置分离以提高安全性。主配置通过变量引用 `${auth:provider-name}` 来使用 auth.json 中的认证信息。

**变量引用格式**：

```
${auth:provider-name}     # 引用 auth.json 中的 provider 的 key
${ENV_VAR}                # 引用环境变量
```

**Schema 定义**（`types.ts`）：

```typescript
const AuthProviderConfig = z.object({
  type: z.enum(["api", "oauth", "basic"]).describe("Authentication type"),
  key: z.string().describe("API key or token"),
  baseURL: z.string().optional().describe("Provider base URL if different from default"),
  metadata: z.record(z.unknown()).optional().describe("Additional auth metadata"),
});

export const AuthConfig = z.record(AuthProviderConfig);
```

**示例**（`auth.json`）：

```json
{
  "zhipuai-coding-plan": {
    "type": "api",
    "key": "90637d406dca4467bfc966b46d2fb9b0.xxx",
    "metadata": {
      "provider": "zhipuai",
      "model": "glm-4"
    }
  },
  "kimi-for-coding": {
    "type": "api",
    "key": "sk-opPZNOiVQ3XJyijNjn23Ss1OMSPLl9AqLH8jfVaZnPGPoBEL",
    "baseURL": "https://api.moonshot.cn/v1"
  },
  "anthropic-claude": {
    "type": "api",
    "key": "${ANTHROPIC_API_KEY}"
  }
}
```

**在配置中引用**（`tong_work.jsonc` 或 `config.jsonc`）：

```jsonc
{
  // 使用 ${auth:provider-name} 引用 auth.json 中的 key
  "apiKey": "${auth:anthropic-claude}",
  
  "provider": {
    "anthropic": {
      "baseURL": "https://api.anthropic.com/v1",
      "apiKey": "${auth:anthropic-claude}",
      "defaultModel": "claude-sonnet-4-5"
    },
    "zhipuai": {
      "baseURL": "https://open.bigmodel.cn/api/paas/v4",
      "apiKey": "${auth:zhipuai-coding-plan}",
      "defaultModel": "glm-4"
    }
  }
}
```

**支持两种变量引用格式**：

1. **Auth 引用**：`${auth:provider-name}` - 从 auth.json 读取对应 provider 的 key
2. **环境变量**：`${ENV_VAR}` - 从 process.env 读取环境变量

**使用方式**：

```typescript
import { Auth_getApiKey, Auth_getProvider } from "@tong_work/config";

// 获取 API Key
const apiKey = await Auth_getApiKey("zhipuai-coding-plan");

// 获取完整 Provider 配置
const provider = await Auth_getProvider("kimi-for-coding");
// provider = { type: "api", key: "sk-...", baseURL: "https://..." }
```

**安全说明**：
- `auth.json` 存储在 `~/.local/share/`（data 目录），而不是 `~/.config/`（config 目录）
- 支持环境变量占位符（如 `"${ANTHROPIC_API_KEY}"`）
- 建议设置文件权限为 `600`（仅所有者可读写）

### 4.3 Global 来源实现

**文件路径**：`packages/core/src/config/sources/global.ts`

```typescript
import path from "path";
import fs from "fs/promises";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";
import type { Config.Info } from "../types.js";

const CONFIG_FILENAMES = ["tong_work.jsonc", "tong_work.json"];

export async function loadGlobalConfig(): Promise<Config.Info | null> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = path.join(ConfigPaths.config, filename);
    try {
      const content = await fs.readFile(filepath, "utf-8");
      return parseConfigFile(content, filepath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      console.warn(`[Config] Failed to read global config "${filepath}":`, error);
    }
  }
  return null;
}

function parseConfigFile(content: string, filepath: string): Config.Info {
  if (filepath.endsWith(".jsonc")) {
    return parseJsonc(content);
  }
  return JSON.parse(content);
}

function parseJsonc(content: string): Config.Info {
  // TODO: 实现 JSONC 解析（支持注释和尾随逗号）
  // 可复用第三方库如 jsonc-parser，或实现简化版解析器
  return JSON.parse(content);
}

export const globalSource: ConfigSource = {
  name: "global",
  priority: 0,
  load: loadGlobalConfig,
};
```

### 4.3 Custom 文件来源实现

**文件路径**：`packages/core/src/config/sources/file.ts`

```typescript
import fs from "fs/promises";
import path from "path";
import type { ConfigSource } from "../source.js";
import type { Config.Info } from "../types.js";

export async function loadFileConfig(filepath: string): Promise<Config.Info | null> {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    const ext = path.extname(filepath);
    if (ext === ".jsonc") {
      return parseJsonc(content);
    }
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    console.warn(`[Config] Failed to read config file "${filepath}":`, error);
    return null;
  }
}

function parseJsonc(content: string): Config.Info {
  // TODO: 实现 JSONC 解析
  return JSON.parse(content);
}

export function createFileSource(
  filepath: string,
  priority: number = 200
): ConfigSource {
  return {
    name: `file:${path.basename(filepath)}`,
    priority,
    load: () => loadFileConfig(filepath),
  };
}
```

### 4.4 Environment 运行时配置源

**文件路径**：`packages/core/src/config/sources/environment.ts`

**重要**：此处的 Environment 指的是 **Agent 运行时上下文**（如 OsEnv），不是部署环境。

Environment 配置源加载指定 Agent 运行时环境的配置，包含该环境的 Agents、Models、工具等配置。

```typescript
import path from "path";
import fs from "fs/promises";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

const ENV_CONFIG_FILENAME = "config.jsonc";
const ENV_AGENTS_FILENAME = "agents.jsonc";
const ENV_MODELS_FILENAME = "models.jsonc";

export async function loadEnvironmentConfig(envName: string): Promise<Config.Info | null> {
  const envDir = path.join(ConfigPaths.environments, envName);
  
  try {
    // 1. 加载主配置
    const configPath = path.join(envDir, ENV_CONFIG_FILENAME);
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseEnvironmentConfig(configContent, configPath);
    
    // 2. 加载 Agents 配置（可选）
    const agentsPath = path.join(envDir, ENV_AGENTS_FILENAME);
    try {
      const agentsContent = await fs.readFile(agentsPath, "utf-8");
      config.agents = parseEnvironmentConfig(agentsContent, agentsPath);
    } catch {
      // agents.jsonc 可选
    }
    
    // 3. 加载 Models 配置（可选）
    const modelsPath = path.join(envDir, ENV_MODELS_FILENAME);
    try {
      const modelsContent = await fs.readFile(modelsPath, "utf-8");
      config.models = parseEnvironmentConfig(modelsContent, modelsPath);
    } catch {
      // models.jsonc 可选
    }
    
    return config;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      console.warn(`[Config] Environment "${envName}" not found at ${envDir}`);
      return null;
    }
    console.warn(`[Config] Failed to read environment config:`, error);
    return null;
  }
}

function parseEnvironmentConfig(content: string, filepath: string): Config.Info {
  // 简化实现：移除注释和尾随逗号
  const cleaned = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(cleaned);
}

export function createEnvironmentSource(
  envName: string,
  priority: number = 10
): ConfigSource {
  return {
    name: `environment:${envName}`,
    priority,
    load: () => loadEnvironmentConfig(envName),
  };
}
```

**Environment 配置加载流程**：

1. 首先加载 Global 配置（`tong_work.jsonc`）
2. 检查 Global 配置中的 `activeEnvironment` 字段（或回退到 `defaultEnvironment`）
3. 如果存在，加载对应的 Environment 运行时配置：
   - `environments/{env-name}/config.jsonc` - 主配置
   - `environments/{env-name}/agents.jsonc` - Agents 配置（可选）
   - `environments/{env-name}/models.jsonc` - Models 配置（可选）
4. Environment 配置与 Global 配置合并（Environment 优先级更高）

**Environment 配置示例**（`environments/os_env/config.jsonc`）：

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
  
  // 能力声明
  "capabilities": {
    "logs": true,
    "events": true,
    "metrics": true,
    "profiles": true,
    "mcpTools": false
  }
}
```

### 4.5 Inline 来源实现

**文件路径**：`packages/core/src/config/sources/inline.ts`

```typescript
import type { ConfigSource } from "../source.js";
import type { Config.Info } from "../types.js";

export function createInlineSource(content: string, priority: number = 100): ConfigSource {
  return {
    name: "inline",
    priority,
    load: async () => {
      try {
        return JSON.parse(content);
      } catch (error) {
        console.warn("[Config] Failed to parse inline config:", error);
        return null;
      }
    },
  };
}
```

### 4.6 默认来源注册

**文件路径**：`packages/core/src/config/default-sources.ts`

```typescript
import { configRegistry } from "./registry.js";
import { globalSource } from "./sources/global.js";
import { createFileSource } from "./sources/file.js";
import { createInlineSource } from "./sources/inline.js";
import { createEnvironmentSource } from "./sources/environment.js";

export function initDefaultSources(): void {
  configRegistry.clear();
  configRegistry.register(globalSource);
}

export async function initWithEnvOverrides(): Promise<void> {
  initDefaultSources();

  // 先加载 Global 配置以获取 defaultEnvironment
  const globalConfig = await globalSource.load();
  const defaultEnv = globalConfig?.defaultEnvironment;

  // 如果指定了 Environment，注册 Environment 配置源
  if (defaultEnv) {
    configRegistry.register(createEnvironmentSource(defaultEnv, 10));
  }

  // Inline 内容（优先级高于 Environment）
  if (process.env.AGENT_CORE_CONFIG_CONTENT) {
    configRegistry.register(
      createInlineSource(process.env.AGENT_CORE_CONFIG_CONTENT, 100)
    );
  }

  // Custom 文件（优先级最高）
  if (process.env.AGENT_CORE_CONFIG) {
    configRegistry.register(
      createFileSource(process.env.AGENT_CORE_CONFIG, 200)
    );
  }
}
```

**注意**：`initWithEnvOverrides` 现在返回 `Promise<void>`，因为需要异步加载 Global 配置来确定 Environment。

---

## 五、配置 Schema 定义

### 5.1 统一配置 Info 类型

**文件路径**：`packages/core/src/config/types.ts`

```typescript
import { z } from "zod";

// Provider 配置
const ProviderConfig = z.object({
  baseURL: z.string().optional().describe("Provider base URL"),
  apiKey: z.string().optional().describe("API key"),
  defaultModel: z.string().optional().describe("Default model for this provider"),
});

// Agent 配置（基于 env_spec/types.ts AgentSpec）
const AgentConfig = z.object({
  id: z.string(),
  role: z.enum(["primary", "sub"]),
  promptId: z.string().optional(),
  promptOverride: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Environment Profile 配置
const ProfileConfig = z.object({
  id: z.string(),
  displayName: z.string(),
  primaryAgents: z.array(AgentConfig),
  subAgents: z.array(AgentConfig).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Environment 运行时配置
const EnvironmentRuntimeConfig = z.object({
  id: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  capabilities: z.object({
    logs: z.boolean().optional(),
    events: z.boolean().optional(),
    metrics: z.boolean().optional(),
    profiles: z.boolean().optional(),
    mcpTools: z.boolean().optional(),
  }).optional(),
  profiles: z.array(ProfileConfig).optional(),
});

// 主配置 Schema
export const ConfigInfo = z.object({
  // === 当前激活的 Environment ===
  // 指定当前使用哪个 Agent 运行时环境（如 'os_env', 'web_env'）
  activeEnvironment: z.string().optional().describe("Active Agent runtime environment name (e.g., 'os_env', 'web_env')"),
  
  // === 默认模型配置（当 Environment 未指定时回退到此配置）===
  defaultModel: z.string().optional().describe("Default LLM model, format: provider/model"),
  baseURL: z.string().optional().describe("Default LLM provider base URL"),
  apiKey: z.string().optional().describe("Default LLM API key"),
  
  // === Provider 配置 ===
  provider: z.record(ProviderConfig).optional().describe("Provider-specific configurations"),
  
  // === Environment 运行时配置（内联配置或从文件加载）===
  environment: EnvironmentRuntimeConfig.optional().describe("Agent runtime environment configuration"),
  
  // === Agents 配置（可以从单独的 agents.jsonc 加载）===
  agents: z.array(AgentConfig).optional().describe("Agent specifications for this environment"),
  
  // === Models 配置（可以从单独的 models.jsonc 加载）===
  models: z.record(z.object({
    provider: z.string(),
    modelId: z.string(),
    displayName: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
  })).optional().describe("Model configurations for this environment"),
  
  // === 其他配置（预留扩展）===
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
});

export namespace Config {
  export type Info = z.infer<typeof ConfigInfo>;
}
```

### 5.2 示例配置文件

**`~/.config/tong_work/agent-core/tong_work.jsonc`**：

```jsonc
{
  // 默认模型配置
  "defaultModel": "anthropic/claude-sonnet-4-5",
  "baseURL": "https://api.anthropic.com",
  "apiKey": "${ANTHROPIC_API_KEY}",

  // Provider 详细配置
  "provider": {
    "openai": {
      "baseURL": "https://api.openai.com/v1",
      "defaultModel": "gpt-4o"
    },
    "anthropic": {
      "baseURL": "https://api.anthropic.com/v1",
      "defaultModel": "claude-sonnet-4-5"
    }
  }
  
  // 注：当前版本仅支持基础模型配置
  // 治理策略（timeout/retry/concurrency）等高级配置暂不实现
}
```

---

## 六、配置加载与合并

### 6.1 加载流程

**文件路径**：`packages/core/src/config/loader.ts`

```typescript
import { configRegistry } from "./registry.js";
import type { Config.Info } from "./types.js";
import { mergeDeep } from "./merge.js";

export async function loadConfig(): Promise<Config.Info> {
  const sources = configRegistry.getSources();
  let result: Config.Info = {};

  for (const source of sources) {
    try {
      const loaded = await source.load();
      if (loaded) {
        console.log(`[Config] Loaded from "${source.name}"`);
        result = mergeDeep(result, loaded);
      }
    } catch (error) {
      console.warn(`[Config] Failed to load config from "${source.name}":`, error);
    }
  }

  return postProcess(result);
}

// 当前版本不设置默认值，保持配置简洁
// 后续版本可在此处添加配置校验和默认值
```

### 6.2 合并策略

**文件路径**：`packages/core/src/config/merge.ts`

```typescript
import { remeda } from "remeda";

export function mergeDeep<T>(target: T, source: Partial<T>): T {
  // remeda.mergeDeep 实现深合并
  // - 对象字段递归合并
  // - 数组字段默认替换（可配置为追加）
  return remeda.mergeDeep(target, source) as T;
}

export function mergeWithArrayConcat<T>(
  target: T,
  source: Partial<T>,
  arrayFields: string[]
): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetValue = (result as Record<string, unknown>)[key];
    const sourceValue = (source as Record<string, unknown>)[key];

    if (arrayFields.includes(key) && Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      (result as Record<string, unknown>)[key] = [...targetValue, ...sourceValue];
    } else if (typeof targetValue === "object" && typeof sourceValue === "object") {
      (result as Record<string, unknown>)[key] = mergeWithArrayConcat(
        targetValue as T,
        sourceValue as Partial<T>,
        arrayFields
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}
```

---

## 七、状态持久化（用户级模型选择）

### 7.1 ModelStore 设计

**文件路径**：`packages/core/src/config/state/model-store.ts`

```typescript
import { ConfigPaths } from "../paths.js";
import fs from "fs/promises";

export interface ModelEntry {
  providerID: string;
  modelID: string;
}

export interface ModelStoreData {
  recent: ModelEntry[];
  favorite: ModelEntry[];
  variant: Record<string, string>;
}

export class ModelStore {
  private data: ModelStoreData = {
    recent: [],
    favorite: [],
    variant: {},
  };
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(ConfigPaths.modelStore, "utf-8");
      const parsed = JSON.parse(content);
      this.data = {
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        favorite: Array.isArray(parsed.favorite) ? parsed.favorite : [],
        variant: typeof parsed.variant === "object" ? parsed.variant : {},
      };
      this.loaded = true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        this.loaded = true;
        return;
      }
      console.warn("[ModelStore] Failed to load:", error);
      this.loaded = true;
    }
  }

  async save(): Promise<void> {
    await fs.writeFile(
      ConfigPaths.modelStore,
      JSON.stringify(this.data, null, 2)
    );
  }

  async getRecent(): Promise<ModelEntry[]> {
    await this.ensureLoaded();
    return this.data.recent;
  }

  async addRecent(providerID: string, modelID: string): Promise<void> {
    await this.ensureLoaded();
    this.data.recent = this.data.recent.filter(
      (m) => !(m.providerID === providerID && m.modelID === modelID)
    );
    this.data.recent.unshift({ providerID, modelID });
    this.data.recent = this.data.recent.slice(0, 10);
    await this.save();
  }

  async getFavorite(): Promise<ModelEntry[]> {
    await this.ensureLoaded();
    return this.data.favorite;
  }

  async toggleFavorite(providerID: string, modelID: string): Promise<boolean> {
    await this.ensureLoaded();
    const exists = this.data.favorite.some(
      (m) => m.providerID === providerID && m.modelID === modelID
    );

    if (exists) {
      this.data.favorite = this.data.favorite.filter(
        (m) => !(m.providerID === providerID && m.modelID === modelID)
      );
    } else {
      this.data.favorite.push({ providerID, modelID });
    }
    await this.save();
    return !exists;
  }

  async getVariant(providerID: string, modelID: string): Promise<string | undefined> {
    await this.ensureLoaded();
    const key = `${providerID}/${modelID}`;
    return this.data.variant[key];
  }

  async setVariant(providerID: string, modelID: string, variant: string): Promise<void> {
    await this.ensureLoaded();
    const key = `${providerID}/${modelID}`;
    this.data.variant[key] = variant;
    await this.save();
  }

  async clear(): Promise<void> {
    this.data = { recent: [], favorite: [], variant: {} };
    await this.save();
  }
}
```

### 7.2 ModelStore 文件格式

**`~/.local/state/tong_work/agent-core/model.json`**：

```json
{
  "recent": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
    { "providerID": "openai", "modelID": "gpt-4o" }
  ],
  "favorite": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }
  ],
  "variant": {
    "anthropic/claude-sonnet-4-5": "reasoning"
  }
}
```

---

## 八、配置获取与使用

### 8.1 配置读取 API

参考 OpenCode 的配置读取模式，提供统一的配置获取方式：

**文件路径**：`packages/core/src/config/config.ts`

```typescript
import { loadConfig } from "./loader.js";
import type { Config } from "./types.js";

// 内部缓存
let cachedConfig: Config.Info | null = null;
let configLoaded = false;

/**
 * 获取合并后的配置
 * 首次调用会触发配置加载，后续调用返回缓存
 */
export async function Config_get(): Promise<Config.Info> {
  if (!configLoaded) {
    cachedConfig = await loadConfig();
    configLoaded = true;
  }
  return cachedConfig ?? {};
}

/**
 * 强制重新加载配置
 * 用于配置变更后刷新
 */
export async function Config_reload(): Promise<Config.Info> {
  cachedConfig = null;
  configLoaded = false;
  return Config_get();
}

/**
 * 清除配置缓存
 * 下次 Config_get() 会重新加载
 */
export function Config_clear(): void {
  cachedConfig = null;
  configLoaded = false;
}

/**
 * 同步获取配置（仅当配置已加载时可用）
 * 适用于配置加载完成后的场景
 */
export function Config_getSync(): Config.Info | null {
  return cachedConfig;
}
```

### 8.2 使用示例

```typescript
import { Config_get, Config_getSync } from "@tong_work/config";

// 异步获取配置（推荐）
async function example() {
  const config = await Config_get();
  
  // 获取默认模型
  const model = config.defaultModel;
  
  // 获取 Environment 配置
  const envConfig = config.environment;
  
  // 获取 provider 配置
  const providerConfig = config.provider?.["openai"];
}

// 同步获取（仅在配置已加载后使用）
function exampleSync() {
  const config = Config_getSync();
  if (config) {
    console.log(config.defaultModel);
  }
}
```

### 8.3 配置变更监听

```typescript
// 配置变更回调类型
type ConfigChangeCallback = (config: Config.Info) => void;

const listeners: Set<ConfigChangeCallback> = new Set();

/**
 * 订阅配置变更
 */
export function Config_onChange(callback: ConfigChangeCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * 触发配置变更通知
 */
export function Config_notifyChange(config: Config.Info): void {
  listeners.forEach(cb => cb(config));
}
```

---

## 九、环境变量汇总

| 变量 | 作用 | 优先级 |
|------|------|--------|
| `AGENT_CORE_CONFIG` | 指定单个配置文件路径 | 200 |
| `AGENT_CORE_CONFIG_CONTENT` | 内联 JSON 配置字符串 | 100 |
| `AGENT_CORE_CONFIG_DIR` | （保留）追加额外配置目录 | - |
| `AGENT_CORE_DISABLE_PROJECT_CONFIG` | （已废弃）项目配置不存在 | - |
| `AGENT_CORE_TEST_HOME` | 测试时覆盖 home 路径 | - |
| `AGENT_CORE_LOG_LEVEL` | 日志级别（覆盖 config.debug.logLevel） | - |

---

## 十、文件组织

```
packages/core/src/config/
├── index.ts                        # 主入口，export Config_get, loadConfig, ModelStore
├── config.ts                       # Config_get, Config_reload, Config_onChange 等 API

# === 路径与目录 ===
├── paths.ts                        # ConfigPaths 命名空间，xdg-basedir 兼容

# === 配置来源抽象 ===
├── source.ts                       # ConfigSource 接口
├── registry.ts                     # ConfigSourceRegistry 实现

# === 默认来源注册 ===
├── default-sources.ts              # initDefaultSources, initWithEnvOverrides

# === 各来源实现 ===
└── sources/
    ├── global.ts                   # Global 配置加载（tong_work.jsonc/json）
    ├── file.ts                     # 通用文件加载（createFileSource）
    └── inline.ts                   # Inline 来源（createInlineSource）

# === Schema 与类型 ===
├── types.ts                        # ConfigInfo Zod Schema

# === 合并策略 ===
├── merge.ts                        # mergeDeep, mergeWithArrayConcat

# === 配置加载 ===
├── loader.ts                       # loadConfig 配置加载流程

# === 状态持久化 ===
└── state/
    └── model-store.ts              # ModelStore 用户级模型选择持久化
```

---

## 十一、与 OpenCode 对比

| 维度 | OpenCode | tong_work |
|------|----------|-----------|
| **默认层级** | 7 层（Remote/Global/Custom/Project/.opencode/Inline/Managed） | 1 层（Global） |
| **项目绑定** | 支持 Project + .opencode 目录 | 无（用户级配置） |
| **扩展方式** | 写死在代码中 | registerSource 按需注册 |
| **目录结构** | xdg-basedir + .opencode | xdg-basedir |
| **配置 Schema** | 复杂（Agent/Mode/Plugin/治理策略等） | 极简（仅 LLM/Provider） |
| **配置读取** | Config.get() 等 | Config_get() / Config_getSync() |
| **状态持久化** | model.json | model.json（兼容） |
| **应用场景** | 代码助手 | 企业任务自主推进（不限于代码） |

---

## 十二、实施路线图

### Phase 1：基础配置系统 ✅ 已完成

- [x] 创建 `packages/core/src/config/` 目录结构
- [x] 实现 `paths.ts`：ConfigPaths 命名空间
- [x] 实现 `source.ts` + `registry.ts`：ConfigSource 抽象
- [x] 实现 `types.ts`：ConfigInfo Zod Schema（简化版，仅基础 LLM 配置）
- [x] 实现 `merge.ts`：合并策略
- [x] 实现 `sources/global.ts`：Global 配置加载
- [x] 实现 `loader.ts` + `default-sources.ts`：加载入口
- [x] 实现 `config.ts`：Config_get() 等配置读取 API

### Phase 2：状态持久化（1 天）

- [ ] 实现 `state/model-store.ts`
- [ ] TUI 集成模型选择持久化
- [ ] 配置状态 API

### Phase 3：扩展能力（按需）

- [ ] Remote 来源（企业 auth wellknown）
- [ ] Managed 来源（企业托管目录）
- [ ] JSONC 解析支持
- [ ] 配置热重载
- [ ] 配置验证与错误提示优化

---

## 十三、测试要点

### 13.1 配置加载测试

```typescript
// 加载优先级测试
test("config priority: inline overrides global", async () => {
  initWithEnvOverrides();
  // Global 返回 { defaultModel: "a" }, Inline 返回 { defaultModel: "b" }
  const config = await loadConfig();
  expect(config.defaultModel).toBe("b");
});

// Config_get API 测试
test("Config_get returns cached config", async () => {
  const config1 = await Config_get();
  const config2 = await Config_get();
  expect(config1).toBe(config2); // 应该是同一个对象（缓存）
});

test("Config_reload clears cache", async () => {
  const config1 = await Config_get();
  await Config_reload();
  const config2 = await Config_get();
  // 重新加载后应该是新对象
  expect(config1).not.toBe(config2);
});
```

### 13.2 ModelStore 测试

```typescript
test("recent models limited to 10", async () => {
  const store = new ModelStore();
  for (let i = 0; i < 15; i++) {
    await store.addRecent("provider", `model-${i}`);
  }
  const recent = await store.getRecent();
  expect(recent.length).toBe(10);
});
```

---

## 十四、参考文档

- **OpenCode 配置管理**：`docs/app-config-management.md`
- **可扩展配置设计**：`docs/extensible-config-design.md`
- **Environment 设计理念**：`docs/environment-design-philosophy.md`
- **Env Spec 设计**：`docs/env-spec-design-and-implementation.md`

---

## 十五、总结

tong_work 配置系统的设计要点：

1. **用户级配置**：不绑定项目，随用户走，适合任何工作场景
2. **简洁默认**：仅 Global 一层，通过环境变量扩展
3. **极简配置项**：当前仅实现基础 LLM 配置（defaultModel/baseURL/apiKey/provider），治理策略等高级配置暂不实现
4. **配置读取 API**：参考 OpenCode 设计，提供 `Config_get()` / `Config_getSync()` / `Config_reload()` / `Config_onChange()` 等统一接口
5. **可观测**：每个来源有 `name`，便于排查
6. **兼容 xdg-basedir**：复用成熟目录规范
7. **用户级状态持久化**：`model.json` 存储模型选择，随用户走
