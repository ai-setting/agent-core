# OpenCode Command 机制说明

本文档描述 OpenCode 项目中命令（Command）的实现原理与细节，供智能体理解原理并定位相关代码。

---

## 一、命令机制总览

项目存在**两套相互独立的命令系统**：

| 类型 | 示例 | 定义位置 | 执行方式 | 是否调用 LLM |
|-----|------|----------|----------|--------------|
| **前端命令** | `/models`、`/sessions`、`/new` | `command.register()` | `onSelect` 直接执行 UI 逻辑 | **否** |
| **后端命令** | `/init`、`/review`、config 自定义 | `Command` 模块 | `session.command` HTTP API | **是** |

---

## 二、后端命令（Command 模块）

### 2.1 定义与注册

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\command\index.ts`

命令通过 `Command.Info` 描述，包含 name、description、template、agent、model、source 等字段：

```typescript
// packages/opencode/src/command/index.ts
export const Info = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    agent: z.string().optional(),
    model: z.string().optional(),
    source: z.enum(["command", "mcp", "skill"]).optional(),
    template: z.promise(z.string()).or(z.string()),
    subtask: z.boolean().optional(),
    hints: z.array(z.string()),
  })
```

### 2.2 命令来源

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\command\index.ts`

命令在 `Instance.state()` 中汇聚，来源包括：

1. **内置命令**：`init`、`review`，模板在 `template/` 目录
2. **配置命令**：`opencode.json` 的 `command` 字段
3. **MCP prompts**：MCP 提供的 prompts
4. **Skills**：`.opencode/skills/` 下的技能

```typescript
// packages/opencode/src/command/index.ts (约 57-139 行)
const state = Instance.state(async () => {
  const result: Record<string, Info> = {
    [Default.INIT]: { ... },
    [Default.REVIEW]: { ... },
  }
  for (const [name, command] of Object.entries(cfg.command ?? {})) { ... }
  for (const [name, prompt] of Object.entries(await MCP.prompts())) { ... }
  for (const skill of await Skill.all()) { ... }
  return result
})
```

### 2.3 API 接口

```typescript
// packages/opencode/src/command/index.ts
export async function get(name: string) {
  return state().then((x) => x[name])
}

export async function list() {
  return state().then((x) => Object.values(x))
}
```

### 2.4 命令执行流

**HTTP 路由：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\session.ts`

```typescript
// packages/opencode/src/server/routes/session.ts (约 768-804 行)
.post("/:sessionID/command", ...)
async (c) => {
  const sessionID = c.req.valid("param").sessionID
  const body = c.req.valid("json")
  const msg = await SessionPrompt.command({ ...body, sessionID })
  return c.json(msg)
}
```

**执行逻辑：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\session\prompt.ts`

```typescript
// packages/opencode/src/session/prompt.ts (约 1624-1650 行)
export async function command(input: CommandInput) {
  const command = await Command.get(input.command)
  const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())
  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const templateCommand = await command.template
  // 替换 $1, $2, $ARGUMENTS 占位符
  // 执行 shell 反引号语法
  // 创建 AI 消息并发送
}
```

模板占位符支持：`$1`、`$2`、`$ARGUMENTS`。

---

## 三、前端命令（command.register）

### 3.1 TUI 命令定义

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx
export type CommandOption = DialogSelectOption<string> & {
  keybind?: keyof KeybindsConfig
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
}
```

### 3.2 注册与触发

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/component/dialog-command.tsx (约 73-111 行)
const result = {
  trigger(name: string) {
    for (const option of entries()) {
      if (option.value === name) {
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
  register(cb: () => CommandOption[]) { ... },
}
```

### 3.3 Model 命令示例（无 LLM 调用）

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/app.tsx (约 323-336 行)
{
  title: "Switch model",
  value: "model.list",
  keybind: "model_list",
  suggested: true,
  category: "Agent",
  slash: { name: "models" },
  onSelect: () => {
    dialog.replace(() => <DialogModel />)
  },
},
```

类似的前端命令：`/sessions`、`/new`、`/agents`、`model.cycle_recent` 等，均通过 `onSelect` 执行 UI 或本地状态更新，不调用后端。

---

## 四、Slash 命令与提交逻辑

### 4.1 Autocomplete 命令来源

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx (约 354-371 行)
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
      },
    })
  }
  return results
})
```

