# Models Command 设计文档

## 概述

本文档定义 agent-core 的 `/models` 命令实现设计。该命令允许用户通过 TUI 界面选择和管理 LLM 模型，支持模型浏览、收藏、最近使用记录等功能。

**设计原则**：
1. 遵循 agent-core 的 **后端执行** 架构：command 逻辑在 server 端执行
2. 每个 command 拥有独立的 **Dialog 组件**
3. 借鉴 OpenCode 的模型管理机制（recent/favorite/variant 持久化）
4. 复用已有的 `ModelStore` 和 `Providers` 配置系统

---

## 一、总体架构

### 1.1 命令类型

`/models` 是 **后端命令**（与 OpenCode 的前端命令不同）：

- **执行方式**：通过 HTTP API `/commands/models` 调用
- **返回结果**：包含 `mode: "dialog"` 标记，指示 TUI 打开 ModelsDialog
- **不直接操作 UI**：server 端只处理数据和状态，UI 由 TUI 端 Dialog 组件负责

### 1.2 核心流程

```
用户输入 / 并选择 /models
    │
    ├─ CommandPalette 调用 executeCommand("models")
    │
    ├─ POST /commands/models → Server 端 modelsCommand.execute()
    │
    ├─ Server 返回 { mode: "dialog", providers: [...], currentModel: {...} }
    │
    └─ TUI 检测到 mode === "dialog"
            → dialog.replace(() => <ModelsDialog data={result.data} />)
            → 打开模型选择弹窗
            → 用户选择模型 → 调用 modelsCommand with action: "select"
            → Server 更新 ModelStore（addRecent）
            → 返回成功结果 → TUI 关闭 dialog
```

---

## 二、Server 端实现

### 2.1 文件位置

```
packages/core/src/server/command/built-in/models.ts    # 命令实现
packages/core/src/server/command/built-in/index.ts     # 注册命令（已有）
```

### 2.2 Command 定义

```typescript
// packages/core/src/server/command/built-in/models.ts

import type { Command, CommandContext, CommandResult } from "../types.js";
import { ModelStore } from "../../../config/state/model-store.js";
import { Providers_getAll } from "../../../config/providers.js";

interface ModelsAction {
  type: "list" | "select" | "toggle_favorite" | "set_variant";
  providerID?: string;
  modelID?: string;
  variant?: string;
}

interface ModelInfo {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
  isFavorite: boolean;
  variant?: string;
}

interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelInfo[];
}

export const modelsCommand: Command = {
  name: "models",
  displayName: "Models",
  description: "Select and manage LLM models",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    const modelStore = new ModelStore();
    
    // 解析 action
    let action: ModelsAction;
    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON" },
      };
    }

    switch (action.type) {
      case "list": {
        // 获取所有 provider 和模型
        const providers = await Providers_getAll();
        const recent = await modelStore.getRecent();
        const favorites = await modelStore.getFavorite();
        
        // 构建响应数据
        const data = {
          mode: "dialog",
          recent,
          favorites,
          providers: providers.map(p => ({
            providerID: p.id,
            providerName: p.name,
            models: (p.models || []).map(m => ({
              providerID: p.id,
              providerName: p.name,
              modelID: m,
              modelName: m,
              isFavorite: favorites.some(f => 
                f.providerID === p.id && f.modelID === m
              ),
            })),
          })),
        };
        
        return {
          success: true,
          message: "Opening model selection dialog",
          data,
        };
      }

      case "select": {
        if (!action.providerID || !action.modelID) {
          return {
            success: false,
            message: "Missing providerID or modelID",
            data: { error: "Invalid selection" },
          };
        }

        // 添加到 recent
        await modelStore.addRecent(action.providerID, action.modelID);
        
        // 获取 variant
        const variant = await modelStore.getVariant(action.providerID, action.modelID);

        return {
          success: true,
          message: `Model selected: ${action.providerID}/${action.modelID}`,
          data: {
            providerID: action.providerID,
            modelID: action.modelID,
            variant,
          },
        };
      }

      case "toggle_favorite": {
        if (!action.providerID || !action.modelID) {
          return {
            success: false,
            message: "Missing providerID or modelID",
          };
        }

        const isFavorite = await modelStore.toggleFavorite(
          action.providerID,
          action.modelID
        );

        return {
          success: true,
          message: isFavorite ? "Added to favorites" : "Removed from favorites",
          data: { isFavorite },
        };
      }

      case "set_variant": {
        if (!action.providerID || !action.modelID || !action.variant) {
          return {
            success: false,
            message: "Missing required parameters",
          };
        }

        await modelStore.setVariant(action.providerID, action.modelID, action.variant);

        return {
          success: true,
          message: "Variant updated",
          data: { variant: action.variant },
        };
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as ModelsAction).type}`,
        };
    }
  },
};
```

### 2.3 命令注册

```typescript
// packages/core/src/server/command/built-in/index.ts

