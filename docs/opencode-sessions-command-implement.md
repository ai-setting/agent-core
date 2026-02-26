# Sessions Command 实现说明文档

> 本文档面向需要理解 sessions command 完整实现逻辑的开发者或 Agent。
> 通过阅读本文档及引用的绝对路径文件，可以快速掌握实现细节。

## 一、总体架构

Sessions Command 实现了一个完整的会话列表管理功能，包括：
- **后端 Command**: 提供 list/select/delete 三种 action
- **前端 Dialog**: 展示会话列表，支持搜索、选择、删除操作
- **数据流**: 从 Storage 模块获取会话数据，通过 REST API 传输到 TUI 渲染

## 二、核心流程

```
用户输入 /sessions
    ↓
CommandPalette/CommandDialog 检测到 sessions 命令
    ↓
调用 command.executeCommand("sessions", '{"type":"list"}')
    ↓
POST /commands/sessions
    ↓
SessionsCommand.execute() 处理 list action
    ↓
Storage.listSessions() 获取所有会话
    ↓
提取 SessionListItem 信息（id, title, time, messageCount, directory）
    ↓
按 updatedAt 倒序排序
    ↓
返回 JSON 响应 { mode: "dialog", sessions: [...] }
    ↓
TUI 接收到响应，检测到 mode: "dialog"
    ↓
dialog.push(() => <SessionsDialog data={...} />, { title: "Sessions" })
    ↓
渲染会话列表，支持搜索/导航/选择/删除
```

## 三、Server 端实现详解

### 3.1 文件位置

**绝对路径**: `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\server\command\built-in\sessions.ts`

### 3.2 核心代码解析

#### Action 类型定义（行 15-19）

```typescript
interface SessionsAction {
  type: "list" | "select" | "delete";
  sessionId?: string;
}
```

- **list**: 获取所有会话列表
- **select**: 切换到指定会话
- **delete**: 删除指定会话

#### SessionListItem 类型（行 21-28）

```typescript
interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  directory: string;
}
```

展示所需的核心信息，从 Session 对象提取。

#### Command 定义（行 33-66）

```typescript
export const sessionsCommand: Command = {
  name: "sessions",
  displayName: "Sessions",
  description: "List and manage conversation sessions",
  hasArgs: false,
  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // 解析 action 并分发到对应 handler
  },
};
```

#### list action 实现（行 75-103）

```typescript
async function handleListAction(): Promise<CommandResult> {
  const sessions = Storage.listSessions();
  
  const sessionItems: SessionListItem[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    directory: session.directory,
  }));

  sessionItems.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    success: true,
    message: "Opening sessions dialog",
    data: {
      mode: "dialog",
      sessions: sessionItems,
    } as SessionsResponse,
  };
}
```

**关键点**:
- 使用 `Storage.listSessions()` 获取内存中的所有会话
- 提取 `session.messageCount` 显示消息数量
- 按 `updatedAt` 倒序排列（最新的在前面）
- 返回 `mode: "dialog"` 告诉 TUI 需要打开 Dialog

#### select action 实现（行 108-151）

```typescript
async function handleSelectAction(context: CommandContext, action: SessionsAction): Promise<CommandResult> {
  // 验证 sessionId
  const session = Storage.getSession(action.sessionId);
  if (!session) {
    return { success: false, message: "Session not found" };
  }

  // 如果 env 支持 setCurrentSession，调用切换
  if (context.env && "setCurrentSession" in context.env) {
    await (context.env as any).setCurrentSession(action.sessionId);
  }

  return { success: true, message: "Session selected" };
}
```

**注意**: 当前 OsEnv 未实现 `setCurrentSession`，TUI 端会在本地处理会话切换。

#### delete action 实现（行 156-196）

```typescript
async function handleDeleteAction(action: SessionsAction): Promise<CommandResult> {
  const session = Session.get(action.sessionId);
  if (!session) {
    return { success: false, message: "Session not found" };
  }

  session.delete(); // 调用 Session.delete() 级联删除

  return { success: true, message: "Session deleted" };
}
```

**注意**: `Session.delete()` 会自动删除子会话和关联的消息。

### 3.3 依赖模块

