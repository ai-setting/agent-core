# OpenCode TUI 输入框按 "/" 触发命令列表 - 技术实现文档

本文档描述 thirdparty/opencode 下 TUI 中如何实现「输入框键入 `/` 即触发对应命令列表」这一功能，涉及的核心组件、机制及关键代码位置，供其他 Agent 参考实现类似机制。

---

## 一、概览

### 1.1 功能概述

- **触发时机**：用户在输入框**行首**键入 `/` 时，自动弹出命令列表
- **核心组件**：`Autocomplete` 组件
- **数据来源**：`command.slashes()`（前端命令）+ `sync.data.command`（后端命令）
- **底层框架**：OpenTUI（`@opentui/core` + `@opentui/solid`）+ SolidJS

### 1.2 技术栈

| 组件 | 库/框架 |
|------|---------|
| 终端 UI 渲染 | `@opentui/core`（TextareaRenderable、box、scrollbox 等） |
| 响应式 | SolidJS（createMemo、createSignal、createStore） |
| 模糊匹配 | `fuzzysort` |
| 命令注册 | `useCommandDialog`、`command.register()` |

---

## 二、触发机制

### 2.1 触发入口

触发有两种方式：

1. **通过 `onKeyDown`**：用户按下 `/` 键且光标在行首时
2. **通过 `onInput`**：输入内容变化时，若以 `/` 开头且无空格，则重新打开命令列表

### 2.2 关键代码：`onKeyDown` 中 `/` 检测

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

```tsx
// 约 414-446 行
onKeyDown(e: KeyEvent) {
  if (!store.visible) {
    // ...
    if (e.name === "/") {
      if (props.input().cursorOffset === 0) show("/")
    }
  }
}
```

### 2.3 关键代码：`onInput` 中内容变化检测

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

```tsx
// 约 382-410 行
onInput(value) {
  // ...
  // 检测行首 "/" 触发命令列表
  if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
    show("/")
    setStore("index", 0)
    return
  }
}
```

### 2.4 输入框与 Autocomplete 的联动

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\index.tsx`

- 输入框的 `onContentChange` 会调用 `autocomplete.onInput(value)`（约 571-576 行）
- 输入框的 `onKeyDown` 会调用 `autocomplete.onKeyDown(e)`（约 639 行）

```tsx
// 约 570-576 行
onContentChange={() => {
  const value = input.plainText
  setStore("prompt", "input", value)
  autocomplete.onInput(value)
  syncExtmarksWithPromptParts()
}}

// 约 639 行
if (store.mode === "normal") autocomplete.onKeyDown(e)
```

---

## 三、核心组件

### 3.1 Autocomplete 组件

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

#### 职责

- 监听 `/` 和 `@` 触发
- 显示命令/文件/Agent 列表
- 支持模糊搜索（fuzzysort）
- 支持键盘（上下键、回车、Tab）和鼠标选择

#### 状态

```tsx
// 约 83-88 行
const [store, setStore] = createStore({
  index: 0,        // 触发字符在输入中的位置
  selected: 0,      // 当前选中项索引
  visible: false,   // false | "@" | "/"
  input: "keyboard", // "keyboard" | "mouse"
})
```

#### 显示/隐藏

```tsx
// 约 361-374 行
function show(mode: "@" | "/") {
  command.keybinds(false)
  setStore({
    visible: mode,
    index: props.input().cursorOffset,
  })
}

function hide() {
  // ...
  command.keybinds(true)
  setStore("visible", false)
}
```

### 3.2 命令来源：`commands` 的 createMemo

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

```tsx
// 约 354-375 行
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
        const cursor = props.input().logicalCursor
        props.input().deleteRange(0, 0, cursor.row, cursor.col)
        props.input().insertText(newText)
        props.input().cursorOffset = Bun.stringWidth(newText)
      },
    })
  }

  results.sort((a, b) => a.display.localeCompare(b.display))
  // ...
})
```

### 3.3 command.slashes() 来源：`dialog-command`

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx`

```tsx
// 约 83-94 行
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
}
```

---

## 四、层级与依赖关系

```
Prompt (prompt/index.tsx)
  ├── Autocomplete (autocomplete.tsx)
  │     ├── useCommandDialog() → command.slashes()
  │     └── useSync() → sync.data.command
  └── textarea (@opentui/core TextareaRenderable)
        ├── onContentChange → autocomplete.onInput
        └── onKeyDown → autocomplete.onKeyDown
```

---

## 五、sync.data.command 的来源

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\sync.tsx`

```tsx
// 约 42 行：store 定义
command: Command[]

// 约 387 行：bootstrap 时从 API 拉取
sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? [])))
```

---

## 六、选项列表渲染

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx`

