# 模型选择优先级逻辑

本文档说明 agent-core 中模型选择的完整优先级逻辑。

## 优先级链

当系统需要选择一个 LLM 模型时（启动时或切换模型时），按以下优先级顺序选择：

```
1. Recent Model（用户最近选择）> 2. Config Default（配置默认）> 3. Provider Default（Provider 默认）
```

### 详细说明

#### 1. Recent Model（最高优先级）

用户通过 `/models` 命令选择的最后一个模型。

- **存储位置**: `~/.local/state/tong_work/agent-core/model.json`
- **数据结构**: `{ "recent": [{"providerID": "...", "modelID": "..."}] }`
- **使用场景**: 
  - 启动时：如果 recent 列表中有有效的模型，优先使用
  - 运行时：通过 `/models` 选择新模型后立即生效

**为什么 recent 优先级最高？**
- 用户的选择应该被记住并优先使用
- 提供更好的用户体验，不需要每次启动都重新选择

#### 2. Config Default（中等优先级）

在主配置文件中指定的默认模型。

- **配置项**: `defaultModel` in `tong_work.jsonc`
- **格式**: `"provider/model"` (例如 `"anthropic/claude-3-opus"`)
- **使用场景**: 当没有 recent 模型时使用

**配置示例**:
```jsonc
// ~/.config/tong_work/agent-core/tong_work.jsonc
{
  "defaultModel": "anthropic/claude-3-opus"
}
```

#### 3. Provider Default（最低优先级）

Provider 配置中指定的默认模型，或 Provider 的模型列表中的第一个。

- **配置项**: `provider.{name}.defaultModel`
- **使用场景**: 当没有 recent 也没有 config default 时使用

**配置示例**:
```jsonc
{
  "provider": {
    "anthropic": {
      "defaultModel": "claude-3-opus"
    }
  }
}
```

## 模型验证

在选择模型时，系统会验证模型是否有效：

### 验证顺序

1. **Config Models** - 检查 `environments/{env}/models.jsonc` 中定义的模型
2. **Provider Models** - 检查 Provider 配置中的 `models` 列表
3. **Provider Default** - 检查是否是 Provider 的 `defaultModel`

### 验证失败处理

如果某个优先级的模型验证失败（无效），系统会回退到下一个优先级：

```
尝试 Recent Model #1 → 无效 → 尝试 Recent Model #2 → 无效 → ... → 
尝试 Config Default → 无效 → 
尝试 Provider Default
```

## 运行时模型切换

通过 `/models` 命令切换模型时：

1. 用户选择模型
2. 调用 `ServerEnvironment.switchModel()`
3. 验证模型有效性
4. 重新初始化 LLM（调用 `configureLLMWithModel`）
5. 更新 `currentModelSelection`（内存）
6. 添加到 `recent` 列表（持久化）

### 代码流程

```typescript
// 1. 选择模型
const result = await command.executeCommand("models", JSON.stringify({
  type: "select",
  providerID: "anthropic",
  modelID: "claude-3-opus"
}));

// 2. Server 端执行
async switchModel(providerID: string, modelID: string): Promise<boolean> {
  // 验证模型
  if (!(await this.isModelValid({ providerID, modelID }, providers))) {
    return false;
  }
  
  // 获取 API key 和 baseURL
  const authInfo = await Auth_getProvider(providerID);
  const baseURL = providerInfo?.baseURL || authInfo.baseURL;
  
  // 重新初始化 LLM
  await this.configureLLMWithModel(
    `${providerID}/${modelID}`, 
    baseURL, 
    authInfo.key
  );
  
  // 更新当前选择
  this.currentModelSelection = { providerID, modelID };
  
  // 添加到 recent
  await this.modelStore.addRecent(providerID, modelID);
  
  return true;
}
```

## 启动时模型选择

Server 启动时的模型选择流程：

```typescript
// ServerEnvironment.constructor
if (config?.loadConfig !== false) {
  this.configLoaded = this.loadConfigAndInitLLM();
}

// loadConfigAndInitLLM 流程:
async loadConfigAndInitLLM(): Promise<void> {
  // 1. 加载配置
  const config = await Config_get();
  
  // 2. 加载用户偏好（recent）
  await this.modelStore.load();
  const recent = await this.modelStore.getRecent();
  
  // 3. 选择模型（按优先级）
  const selectedModel = await this.selectModelWithFallback(
    null,           // currentSelection（启动时为 null）
    configModel,    // config.defaultModel
    recent,         // 用户最近选择
    providers       // provider 列表
  );
  
  // 4. 初始化 LLM
  if (selectedModel) {
    await this.configureLLMWithModel(
      `${selectedModel.providerID}/${selectedModel.modelID}`,
      baseURL,
      authInfo.key
    );
  }
}
```

## 配置示例

### 完整配置示例

**主配置** (`~/.config/tong_work/agent-core/tong_work.jsonc`):
```jsonc
{
  // 激活的 Environment
  "activeEnvironment": "server_env",
  
  // 默认模型（当没有 recent 时使用）
  "defaultModel": "anthropic/claude-3-opus"
}
```

**Environment 模型配置** (`~/.config/tong_work/agent-core/environments/server_env/models.jsonc`):
```jsonc
{
  "claude-3-opus": {
    "provider": "anthropic",
    "modelId": "claude-3-opus-20240229",
    "displayName": "Claude 3 Opus"
  },
  "gpt-4o": {
    "provider": "openai",
    "modelId": "gpt-4o",
    "displayName": "GPT-4o"
  }
}
```

**模型存储** (`~/.local/state/tong_work/agent-core/model.json`):
```json
{
  "recent": [
    {"providerID": "anthropic", "modelID": "claude-3-opus"},
    {"providerID": "openai", "modelID": "gpt-4o"}
  ],
  "favorite": [
    {"providerID": "anthropic", "modelID": "claude-3-opus"}
  ],
  "variant": {}
}
```

## 调试信息

启动时会在控制台输出模型选择过程：

```
[ServerEnvironment] Loading configuration...
[ModelsConfig] Loaded X models from environment "server_env"
[ServerEnvironment] Using recent model: anthropic/claude-3-opus
[ServerEnvironment] Selected model: anthropic/claude-3-opus
[ServerEnvironment] LLM initialized successfully
```

如果使用了 config default：
```
[ServerEnvironment] Using config default model: openai/gpt-4o
```

如果使用了 provider default：
```
[ServerEnvironment] Using provider default model: anthropic/claude-3-sonnet
```

## 相关代码

- **模型选择逻辑**: `packages/core/src/server/environment.ts`
  - `selectModelWithFallback()` - 优先级选择
  - `isModelValid()` - 模型验证
  - `switchModel()` - 运行时切换
  - `loadConfigAndInitLLM()` - 启动时初始化

- **模型配置加载**: `packages/core/src/config/models-config.ts`
  - `ModelsConfig_getAll()` - 从配置加载模型
  - `ModelsConfig_getFromEnvironment()` - 从 environment 加载

- **模型存储**: `packages/core/src/config/state/model-store.ts`
  - `addRecent()` - 添加最近使用
  - `getRecent()` - 获取最近使用列表
