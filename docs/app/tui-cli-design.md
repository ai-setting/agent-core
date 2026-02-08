# TUI CLI 设计文档

## 1. 概述

本文档定义 agent-core CLI 的 TUI（Terminal User Interface）版本设计。基于 OpenCode TUI 架构进行简化，只保留核心功能：
- 流式展示后端返回
- 用户输入进行交互

**架构定位**: TUI CLI 是 Client 层的富界面客户端，通过 SSE 与 Server 通信。

## 2. 技术栈

### 2.1 核心依赖

| 库 | 用途 | 版本 |
|----|------|------|
| **@opentui/solid** | 终端 UI 渲染引擎 | 最新版 |
| **solid-js** | 响应式 UI 框架 | ^1.8.x |
| **eventsource** | SSE 客户端 | ^2.x |

### 2.2 技术选型说明

**为什么使用 OpenTUI？**
- 专为终端设计的渲染引擎
- 基于 SolidJS 的响应式框架
- 支持流式渲染和增量更新
- 良好的键盘交互支持

**简化原则**
- 不实现完整的消息列表管理
- 不实现侧边栏和复杂布局
- 不实现多会话切换
- 专注于单一会话的实时对话

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    TUI CLI Application                       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   TUI App (SolidJS)                    │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │  MessageBox  │  │  InputBox    │  │ StatusBar   │ │  │
│  │  │  (流式展示)   │  │  (用户输入)   │  │ (状态显示)   │ │  │
│  │  └──────────────┘  └──────────────┘  └─────────────┘ │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼────────────────────────────────┐  │
│  │                   EventManager                         │  │
│  │  • SSE 连接 (/events)                                   │  │
│  │  • 事件批处理                                           │  │
│  │  • 状态同步                                             │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│                          │ SSE (Server-Sent Events)          │
│                          ▼                                   │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
                          HTTP Server
```

### 3.2 核心组件

#### 3.2.1 TUI App 入口

**文件**: `packages/core/src/cli/tui/app.tsx`

```typescript
import { render } from "@opentui/solid"
import { App } from "./components/App"

export async function startTUI(options: TUIOptions) {
  const cleanup = render(() => (
    <App 
      serverUrl={options.url}
      sessionId={options.sessionID}
    />
  ), {
    targetFps: 30,
    exitOnCtrlC: true,
  })
  
  return cleanup
}
```

#### 3.2.2 App 组件

**文件**: `packages/core/src/cli/tui/components/App.tsx`

```typescript
import { createSignal, createEffect } from "solid-js"
import { MessageBox } from "./MessageBox"
import { InputBox } from "./InputBox"
import { StatusBar } from "./StatusBar"
import { useEventStream } from "../hooks/useEventStream"

export function App(props: { serverUrl: string; sessionId?: string }) {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [status, setStatus] = createSignal("就绪")
  
  const { sendMessage, events } = useEventStream({
    url: props.serverUrl,
    sessionId: props.sessionId,
  })
  
  // 处理流式事件
  createEffect(() => {
    const event = events()
    if (!event) return
    
    switch (event.type) {
      case "text":
        appendText(event.delta)
        break
      case "tool_call":
        addToolCall(event)
        break
      case "completed":
        setIsStreaming(false)
        setStatus("完成")
        break
      case "error":
        setIsStreaming(false)
        setStatus(`错误: ${event.error}`)
        break
    }
  })
  
  const handleSubmit = async (content: string) => {
    addUserMessage(content)
    setIsStreaming(true)
    setStatus("生成中...")
    await sendMessage(content)
  }
  
  return (
    <box flexDirection="column" height="100%">
      <MessageBox 
        messages={messages()} 
        isStreaming={isStreaming()}
      />
      <InputBox 
        onSubmit={handleSubmit}
        disabled={isStreaming()}
      />
      <StatusBar status={status()} />
    </box>
  )
}
```

#### 3.2.3 MessageBox 组件

**文件**: `packages/core/src/cli/tui/components/MessageBox.tsx`

消息展示区域，支持流式渲染：

```typescript
import { For } from "solid-js"

interface Message {
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
}

export function MessageBox(props: { 
  messages: Message[]
  isStreaming: boolean 
}) {
  return (
    <scrollbox 
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
    >
      <For each={props.messages}>
        {(message) => (
          <MessageItem message={message} />
        )}
      </For>
      
      {/* 流式指示器 */}
      <Show when={props.isStreaming}>
        <text color="gray">●</text>
      </Show>
    </scrollbox>
  )
}

function MessageItem(props: { message: Message }) {
  const isUser = () => props.message.role === "user"
  
  return (
    <box 
      flexDirection="column"
      padding={1}
      border={isUser() ? undefined : ["left"]}
      borderColor={isUser() ? undefined : "blue"}
    >
      <text bold color={isUser() ? "green" : "blue"}>
        {isUser() ? "用户" : "AI"}
      </text>
      
      <text>{props.message.content}</text>
      
      {/* 工具调用展示 */}
      <Show when={props.message.toolCalls?.length}>
        <For each={props.message.toolCalls}>
          {(tool) => <ToolCallItem tool={tool} />}
        </For>
      </Show>
    </box>
  )
}
```

#### 3.2.4 InputBox 组件

**文件**: `packages/core/src/cli/tui/components/InputBox.tsx`

用户输入区域：

```typescript
import { createSignal } from "solid-js"

