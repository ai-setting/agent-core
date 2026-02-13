---
name: command-development
description: 协助开发者按照规范流程创建 agent-core 中的新 Command，包括设计、实现和文档三个阶段
---

# Command 开发助手

## 描述

协助开发者按照规范流程创建 agent-core 中的新 Command。流程分为三个阶段：**设计阶段** → **研发阶段** → **文档阶段**，确保每个 command 都有完善的设计文档和实现说明。

## 适用场景

- 需要创建新的斜杠命令（如 `/xxx`）
- 需要实现命令对应的前端 Dialog 界面
- 需要理解 Command 架构和开发流程
- 需要为现有 command 补充设计和实现文档

## 开发流程

### 阶段一：设计阶段（必须先完成）

在编写任何代码之前，必须先产出设计文档。

#### 1.1 理解需求

与用户确认以下信息：
- 命令名称（如 `models`、`connect`、`echo`）
- 命令功能（列表选择、配置管理、简单操作等）
- 是否需要前端 Dialog
- 数据是否需要持久化
- 与其他组件的交互关系

#### 1.2 阅读参考文档

阅读以下文档以理解现有实现模式：
- `docs/command-mechanism-design.md` - Command 机制整体架构
- `docs/models-command-design.md` - 复杂 Command 设计示例
- 参考已有的类似 Command 实现（见"参考实现"章节）

#### 1.3 产出设计文档

**必须**在 `docs/` 目录下创建设计文档，命名格式：`{name}-command-design.md`

设计文档必须包含以下章节：

```markdown
# {Name} Command 设计文档

## 1. 概述

- 命令用途
- 设计原则
- 与现有命令的差异/关联

## 2. 总体架构

### 2.1 命令类型
- 后端命令 / 前端命令
- 执行方式
- 返回值模式

### 2.2 核心流程

```
[流程图，展示用户操作到命令执行的完整流程]
```

## 3. Server 端实现设计

### 3.1 文件位置
- 命令实现：`packages/core/src/server/command/built-in/{name}.ts`
- 类型定义：（如有新增）

### 3.2 Command 定义

```typescript
// 完整的 Command 接口定义，包括：
// - Action 类型定义
// - 所有 action type 的处理逻辑
// - 每个 case 的输入输出数据结构
```

### 3.3 依赖服务
- 使用的 store/config/auth 等模块
- 数据持久化方案

## 4. TUI 端实现设计

### 4.1 文件位置
- Dialog 组件：`packages/core/src/cli/tui/components/{Name}Dialog.tsx`
- 集成点：`CommandPalette.tsx`

### 4.2 组件设计

```typescript
// Dialog 组件接口定义
// - Props 类型
// - State 定义
// - 主要方法（选择、过滤、键盘处理等）
```

### 4.3 UI 布局
- 界面结构描述
- 交互设计（键盘、鼠标）

## 5. 数据流与持久化

- 数据流向图
- 存储方案（如有）
- 与现有存储系统的关系

## 6. API 设计

### 6.1 Request/Response 格式

```json
// 每个 action type 的请求和响应示例
{
  "type": "list",
  "...": "..."
}
```

### 6.2 Error 处理
- 错误码定义
- 错误消息规范

## 7. 实现步骤

### Phase 1: Server 端
1. [ ] 创建命令文件
2. [ ] 实现核心逻辑
3. [ ] 注册命令
4. [ ] 添加测试

### Phase 2: TUI 端
1. [ ] 创建 Dialog 组件
2. [ ] 实现 UI 交互
3. [ ] 集成到 CommandPalette

### Phase 3: 集成测试
1. [ ] 端到端测试
2. [ ] 边界情况测试

## 8. 参考文件

| 功能 | 路径 |
|------|------|
| Command Types | `packages/core/src/server/command/types.ts` |
| 类似 Command 实现 | `packages/core/src/server/command/built-in/[参考命令].ts` |
| Dialog 示例 | `packages/core/src/cli/tui/components/[参考Dialog].tsx` |
```

#### 1.4 设计评审

确认设计文档完整后，向用户展示设计要点，确认无误后进入下一阶段。

---

### 阶段二：研发阶段

严格按照设计文档进行实现。

#### 2.1 后端实现

创建文件：`packages/core/src/server/command/built-in/{name}.ts`

**代码模板：**

