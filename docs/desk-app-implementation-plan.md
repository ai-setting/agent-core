# Desk App 实现方案文档

> 基于 desk-demo 参考实现 + agent-core 现有架构

---

## 1. 项目概述

### 1.1 目标

基于 agent-core 框架，开发面向图形化操作用户的 **Desktop App**，提供比 TUI 更丰富的交互体验。

### 1.2 技术栈选择

| 层级 | 技术选型 | 理由 |
|------|----------|------|
| **桌面框架** | Tauri 2.x | 轻量、高性能、与现有技术栈（Bun/TypeScript）匹配 |
| **前端框架** | Next.js 16 + React 19 | desk-demo 已验证，生态成熟 |
| **UI 组件库** | shadcn/ui + Radix UI | desk-demo 已采用，组件丰富、样式美观 |
| **样式** | Tailwind CSS 4 | desk-demo 已采用，与 shadcn/ui 完美配合 |
| **状态管理** | React Context + useReducer | 继承 desk-demo 模式，简单够用 |
| **主题** | next-themes | 支持深色/浅色主题切换 |

### 1.3 与 agent-core 的关系

```
┌─────────────────────────────────────────────────────────────┐
│                     Desk App (Tauri + Next.js)             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    Next.js 前端                       │  │
│  │  - UI 组件（复用的 desk-demo 组件）                  │  │
│  │  - 状态管理（React Context）                          │  │
│  │  - SSE 事件流处理                                     │  │
│  └─────────────────────┬───────────────────────────────┘  │
│                        │ WebSocket / HTTP                   │
│  ┌─────────────────────┴───────────────────────────────┐  │
│  │              Tauri 主进程（Rust）                     │  │
│  │  - 窗口管理                                           │  │
│  │  - 系统托盘                                           │  │
│  │  - 原生通知                                           │  │
│  │  - IPC 通信                                           │  │
│  └─────────────────────┬───────────────────────────────┘  │
│                        │ HTTP / WebSocket                   │
│  ┌─────────────────────┴───────────────────────────────┐  │
│  │              agent-core Server                        │  │
│  │  (直接复用，无需修改)                                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构设计

```
packages/app/desktop/                      # Desk App 主目录
├── src/                                   # 前端源码（Next.js）
│   ├── app/                               # Next.js App Router
│   │   ├── layout.tsx                     # 根布局
│   │   ├── page.tsx                      # 主页面
│   │   └── globals.css                   # 全局样式
│   ├── components/                       # UI 组件
│   │   ├── ui/                           # shadcn/ui 组件
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── ...（其他 shadcn/ui 组件）
│   │   ├── session-sidebar.tsx            # 会话侧边栏
│   │   ├── chat-area.tsx                 # 聊天区域
│   │   ├── top-toolbar.tsx               # 顶部工具栏
│   │   ├── command-palette.tsx           # 命令面板
│   │   ├── model-selector.tsx             # 模型选择器
│   │   ├── event-panel.tsx               # 事件面板
│   │   └── settings-panel.tsx             # 设置面板
│   ├── lib/                              # 工具库
│   │   ├── store.tsx                     # 状态管理（核心）
│   │   ├── types.ts                      # 类型定义
│   │   ├── utils.ts                      # 工具函数
│   │   └── api-client.ts                 # API 客户端
│   ├── hooks/                            # 自定义 Hooks
│   │   ├── use-sse.ts                    # SSE 事件流 Hook
│   │   └── use-agent.ts                  # Agent 交互 Hook
│   └── styles/                           # 样式文件
│       └── globals.css
├── src-tauri/                            # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs                       # 入口
│   │   ├── lib.rs                        # 库
│   │   └── commands.rs                   # Tauri 命令
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── public/                               # 静态资源
│   ├── icon.svg
│   └── ...
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
└── SPEC.md                               # 功能规范
```

---

## 3. 核心模块设计

### 3.1 状态管理（Store）

继承 desk-demo 的设计，使用 React Context + useReducer。

```typescript
// packages/app/desktop/src/lib/types.ts

