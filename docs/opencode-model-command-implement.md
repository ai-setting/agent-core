# OpenCode /models 命令实现机制调研文档

本文档面向需要理解 thirdparty/opencode 项目中 **模型选择（/models）命令** 完整实现逻辑的开发者或 Agent。通过阅读本文档及引用的**绝对路径**文件，可以掌握命令触发、模型选择、持久化存储、下次启动加载等完整流程，便于借鉴实现类似功能。

> **路径说明**：本文档中所有文件路径均为绝对路径，基于工作区 `d:\document\zhishitong_workspace\zst_project\tong_work`。若工作区根目录不同，请相应替换路径前缀。

> **命令说明**：实现中实际使用的命令为 `/models`（复数形式），非 `/model`。两者等价理解即可。

---

## 一、总体架构

### 1.1 命令类型

`/models` 属于 **前端命令**（非后端命令），其特点：

- **不调用 LLM**：选择后直接执行 UI 逻辑，不触发 `session.command` HTTP API
- **定义位置**：`command.register()` 注册
- **执行方式**：`onSelect` 回调直接打开模型选择弹窗 `DialogModel`

### 1.2 核心流程概览

```
用户输入 / 并选择 /models
    │
    ├─ Autocomplete 展示 command.slashes() 中的 /models
    │
    ├─ 用户选择 /models → onSelect → command.trigger("model.list")
    │
    └─ trigger("model.list") → 找到 value === "model.list" 的 option
            → onSelect(dialog) → dialog.replace(() => <DialogModel />)
            → 打开模型选择弹窗
            → 用户选择模型 → local.model.set({ providerID, modelID }, { recent: true })
            → 更新 modelStore + 持久化到 model.json
```

---

## 二、命令注册与触发

### 2.1 命令注册

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx`

约第 323-336 行：

```typescript
{
  title: "Switch model",
  value: "model.list",
  keybind: "model_list",
  suggested: true,
  category: "Agent",
  slash: {
    name: "models",
  },
  onSelect: () => {
    dialog.replace(() => <DialogModel />)
  },
},
```

- `value: "model.list"`：内部命令标识，用于 `trigger(name)` 查找
- `slash.name: "models"`：用户可见的斜杠命令名，即 `/models`
- `keybind: "model_list"`：快捷键绑定（如 Ctrl+X M）
- `onSelect`：打开 `DialogModel` 组件

### 2.2 命令系统与 Slash 暴露

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx`

约第 75-95 行：

```typescript
trigger(name: string) {
  for (const option of entries()) {
    if (option.value === name) {
      if (!isEnabled(option)) return
      option.onSelect?.(dialog)
      return
    }
  }
},
slashes() {
  return visibleOptions().flatMap((option) => {
    const slash = option.slash
    if (!slash) return []
    return {
      display: "/" + slash.name,
      description: option.description ?? option.title,
      aliases: slash.aliases?.map((alias) => "/" + alias),
      onSelect: () => result.trigger(option.value),
    }
  })
},
```

- `slashes()` 将带 `slash` 的 command 转为 `{ display: "/models", onSelect: () => trigger("model.list") }`
- 用户选择 `/models` 时调用 `onSelect`，进而 `trigger("model.list")`，执行对应 `onSelect` 打开 `DialogModel`

### 2.3 Autocomplete 中的命令来源

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

约第 354-371 行：

```typescript
const commands = createMemo((): AutocompleteOption[] => {
  const results: AutocompleteOption[] = [...command.slashes()]

  for (const serverCommand of sync.data.command) {
    if (serverCommand.source === "skill") continue
    const label = serverCommand.source === "mcp" ? ":mcp" : ""
    results.push({
      display: "/" + serverCommand.name + label,
      description: serverCommand.description,
      onSelect: () => {
        const newText = "/" + serverCommand.name + " "
        // 插入到输入框，用户填写参数后回车提交
        props.input().insertText(newText)
        // ...
      },
    })
  }
  return results
})
```

- `command.slashes()` 包含 `/models`，其 `onSelect` 直接 `trigger`，不插入文本
- `/models` 不在 `sync.data.command` 中，因此不会走 `session.command` 流程

### 2.4 HTTP API 触发（外部调用）

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\tui.ts`

约第 176-199 行：

```typescript
.post(
  "/open-models",
  describeRoute({
    summary: "Open models dialog",
    description: "Open the model dialog",
    operationId: "tui.openModels",
    // ...
  }),
  async (c) => {
    await Bus.publish(TuiEvent.CommandExecute, {
      command: "model.list",
    })
    return c.json(true)
  },
)
```

**事件订阅**（`app.tsx` 约第 602-604 行）：

```typescript
sdk.event.on(TuiEvent.CommandExecute.type, (evt) => {
  command.trigger(evt.properties.command)
})
```

- 外部可调用 `POST /tui/open-models` 打开模型选择弹窗
- 通过事件总线发布 `CommandExecute`，最终执行 `command.trigger("model.list")`

---

## 三、模型选择弹窗与选择逻辑

### 3.1 DialogModel 组件

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-model.tsx`