### 4.2 提交时路由判断

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\index.tsx`

只有出现在 `sync.data.command` 中的命令才会走 `session.command`：

```typescript
// packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx (约 572-601 行)
} else if (
  inputText.startsWith("/") &&
  sync.data.command.some((x) => x.name === command)
) {
  // 后端命令 → session.command
  sdk.client.session.command({
    sessionID,
    command: command.slice(1),
    arguments: args,
    agent: local.agent.current().name,
    model: `${selectedModel.providerID}/${selectedModel.modelID}`,
    ...
  })
} else {
  // 普通 prompt
  sdk.client.session.prompt({ ... })
}
```

`/models` 不在 `sync.data.command` 中，因此不会进入 `session.command`，只在前端通过 `onSelect` 打开弹窗。

---

## 五、Model 配置存储

### 5.1 存储文件路径

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/context/local.tsx (约 122 行)
const file = Bun.file(path.join(Global.Path.state, "model.json"))
```

**State 路径定义：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts`

```typescript
// packages/opencode/src/global/index.ts
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
const state = path.join(xdgState!, "opencode")
// 典型路径：Linux ~/.local/state/opencode，Windows %LOCALAPPDATA%/opencode
```

### 5.2 数据结构

```typescript
// packages/opencode/src/cli/cmd/tui/context/local.tsx (约 96-120 行)
const [modelStore, setModelStore] = createStore<{
  ready: boolean
  model: Record<string, { providerID: string; modelID: string }>  // 不持久化
  recent: { providerID: string; modelID: string }[]                // 持久化
  favorite: { providerID: string; modelID: string }[]                // 持久化
  variant: Record<string, string | undefined>                      // 持久化
}>({ ... })
```

### 5.3 持久化逻辑

```typescript
// packages/opencode/src/cli/cmd/tui/context/local.tsx (约 126-140 行)
function save() {
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

`modelStore.model`（当前 agent 的模型选择）不写入磁盘。

### 5.4 选择模型时的更新

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-model.tsx`

```typescript
// packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx (约 66-75 行)
onSelect: () => {
  dialog.clear()
  local.model.set(
    { providerID: provider.id, modelID: model.id },
    { recent: true },
  )
}
```

### 5.5 local.model.set 实现

```typescript
// packages/opencode/src/cli/cmd/tui/context/local.tsx (约 281-302 行)
set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
  batch(() => {
    setModelStore("model", agent.current().name, model)
    if (options?.recent) {
      const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
      if (uniq.length > 10) uniq.pop()
      setModelStore("recent", uniq.map(...))
      save()
    }
  })
}
```

---

## 六、Web App 命令系统

Web 端有单独的命令实现：

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\command.tsx`

- 使用 SolidJS + `createSimpleContext`，支持 `register`、`trigger`、快捷键
- 命令面板快捷键默认 `mod+shift+p`
- 各页面通过 `command.register()` 注册命令

**示例：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\pages\layout.tsx` (约 1066 行起)

---

## 七、关键文件索引

| 功能 | 绝对路径 |
|------|----------|
| 后端 Command 定义与聚合 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\command\index.ts` |
| 命令执行 (SessionPrompt.command) | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\session\prompt.ts` |
| session.command API 路由 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\session.ts` |
| TUI 命令注册与 slashes | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx` |
| TUI 命令定义 (app) | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx` |
| Prompt 提交与 command 路由 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\index.tsx` |
| Slash 自动补全 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx` |
| Model 选择弹窗 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-model.tsx` |
| Model 状态与持久化 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx` |
| Global 路径 (state 等) | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts` |
| Web App 命令上下文 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\command.tsx` |

---

## 八、流程简图

```
用户输入 /
    │
    ├─ Autocomplete: command.slashes() + sync.data.command
    │
    ├─ 选择前端命令 (如 /models)
    │       └─ onSelect() → 打开 DialogModel → local.model.set() → 更新 modelStore
    │
    └─ 选择后端命令 (如 /init)
            └─ 插入 "/init " → 用户回车 → session.command API → SessionPrompt.command()
                    → Command.get() → 模板替换 → 发送 AI 消息
```