```tsx
// 约 378-412 行：options 合并与模糊匹配
const options = createMemo((prev: AutocompleteOption[] | undefined) => {
  const mixed: AutocompleteOption[] =
    store.visible === "@" ? [...agentsValue, ...(filesValue || []), ...mcpResources()] : [...commandsValue]

  const searchValue = search()
  if (!searchValue) return mixed

  const result = fuzzysort.go(removeLineRange(searchValue), mixed, {
    keys: [...],
    limit: 10,
    // ...
  })
  return result.map((arr) => arr.obj)
})

// 约 428-463 行：UI 渲染
<box visible={store.visible !== false} position="absolute" ...>
  <scrollbox ...>
    <Index each={options()}>
      {(option, index) => (
        <box
          backgroundColor={index === store.selected ? theme.primary : undefined}
          onMouseDown={() => { moveTo(index) }}
          onMouseUp={() => select()}
        >
          <text>{option().display}</text>
          <Show when={option().description}>
            <text>{option().description}</text>
          </Show>
        </box>
      )}
    </Index>
  </scrollbox>
</box>
```

---

## 七、命令对话组件（DialogCommand）与 Dialog 机制

TUI 中除了输入框内联的 Autocomplete 外，还有**独立的命令对话组件**，用户选择命令后通常会**进入该命令对应的 Dialog 界面**完成后续操作。

### 7.1 两种命令入口对比

| 入口 | 触发方式 | 展示形式 | 选择后行为 |
|------|----------|----------|------------|
| **Autocomplete** | 输入框行首输入 `/` | 输入框上方的小 popover | 与 DialogCommand 一致：`command.trigger()` |
| **DialogCommand** | 快捷键 `ctrl+p`（command_list） | 全屏 Dialog + 搜索框 + 分组列表 | `option.onSelect(dialog)` |

两者共用同一套命令注册（`command.register()`），选择后都执行 `option.onSelect(dialog)`，因此行为一致。

### 7.2 DialogCommand 组件

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx`

#### 触发与展示

```tsx
// 约 126-136 行：CommandProvider 监听快捷键
if (keybind.match("command_list", evt)) {
  evt.preventDefault()
  value.show()
  return
}

// 约 99-101 行：show() 用 DialogSelect 替换当前 Dialog
show() {
  dialog.replace(() => <DialogCommand options={visibleOptions()} suggestedOptions={suggestedOptions()} />)
}

// 约 139-147 行：DialogCommand 内部
function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  let ref: DialogSelectRef<string>
  const list = () => {
    if (ref?.filter) return props.options
    return [...props.suggestedOptions, ...props.options]  // suggested 置顶
  }
  return <DialogSelect ref={(r) => (ref = r)} title="Commands" options={list()} />
}
```

#### 命令注册与 onSelect

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx`

```tsx
// 约 286-334 行：典型命令定义
{
  title: "Switch session",
  value: "session.list",
  slash: { name: "sessions", aliases: ["resume", "continue"] },
  onSelect: () => {
    dialog.replace(() => <DialogSessionList />)
  },
},
{
  title: "Switch model",
  value: "model.list",
  slash: { name: "models" },
  onSelect: () => {
    dialog.replace(() => <DialogModel />)
  },
},
{
  title: "Switch agent",
  value: "agent.list",
  slash: { name: "agents" },
  onSelect: () => {
    dialog.replace(() => <DialogAgent />)
  },
},
```

### 7.3 选择命令后进入对应 Dialog

选择命令后，`onSelect(dialog)` 被调用，绝大多数前端命令会执行 `dialog.replace(() => <DialogXxx />)`：

- **`dialog.replace()`**：清空当前 Dialog 栈，用新组件替换栈顶
- 用户进入**该命令对应的 Dialog 界面**（如 `DialogModel`、`DialogSessionList`、`DialogAgent` 等）
- 在新 Dialog 中完成选择（如选模型、选 Session）后，通常调用 `dialog.clear()` 关闭

```
用户按 ctrl+p
    │
    └─ command.show()
        │
        └─ dialog.replace(() => <DialogCommand ... />)
            │
            └─ 全屏 Dialog：标题 "Commands" + 搜索框 + 分组命令列表
                │
                └─ 用户选择 "Switch model"（回车或点击）
                    │
                    └─ option.onSelect(dialog)
                        │
                        └─ dialog.replace(() => <DialogModel />)
                            │
                            └─ 替换为模型选择 Dialog，用户选模型 → onSelect → dialog.clear()
```

### 7.4 Dialog 栈机制

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog.tsx`

```tsx
// 约 49-125 行：Dialog 上下文
const [store, setStore] = createStore({
  stack: [] as { element: JSX.Element; onClose?: () => void }[],
  size: "medium" as "medium" | "large",
})

// replace：替换整个栈（清空旧栈，推入新内容）
replace(input: any, onClose?: () => void) {
  for (const item of store.stack) {
    if (item.onClose) item.onClose()
  }
  setStore("stack", [{ element: input, onClose }])
}

