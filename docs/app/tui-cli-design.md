# TUI CLI 设计文档

## 1. 概述

本文档定义 agent-core CLI 的 TUI（Terminal User Interface）实现。采用自定义响应式 Store + ANSI 终端渲染方案，不依赖 OpenTUI/SolidJS 等外部 UI 框架，保持轻量和可控。

核心功能：
- SSE 事件流接收与批处理
- 自定义 ReactiveStore 驱动的响应式渲染
- ANSI 全屏终端 UI（消息展示 + 输入框 + 状态栏）
- 支持 text / reasoning / tool_call / tool_result 多种 Part 类型

**架构定位**: TUI CLI 是 Client 层的富界面客户端，通过 SSE 与 Server 通信。

## 2. 技术栈

### 2.1 核心依赖

| 库 | 用途 | 版本 |
|----|------|------|
| **eventsource** | SSE 客户端 | ^2.x |
| **readline** | 终端输入处理 | Node.js 内置 |

### 2.2 技术选型说明

**为什么不使用 OpenTUI/SolidJS？**
- 减少外部依赖，降低构建复杂度
- 自定义 ReactiveStore 足以满足当前需求
- ANSI 直接渲染更轻量，启动更快
- 完全可控的渲染逻辑，便于调试

**设计原则**
- 不实现完整的消息列表管理
- 不实现侧边栏和复杂布局
- 不实现多会话切换
- 专注于单一会话的实时对话

## 3. 架构设计

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                     TUI CLI Application                       │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    TUIApp (协调层)                       │  │
│  │  • 事件分发与状态管理                                     │  │
│  │  • 消息/Part 生命周期管理                                 │  │
│  └──────┬──────────────────┬──────────────────┬───────────┘  │
│         │                  │                  │               │
│  ┌──────▼──────┐  ┌───────▼────────┐  ┌─────▼───────────┐  │
│  │ TUIRenderer │  │ ReactiveStore  │  │ EventStream     │  │
│  │ (ANSI 渲染)  │  │ (响应式状态)    │  │ Manager         │  │
│  │ • Header    │  │ • messages[]   │  │ • SSE 连接       │  │
│  │ • Messages  │  │ • parts{}      │  │ • 事件批处理     │  │
│  │ • Input     │  │ • isStreaming   │  │ • 自动重连       │  │
│  │ • StatusBar │  │ • sessionId    │  │ • HTTP API      │  │
│  └─────────────┘  └────────────────┘  └────────┬────────┘  │
│                                                 │            │
│                                    SSE (Server-Sent Events)  │
│                                                 ▼            │
└──────────────────────────────────────────────────────────────┘
                                │
                                ▼
                          HTTP Server
```

### 3.2 核心组件

#### 3.2.1 TUI 入口

**文件**: `packages/core/src/cli/tui/index.ts`

```typescript
import { createTUIApp } from "./components/App.js";
import type { TUIOptions } from "./types.js";

export { createTUIApp } from "./components/App.js";
export type { TUIOptions } from "./types.js";
export { store, storeActions, createEffect } from "./store.js";

/**
 * 启动 TUI（兼容旧 API）
 */
export async function startTUI(options: TUIOptions): Promise<() => void> {
  const app = createTUIApp(options);
  await app.start();
  return () => app.stop();
}
```

#### 3.2.2 TUIApp 协调层

**文件**: `packages/core/src/cli/tui/components/App.ts`

TUIApp 是核心协调类，负责连接 EventStreamManager、ReactiveStore 和 TUIRenderer：

```typescript
export class TUIApp {
  private renderer: TUIRenderer;
  private eventManager: EventStreamManager;
  private options: TUIOptions;
  private currentMessageId?: string;

  constructor(options: TUIOptions) {
    this.renderer = createRenderer();
    this.eventManager = new EventStreamManager({
      url: options.url,
      sessionId: options.sessionID,
      password: options.password,
      onEvent: (event) => this.handleEvent(event),
      onError: (error) => this.handleError(error),
      onConnect: () => this.handleConnect(),
      onDisconnect: () => this.handleDisconnect(),
    });
    this.renderer.setOnSubmit((text) => this.handleUserInput(text));
  }

