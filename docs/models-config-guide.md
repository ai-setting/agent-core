# 从配置文件加载模型列表

本文档说明如何配置模型列表，让 `/models` 命令从配置文件中读取可用的模型，而不是使用内置的硬编码列表。

## 配置方式

### 方式一：Environment-specific 模型配置（推荐）

在特定 Environment 目录下创建 `models.jsonc` 文件：

**文件路径**：
```
~/.config/tong_work/agent-core/environments/{environment-name}/models.jsonc
```

**示例**：
```jsonc
{
  "gpt-4o": {
    "provider": "openai",
    "modelId": "gpt-4o",
    "displayName": "GPT-4o",
    "capabilities": ["vision", "function-calling"]
  },
  
  "claude-3-opus": {
    "provider": "anthropic", 
    "modelId": "claude-3-opus-20240229",
    "displayName": "Claude 3 Opus",
    "capabilities": ["vision", "long-context"]
  }
}
```

**激活 Environment**：

在主配置文件中设置 `activeEnvironment`：

```jsonc
// ~/.config/tong_work/agent-core/tong_work.jsonc
{
  "activeEnvironment": "server_env"
}
```

### 方式二：Provider 配置中的 models 字段

在 `tong_work.jsonc` 的 `provider` 配置中指定模型列表：

```jsonc
{
  "provider": {
    "anthropic": {
      "baseURL": "https://api.anthropic.com/v1",
      "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"]
    },
    "openai": {
      "baseURL": "https://api.openai.com/v1", 
      "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]
    }
  }
}
```

## 优先级

模型列表的加载优先级（从高到低）：

1. **Environment models.jsonc** - 如果设置了 `activeEnvironment` 且存在 `models.jsonc`
2. **Provider configuration** - 如果在 `provider.*.models` 中配置了模型列表
3. **Built-in defaults** - 内置的默认模型列表（作为后备）

## 配置字段说明

### ModelConfig 结构

```typescript
{
  "model-key": {
    "provider": "provider-id",      // 必需：Provider ID (如 "anthropic", "openai")
    "modelId": "actual-model-id",   // 必需：实际的模型 ID
    "displayName": "显示名称",       // 可选：在 UI 中显示的名称
    "capabilities": ["vision"]      // 可选：模型能力列表
  }
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `provider` | string | ✓ | Provider ID，对应 auth.json 中的 provider |
| `modelId` | string | ✓ | 实际的模型 ID，用于 API 调用 |
| `displayName` | string | ✗ | 显示名称，如果不设置则使用 modelId |
| `capabilities` | string[] | ✗ | 模型能力列表（如 vision, function-calling 等）|

## 完整的 Environment 配置示例

创建目录结构：

```
~/.config/tong_work/agent-core/
├── tong_work.jsonc          # 主配置
└── environments/
    └── server_env/          # Environment 目录
        ├── config.jsonc     # Environment 配置
        ├── agents.jsonc     # Agents 配置
        └── models.jsonc     # 模型配置
```

**tong_work.jsonc**：
```jsonc
{
  "activeEnvironment": "server_env"
}
```

**environments/server_env/models.jsonc**：
```jsonc
{
  "claude-3-opus": {
    "provider": "anthropic",
    "modelId": "claude-3-opus-20240229",
    "displayName": "Claude 3 Opus",
    "capabilities": ["vision", "function-calling", "long-context"]
  },
  
  "claude-3-sonnet": {
    "provider": "anthropic",
    "modelId": "claude-3-sonnet-20240229",
    "displayName": "Claude 3 Sonnet",
    "capabilities": ["vision", "function-calling"]
  },
  
  "gpt-4o": {
    "provider": "openai",
    "modelId": "gpt-4o",
    "displayName": "GPT-4o",
    "capabilities": ["vision", "function-calling", "json-mode"]
  },
  
  "gpt-4-turbo": {
    "provider": "openai",
    "modelId": "gpt-4-turbo",
    "displayName": "GPT-4 Turbo",
    "capabilities": ["vision", "function-calling"]
  }
}
```

## 验证配置

启动 Server 后，查看控制台输出：

```
[ModelsConfig] Loaded X models from environment "server_env"
[ModelsCommand] Loaded provider models: Y
```

或者在 TUI 中执行 `/models` 命令，应该能看到配置的模型列表。

## API 使用

### 在代码中获取配置模型

```typescript
import { 
  ModelsConfig_getAll, 
  ModelsConfig_getFromEnvironment 
} from "@/config/models-config.js";

// 获取所有模型（自动选择来源）
const providerModels = await ModelsConfig_getAll();

// 从特定 Environment 获取模型
const envModels = await ModelsConfig_getFromEnvironment("server_env");

// 获取当前激活的 Environment
const activeEnv = await ModelsConfig_getActiveEnvironment();
```

### 在 ServerEnvironment 中访问

ServerEnvironment 初始化时会自动加载配置中的模型信息，可以通过 `Config_get()` 获取完整配置：

```typescript
import { Config_get } from "@/config/index.js";

const config = await Config_get();
console.log(config.activeEnvironment);  // "server_env"
console.log(config.models);             // 模型配置对象
```

## 注意事项

1. **JSONC 格式**：配置文件使用 JSONC 格式，支持注释和尾随逗号
2. **Provider 必须先配置**：确保在 `auth.json` 中配置了对应的 Provider API Key
3. **即时生效**：修改配置后，重启 Server 即可生效（无需重新编译）
4. **优先级覆盖**：Environment 配置会完全覆盖 Provider 配置中的模型列表