// clear：清空栈，关闭所有 Dialog
clear() {
  for (const item of store.stack) {
    if (item.onClose) item.onClose()
  }
  setStore("stack", [])
}

// Esc：弹出栈顶
if (evt.name === "escape" && store.stack.length > 0) {
  const current = store.stack.at(-1)!
  current.onClose?.()
  setStore("stack", store.stack.slice(0, -1))
}
```

### 7.5 DialogSelect 通用选择组件

**文件路径：** `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog-select.tsx`

DialogCommand 内部使用 `DialogSelect` 展示命令列表：

| 能力 | 说明 |
|------|------|
| 搜索 | 顶部 `<input>` 输入过滤，fuzzysort 模糊匹配 |
| 分组 | 按 `category` 分组展示（Session、Agent、System 等） |
| 键盘 | 上下键、PageUp/PageDown、Home/End、回车选择 |
| 鼠标 | 点击、悬停高亮 |
| 选择回调 | `option.onSelect(dialog)` 传入 dialog 上下文 |

```tsx
// 约 184-193 行：回车时执行选择
if (evt.name === "return") {
  const option = selected()
  if (option) {
    option.onSelect?.(dialog)
    props.onSelect?.(option)
  }
}
```

### 7.6 命令类型与 onSelect 行为

| 类型 | 示例 | onSelect 行为 |
|------|------|---------------|
| **打开 Dialog** | /models、/sessions、/help | `dialog.replace(() => <DialogXxx />)` |
| **直接执行** | 切换主题、退出、cycle 等 | `dialog.clear()` 或 `local.model.cycle()` |
| **后端命令** | /init、/review | 不通过 command，Autocomplete 插入 `/init ` 后等用户回车 |

### 7.7 相关文件路径

| 组件/功能 | 绝对路径 |
|----------|----------|
| 命令 Dialog 与 CommandProvider | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx` |
| Dialog 栈与 replace/clear | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog.tsx` |
| DialogSelect 通用选择 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog-select.tsx` |
| 命令定义（含 onSelect） | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx` |
| 模型选择 Dialog | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-model.tsx` |
| Session 列表 Dialog | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-session-list.tsx` |

---

## 八、关键文件索引（绝对路径）

| 功能 | 绝对路径 |
|------|----------|
| 按 "/" 触发及命令列表逻辑 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\autocomplete.tsx` |
| Prompt 输入框与 Autocomplete 集成 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\index.tsx` |
| 命令注册与 slashes | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx` |
| TUI 命令定义（如 slash 配置） | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\app.tsx` |
| sync.data.command 来源 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\sync.tsx` |
| 后端命令 API | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\command\index.ts` |
| 提交时 command 路由 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\index.tsx`（submit 函数） |
| 命令 Dialog 与 CommandProvider | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\dialog-command.tsx` |
| Dialog 栈机制 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog.tsx` |
| DialogSelect 通用选择 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\ui\dialog-select.tsx` |

---

## 九、流程简图

```
用户输入 "/"
    │
    ├─ onKeyDown (e.name === "/" && cursorOffset === 0)
    │   或 onInput (value.startsWith("/"))
    │
    └─ show("/")
        │
        ├─ store.visible = "/"
        ├─ store.index = cursorOffset
        │
        ├─ commands = createMemo(() => [...command.slashes(), ...sync.data.command])
        │
        ├─ options = createMemo(() => 模糊匹配 filter 后的 commands)
        │
        └─ 渲染 <box> + <scrollbox> + <Index each={options()}>
              │
              ├─ 用户选择：select() → selected.onSelect?.()
              │   ├─ 前端命令：onSelect → command.trigger()
              │   └─ 后端命令：onSelect → insertText("/xxx ") 等待用户回车
              │
              └─ 提交时：Prompt 中 submit() 判断
                  ├─ sync.data.command 有对应 → session.command API
                  └─ 否则 → session.prompt API
```

---

## 十、实现建议（供其他 Agent 参考）

1. **复制 Autocomplete 模式**：在输入组件中监听 `onKeyDown` 与 `onInput`，检测触发字符（如 `/`）。
2. **命令列表**：需要一个可合并「前端命令 + 后端命令」的 `commands` 数据源。
3. **UI 渲染**：使用 `position="absolute"` 的 popover，放在输入框上方。
4. **模糊匹配**：使用 `fuzzysort` 对 `search` 做过滤。
5. **选择逻辑**：`selected` 索引 + `onKeyDown` 处理上下键、回车、Tab、Esc。
6. **依赖**：`@opentui/core` + `@opentui/solid` 提供 TUI 组件；`fuzzysort` 做模糊匹配；SolidJS 做响应式。

---

**文档版本**：基于 thirdparty/opencode 代码库调研  
**最后更新**：2025-02-11