// Session
export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId: string
  messageCount: number
}

// Message
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  thinking?: string
  toolCalls?: ToolCall[]
  isStreaming?: boolean
}

// Tool Call
export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

// Provider & Model
export interface Provider {
  id: string
  name: string
  models: Model[]
}

export interface Model {
  id: string
  name: string
  providerId: string
  providerName: string
  isFavorite?: boolean
  lastUsed?: string
}

// Agent Event
export type AgentEventType =
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'command_exec'
  | 'tool_start'
  | 'tool_end'
  | 'error'
  | 'info'

export interface AgentEvent {
  id: string
  type: AgentEventType
  title: string
  description: string
  timestamp: string
  read: boolean
  filePath?: string
  diff?: FileDiffHunk[]
  fileContent?: string
  language?: string
  command?: string
  output?: string
  exitCode?: number
  errorMessage?: string
  errorStack?: string
}

// App Settings
export interface AppSettings {
  theme: 'dark' | 'light'
  fontSize: number
  apiKeys: Record<string, string>
  providers: Provider[]
  defaultModel: string
}
```

### 3.2 状态管理（Reducer）

```typescript
// packages/app/desktop/src/lib/store.tsx

interface AppState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  providers: Provider[]
  selectedModelId: string
  sidebarOpen: boolean
  settingsOpen: boolean
  commandPaletteOpen: boolean
  modelSelectorOpen: boolean
  isStreaming: boolean
  events: AgentEvent[]
  eventPanelOpen: boolean
  selectedEventId: string | null
  // 连接状态
  serverConnected: boolean
  serverUrl: string
}

type AppAction =
  | { type: 'SET_ACTIVE_SESSION'; payload: string }
  | { type: 'CREATE_SESSION' }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'ADD_MESSAGE'; payload: { sessionId: string; message: Message } }
  | { type: 'UPDATE_MESSAGE'; payload: { sessionId: string; messageId: string; content: string } }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SETTINGS_OPEN'; payload: boolean }
  | { type: 'SET_COMMAND_PALETTE_OPEN'; payload: boolean }
  | { type: 'SET_MODEL_SELECTOR_OPEN'; payload: boolean }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'FINISH_STREAM'; payload: { sessionId: string; messageId: string } }
  | { type: 'TOGGLE_FAVORITE'; payload: string }
  | { type: 'TOGGLE_EVENT_PANEL' }
  | { type: 'SELECT_EVENT'; payload: string | null }
  | { type: 'MARK_EVENT_READ'; payload: string }
  | { type: 'ADD_EVENT'; payload: AgentEvent }
  | { type: 'SET_SERVER_CONNECTED'; payload: boolean }
  | { type: 'SET_SERVER_URL'; payload: string }
  // 异步操作
  | { type: 'LOAD_SESSIONS' }
  | { type: 'LOAD_SESSIONS_SUCCESS'; payload: Session[] }
  | { type: 'LOAD_MESSAGES'; payload: string }
  | { type: 'LOAD_MESSAGES_SUCCESS'; payload: { sessionId: string; messages: Message[] } }
```

### 3.3 API 客户端

需要实现与 agent-core Server 的通信：

```typescript
// packages/app/desktop/src/lib/api-client.ts

interface ApiClient {
  baseUrl: string
  // Session
  createSession(): Promise<{ id: string; title?: string }>
  listSessions(): Promise<Session[]>
  getSession(id: string): Promise<Session>
  deleteSession(id: string): Promise<void>
  
  // Messages
  getMessages(sessionId: string): Promise<Message[]>
  sendPrompt(sessionId: string, content: string): Promise<void>
  
  // Commands
  executeCommand(name: string, args?: string): Promise<CommandResult>
  
  // Models
  listModels(): Promise<Provider[]>
  