| 模块 | 路径 | 用途 |
|------|------|------|
| Storage | `packages/core/src/core/session/storage.ts` | 获取会话列表和信息 |
| Session | `packages/core/src/core/session/index.ts` | 删除会话 |
| CommandContext | `packages/core/src/server/command/types.ts` | 执行上下文 |

### 3.4 命令注册

**文件**: `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\server\index.ts`（行 52）

```typescript
import { sessionsCommand } from "./command/built-in/sessions.js";

commandRegistry.register(sessionsCommand);
```

## 四、TUI 端实现详解

### 4.1 文件位置

**绝对路径**: `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\cli\tui\components\SessionsDialog.tsx`

### 4.2 组件结构

#### Props 类型（行 20-26）

```typescript
interface SessionsDialogProps {
  data: SessionsDialogData;
}

interface SessionsDialogData {
  sessions: SessionListItem[];
}
```

#### State 定义（行 47-52）

```typescript
const [filter, setFilter] = createSignal("");
const [selectedIndex, setSelectedIndex] = createSignal(0);
const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
const [deleteTarget, setDeleteTarget] = createSignal<SessionListItem | null>(null);
const [error, setError] = createSignal<string | null>(null);
```

### 4.3 关键方法

#### 过滤逻辑（行 59-67）

```typescript
const filteredSessions = createMemo(() => {
  const f = filter().toLowerCase().trim();
  if (!f) return props.data.sessions;

  return props.data.sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(f) ||
      session.directory.toLowerCase().includes(f)
  );
});
```

支持按标题和工作目录搜索。

#### 键盘处理（行 74-113）

```typescript
const handleListKeyDown = (key: string): boolean => {
  // 处理删除确认状态
  if (showDeleteConfirm()) {
    switch (key.toLowerCase()) {
      case "y": confirmDelete(); return true;
      case "n":
      case "escape": cancelDelete(); return true;
      default: return true; // 阻止其他按键
    }
  }

  switch (key.toLowerCase()) {
    case "up": moveSelection(-1); return true;
    case "down": moveSelection(1); return true;
    case "return": selectSession(); return true;
    case "d": initiateDelete(); return true;
    case "escape": dialog.pop(); return true;
    default: return false;
  }
};
```

**按键映射**:
- `↑/↓`: 导航
- `Enter`: 选择会话
- `D`: 删除（进入确认模式）
- `Y/N`: 确认/取消删除
- `Esc`: 关闭 Dialog

#### 选择会话（行 115-136）

```typescript
const selectSession = async () => {
  const selected = list[selectedIndex()];
  
  const result = await command.executeCommand(
    "sessions",
    JSON.stringify({ type: "select", sessionId: selected.id })
  );

  if (result.success) {
    dialog.pop();
  } else {
    setError(result.message);
  }
};
```

#### 删除确认流程（行 138-188）

```typescript
const initiateDelete = () => {
  setDeleteTarget(selected);
  setShowDeleteConfirm(true);
};

const confirmDelete = async () => {
  const result = await command.executeCommand(
    "sessions",
    JSON.stringify({ type: "delete", sessionId: target.id })
  );

  if (result.success) {
    // 删除成功后刷新列表
    const listResult = await command.executeCommand("sessions", ...);
    dialog.pop();
    dialog.push(() => <SessionsDialog data={listResult.data} />);
  }
};
```

### 4.4 UI 布局

```
┌────────────────────────────────────────────┐
│ > [搜索框]                                  │
├────────────────────────────────────────────┤
│ Session Title                    5 msgs    │
│ /path/to/project         2h ago            │
├────────────────────────────────────────────┤
│ ▶ Current Session               12 msgs    │ ← 选中状态（高亮）
│ /current/path            1h ago            │
└────────────────────────────────────────────┘
```

**组件结构**:
- 搜索框（带 ref 获取输入值）
- 错误提示区
- 删除确认框（条件渲染）
- 会话列表（For 循环渲染）
- 底部操作提示

### 4.5 时间格式化（行 34-45）

```typescript
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return `${year}-${month}-${day}`;
}
```

使用相对时间（如 "2h ago"）比绝对时间更友好。

## 五、数据流