用户选择模型时的核心逻辑（约第 66-75、98-106、140-149 行）：

```typescript
onSelect: () => {
  dialog.clear()
  local.model.set(
    {
      providerID: provider.id,
      modelID: model.id,
    },
    { recent: true },
  )
},
```

- 选择后调用 `local.model.set(model, { recent: true })`
- `{ recent: true }` 表示将模型加入最近使用列表并触发持久化

### 3.2 local.model.set 实现

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

约第 281-302 行：

```typescript
set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
  batch(() => {
    if (!isModelValid(model)) {
      toast.show({ message: `Model ${model.providerID}/${model.modelID} is not valid`, ... })
      return
    }
    setModelStore("model", agent.current().name, model)
    if (options?.recent) {
      const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
      if (uniq.length > 10) uniq.pop()
      setModelStore(
        "recent",
        uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
      )
      save()
    }
  })
}
```

- `modelStore.model[agentName]`：当前 agent 的选中模型（**内存**）
- `modelStore.recent`：最近使用的模型列表（最多 10 个），**持久化**
- `options.recent === true` 时更新 `recent` 并调用 `save()` 写入 `model.json`

---

## 四、存储与持久化

### 4.1 存储文件路径

**文件路径**：`{Global.Path.state}/model.json`

**Global.Path 定义**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts`

```typescript
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
const state = path.join(xdgState!, "opencode")
// 典型路径：Linux ~/.local/state/opencode，Windows %LOCALAPPDATA% 等
```

常见平台示例：

| 平台   | model.json 路径示例                               |
|--------|---------------------------------------------------|
| Linux  | `~/.local/state/opencode/model.json`              |
| macOS  | `~/.local/state/opencode/model.json`              |
| Windows| `%LOCALAPPDATA%\opencode\model.json` 或类似路径   |

### 4.2 文件内容结构

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

约第 120-139 行：

```typescript
const file = Bun.file(path.join(Global.Path.state, "model.json"))

function save() {
  if (!modelStore.ready) {
    state.pending = true
    return
  }
  state.pending = false
  Bun.write(
    file,
    JSON.stringify({
      recent: modelStore.recent,
      favorite: modelStore.favorite,
      variant: modelStore.variant,
    }),
  )
}
```

**model.json 结构**：

```json
{
  "recent": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
    { "providerID": "openai", "modelID": "gpt-4" }
  ],
  "favorite": [
    { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }
  ],
  "variant": {
    "anthropic/claude-sonnet-4-5": "reasoning"
  }
}
```

| 字段     | 说明                                   | 是否持久化 |
|----------|----------------------------------------|------------|
| `recent` | 最近使用的模型列表，最多 10 个         | 是         |
| `favorite` | 收藏的模型                            | 是         |
| `variant` | 每个模型的变体选择（如 reasoning 等） | 是         |
| `model`  | 当前选中的模型（按 agent 区分）        | **否**     |

### 4.2.1 recent、favorite、variant 三者区别

| 字段 | 含义 | 来源 | 典型用途 |
|------|------|------|----------|
| **recent** | 最近使用过的模型列表（最多 10 个） | 在模型选择弹窗中选中某模型时自动加入 | 启动时未配置时作为默认模型来源；快捷键在最近模型间循环切换 |
| **favorite** | 用户手动收藏的模型 | 在模型弹窗中按 Favorite 快捷键（`model_favorite_toggle`）添加/移除 | 弹窗中单独分组展示；快捷键在收藏模型间循环切换 |
| **variant** | 每个模型的变体选择 | 同一模型有多种变体（如 reasoning 模式、普通模式）时，用户选择的具体变体 | 记录用户对每个模型的变体偏好，如 `"anthropic/claude-sonnet-4-5": "reasoning"` |

**简要理解**：
- `recent`：历史记录，自动维护
- `favorite`：星标收藏，手动维护
- `variant`：同一模型不同「模式」的偏好

**重要**：当前选中模型（`modelStore.model`）**不写入** `model.json`，仅保存在内存中。

### 4.3 何时触发 save()

`save()` 会在以下场景被调用：

1. `model.set(..., { recent: true })`：选择模型并加入 recent
2. `model.cycleFavorite()`：切换收藏模型
3. `model.toggleFavorite()`：切换收藏状态
4. `model.variant.set()`：设置模型变体

---

## 五、启动时加载与回退逻辑

### 5.1 读取 model.json

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

约第 142-154 行：

```typescript
file
  .json()
  .then((x) => {
    if (Array.isArray(x.recent)) setModelStore("recent", x.recent)
    if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
    if (typeof x.variant === "object" && x.variant !== null) setModelStore("variant", x.variant)
  })
  .catch(() => {})
  .finally(() => {
    setModelStore("ready", true)
    if (state.pending) save()
  })