  // Events (SSE)
  connectEventStream(sessionId: string): EventSource
  
  // Settings
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<void>
}

function createApiClient(baseUrl: string): ApiClient {
  // 实现...
}
```

### 3.4 SSE 事件流 Hook

```typescript
// packages/app/desktop/src/hooks/use-sse.ts

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Message, AgentEvent } from '@/lib/types'

interface UseSSEOptions {
  url: string
  sessionId: string
  onMessage?: (message: Message) => void
  onEvent?: (event: AgentEvent) => void
  onStreamStart?: (data: { model?: string }) => void
  onStreamText?: (data: { delta: string }) => void
  onStreamReasoning?: (data: { content: string }) => void
  onStreamToolCall?: (data: { toolName: string; toolArgs: Record<string, unknown> }) => void
  onStreamToolResult?: (data: { toolName: string; result: unknown; success: boolean }) => void
  onStreamComplete?: () => void
  onStreamError?: (error: string) => void
  onConnected?: () => void
  onDisconnected?: () => void
}

export function useSSE(options: UseSSEOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  
  const connect = useCallback(() => {
    // 创建 EventSource，连接 /events?session={sessionId}
    // 处理各种事件类型
  }, [options])
  
  const disconnect = useCallback(() => {
    // 关闭 EventSource
  }, [])
  
  return {
    isConnected,
    connect,
    disconnect,
  }
}
```

---

## 4. 组件设计

### 4.1 页面布局

```typescript
// packages/app/desktop/src/app/page.tsx

