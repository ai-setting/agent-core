# Command 开发指南

本文档详细记录了 agent-core 中 Command 的完整开发流程，包括后端实现、前端 Dialog 实现、常见问题及解决方案。以 `/models` 命令为示例，指导开发者快速实现新的 Command。

---

## 一、Command 架构概述

agent-core 的 Command 采用**后端执行**架构：

```
用户输入 /command_name
    │
    ├─ TUI: CommandPalette 捕获命令
    │
    ├─ HTTP POST /commands/{name} → Server 端执行
    │
    ├─ Server 返回 CommandResult
    │   ├─ mode: "dialog" → TUI 打开对应的 Dialog
    │   └─ mode: 其他 → TUI 显示结果消息
    │
    └─ Dialog 中用户交互 → 再次调用 command API
```

### 核心文件位置

```
packages/core/src/
├── server/
│   ├── command/
│   │   ├── types.ts              # Command 接口定义
│   │   ├── registry.ts           # Command 注册中心
│   │   └── built-in/
│   │       ├── echo.ts           # 示例命令
│   │       ├── connect.ts        # Provider 连接命令
│   │       └── models.ts         # 模型选择命令
│   └── index.ts                  # Server 入口，注册命令
│
└── cli/tui/
    ├── components/
    │   ├── CommandPalette.tsx    # 命令面板（输入 / 触发）
    │   ├── CommandDialog.tsx     # 命令选择对话框
    │   ├── DialogStack.tsx       # Dialog 栈管理
    │   ├── ModelsDialog.tsx      # 模型选择 Dialog
    │   ├── ConnectDialog.tsx     # Provider 连接 Dialog
    │   └── EchoDialog.tsx        # Echo 测试 Dialog
    │
    └── contexts/
        ├── command.tsx           # Command Context（执行命令）
        └── dialog.tsx            # Dialog Context（管理 Dialog 栈）
```

---

## 二、后端实现

### 2.1 Command 接口定义

```typescript
// packages/core/src/server/command/types.ts

export interface Command {
  /** 命令名称（不带 / 前缀） */
  name: string;
  
  /** 显示名称 */
  displayName: string;
  
  /** 命令描述 */
  description: string;
  
  /** 是否需要参数 */
  hasArgs: boolean;
  
  /** 参数描述（可选） */
  argsDescription?: string;
  
  /** 执行命令 */
  execute(context: CommandContext, args: string): Promise<CommandResult>;
}

export interface CommandContext {
  sessionId: string;
  env?: BaseEnvironment;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
}
```

### 2.2 实现命令

创建文件 `packages/core/src/server/command/built-in/xxx.ts`：

```typescript
import type { Command, CommandContext, CommandResult } from "../types.js";

interface Action {
  type: "list" | "select" | "other_action";
  // ... 其他参数
}

export const xxxCommand: Command = {
  name: "xxx",
  displayName: "Xxx",
  description: "Description of the command",
  hasArgs: false,  // 大多数 Dialog 命令设为 false

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // 解析 action
    let action: Action;
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
        // 返回 dialog 模式，触发前端打开 Dialog
        return {
          success: true,
          message: "Opening dialog",
          data: {
            mode: "dialog",  // 关键：触发 Dialog
            items: [],       // Dialog 需要的数据
          },
        };
      }

      case "select": {
        // 执行选择操作
        // ...
        return {
          success: true,
          message: "Item selected",
          data: { selected: action.item },
        };
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as any).type}`,
        };
    }
  },
};
```

### 2.3 注册命令

在 `packages/core/src/server/index.ts` 中注册：

```typescript
import { xxxCommand } from "./command/built-in/xxx.js";

// 在 startServer 函数中
commandRegistry.register(xxxCommand);
```

---

## 三、前端实现

### 3.1 在 CommandPalette 中添加命令处理

编辑 `packages/core/src/cli/tui/components/CommandPalette.tsx`：

```typescript
// 1. 导入 Dialog 组件
import { XxxDialog } from "./XxxDialog.js";

// 2. 添加到 commandsWithDialog 数组
const commandsWithDialog = ["connect", "echo", "models", "xxx"];