```

- 启动时异步读取 `model.json`
- 只恢复 `recent`、`favorite`、`variant`
- 读取失败时静默忽略（`.catch(() => {})`）
- `ready` 置为 `true` 后，若有 `pending` 则执行一次 `save()`

### 5.2 当前模型的回退顺序

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

约第 156-205 行：

```typescript
const fallbackModel = createMemo(() => {
  // 1. 命令行参数 --model
  if (args.model) {
    const { providerID, modelID } = Provider.parseModel(args.model)
    if (isModelValid({ providerID, modelID })) {
      return { providerID, modelID }
    }
  }

  // 2. 配置中的 model 字段（sync.data.config.model）
  if (sync.data.config.model) {
    const { providerID, modelID } = Provider.parseModel(sync.data.config.model)
    if (isModelValid({ providerID, modelID })) {
      return { providerID, modelID }
    }
  }

  // 3. model.json 中 recent 的第一个有效模型
  for (const item of modelStore.recent) {
    if (isModelValid(item)) {
      return item
    }
  }

  // 4. Provider 默认模型或第一个可用模型
  const provider = sync.data.provider[0]
  if (!provider) return undefined
  const defaultModel = sync.data.provider_default[provider.id]
  const firstModel = Object.values(provider.models)[0]
  const model = defaultModel ?? firstModel?.id
  if (!model) return undefined
  return {
    providerID: provider.id,
    modelID: model,
  }
})

const currentModel = createMemo(() => {
  const a = agent.current()
  return (
    getFirstValidModel(
      () => modelStore.model[a.name],  // 内存中的当前选择
      () => a.model,                    // agent 配置的 model
      fallbackModel,
    ) ?? undefined
  )
})
```

**回退优先级**（从高到低）：

1. 内存中 `modelStore.model[agentName]`（当前会话内选择）
2. Agent 配置的 `model`
3. `fallbackModel`：
   - 命令行 `--model`
   - 配置 `config.model`
   - `model.json` 中 `recent` 的第一个有效模型
   - Provider 默认或第一个可用模型

---

## 六、modelStore 完整结构

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

约第 95-120 行：

```typescript
const [modelStore, setModelStore] = createStore<{
  ready: boolean
  model: Record<string, { providerID: string; modelID: string }>  // 不持久化
  recent: { providerID: string; modelID: string }[]              // 持久化
  favorite: { providerID: string; modelID: string }[]            // 持久化
  variant: Record<string, string | undefined>                    // 持久化
}>({
  ready: false,
  model: {},
  recent: [],
  favorite: [],
  variant: {},
})
```

---

## 七、关键文件索引

| 功能                         | 绝对路径 |
|------------------------------|----------|
| 全局路径（state 等）         | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts` |
| 命令注册（/models）          | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx` |
| 命令系统与 trigger/slashes   | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx` |
| Autocomplete 命令列表        | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx` |
| 模型选择弹窗                 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-model.tsx` |
| 模型状态与持久化             | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx` |
| HTTP API /tui/open-models     | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\tui.ts` |
| 事件定义                     | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\event.ts` |

---

## 八、Web/Desktop App 模式差异

Web 与 Desktop 使用另一套持久化机制，未使用 `model.json`：

- **文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\models.tsx`
- **持久化工具**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\utils\persist.ts`
- 存储键：`Persist.global("model", ["model.v1"])`
- 后端：Web 用 `localStorage`，Desktop 用 `platform.storage`（如 IndexedDB）

---

## 九、总结

1. **命令**：`/models` 为前端命令，通过 `command.register()` 注册，`onSelect` 打开 `DialogModel`。
2. **触发方式**：用户输入 `/` 选择 `/models`、快捷键、或 `POST /tui/open-models`。
3. **持久化**：`~/.local/state/opencode/model.json` 仅持久化 `recent`、`favorite`、`variant`，**不持久化当前选中模型**。
4. **启动恢复**：当前选中模型由 `fallbackModel` 决定：命令行 → 配置 → `recent` 第一个有效 → Provider 默认。
5. **实现借鉴**：可按需调整 persistent 字段（例如增加 `model` 持久化）、修改 `fallbackModel` 顺序或扩展 `model.json` 结构。