  async start(): Promise<void> { /* 初始化连接、挂载渲染器 */ }
  stop(): void { /* 断开连接、清理渲染器 */ }
}
```

**事件处理流程**：

```typescript
private handleEvent(event: TUIStreamEvent): void {
  switch (event.type) {
    case "stream.start":
      storeActions.setStreaming(true);
      this.startAssistantMessage();
      break;
    case "stream.text":
    case "stream.reasoning":
      this.updateTextPart(event.type, event.content || event.delta);
      break;
    case "stream.tool.call":
      this.addToolCall(event);
      break;
    case "stream.tool.result":
      this.addToolResult(event);
      break;
    case "stream.completed":
      storeActions.setStreaming(false);
      break;
    case "stream.error":
      storeActions.setStreaming(false);
      this.addSystemMessage(`错误: ${event.error}`);
      break;
  }
}
```

#### 3.2.3 TUIRenderer（ANSI 终端渲染器）

**文件**: `packages/core/src/cli/tui/solid-renderer.ts`

负责全屏 ANSI 渲染，订阅 ReactiveStore 变化自动重绘：

```typescript
export class TUIRenderer {
  private rl: readline.Interface;
  private inputBuffer = "";
  private onSubmit?: (text: string) => void;
  private isMounted = false;

  mount() {
    this.isMounted = true;
    // 订阅 store 变化，自动触发渲染
    createEffect(() => {
      const _messages = store.messages;
      const _parts = store.parts;
      const _streaming = store.isStreaming;
      this.render();
    });
  }

  private render() {
    // 全屏重绘：Header + Messages + Input + StatusBar
    let output = "";
    output += this.buildHeader();
    for (const message of store.messages) {
      output += this.buildMessage(message, store.parts[message.id] || []);
    }
    output += this.buildInput();
    stdout.write(ANSI.CLEAR);
    stdout.write(output);
  }
}
```

**渲染布局**：
- **Header**: 带边框的标题栏，显示 Session ID
- **Messages**: 按角色区分样式（user=绿色边栏, assistant=Part渲染, system=灰色圆点）
- **Part 渲染**: reasoning=灰色斜体, text=普通文本, tool_call=黄色闪电, tool_result=绿色/红色勾叉
- **Input**: 底部输入框，支持退格和回车提交
- **StatusBar**: 底部状态提示 + 流式生成指示器

#### 3.2.4 ReactiveStore（响应式状态管理）

**文件**: `packages/core/src/cli/tui/store.ts`

自定义轻量级响应式 Store，提供类 SolidJS 的 `createEffect` API：

```typescript
interface SessionStore {
  messages: any[];
  parts: Record<string, any[]>;  // messageId -> MessagePart[]
  sessionId?: string;
  isStreaming: boolean;
  status: string;
}

class ReactiveStore {
  private listeners: Set<Listener> = new Set();
  private batching = false;

  subscribe(listener: Listener): () => void { /* ... */ }
  batch(fn: () => void) { /* 批量更新，只触发一次通知 */ }
  trigger() { /* 手动触发所有 listener */ }
}
```

**Store Actions**：

```typescript
export const storeActions = {
  addMessage(message)    // 添加消息并初始化 parts
  updatePart(messageId, part)  // 更新或新增 Part
  setSessionId(sessionId)
  setStreaming(isStreaming)
  setStatus(status)
  reset()                // 重置所有状态
}
```

#### 3.2.5 EventStreamManager（SSE 事件流管理）

**文件**: `packages/core/src/cli/tui/hooks/useEventStream.ts`

基于类的 SSE 事件流管理器，支持批处理和自动重连：

```typescript
export class EventStreamManager {
  private eventSource: EventSource | null = null;
  private eventQueue: TUIStreamEvent[] = [];
  private flushTimer: Timer | null = null;

  constructor(options: EventStreamOptions) { /* ... */ }