import { echoCommand } from "./echo.js";
import { connectCommand } from "./connect.js";
import { modelsCommand } from "./models.js";  // 新增

export function registerBuiltInCommands(registry: CommandRegistry): void {
  registry.register(echoCommand);
  registry.register(connectCommand);
  registry.register(modelsCommand);  // 新增
}
```

---

## 三、TUI 端实现

### 3.1 文件位置

```
packages/core/src/cli/tui/components/ModelsDialog.tsx    # Dialog 组件
packages/core/src/cli/tui/components/index.ts            # 导出组件（新增）
packages/core/src/cli/tui/contexts/command.tsx           # 修改 executeCommand 处理
```

### 3.2 ModelsDialog 组件

```typescript
// packages/core/src/cli/tui/components/ModelsDialog.tsx

import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface ModelInfo {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
  isFavorite: boolean;
  variant?: string;
}

interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelInfo[];
}

interface ModelsDialogData {
  recent: Array<{ providerID: string; modelID: string }>;
  favorites: Array<{ providerID: string; modelID: string }>;
  providers: ProviderModels[];
}

interface ModelsDialogProps {
  data: ModelsDialogData;
}

type DialogState = 
  | { type: "list" }
  | { type: "select_variant"; model: ModelInfo };

export function ModelsDialog(props: ModelsDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [state, setState] = createSignal<DialogState>({ type: "list" });
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [favorites, setFavorites] = createSignal<Set<string>>(new Set());
  
  // 初始化 favorites
  onMount(() => {
    const favSet = new Set(
      props.data.favorites.map(f => `${f.providerID}/${f.modelID}`)
    );
    setFavorites(favSet);
  });

  // 构建模型列表（Recent → Favorites → All）
  const modelGroups = createMemo(() => {
    const f = filter().toLowerCase().trim();
    const allModels: ModelInfo[] = [];
    
    // 1. Recent models
    const recentModels: ModelInfo[] = [];
    for (const r of props.data.recent) {
      const provider = props.data.providers.find(p => p.providerID === r.providerID);
      const model = provider?.models.find(m => m.modelID === r.modelID);
      if (model) {
        recentModels.push({ ...model, isFavorite: favorites().has(`${r.providerID}/${r.modelID}`) });
      }
    }
    
    // 2. Favorite models (排除已在 recent 中的)
    const favoriteModels: ModelInfo[] = [];
    for (const fav of props.data.favorites) {
      const key = `${fav.providerID}/${fav.modelID}`;
      if (!props.data.recent.some(r => r.providerID === fav.providerID && r.modelID === fav.modelID)) {
        const provider = props.data.providers.find(p => p.providerID === fav.providerID);
        const model = provider?.models.find(m => m.modelID === fav.modelID);
        if (model) {
          favoriteModels.push({ ...model, isFavorite: true });
        }
      }
    }
    
    // 3. All models (按 provider 分组)
    const providerModels: ProviderModels[] = [];
    for (const provider of props.data.providers) {
      const models = provider.models
        .filter(m => {
          const key = `${m.providerID}/${m.modelID}`;
          // 排除已在 recent/favorites 中的
          return !props.data.recent.some(r => r.providerID === m.providerID && r.modelID === m.modelID) &&
                 !props.data.favorites.some(f => f.providerID === m.providerID && f.modelID === m.modelID);
        })
        .map(m => ({ ...m, isFavorite: favorites().has(`${m.providerID}/${m.modelID}`) }));
      
      if (models.length > 0) {
        providerModels.push({ ...provider, models });
      }
    }
    
    // 过滤
    if (f) {
      const filterFn = (m: ModelInfo) => 
        m.modelID.toLowerCase().includes(f) ||
        m.providerName.toLowerCase().includes(f);
      
      return {
        recent: recentModels.filter(filterFn),
        favorites: favoriteModels.filter(filterFn),
        providers: providerModels
          .map(p => ({ ...p, models: p.models.filter(filterFn) }))
          .filter(p => p.models.length > 0),
      };
    }
    
    return { recent: recentModels, favorites: favoriteModels, providers: providerModels };
  });

  // 扁平化列表用于导航
  const flatModels = createMemo(() => {
    const groups = modelGroups();
    const flat: (ModelInfo & { group: string })[] = [];
    
    if (groups.recent.length > 0) {
      flat.push(...groups.recent.map(m => ({ ...m, group: "Recent" })));
    }
    if (groups.favorites.length > 0) {
      flat.push(...groups.favorites.map(m => ({ ...m, group: "Favorites" })));
    }
    for (const provider of groups.providers) {
      flat.push(...provider.models.map(m => ({ ...m, group: provider.providerName })));
    }
    
    return flat;
  });

  // 选择模型
  const selectModel = async (model: ModelInfo) => {
    tuiLogger.info("[ModelsDialog] Selecting model", { 
      providerID: model.providerID, 
      modelID: model.modelID 
    });
    
    const result = await command.executeCommand(
      "models",
      JSON.stringify({
        type: "select",
        providerID: model.providerID,
        modelID: model.modelID,
      })
    );
    
    if (result.success) {
      dialog.pop();
    }
  };

  // 切换收藏
  const toggleFavorite = async (model: ModelInfo, e: Event) => {
    e.stopPropagation();
    
    const result = await command.executeCommand(
      "models",
      JSON.stringify({
        type: "toggle_favorite",
        providerID: model.providerID,
        modelID: model.modelID,
      })
    );
    
    if (result.success) {
      const key = `${model.providerID}/${model.modelID}`;
      setFavorites(prev => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
    }
  };

  // 键盘导航
  const handleKeyDown = (key: string): boolean => {
    switch (key.toLowerCase()) {
      case "up":
      case "arrowup":
        setSelectedIndex(i => Math.max(0, i - 1));
        return true;
      case "down":
      case "arrowdown":
        setSelectedIndex(i => Math.min(flatModels().length - 1, i + 1));
        return true;
      case "return":
      case "enter": {
        const model = flatModels()[selectedIndex()];
        if (model) selectModel(model);
        return true;
      }
      case "escape":
        dialog.pop();
        return true;
      case "f": {
        // F 键切换收藏
        const model = flatModels()[selectedIndex()];
        if (model) toggleFavorite(model, { stopPropagation: () => {} } as Event);
        return true;
      }
      default:
        return false;
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* 标题栏 */}
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.theme().border}
      >
        <text fg={theme.theme().foreground}>Select Model</text>
        <box flexGrow={1} />
        <text fg={theme.theme().muted}>F: favorite • Esc: close</text>
      </box>

      {/* 搜索框 */}
      <box flexDirection="row" height={1} margin={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          flexGrow={1}
          value={filter()}
          onChange={setFilter}
          placeholder="Filter models..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      {/* 分隔线 */}
      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      {/* 模型列表 */}
      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show when={flatModels().length > 0} fallback={
          <box paddingLeft={2}>
            <text fg={theme.theme().muted}>No models found</text>
          </box>
        }>
          {/* Recent 组 */}
          <Show when={modelGroups().recent.length > 0}>
            <box flexDirection="column" marginBottom={1}>
              <box paddingLeft={1} backgroundColor={theme.theme().border}>
                <text fg={theme.theme().muted}>Recent</text>
              </box>
              <For each={modelGroups().recent}>
                {(model, index) => renderModelItem(model, index(), "Recent")}
              </For>
            </box>
          </Show>

          {/* Favorites 组 */}
          <Show when={modelGroups().favorites.length > 0}>
            <box flexDirection="column" marginBottom={1}>
              <box paddingLeft={1} backgroundColor={theme.theme().border}>
                <text fg={theme.theme().muted}>Favorites</text>
              </box>
              <For each={modelGroups().favorites}>
                {(model, index) => renderModelItem(model, index() + modelGroups().recent.length, "Favorites")}
              </For>
            </box>
          </Show>

          {/* Providers 组 */}
          <For each={modelGroups().providers}>
            {(provider) => (
              <box flexDirection="column" marginBottom={1}>
                <box paddingLeft={1} backgroundColor={theme.theme().border}>
                  <text fg={theme.theme().muted}>{provider.providerName}</text>
                </box>
                <For each={provider.models}>
                  {(model, index) => renderModelItem(
                    model,
                    calculateGlobalIndex(provider, index()),
                    provider.providerName
                  )}
                </For>
              </box>
            )}
          </For>
        </Show>
      </box>

      {/* 底部提示 */}
      <box flexDirection="row" height={1} marginTop={1} paddingLeft={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter select • {flatModels().length} models
        </text>
      </box>
    </box>
  );

  function renderModelItem(model: ModelInfo, globalIndex: number, group: string) {
    const isSelected = () => globalIndex === selectedIndex();
    const isFav = () => favorites().has(`${model.providerID}/${model.modelID}`);

    return (
      <box
        flexDirection="row"
        alignItems="center"
        paddingLeft={2}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.theme().primary : undefined}
        onClick={() => selectModel(model)}
      >
        <text
          fg={isSelected() ? theme.theme().background : theme.theme().foreground}
        >
          {model.modelID}
        </text>
        <Show when={isFav()}>
          <text
            fg={isSelected() ? theme.theme().background : theme.theme().success}
            marginLeft={1}
          >
            ★
          </text>
        </Show>
        <box flexGrow={1} />
        <text
          fg={isSelected() ? theme.theme().background : theme.theme().muted}
        >
          {model.providerName}
        </text>
      </box>
    );
  }

  function calculateGlobalIndex(provider: ProviderModels, localIndex: number): number {
    let index = modelGroups().recent.length + modelGroups().favorites.length;
    for (const p of modelGroups().providers) {
      if (p.providerID === provider.providerID) {
        return index + localIndex;
      }
      index += p.models.length;
    }
    return index;
  }
}
```

### 3.3 修改 CommandDialog 支持 Dialog 模式

```typescript
// 在 CommandDialog.tsx 的 executeSelected 函数中

const executeSelected = async () => {
  // ... 现有代码 ...
  
  if (selectedCmd.hasArgs) {
    // 需要参数：关闭 dialog 并在输入框插入命令
    dialog.pop();
    await command.executeCommand(selectedCmd.name, "");
  } else {
    // 不需要参数：直接执行
    dialog.pop();
    const result = await command.executeCommand(selectedCmd.name, "");
    
    // 检查是否需要打开 Dialog
    if (result.success && result.data && (result.data as any).mode === "dialog") {
      // 根据命令类型打开对应的 Dialog
      switch (selectedCmd.name) {
        case "models":
          const { ModelsDialog } = await import("./ModelsDialog.js");
          dialog.replace(() => <ModelsDialog data={(result.data as any)} />);
          break;
        case "connect":
          const { ConnectDialog } = await import("./ConnectDialog.js");
          dialog.replace(() => <ConnectDialog />);
          break;
        case "echo":
          const { EchoDialog } = await import("./EchoDialog.js");
          dialog.replace(() => <EchoDialog defaultMessage={(result.data as any).defaultMessage || ""} />);
          break;
        default:
          showResultDialog(selectedCmd, result);
      }
    } else {
      showResultDialog(selectedCmd, result);
    }
  }
};
```

---

## 四、数据持久化

### 4.1 ModelStore（已存在）

复用已有的 `ModelStore` 实现：

```typescript
// packages/core/src/config/state/model-store.ts（已存在）

export interface ModelEntry {
  providerID: string;
  modelID: string;
}

export interface ModelStoreData {
  recent: ModelEntry[];      // 最多 10 个
  favorite: ModelEntry[];    // 无限制
  variant: Record<string, string>;  // 模型变体偏好
}
```

**存储位置**：`~/.local/state/tong_work/agent-core/model.json`

### 4.2 数据流

```
User selects model in ModelsDialog
    │
    ├─ TUI calls executeCommand("models", {type: "select", providerID, modelID})
    │
    ├─ Server modelsCommand.execute()
    │   ├─ modelStore.addRecent(providerID, modelID)
    │   └─ Save to model.json
    │
    └─ Server returns success → TUI closes dialog
```

---

## 五、与 OpenCode 的差异对比

| 特性 | OpenCode | agent-core |
|------|----------|------------|
| 命令类型 | 前端命令（不调用 API） | 后端命令（HTTP API） |
| Dialog 触发 | `command.trigger("model.list")` | Server 返回 `mode: "dialog"` |
| 持久化字段 | recent, favorite, variant | 相同（复用 ModelStore） |
| 当前模型存储 | 内存（不持久化） | 内存（不持久化） |
| 回退逻辑 | 命令行→配置→recent→默认 | 可配置（在 ServerEnvironment 中实现） |
| Provider 配置 | 内置 + 自定义 | 相同（复用 Providers 系统） |
| UI 框架 | Ink | OpenTUI |

---

## 六、实现步骤

### Phase 1: Server 端（2h）

1. [ ] 创建 `packages/core/src/server/command/built-in/models.ts`
2. [ ] 实现 modelsCommand（list/select/toggle_favorite/set_variant）
3. [ ] 在 `index.ts` 中注册命令
4. [ ] 添加单元测试

### Phase 2: TUI 端（3h）

1. [ ] 创建 `packages/core/src/cli/tui/components/ModelsDialog.tsx`
2. [ ] 实现模型列表 UI（Recent/Favorites/Providers 分组）
3. [ ] 实现键盘导航（↑↓/Enter/Esc/F）
4. [ ] 实现搜索过滤
5. [ ] 修改 `CommandDialog.tsx` 支持 dialog 模式检测

### Phase 3: 集成测试（1h）

1. [ ] 启动 Server + TUI
2. [ ] 测试 `/models` 命令打开 Dialog
3. [ ] 测试模型选择（更新 recent）
4. [ ] 测试收藏功能
5. [ ] 验证 model.json 持久化

---

## 七、API 参考

### 7.1 Command 请求/响应

**List Action**
```json
// Request
{ "type": "list" }

// Response
{
  "success": true,
  "data": {
    "mode": "dialog",
    "recent": [{"providerID": "anthropic", "modelID": "claude-3-sonnet"}],
    "favorites": [{"providerID": "openai", "modelID": "gpt-4"}],
    "providers": [{
      "providerID": "anthropic",
      "providerName": "Anthropic",
      "models": [{"providerID": "anthropic", "modelID": "claude-3-opus", "modelName": "claude-3-opus", "isFavorite": false}]
    }]
  }
}
```

**Select Action**
```json
// Request
{
  "type": "select",
  "providerID": "anthropic",
  "modelID": "claude-3-sonnet"
}

// Response
{
  "success": true,
  "message": "Model selected: anthropic/claude-3-sonnet",
  "data": {
    "providerID": "anthropic",
    "modelID": "claude-3-sonnet",
    "variant": null
  }
}
```

**Toggle Favorite Action**
```json
// Request
{
  "type": "toggle_favorite",
  "providerID": "anthropic",
  "modelID": "claude-3-sonnet"
}

// Response
{
  "success": true,
  "message": "Added to favorites",
  "data": { "isFavorite": true }
}
```

---

## 九、Server 启动时的模型配置加载

### 9.1 设计目标

借鉴 OpenCode 的启动配置加载逻辑，Server 启动时需要：

1. **加载默认配置**：从配置文件（config.jsonc）读取默认模型和 API Key
2. **读取用户偏好**：从 ModelStore（model.json）读取用户最近使用的模型
3. **优先级回退**：按照优先级选择最终使用的模型
4. **实时切换**：用户通过 `/models` 命令切换模型后，实时更新 Environment 的 LLM 配置

### 9.2 配置优先级（Fallback Chain）

与 OpenCode 类似，采用以下优先级（从高到低）：

```
1. 当前会话选择的模型（内存，不持久化）
2. 配置文件中的 defaultModel（config.jsonc）
3. ModelStore 中 recent 的第一个有效模型（用户最近使用）
4. 内置 Provider 的默认模型
5. Provider 的第一个可用模型
```

### 9.3 ServerEnvironment 配置加载流程

```typescript
// packages/core/src/server/environment.ts

import { ModelStore } from "../config/state/model-store.js";
import { Providers_getAll, type ProviderInfo } from "../config/providers.js";
import { Auth_getProvider } from "../config/auth.js";

export interface ServerEnvironmentConfig extends BaseEnvironmentConfig {
  sessionId?: string;
  loadConfig?: boolean;
  /** 当前选择的模型（内存，不持久化） */
  currentModel?: {
    providerID: string;
    modelID: string;
  };
}

export class ServerEnvironment extends BaseEnvironment {
  private modelStore: ModelStore;
  private currentModelSelection: { providerID: string; modelID: string } | null = null;

  constructor(config?: ServerEnvironmentConfig) {
    // ... 现有代码 ...
    
    this.modelStore = new ModelStore();
    
    // 初始化当前模型选择（如果传入）
    if (config?.currentModel) {
      this.currentModelSelection = config.currentModel;
    }
  }

  /**
   * 加载配置并初始化 LLM（增强版）
   */
  private async loadConfigAndInitLLM(): Promise<void> {
    try {
      console.log("[ServerEnvironment] Loading configuration...");
      
      // 1. 加载配置文件
      const rawConfig = await Config_get();
      const config = await resolveConfig(rawConfig);
      
      // 2. 加载用户模型偏好
      await this.modelStore.load();
      const recent = await this.modelStore.getRecent();
      
      // 3. 获取所有 provider
      const providers = await Providers_getAll();
      
      // 4. 按照优先级选择模型
      const selectedModel = await this.selectModelWithFallback(
        this.currentModelSelection,
        config.defaultModel ? this.parseModelString(config.defaultModel) : null,
        recent,
        providers
      );
      
      if (selectedModel) {
        console.log(`[ServerEnvironment] Selected model: ${selectedModel.providerID}/${selectedModel.modelID}`);
        
        // 5. 获取 API Key
        const authInfo = await Auth_getProvider(selectedModel.providerID);
        if (!authInfo?.key) {
          console.warn(`[ServerEnvironment] No API key found for provider: ${selectedModel.providerID}`);
          return;
        }
        
        // 6. 获取 baseURL
        const providerInfo = providers.find(p => p.id === selectedModel.providerID);
        const baseURL = providerInfo?.baseURL || authInfo.baseURL || "https://api.openai.com/v1";
        
        // 7. 初始化 LLM
        const modelFullName = `${selectedModel.providerID}/${selectedModel.modelID}`;
        await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);
        
        // 8. 更新当前选择（内存中）
        this.currentModelSelection = selectedModel;
        
        console.log("[ServerEnvironment] LLM initialized successfully");
      } else {
        console.log("[ServerEnvironment] No valid model configuration found");
      }
    } catch (error) {
      console.error("[ServerEnvironment] Failed to load configuration:", error);
    }
  }

  /**
   * 按照优先级选择模型
   */
  private async selectModelWithFallback(
    currentSelection: { providerID: string; modelID: string } | null,
    configModel: { providerID: string; modelID: string } | null,
    recent: Array<{ providerID: string; modelID: string }>,
    providers: ProviderInfo[]
  ): Promise<{ providerID: string; modelID: string } | null> {
    
    // 1. 检查当前会话选择（最高优先级）
    if (currentSelection && await this.isModelValid(currentSelection, providers)) {
      return currentSelection;
    }
    
    // 2. 检查配置文件中的默认模型
    if (configModel && await this.isModelValid(configModel, providers)) {
      return configModel;
    }
    
    // 3. 检查 ModelStore 中的 recent 列表
    for (const entry of recent) {
      if (await this.isModelValid(entry, providers)) {
        return entry;
      }
    }
    
    // 4. 使用第一个可用的 provider 的默认模型
    for (const provider of providers) {
      if (provider.models && provider.models.length > 0) {
        // 使用 defaultModel 或第一个模型
        const defaultModel = provider.defaultModel || provider.models[0];
        return {
          providerID: provider.id,
          modelID: defaultModel,
        };
      }
    }
    
    return null;
  }

  /**
   * 验证模型是否有效
   */
  private async isModelValid(
    model: { providerID: string; modelID: string },
    providers: ProviderInfo[]
  ): Promise<boolean> {
    const provider = providers.find(p => p.id === model.providerID);
    if (!provider) return false;
    
    // 检查模型是否在 provider 的模型列表中
    if (provider.models && provider.models.includes(model.modelID)) {
      return true;
    }
    
    // 或者检查是否是 defaultModel
    if (provider.defaultModel === model.modelID) {
      return true;
    }
    
    return false;
  }

  /**
   * 解析模型字符串（如 "anthropic/claude-3-sonnet"）
   */
  private parseModelString(modelString: string): { providerID: string; modelID: string } | null {
    const parts = modelString.split("/");
    if (parts.length === 2) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return null;
  }

  /**
   * 切换当前模型（供 models command 调用）
   */
  async switchModel(providerID: string, modelID: string): Promise<boolean> {
    try {
      const providers = await Providers_getAll();
      
      // 验证模型有效性
      if (!await this.isModelValid({ providerID, modelID }, providers)) {
        console.error(`[ServerEnvironment] Invalid model: ${providerID}/${modelID}`);
        return false;
      }
      
      // 获取 API Key
      const authInfo = await Auth_getProvider(providerID);
      if (!authInfo?.key) {
        console.error(`[ServerEnvironment] No API key for provider: ${providerID}`);
        return false;
      }
      
      // 获取 baseURL
      const providerInfo = providers.find(p => p.id === providerID);
      const baseURL = providerInfo?.baseURL || authInfo.baseURL || "https://api.openai.com/v1";
      
      // 重新初始化 LLM
      const modelFullName = `${providerID}/${modelID}`;
      await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);
      
      // 更新当前选择
      this.currentModelSelection = { providerID, modelID };
      
      // 添加到 recent
      await this.modelStore.addRecent(providerID, modelID);
      
      console.log(`[ServerEnvironment] Switched to model: ${providerID}/${modelID}`);
      return true;
    } catch (error) {
      console.error("[ServerEnvironment] Failed to switch model:", error);
      return false;
    }
  }

  /**
   * 获取当前选择的模型
   */
  getCurrentModel(): { providerID: string; modelID: string } | null {
    return this.currentModelSelection;
  }
}
```

### 9.4 modelsCommand 集成模型切换

```typescript
// packages/core/src/server/command/built-in/models.ts