export function InputBox(props: { 
  onSubmit: (content: string) => void
  disabled: boolean 
}) {
  const [input, setInput] = createSignal("")
  
  const handleSubmit = () => {
    const content = input().trim()
    if (!content || props.disabled) return
    
    props.onSubmit(content)
    setInput("")
  }
  
  return (
    <box 
      flexShrink={0}
      border={["top"]}
      padding={1}
    >
      <textarea
        value={input()}
        onChange={setInput}
        onSubmit={handleSubmit}
        placeholder={props.disabled ? "等待响应..." : "输入消息 (Enter 发送)"}
        disabled={props.disabled}
        maxHeight={3}
      />
    </box>
  )
}
```

#### 3.2.5 Event Hook

**文件**: `packages/core/src/cli/tui/hooks/useEventStream.ts`

SSE 事件流管理：

```typescript
import { createSignal, createEffect, onCleanup } from "solid-js"
import { EventSource } from "eventsource"

export function useEventStream(options: {
  url: string
  sessionId?: string
}) {
  const [events, setEvents] = createSignal<StreamEvent | null>(null)
  const [eventSource, setEventSource] = createSignal<EventSource | null>(null)
  
  // 批处理队列
  let queue: StreamEvent[] = []
  let timer: Timer | undefined
  let lastFlush = 0
  
  const flush = () => {
    if (queue.length === 0) return
    const batch = queue
    queue = []
    timer = undefined
    lastFlush = Date.now()
    
    // 处理批量事件
    for (const event of batch) {
      setEvents(event)
    }
  }
  
  const handleEvent = (event: StreamEvent) => {
    queue.push(event)
    const elapsed = Date.now() - lastFlush
    
    if (timer) return
    // 16ms 内批量处理 (约 60fps)
    if (elapsed < 16) {
      timer = setTimeout(flush, 16)
      return
    }
    flush()
  }
  
  createEffect(() => {
    const url = new URL("/events", options.url)
    if (options.sessionId) {
      url.searchParams.set("session", options.sessionId)
    }
    
    const es = new EventSource(url.toString())
    setEventSource(es)
    
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        handleEvent(data)
      } catch {}
    }
    
    es.onerror = () => {
      handleEvent({ type: "error", error: "连接中断" })
    }
    
    onCleanup(() => {
      es.close()
      if (timer) clearTimeout(timer)
    })
  })
  
  const sendMessage = async (content: string) => {
    const sessionId = options.sessionId || await createSession()
    
    await fetch(`${options.url}/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  }
  
  return { events, sendMessage }
}
```

## 4. 目录结构

```
packages/core/src/cli/
├── index.ts                    # CLI 入口
├── client.ts                   # HTTP 客户端（已存在）
├── commands/                   # 命令实现
│   ├── attach.ts              # attach 命令（需要修改）
│   └── ...
└── tui/                       # TUI 实现（新增）
    ├── index.ts               # TUI 入口
    ├── app.tsx                # 应用根组件
    ├── components/            # UI 组件
    │   ├── App.tsx           # 主应用组件
    │   ├── MessageBox.tsx    # 消息展示区
    │   ├── InputBox.tsx      # 输入框
    │   ├── StatusBar.tsx     # 状态栏
    │   └── ToolCallItem.tsx  # 工具调用展示
    ├── hooks/                # 自定义 Hooks
    │   └── useEventStream.ts # SSE 事件管理
    └── types.ts              # TUI 类型定义
```

## 5. 事件类型

### 5.1 支持的事件

| 事件类型 | 描述 | 字段 |
|---------|------|------|
| `start` | 开始生成 | - |
| `text` | 文本增量 | `delta: string` |
| `reasoning` | 推理过程 | `content: string` |
| `tool_call` | 工具调用 | `toolName`, `toolArgs` |
| `tool_result` | 工具结果 | `toolName`, `result` |
| `completed` | 完成 | - |
| `error` | 错误 | `error: string` |

### 5.2 事件处理流程

```
Server 发送事件
    ↓
EventSource 接收
    ↓
批处理 (16ms 窗口)
    ↓
SolidJS 状态更新
    ↓
OpenTUI 渲染
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
| `↑/↓` | 滚动消息历史 |

## 7. 实现阶段

### 阶段 1: 基础框架
- [ ] 安装 @opentui/solid 依赖
- [ ] 创建 TUI 目录结构
- [ ] 实现基础 App 组件

### 阶段 2: 核心功能
- [ ] 实现 MessageBox 组件
- [ ] 实现 InputBox 组件
- [ ] 集成 SSE 事件流

### 阶段 3: 完善体验
- [ ] 添加状态栏
- [ ] 优化滚动体验
- [ ] 错误处理和重连

### 阶段 4: 测试验证
- [ ] 集成测试
- [ ] 性能测试
- [ ] 边界情况处理

## 8. 依赖变更

### package.json 修改

```json
{
  "dependencies": {
    "@opentui/solid": "^0.x",
    "solid-js": "^1.8.x",
    "eventsource": "^2.x"
  }
}
```

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