```
┌─────────────┐     GET /commands/sessions      ┌─────────────┐
│  TUI Dialog │ ───────────────────────────────> │   Server    │
└─────────────┘                                  └─────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────┐
                                               │   Storage   │
                                               │  (SQLite)   │
                                               └─────────────┘
                                                        │
                                                        │ sessions[]
                                                        ▼
                                               ┌─────────────┐
                                               │   Command   │
                                               │   Handler   │
                                               └─────────────┘
                                                        │
                                                        │ JSON
                                                        ▼
┌─────────────┐     {mode:"dialog",sessions:[]}   ┌─────────────┐
│  SessionsDialog  │ <───────────────────────────── │   Server    │
└─────────────┘                                  └─────────────┘
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
  "message": "Opening sessions dialog",
  "data": {
    "mode": "dialog",
    "sessions": [
      {
        "id": "session-xxx",
        "title": "Session Title",
        "createdAt": 1705312200000,
        "updatedAt": 1705315800000,
        "messageCount": 12,
        "directory": "/path/to/project"
      }
    ]
  }
}
```

**Select Action**
```json
// Request
{ "type": "select", "sessionId": "session-xxx" }

// Response
{
  "success": true,
  "message": "Session selected: Session Title",
  "data": { "sessionId": "session-xxx", "title": "Session Title" }
}
```

**Delete Action**
```json
// Request
{ "type": "delete", "sessionId": "session-xxx" }

// Response
{
  "success": true,
  "message": "Session deleted",
  "data": { "sessionId": "session-xxx" }
}
```

### 6.2 Error 处理

| 场景 | Response |
|------|----------|
| 会话不存在 | `{success: false, message: "Session not found: xxx"}` |
| 删除失败 | `{success: false, message: "Failed to delete session: ..."}` |
| 参数无效 | `{success: false, message: "Missing sessionId"}` |

## 七、关键文件索引

| 功能 | 绝对路径 | 关键行号 |
|------|----------|----------|
| 命令定义 | `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\server\command\built-in\sessions.ts` | 1-198 |
| Dialog 组件 | `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\cli\tui\components\SessionsDialog.tsx` | 1-290 |
| CommandDialog 集成 | `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\cli\tui\components\CommandDialog.tsx` | 180-186 |
| CommandPalette 集成 | `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\cli\tui\components\CommandPalette.tsx` | 17, 129, 222-240 |
| 命令注册 | `D:\document\zhishitong_workspace\test_tong_work\agent-core\packages\core\src\server\index.ts` | 52 |

## 八、扩展指南

### 8.1 添加新的 action type

1. 在 `SessionsAction` 中添加新的 type（sessions.ts 行 15-19）
2. 在 switch case 中添加新的 handler（sessions.ts 行 54-65）
3. 更新 Dialog 组件支持新的交互

### 8.2 修改会话信息展示

1. 更新 `SessionListItem` 接口（sessions.ts 行 21-28）
2. 更新数据组装逻辑（handleListAction，行 85-91）
3. 更新 Dialog 渲染（SessionsDialog.tsx）

### 8.3 添加分页支持

当前一次性返回所有会话。如果会话数量很多（>100），建议：
1. 后端添加分页参数（limit/offset）
2. 前端实现虚拟滚动或分页加载

## 九、注意事项

1. **ref 获取输入值**: OpenTUI 的 input 组件需要使用 ref 获取值，onContentChange 事件对象是空的
2. **删除确认**: 删除操作需要二次确认（Y/N），避免误操作
3. **列表刷新**: 删除成功后需要重新执行 list action 刷新列表
4. **时间格式化**: 使用相对时间（如 "2h ago"）提升用户体验
5. **键盘事件**: handleListKeyDown 必须返回 boolean，告诉调用者是否已处理
6. **双处集成**: 必须在 CommandDialog.tsx 和 CommandPalette.tsx 中都添加集成

## 十、测试清单

- [ ] 启动 Server: `bun run start`
- [ ] 启动 TUI: `bun run attach http://localhost:3000`
- [ ] 输入 `/` 打开命令面板
- [ ] 选择 sessions 命令，确认 Dialog 弹出
- [ ] 测试搜索过滤功能
- [ ] 测试上下键导航
- [ ] 测试 Enter 选择会话
- [ ] 测试 D 键删除会话
- [ ] 测试 Y/N 确认/取消删除
- [ ] 测试 Esc 关闭 Dialog