```typescript
import type { Command, CommandContext, CommandResult } from "../types.js";

// Action 类型定义
interface {Name}Action {
  type: "list" | "select" | /* 其他 action */;
  // 根据需求添加字段
}

// 响应数据类型
interface {Name}Response {
  mode: "dialog";
  items: Array<{ id: string; name: string }>;
  // 其他字段
}

export const {name}Command: Command = {
  name: "{name}",
  displayName: "{DisplayName}",
  description: "{Description}",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // 解析 action
    let action: {Name}Action;
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
        // TODO: 获取数据
        const items: Array<{ id: string; name: string }> = [];
        
        return {
          success: true,
          message: "Opening dialog",
          data: {
            mode: "dialog",
            items,
          } as {Name}Response,
        };
      }

      case "select": {
        // TODO: 执行选择逻辑
        return {
          success: true,
          message: "Item selected",
          data: { selected: action.id },
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

**注册命令：**

编辑 `packages/core/src/server/index.ts`：

```typescript
import { {name}Command } from "./command/built-in/{name}.js";

// 在 startServer 函数中
commandRegistry.register({name}Command);
```

#### 2.2 前端 Dialog 实现

创建文件：`packages/core/src/cli/tui/components/{Name}Dialog.tsx`

**代码模板：**

```typescript
import { createSignal, createMemo, For, Show } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface Item {
  id: string;
  name: string;
}

interface {Name}DialogData {
  items: Item[];
}

interface {Name}DialogProps {
  data: {Name}DialogData;
}