case "select": {
  if (!action.providerID || !action.modelID) {
    return {
      success: false,
      message: "Missing providerID or modelID",
      data: { error: "Invalid selection" },
    };
  }

  // 添加到 recent
  await modelStore.addRecent(action.providerID, action.modelID);
  
  // 如果 env 支持，切换当前模型
  if (context.env && "switchModel" in context.env) {
    const switched = await (context.env as any).switchModel(
      action.providerID,
      action.modelID
    );
    
    if (!switched) {
      return {
        success: false,
        message: "Failed to switch model. Please check API key configuration.",
        data: { error: "Switch failed" },
      };
    }
  }

  return {
    success: true,
    message: `Model selected: ${action.providerID}/${action.modelID}`,
    data: {
      providerID: action.providerID,
      modelID: action.modelID,
    },
  };
}
```

### 9.5 启动流程图

```
Server 启动
    │
    ├─ 1. 加载 config.jsonc
    │   ├─ defaultModel: "anthropic/claude-3-sonnet"
    │   └─ apiKey: "${auth:anthropic}"
    │
    ├─ 2. 加载 model.json
    │   └─ recent: [{"providerID": "openai", "modelID": "gpt-4"}]
    │
    ├─ 3. 加载 providers.jsonc
    │   └─ 获取所有 provider 配置
    │
    ├─ 4. 优先级选择
    │   ├─ 检查 currentSelection (null)
    │   ├─ 检查 configModel (anthropic/claude-3-sonnet) ✓
    │   └─ 选择: anthropic/claude-3-sonnet
    │
    ├─ 5. 获取 auth
    │   └─ auth.json: { "anthropic": { "key": "sk-xxx" } }
    │
    └─ 6. 初始化 LLM
        ├─ model: "anthropic/claude-3-sonnet"
        ├─ baseURL: "https://api.anthropic.com/v1"
        └─ apiKey: "sk-xxx"