// 3. 在 executeCommand 中添加处理逻辑
if (name === "xxx") {
  const result = await command.executeCommand(name, args);
  if (result.success && result.data?.mode === "dialog") {
    dialog.push(
      () => <XxxDialog data={result.data} />,
      { title: "Xxx Dialog" }
    );
  }
  return;
}
```

### 3.2 实现 Dialog 组件

创建文件 `packages/core/src/cli/tui/components/XxxDialog.tsx`：

```typescript
import { createSignal, createMemo, For, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface Item {
  id: string;
  name: string;
  // ...
}

interface XxxDialogData {
  items: Item[];
}

interface XxxDialogProps {
  data: XxxDialogData;
}

export function XxxDialog(props: XxxDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  // 状态
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  // ⚠️ 重要：使用 ref 获取 input 值
  let inputRef: any = null;

  // 过滤列表
  const filteredItems = createMemo(() => {
    const f = filter().toLowerCase().trim();
    if (!f) return props.data.items;
    return props.data.items.filter(item => 
      item.name.toLowerCase().includes(f)
    );
  });

  // 选择移动
  const moveSelection = (direction: -1 | 1) => {
    const list = filteredItems();
    if (list.length === 0) return;
    
    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;
    setSelectedIndex(next);
  };

  // 键盘处理 - 返回 boolean 表示是否处理了该键
  const handleListKeyDown = (key: string): boolean => {
    switch (key.toLowerCase()) {
      case "up":
      case "arrowup":
        moveSelection(-1);
        return true;
      case "down":
      case "arrowdown":
        moveSelection(1);
        return true;
      case "return":
      case "enter":
        selectItem();
        return true;
      case "escape":
        dialog.pop();
        return true;
      default:
        return false;
    }
  };

  // 选择项目
  const selectItem = async () => {
    const list = filteredItems();
    const selected = list[selectedIndex()];
    if (!selected) return;

    const result = await command.executeCommand(
      "xxx",
      JSON.stringify({ type: "select", id: selected.id })
    );

    if (result.success) {
      dialog.pop();
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* 搜索框 */}
      <box flexDirection="row" height={1} marginBottom={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          ref={(ref: any) => { inputRef = ref; }}
          flexGrow={1}
          value={filter()}
          onContentChange={(event: any) => {
            // ⚠️ 关键：从 ref 获取值，而不是从 event
            const value = inputRef?.plainText || inputRef?.value || "";
            setFilter(value);
            setSelectedIndex(0);
          }}
          placeholder="Filter..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleListKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      {/* 列表 */}
      <box flexGrow={1} flexDirection="column" overflow="scroll">
        <Show
          when={filteredItems().length > 0}
          fallback={<text fg={theme.theme().muted}>No items found</text>}
        >
          <For each={filteredItems()}>
            {(item, index) => {
              const isSelected = () => index() === selectedIndex();
              return (
                <box
                  flexDirection="row"
                  paddingLeft={2}
                  height={1}
                  backgroundColor={isSelected() ? theme.theme().primary : undefined}
                >
                  <text fg={isSelected() ? theme.theme().background : theme.theme().foreground}>
                    {item.name}
                  </text>
                </box>
              );
            }}
          </For>
        </Show>
      </box>

      {/* 底部提示 */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter select • Esc close
        </text>
      </box>
    </box>
  );
}
```

---

## 四、前端 Dialog 开发指导原则

### 4.1 必须遵守的规则

#### ⚠️ 规则 1：使用 ref 获取 input 值

**问题**：OpenTUI 的 `input` 组件的 `onContentChange` 事件对象是空的 `{}`，无法从中获取输入值。

**错误做法**：
```typescript
// ❌ 错误：event 是空对象
onContentChange={(event: any) => {
  const value = event?.value || event;  // 得到 "[object Object]"
  setFilter(value);
}}
```

**正确做法**：
```typescript
// ✅ 正确：使用 ref 获取值
let inputRef: any = null;

<input
  ref={(ref: any) => { inputRef = ref; }}
  onContentChange={(event: any) => {
    const value = inputRef?.plainText || inputRef?.value || "";
    setFilter(value);
  }}
/>
```

#### ⚠️ 规则 2：键盘处理函数返回 boolean

**问题**：`onKeyDown` 需要知道是否处理了该键，来决定是否调用 `preventDefault()`。

**正确模式**：
```typescript
const handleListKeyDown = (key: string): boolean => {
  switch (key.toLowerCase()) {
    case "up":
    case "arrowup":
      moveSelection(-1);
      return true;  // 已处理
    case "down":
    case "arrowdown":
      moveSelection(1);
      return true;  // 已处理
    default:
      return false; // 未处理，让按键继续传递
  }
};

// 使用方式
onKeyDown={(e: any) => {
  if (handleListKeyDown(e.name || e.key)) {
    e.preventDefault();  // 只有处理了才阻止默认行为
  }
}}
```

#### ⚠️ 规则 3：使用 createMemo 处理过滤列表

**问题**：过滤后的列表需要响应式更新。

**正确做法**：
```typescript
const filteredItems = createMemo(() => {
  const f = filter().toLowerCase().trim();
  if (!f) return props.data.items;
  return props.data.items.filter(item => 
    item.name.toLowerCase().includes(f)
  );
});
```

#### ⚠️ 规则 4：选中状态使用函数形式

**问题**：在 `For` 循环中，选中状态需要正确响应。

**正确做法**：
```typescript
<For each={filteredItems()}>
  {(item, index) => {
    // ✅ 使用函数形式，确保响应式
    const isSelected = () => index() === selectedIndex();
    
    return (
      <box backgroundColor={isSelected() ? theme.theme().primary : undefined}>
        {/* ... */}
      </box>
    );
  }}
</For>
```

### 4.2 Dialog 结构模板

```typescript
<box flexDirection="column" width="100%" height="100%" padding={1}>
  {/* 1. 搜索/输入框 */}
  <box flexDirection="row" height={1} marginBottom={1}>
    <text fg={theme.theme().primary}>&gt; </text>
    <input ... />
  </box>

  {/* 2. 分隔线 */}
  <box height={1} borderStyle="single" borderColor={theme.theme().border} />

  {/* 3. 内容列表 */}
  <box flexGrow={1} flexDirection="column" overflow="scroll">
    <Show when={...} fallback={...}>
      <For each={...}>
        {(item, index) => { /* 渲染每个项目 */ }}
      </For>
    </Show>
  </box>

  {/* 4. 底部提示 */}
  <box flexDirection="row" height={1} marginTop={1}>
    <text fg={theme.theme().muted}>提示信息</text>
  </box>
</box>
```

### 4.3 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 过滤不生效 | event 对象为空 | 使用 ref 获取 input 值 |
| 键盘无响应 | handleListKeyDown 返回类型错误 | 确保返回 boolean |
| 选中状态不更新 | 未使用函数形式 | 使用 `() => index() === selectedIndex()` |
| 列表不更新 | 未使用 createMemo | 使用 createMemo 包装过滤逻辑 |
| ESC 无法退出 | onKeyDown 未处理 escape | 在 handleListKeyDown 中处理 escape |

---

## 五、Models Command 实现详情

### 5.1 文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| 命令实现 | `packages/core/src/server/command/built-in/models.ts` | 后端命令逻辑 |
| Dialog 组件 | `packages/core/src/cli/tui/components/ModelsDialog.tsx` | 前端对话框 |
| 命令注册 | `packages/core/src/server/index.ts` | 注册 models 命令 |
| CommandPalette | `packages/core/src/cli/tui/components/CommandPalette.tsx` | 添加命令处理 |
| ModelStore | `packages/core/src/config/state/model-store.ts` | 模型配置持久化 |
| Providers | `packages/core/src/config/providers.ts` | Provider 配置 |
| ServerEnvironment | `packages/core/src/server/environment.ts` | 环境配置加载 |

### 5.2 后端 Actions

| Action | 说明 |
|--------|------|
| `list` | 返回所有 providers 和 models，触发 Dialog |
| `select` | 选择模型，更新 recent 列表 |
| `toggle_favorite` | 切换模型收藏状态 |
| `set_variant` | 设置模型变体 |

### 5.3 数据结构

```typescript
// Command 返回的 Dialog 数据
interface ModelsDialogData {
  recent: Array<{ providerID: string; modelID: string }>;
  favorites: Array<{ providerID: string; modelID: string }>;
  providers: ProviderModels[];
}

interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelInfo[];
}
```

### 5.4 ServerEnvironment 集成

Models Command 与 ServerEnvironment 集成，支持：

1. **启动时加载模型配置**：优先级链 `current > config > recent > provider default`
2. **实时切换模型**：调用 `env.switchModel()` 重新初始化 LLM
3. **持久化**：recent/favorites 保存到 `~/.local/state/tong_work/agent-core/model.json`

---

## 六、开发 Checklist

开发新 Command 时，按以下 Checklist 检查：

### 后端
- [ ] 创建 `packages/core/src/server/command/built-in/xxx.ts`
- [ ] 实现 Command 接口（name, displayName, description, hasArgs, execute）
- [ ] 在 `packages/core/src/server/index.ts` 中注册命令
- [ ] 实现 list action，返回 `mode: "dialog"`
- [ ] 实现其他 actions（select, update, etc.）

### 前端
- [ ] 创建 `packages/core/src/cli/tui/components/XxxDialog.tsx`
- [ ] 使用 ref 获取 input 值（`inputRef?.plainText || inputRef?.value`）
- [ ] 实现 `handleListKeyDown` 返回 boolean
- [ ] 使用 `createMemo` 处理过滤列表
- [ ] 选中状态使用函数形式 `() => index() === selectedIndex()`
- [ ] 在 `CommandPalette.tsx` 中导入 Dialog 组件
- [ ] 添加到 `commandsWithDialog` 数组
- [ ] 在 `executeCommand` 中添加命令处理逻辑

### 测试
- [ ] 启动 Server：`bun run start`
- [ ] 启动 TUI：`bun run attach http://localhost:3000`
- [ ] 输入 `/` 打开命令面板
- [ ] 选择命令，确认 Dialog 打开
- [ ] 测试上下键导航
- [ ] 测试过滤功能
- [ ] 测试 Enter 选择
- [ ] 测试 Esc 关闭

---

## 七、参考资源

### 现有实现

| Command | 后端文件 | Dialog 文件 | 复杂度 |
|---------|----------|-------------|--------|
| echo | `built-in/echo.ts` | `EchoDialog.tsx` | 简单 |
| connect | `built-in/connect.ts` | `ConnectDialog.tsx` | 中等 |
| models | `built-in/models.ts` | `ModelsDialog.tsx` | 中等 |

### 相关文档

- `docs/environment-design-philosophy.md` - Environment 设计理念
- `docs/config-design.md` - 配置系统设计
- `docs/DEVELOPMENT_PROGRESS.md` - 开发进度

---

## 八、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-02-13 | 初始版本，基于 models command 实现经验 |
