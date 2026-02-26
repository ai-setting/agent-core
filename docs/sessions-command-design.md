# Sessions Command 设计文档

## 1. 概述

### 1.1 命令用途
`sessions` command 用于列出和管理历史会话列表，允许用户：
- 查看所有历史会话（按更新时间倒序）
- 搜索过滤会话
- 选择并切换到特定会话
- 删除会话

### 1.2 设计原则
- 参考 OpenCode 的 `list session` 功能体验
- 支持分页或滚动加载（考虑会话数量可能很多）
- 显示关键信息：标题、更新时间、消息数量
- 键盘优先的交互设计

### 1.3 与现有命令的差异/关联
- 类似 `models` command 的列表选择模式
- 依赖 `Session` 和 `Storage` 模块获取会话数据
- 与 `OsEnv` 集成，支持切换会话

## 2. 总体架构

### 2.1 命令类型
- **后端命令**：获取会话列表、执行会话操作
- **前端 Dialog**：展示会话列表、支持搜索和选择
- **执行方式**：无参数触发 list action，打开 Dialog
- **返回值模式**：`mode: "dialog"`，返回会话列表数据

### 2.2 核心流程

```
用户输入 /sessions
    ↓
Command 执行 "list" action
    ↓
从 Storage 获取所有会话信息
    ↓
按更新时间倒序排序
    ↓
返回 session 列表数据
    ↓
打开 SessionsDialog
    ↓
用户搜索/浏览/选择
    ↓
执行 "select" 或 "delete" action
    ↓
切换会话或删除会话
    ↓
关闭 Dialog
```

## 3. Server 端实现设计

### 3.1 文件位置
- 命令实现：`packages/core/src/server/command/built-in/sessions.ts`
- 类型定义：复用 `packages/core/src/core/session/types.ts`

### 3.2 Command 定义

```typescript
interface SessionsAction {
  type: "list" | "select" | "delete";
  sessionId?: string;
}

interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  directory: string;
}

interface SessionsResponse {
  mode: "dialog";
  sessions: SessionListItem[];
}
```

### 3.3 Action 处理逻辑

**list action:**
- 从 `Storage.listSessions()` 获取所有会话
- 提取关键信息：id, title, createdAt, updatedAt, messageCount
- 按 `updatedAt` 倒序排序
- 返回列表数据

**select action:**
- 根据 sessionId 获取会话
- 通知 OsEnv 切换到该会话（通过 context.env）
- 返回切换结果

**delete action:**
- 根据 sessionId 删除会话
- 调用 `session.delete()`
- 返回删除结果

### 3.4 依赖服务
- `Storage`：获取会话列表和信息
- `Session`：获取消息数量、删除会话
- `ServerEnvironment`：切换当前会话

## 4. TUI 端实现设计

### 4.1 文件位置
- Dialog 组件：`packages/core/src/cli/tui/components/SessionsDialog.tsx`
- 集成点：`CommandDialog.tsx` 和 `CommandPalette.tsx`

### 4.2 组件设计

```typescript
interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  directory: string;
}

interface SessionsDialogData {
  sessions: SessionListItem[];
}

interface SessionsDialogProps {
  data: SessionsDialogData;
}
```

### 4.3 UI 布局

```
┌────────────────────────────────────────────┐
│ Sessions                              ESC │
├────────────────────────────────────────────┤
│ > [搜索框]                                  │
├────────────────────────────────────────────┤
│ Session Title 1                    5 msgs │
│ /path/to/project         2024-01-15 10:30 │
│                                            │
│ ▶ Session Title 2                  12 msgs│  ← 选中状态
│ /path/to/another         2024-01-14 15:20 │
│                                            │
│ Session Title 3                   128 msgs│
│ /path/to/third           2024-01-13 09:00 │
├────────────────────────────────────────────┤
│ ↑↓ navigate • Enter select • D delete • Esc│
└────────────────────────────────────────────┘
```

### 4.4 交互设计

**键盘操作：**
- `↑/↓`：上下导航
- `Enter`：选择会话并切换
- `D`：删除当前选中的会话（需确认）
- `Esc`：关闭 Dialog
- 输入文字：实时过滤会话标题

**删除确认：**
- 按 `D` 后弹出确认 Dialog
- 显示 "Delete session 'xxx'? (Y/N)"
- `Y` 确认删除，`N` 或 `Esc` 取消

## 5. 数据流与持久化

### 5.1 数据流向

```
TUI SessionsDialog
    ↓ GET /commands/sessions
Server sessions command
    ↓ Storage.listSessions()
SQLite/File Storage
    ↓ 返回 SessionInfo[]
Command 组装 SessionListItem[]
    ↓ JSON response
TUI 渲染列表
    ↓ 用户交互
Command 执行 select/delete
    ↓ Storage 操作
持久化存储
```

### 5.2 存储方案
- 复用现有的 `Storage` 模块
- 支持 SQLite 和 File 两种模式
- 无需额外的状态存储

## 6. API 设计

### 6.1 Request/Response 格式

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
  "message": "Session switched",
  "data": { "sessionId": "session-xxx" }
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

| 错误场景 | 错误码 | 错误消息 |
|---------|-------|---------|
| 会话不存在 | 404 | Session not found |
| 切换失败 | 500 | Failed to switch session |
| 删除失败 | 500 | Failed to delete session |

## 7. 实现步骤

### Phase 1: Server 端
1. [ ] 创建 `packages/core/src/server/command/built-in/sessions.ts`
2. [ ] 实现 list/select/delete action
3. [ ] 在 `packages/core/src/server/index.ts` 注册命令
4. [ ] 添加基础测试

### Phase 2: TUI 端
1. [ ] 创建 `packages/core/src/cli/tui/components/SessionsDialog.tsx`
2. [ ] 实现列表渲染、搜索过滤、键盘导航
3. [ ] 实现删除确认 Dialog
4. [ ] 在 `CommandDialog.tsx` 添加集成
5. [ ] 在 `CommandPalette.tsx` 添加集成（关键！）

### Phase 3: 集成测试
1. [ ] 启动 Server 和 TUI
2. [ ] 测试命令面板触发
3. [ ] 测试搜索过滤
4. [ ] 测试选择和切换
5. [ ] 测试删除功能

## 8. 参考文件

| 功能 | 路径 |
|------|------|
| Command Types | `packages/core/src/server/command/types.ts` |
| Models Command | `packages/core/src/server/command/built-in/models.ts` |
| ModelsDialog | `packages/core/src/cli/tui/components/ModelsDialog.tsx` |
| Session Storage | `packages/core/src/core/session/storage.ts` |
| Session | `packages/core/src/core/session/session.ts` |
| CommandDialog | `packages/core/src/cli/tui/components/CommandDialog.tsx` |
| CommandPalette | `packages/core/src/cli/tui/components/CommandPalette.tsx` |

## 9. 注意事项

1. **性能考虑**：如果会话数量很多（>100），考虑实现分页或虚拟滚动
2. **时间显示**：使用相对时间（如 "2 hours ago"）比绝对时间更友好
3. **空状态**：当没有会话时显示友好的提示信息
4. **删除确认**：删除操作需要二次确认，避免误操作
5. **当前会话**：在列表中高亮显示当前会话