  connect(): void      // 连接 SSE，支持 token 认证
  disconnect(): void   // 断开连接，清理资源
  async sendMessage(content: string, sessionId?: string): Promise<void>
  async createSession(title?: string): Promise<string>
}
```

**关键特性**：
- **事件批处理**: 16ms 窗口内合并事件（约 60fps），减少渲染次数
- **事件归一化**: 将服务器原始事件 `TUIStreamEventRaw`（嵌套 properties）转换为扁平化 `TUIStreamEvent`
- **自动重连**: 连接断开后 3 秒自动重连
- **认证支持**: 通过 URL 参数传递 token（EventSource 不支持自定义 headers）

## 4. 目录结构

```
packages/core/src/cli/tui/
├── index.ts                    # TUI 入口，导出 startTUI / createTUIApp
├── types.ts                    # 类型定义（TUIStreamEvent, Message, MessagePart 等）
├── store.ts                    # ReactiveStore 响应式状态管理
├── solid-renderer.ts           # TUIRenderer ANSI 终端渲染器
├── components/
│   └── App.ts                 # TUIApp 协调层（事件分发、消息管理）
└── hooks/
    └── useEventStream.ts      # EventStreamManager SSE 事件流管理
```

## 5. 事件类型

### 5.1 原始事件格式（服务器端）

服务器发送嵌套格式的 `TUIStreamEventRaw`：

```typescript
interface TUIStreamEventRaw {
  type: string;
  properties: {
    sessionId?: string;
    messageId?: string;
    content?: string;
    delta?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    result?: unknown;
    success?: boolean;
    error?: string;
  };
  timestamp?: number;
}
```

### 5.2 客户端扁平化事件

通过 `normalizeEvent()` 转换为扁平化的 `TUIStreamEvent`：

| 事件类型 | 描述 | 关键字段 |
|---------|------|---------|
| `stream.start` | 开始生成 | - |
| `stream.text` | 文本内容 | `content`, `delta` |
| `stream.reasoning` | 推理过程 | `content`, `delta` |
| `stream.tool.call` | 工具调用 | `toolName`, `toolArgs` |
| `stream.tool.result` | 工具结果 | `toolName`, `result`, `success` |
| `stream.completed` | 完成 | - |
| `stream.error` | 错误 | `error` |
| `server.connected` | 连接成功 | - |
| `server.heartbeat` | 心跳（忽略） | - |

### 5.3 事件处理流程

```
Server 发送 TUIStreamEventRaw
    ↓
EventSource 接收 + JSON.parse
    ↓
normalizeEvent() 扁平化
    ↓
事件批处理队列 (16ms 窗口)
    ↓
TUIApp.handleEvent() 分发
    ↓
storeActions 更新 ReactiveStore
    ↓
TUIRenderer 自动重绘
```

## 6. 使用方式

### 6.1 启动 TUI

```bash
# 连接到本地服务器
tong_work attach

# 连接到指定服务器
tong_work attach --server http://localhost:3001

# 指定会话
tong_work attach --session abc123
```

### 6.2 交互操作

| 快捷键 | 功能 |
|--------|------|
| `Enter` | 发送消息 |
| `Ctrl+C` | 退出程序 |
| `Ctrl+L` | 刷新屏幕 |
| `Backspace` | 删除输入字符 |

## 7. 已完成的实现

- [x] 自定义 ReactiveStore 响应式状态管理
- [x] ANSI 全屏终端渲染器（TUIRenderer）
- [x] SSE 事件流管理（EventStreamManager）+ 批处理 + 自动重连
- [x] TUIApp 协调层（事件分发、消息/Part 生命周期）
- [x] 多种 Part 类型渲染（text / reasoning / tool_call / tool_result）
- [x] 事件归一化（TUIStreamEventRaw → TUIStreamEvent）
- [x] 键盘输入处理（raw mode）
- [x] 认证支持（password / token）

## 8. 依赖变更

### package.json 修改

```json
{
  "dependencies": {
    "eventsource": "^2.x"
  }
}
```

> 注：不再依赖 `@opentui/solid` 和 `solid-js`，使用自定义 ReactiveStore + ANSI 渲染替代。

## 9. 参考文档

- [OpenCode TUI 深度解析](../../opencode-tui-deep-dive.md)
- [CLI 设计文档](./cli-design.md)
- [SSE 设计文档](../architecture/sse-design.md)
- [@opentui/solid 文档](https://github.com/opentui/solid)

## 10. 注意事项

1. **性能**: 使用事件批处理减少重渲染次数
2. **内存**: 限制消息历史数量，避免内存泄漏
3. **错误**: 实现连接断开的自动重连
4. **兼容**: 确保在各种终端环境下正常工作

---

**当前状态**: 设计阶段
**下一步**: 实现基础框架和核心组件