export default function DeskAppPage() {
  return (
    <AppProvider>
      <TooltipProvider delayDuration={200}>
        <div className="flex h-screen w-screen overflow-hidden bg-background">
          {/* Sidebar - 会话列表 */}
          <SessionSidebar />
          
          {/* Main Area */}
          <div className="flex-1 flex flex-col min-w-0">
            <TopToolbar />
            <ChatArea />
          </div>
          
          {/* Event Panel - 右侧事件面板 */}
          <EventPanel />
          
          {/* Overlays */}
          <CommandPalette />
          <ModelSelector />
          <SettingsPanel />
        </div>
      </TooltipProvider>
    </AppProvider>
  )
}
```

### 4.2 核心组件说明

| 组件 | 文件 | 功能 |
|------|------|------|
| **SessionSidebar** | session-sidebar.tsx | 会话列表、新建会话、搜索、删除、按时间分组 |
| **ChatArea** | chat-area.tsx | 消息列表、输入框、流式响应、Markdown 渲染 |
| **TopToolbar** | top-toolbar.tsx | 侧边栏开关、会话标题、模型选择、连接状态、设置 |
| **CommandPalette** | command-palette.tsx | Ctrl+P 触发、命令搜索、执行命令 |
| **ModelSelector** | model-selector.tsx | 模型列表、搜索、收藏、最近使用、按 Provider 分组 |
| **EventPanel** | event-panel.tsx | 事件列表、事件详情、Diff 展示、文件内容展示 |
| **SettingsPanel** | settings-panel.tsx | Provider 配置、API Key、外观主题、字体大小 |

### 4.3 Markdown 渲染

继承 desk-demo 的实现，支持：
- 标题（h1-h3）
- 代码块（带语法高亮占位、复制按钮）
- 表格
- 列表（有序/无序）
- 引用
- 粗体/斜体/行内代码

### 4.4 Thinking/Reasoning 展示

```typescript
// 可折叠的思考过程展示
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="rounded-lg border border-border/50 bg-secondary/20">
      <div 
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Brain className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-primary">思考过程</span>
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </div>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-muted-foreground border-t border-border/30">
          {content}
        </div>
      )}
    </div>
  )
}
```

### 4.5 工具调用展示

```typescript
// 可展开的工具调用详情
function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="rounded-lg border border-border/50">
      <div 
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 状态图标 */}
        {toolCall.status === 'running' && <Loader2 className="animate-spin" />}
        {toolCall.status === 'completed' && <CheckCircle2 className="text-success" />}
        {toolCall.status === 'error' && <AlertCircle className="text-destructive" />}
        
        <span className="text-xs font-mono">{toolCall.name}</span>
      </div>
      
      {expanded && (
        <div className="px-3 pb-2 border-t border-border/30">
          <div>
            <span className="text-[10px] uppercase">参数</span>
            <pre className="text-xs font-mono">{toolCall.arguments}</pre>
          </div>
          {toolCall.result && (
            <div>
              <span className="text-[10px] uppercase">结果</span>
              <pre className="text-xs font-mono">{toolCall.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

---

## 5. Tauri 集成

### 5.1 Tauri 配置

```json
// packages/app/desktop/src-tauri/tauri.conf.json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Agent Core",
  "version": "1.0.0",
  "identifier": "com.agentcore.desktop",
  "build": {
    "devUrl": "http://localhost:3000",
    "frontendDist": "../src/out"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "Agent Core",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false,
        "center": true
      }
    ],
    "security": {
      "csp": null
    },
    "trayIcon": {
      "iconPath": "icons/icon.png",
      "iconAsTemplate": true
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 5.2 Tauri 命令

```rust
// packages/app/desktop/src-tauri/src/commands.rs

use tauri::command;

#[command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[command]
pub fn show_notification(title: String, body: String) -> Result<(), String> {
    // 使用 tauri-plugin-notification
    Ok(())
}

#[command]
pub fn get_log_path() -> String {
    // 返回日志目录
    dirs::data_local_dir()
        .unwrap_or_default()
        .join("tong_work")
        .join("logs")
        .to_string_lossy()
        .to_string()
}
```

### 5.3 系统托盘

```rust
// packages/app/desktop/src-tauri/src/lib.rs

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 创建系统托盘
            let tray = tauri::tray::TrayIconBuilder::new()
                .tooltip("Agent Core")
                .on_tray_icon_event(|tray, event| {
                    match event {
                        tauri::tray::TrayIconEvent::Click { .. } => {
                            // 显示窗口
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 6. 与 agent-core Server 的集成

### 6.1 Server 启动方式

Desk App 不需要单独启动 Server，而是通过 Tauri IPC 调用启动：

```typescript
// packages/app/desktop/src/lib/store.tsx

// 初始化时启动 Server
async function initializeApp() {
  // 1. 检查 Server 是否已运行
  // 2. 如果未运行，启动 Server（通过 Tauri 命令）
  // 3. 等待 Server 就绪
  // 4. 连接 SSE 事件流
}
```

或者采用更简单的方案：**Desk App 启动时假设 Server 已在运行**（用户通过命令行启动 Server，然后 Desk App 连接）。

### 6.2 API 映射

| Desk App | agent-core Server API |
|----------|----------------------|
| 创建会话 | POST /sessions |
| 列出会话 | GET /sessions |
| 获取会话 | GET /sessions/:id |
| 删除会话 | DELETE /sessions/:id |
| 发送消息 | POST /sessions/:id/prompt |
| 获取消息 | GET /sessions/:id/messages |
| SSE 事件流 | GET /events?session=:id |
| 执行命令 | POST /commands/:name |
| 模型列表 | GET /models |
| 中断会话 | POST /sessions/:id/interrupt |

---

## 7. 实现路径

### Phase 1: 基础框架搭建

1. 初始化 Tauri + Next.js 项目
2. 配置 Tailwind CSS + shadcn/ui
3. 实现基础布局（Sidebar + Main + Header）
4. 配置 Tauri 窗口和系统托盘

### Phase 2: 核心功能实现

1. 状态管理系统（Reducer + Context）
2. API 客户端封装
3. SSE 事件流 Hook
4. 会话管理（列表、创建、删除、切换）
5. 消息发送和展示
6. Markdown 渲染

### Phase 3: 增强功能

1. 模型选择器
2. 命令面板
3. 事件面板
4. 设置面板
5. Thinking/Reasoning 展示
6. 工具调用展示

### Phase 4: 桌面集成

1. 系统托盘
2. 系统通知
3. 窗口管理（最小化、最大化）
4. 快捷键支持
5. 主题切换

---

## 8. 复用策略

### 8.1 直接复用 desk-demo

以下文件可**直接复制使用**（或轻微修改）：

- `components/ui/*` - 所有 shadcn/ui 组件
- `components/session-sidebar.tsx` - 会话侧边栏
- `components/chat-area.tsx` - 聊天区域（需适配 API）
- `components/top-toolbar.tsx` - 顶部工具栏
- `components/command-palette.tsx` - 命令面板
- `components/model-selector.tsx` - 模型选择器
- `components/event-panel.tsx` - 事件面板
- `components/settings-panel.tsx` - 设置面板
- `lib/types.ts` - 类型定义（需扩展）
- `lib/utils.ts` - 工具函数
- `lib/store.tsx` - 状态管理（需适配 agent-core API）

### 8.2 需要修改的部分

| 文件 | 修改内容 |
|------|----------|
| `lib/store.tsx` | 替换 Mock 数据为真实 API 调用 |
| `lib/api-client.ts` | 新建，实现与 agent-core Server 的通信 |
| `hooks/use-sse.ts` | 新建，实现 SSE 事件流处理 |
| `app/page.tsx` | 适配 Tauri 环境（可能需要包装） |

### 8.3 新增文件

| 文件 | 说明 |
|------|------|
| `lib/api-client.ts` | API 客户端 |
| `hooks/use-sse.ts` | SSE Hook |
| `hooks/use-agent.ts` | Agent 交互 Hook |

---

## 9. 样式主题

### 9.1 颜色变量

继承 agent-core 的设计，使用深色主题为主：

```css
/* globals.css */
:root {
  --background: oklch(0.145 0.015 285);
  --foreground: oklch(0.92 0.004 285);
  --card: oklch(0.18 0.013 285);
  --card-foreground: oklch(0.92 0.004 285);
  --popover: oklch(0.18 0.013 285);
  --popover-foreground: oklch(0.92 0.004 285);
  --primary: oklch(0.92 0.004 285);
  --primary-foreground: oklch(0.2 0.002 285);
  --secondary: oklch(0.22 0.018 285);
  --secondary-foreground: oklch(0.92 0.004 285);
  --muted: oklch(0.22 0.018 285);
  --muted-foreground: oklch(0.6 0.004 285);
  --accent: oklch(0.22 0.018 285);
  --accent-foreground: oklch(0.92 0.004 285);
  --destructive: oklch(0.65 0.15 25);
  --destructive-foreground: oklch(0.92 0.004 285);
  --border: oklch(0.3 0.015 285);
  --input: oklch(0.3 0.015 285);
  --ring: oklch(0.92 0.004 285);
  --radius: 0.625rem;
}
```

---

## 10. 验收标准

### 功能验收

- [ ] 可以创建、切换、删除会话
- [ ] 可以发送消息并接收流式响应
- [ ] Markdown 正确渲染（代码块、表格、列表等）
- [ ] Thinking/Reasoning 正确展示
- [ ] 工具调用过程可查看
- [ ] 模型选择器可用
- [ ] 命令面板可用
- [ ] 事件面板可用（文件编辑、命令执行等）
- [ ] 设置面板可用（主题切换）

### 桌面特性验收

- [ ] 窗口可调整大小、最小化
- [ ] 系统托盘可用
- [ ] 深色/浅色主题切换

### 性能验收

- [ ] 页面加载时间 < 2s
- [ ] SSE 事件延迟 < 100ms
- [ ] UI 交互响应 < 50ms