export function {Name}Dialog(props: {Name}DialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  let inputRef: any = null;

  const filteredItems = createMemo(() => {
    const f = filter().toLowerCase().trim();
    if (!f) return props.data.items;
    return props.data.items.filter(item => 
      item.name.toLowerCase().includes(f)
    );
  });

  const moveSelection = (direction: -1 | 1) => {
    const list = filteredItems();
    if (list.length === 0) return;
    
    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;
    setSelectedIndex(next);
  };

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

  const selectItem = async () => {
    const list = filteredItems();
    const selected = list[selectedIndex()];
    if (!selected) return;

    tuiLogger.info("[{Name}Dialog] Selecting item", { id: selected.id });

    const result = await command.executeCommand(
      "{name}",
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

#### 2.3 CommandPalette 集成 ⚠️ 关键步骤

编辑 `packages/core/src/cli/tui/components/CommandPalette.tsx`，**必须完成以下三项**：

```typescript
// 1. 导入 Dialog 组件
import { {Name}Dialog } from "./{Name}Dialog.js";

// 2. 添加到 commandsWithDialog 数组（⚠️ 最容易遗漏！）
const commandsWithDialog = ["connect", "echo", "models", "{name}"];

// 3. 在 executeCommand 函数中添加处理逻辑
if (name === "{name}") {
  tuiLogger.info("[CommandPalette] Executing {name} command to get data");
  const result = await command.executeCommand(name, args);
  
  if (result.success && result.data && (result.data as any).mode === "dialog") {
    tuiLogger.info("[CommandPalette] Opening {Name}Dialog with data");
    dialog.push(
      () => <{Name}Dialog data={(result.data as any)} />,
      { title: "{DisplayName}" }
    );
  } else {
    tuiLogger.error("[CommandPalette] {name} command failed or returned invalid data");
    store.addMessage({
      id: `cmd-error-${Date.now()}`,
      role: "system",
      content: `✗ /{name} failed: ${result.message || "Failed to load data"}`,
      timestamp: Date.now(),
    });
  }
  return;
}
```

**⚠️ 警告**：第 2 步（commandsWithDialog 数组）最容易被遗漏！如果遗漏，命令在 CommandPalette 中执行时将无法打开 Dialog，只会在消息列表中显示执行结果。

**验证方法**：
- 启动 TUI 后按 `/` 打开命令面板
- 选择你的命令
- **必须能看到 Dialog 弹出**，而不是只在消息列表显示 "Command executed successfully"

---

### 阶段三：文档阶段（必须完成）

研发完成后，**必须**产出实现说明文档。

#### 3.1 创建实现文档

在 `docs/` 目录下创建文档，命名格式：`opencode-{name}-command-implement.md`

文档必须包含以下章节：

```markdown
# {Name} Command 实现说明文档

> 本文档面向需要理解 {name} command 完整实现逻辑的开发者或 Agent。
> 通过阅读本文档及引用的绝对路径文件，可以快速掌握实现细节。

## 一、总体架构

[架构描述，与设计文档保持一致]

## 二、核心流程

```
[详细的流程图，展示实际代码执行路径]
```

## 三、Server 端实现详解

### 3.1 文件位置

**绝对路径**: `{workspace}/packages/core/src/server/command/built-in/{name}.ts`

### 3.2 核心代码解析

#### Action 类型定义

```typescript
// 行号: XX-XX
interface {Name}Action {
  // 详细说明每个字段的用途
}
```

#### list action 实现

```typescript
// 行号: XX-XX
case "list": {
  // 详细说明实现逻辑
}
```

#### select action 实现

```typescript
// 行号: XX-XX
case "select": {
  // 详细说明实现逻辑
}
```

### 3.3 依赖模块

| 模块 | 路径 | 用途 |
|------|------|------|
| [模块名] | `[绝对路径]` | [用途说明] |

## 四、TUI 端实现详解

### 4.1 文件位置

**绝对路径**: `{workspace}/packages/core/src/cli/tui/components/{Name}Dialog.tsx`

### 4.2 组件结构

```typescript
// 行号: XX-XX
interface {Name}DialogProps {
  // 详细说明每个 prop
}
```

### 4.3 关键方法

#### 过滤逻辑

```typescript
// 行号: XX-XX
const filteredItems = createMemo(() => {
  // 详细说明过滤逻辑
});
```

#### 键盘处理

```typescript
// 行号: XX-XX
const handleListKeyDown = (key: string): boolean => {
  // 详细说明每个按键的处理
};
```

#### 选择逻辑

```typescript
// 行号: XX-XX
const selectItem = async () => {
  // 详细说明选择后的处理流程
};
```

### 4.4 UI 布局

[组件结构图或描述]

## 五、数据流

```
[详细的数据流向图]
```

## 六、API 参考

### 6.1 Request/Response 示例

**List Action**
```json
// Request
{ "type": "list" }

// Response
{
  "success": true,
  "data": {
    "mode": "dialog",
    "items": []
  }
}
```

**Select Action**
```json
// Request
{ "type": "select", "id": "xxx" }

// Response
{
  "success": true,
  "message": "Item selected"
}
```

## 七、关键文件索引

| 功能 | 绝对路径 | 关键行号 |
|------|----------|----------|
| 命令定义 | `{workspace}/packages/core/src/server/command/built-in/{name}.ts` | XX-XX |
| Dialog 组件 | `{workspace}/packages/core/src/cli/tui/components/{Name}Dialog.tsx` | XX-XX |
| CommandPalette 集成 | `{workspace}/packages/core/src/cli/tui/components/CommandPalette.tsx` | XX-XX |
| 类型定义 | `{workspace}/packages/core/src/server/command/types.ts` | XX-XX |

## 八、扩展指南

### 8.1 添加新的 action type

1. 在 `{Name}Action` 中添加新的 type
2. 在 switch 中添加新的 case
3. 更新 Dialog 组件支持新的交互

### 8.2 修改数据结构

1. 更新接口定义
2. 更新后端数据组装逻辑
3. 更新前端组件 Props

## 九、注意事项

- [重要实现细节 1]
- [重要实现细节 2]
- [常见问题及解决方案]
```

#### 3.2 更新 README

在 `docs/README.md` 中添加新 command 的文档链接。

---

## 关键规则

### ⚠️ 规则 1：必须先有设计文档

**严禁**直接写代码。必须先产出设计文档，经过确认后再实现。

### ⚠️ 规则 2：使用 ref 获取 input 值

OpenTUI 的 `input` 组件的 `onContentChange` 事件对象是空的 `{}`，无法从中获取输入值。

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

### ⚠️ 规则 3：键盘处理函数返回 boolean

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

### ⚠️ 规则 4：选中状态使用函数形式

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

### ⚠️ 规则 5：文档中的路径必须是绝对路径

实现说明文档中所有文件路径必须是绝对路径，格式：

```
{workspace}/packages/core/src/...
```

其中 `{workspace}` 是实际的工作区根目录（如 `d:\document\zhishitong_workspace\zst_project\tong_work`）。

### ⚠️ 规则 6：有 Dialog 的命令必须在 CommandPalette.tsx 中注册

**如果命令返回 `mode: "dialog"` 并需要打开 Dialog，必须在 `CommandPalette.tsx` 中完成三项操作：**

1. **导入 Dialog 组件**（第 1 步）
2. **添加到 `commandsWithDialog` 数组**（第 2 步）⚠️ **这是最容易遗漏的！**
3. **在 `executeCommand` 中添加处理逻辑**（第 3 步）

**错误示例**（agent-env 命令曾经犯的错误）：
```typescript
// ❌ 错误：只在 CommandDialog.tsx 中添加了 agent-env 的处理
// 但没有在 CommandPalette.tsx 的 commandsWithDialog 中注册
// 导致在 CommandPalette 中执行命令时，无法打开 Dialog
```

**正确做法**（必须在 CommandPalette.tsx 中完成）：
```typescript
// 1. 导入 Dialog 组件
import { AgentEnvDialog } from "./AgentEnvDialog.js";

// 2. 添加到 commandsWithDialog 数组 ⚠️ 这一步绝对不能漏！
const commandsWithDialog = ["connect", "echo", "models", "agent-env"];

// 3. 在 executeCommand 中添加处理逻辑
if (name === "agent-env") {
  const result = await command.executeCommand(name, args);
  if (result.success && result.data?.mode === "dialog") {
    dialog.push(
      () => <AgentEnvDialog data={result.data} />,
      { title: "Manage Environments" }
    );
  }
  return;
}
```

**重要说明**：
- `CommandDialog.tsx` 处理的是命令选择界面（/ 弹出的大对话框）
- `CommandPalette.tsx` 处理的是快速命令执行（/ 后选择命令直接执行）
- **两者都需要注册**，缺一不可！

---

## 测试清单

- [ ] 启动 Server：`bun run start`
- [ ] 启动 TUI：`bun run attach http://localhost:3000`
- [ ] 输入 `/` 打开命令面板
- [ ] **关键测试**：在 CommandPalette 中选择命令，确认 Dialog 能正常打开
- [ ] **关键测试**：在 CommandDialog 中选择命令，确认 Dialog 能正常打开
- [ ] 测试上下键导航
- [ ] 测试过滤功能
- [ ] 测试 Enter 选择
- [ ] 测试 Esc 关闭
- [ ] 设计文档已产出到 `docs/{name}-command-design.md`
- [ ] 实现文档已产出到 `docs/opencode-{name}-command-implement.md`
- [ ] **代码审查**：确认 CommandPalette.tsx 中已完成三项集成（导入、commandsWithDialog 数组、executeCommand 处理）

---

## 参考实现

| Command | 设计文档 | 实现文档 | 后端文件 | Dialog 文件 | 复杂度 |
|---------|----------|----------|----------|-------------|--------|
| echo | - | - | `built-in/echo.ts` | `EchoDialog.tsx` | 简单 |
| connect | - | - | `built-in/connect.ts` | `ConnectDialog.tsx` | 中等 |
| models | `models-command-design.md` | `opencode-model-command-implement.md` | `built-in/models.ts` | `ModelsDialog.tsx` | 中等 |

---

## 文档模板快速链接

### 设计文档模板

参考：`docs/models-command-design.md`

### 实现文档模板

参考：`docs/opencode-model-command-implement.md`

---

## 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| Skill 无法加载 | SKILL.md 缺少 frontmatter | 确保文件以 `---` 开头，包含 name 和 description |
| 过滤不生效 | event 对象为空 | 使用 ref 获取 input 值 |
| 键盘无响应 | handleListKeyDown 返回类型错误 | 确保返回 boolean |
| 选中状态不更新 | 未使用函数形式 | 使用 `() => index() === selectedIndex()` |
| 列表不更新 | 未使用 createMemo | 使用 createMemo 包装过滤逻辑 |
| ESC 无法退出 | onKeyDown 未处理 escape | 在 handleListKeyDown 中处理 escape |
| 命令选择后 Dialog 不弹出 | 未在 CommandPalette.tsx 的 commandsWithDialog 数组中注册 | 按照规则 6 完成三项集成（导入、数组注册、executeCommand 处理）|

---

## 相关文档

- `docs/command-mechanism-design.md` - Command 机制整体架构设计
- `docs/models-command-design.md` - Models Command 设计文档示例
- `docs/opencode-model-command-implement.md` - 实现说明文档示例
- `docs/environment-design-philosophy.md` - Environment 设计理念
- `docs/config-design.md` - 配置系统设计