后续: 用户执行 /models 选择 openai/gpt-4
    │
    ├─ 1. modelsCommand.select
    ├─ 2. modelStore.addRecent("openai", "gpt-4")
    ├─ 3. env.switchModel("openai", "gpt-4")
    │   ├─ 验证模型有效
    │   ├─ 重新初始化 LLM
    │   └─ 更新 currentSelection
    └─ 4. 后续 invoke_llm 使用新模型
```

### 9.6 与 OpenCode 的对比

| 特性 | OpenCode | agent-core |
|------|----------|------------|
| 启动加载 | 从 model.json 加载 recent/favorite/variant | 相同，增加应用到 Environment |
| 优先级 | current > args > config > recent > default | current > config > recent > provider default |
| 实时切换 | 直接更新 modelStore 和内存 | 通过 switchModel 方法重新初始化 LLM |
| 持久化 | 只持久化 recent/favorite/variant | 相同 |
| 当前模型 | 内存（按 agent 区分） | 内存（ServerEnvironment 级别） |

### 9.7 实现要点

1. **延迟初始化**：ServerEnvironment 构造函数中异步加载配置，避免阻塞启动
2. **验证机制**：选择模型时验证模型是否在 provider 的模型列表中
3. **API Key 检查**：切换模型时检查是否有对应的 API Key
4. **回退优雅**：如果没有有效配置，Server 仍然可以启动（只是没有 LLM）
5. **线程安全**：模型切换时重新初始化 LLM，确保并发安全

---

## 十、参考文件

### OpenCode 参考
- 命令注册：`thirdparty/opencode/packages/opencode/src/cli/cmd/tui/app.tsx:323-336`
- DialogModel：`thirdparty/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx`
- ModelStore：`thirdparty/opencode/packages/opencode/src/cli/cmd/tui/context/local.tsx:95-302`

### agent-core 已有实现
- Command Types：`packages/core/src/server/command/types.ts`
- Connect Command：`packages/core/src/server/command/built-in/connect.ts`
- ConnectDialog：`packages/core/src/cli/tui/components/ConnectDialog.tsx`
- ModelStore：`packages/core/src/config/state/model-store.ts`
- Providers：`packages/core/src/config/providers.ts`
