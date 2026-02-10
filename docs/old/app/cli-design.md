# CLI 应用设计文档

## 1. 概述

CLI (Command Line Interface) 是基于 agent-core 框架构建的命令行客户端应用。通过 SSE 连接到 Server，实现实时流式对话。

**架构定位**: CLI 是 Client 层的一部分，通过 SSE 与 Server 通信。

**实现范围 (MVP)**:
- ✅ 基础交互式对话（一问一答）
- ✅ SSE 连接 Server
- ✅ 流式输出显示
- ❌ 子命令系统 (run/session/config 等)
- ❌ TUI 富界面
- ❌ 文件引用 (@filename)
- ❌ Shell 命令执行 (!command)

## 2. 技术栈

### 2.1 核心依赖

| 库 | 用途 | 版本 |
|----|------|------|
| **Bun** | 运行时/构建 | 最新版 |
| **eventsource** | SSE 客户端 | ^2.x |
| **chalk** | 终端颜色 | ^5.x |

### 2.2 技术选型说明

**为什么使用 Bun？**
- 原生 TypeScript 支持
- 更快的启动速度
- 内置测试运行器
- 现代化的包管理

**实现模式**
- **MVP 模式**: 简单的交互式问答（类似 readline）
- **未来扩展**: 子命令系统、TUI 富界面

## 3. 架构设计

### 3.1 整体架构 (MVP)

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Application (MVP)                │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   CLI Engine                           │  │
│  │  • 交互式输入循环                                       │  │
│  │  • 流式输出渲染                                         │  │
│  └───────────────────────┬────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼────────────────────────────────┐  │
│  │                   AgentClient                          │  │
│  │  • SSE 连接 (/events)                                   │  │
│  │  • 事件订阅 (text, completed, error)                    │  │
│  │  • HTTP API (sessions, prompt)                          │  │
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

#### 3.2.1 CLI Engine (MVP)

简单的交互式对话引擎：

```typescript
// src/cli-engine.ts
export class CLIEngine {
  private client: AgentClient
  private sessionId: string
  private isStreaming: boolean = false

  constructor(options: { serverUrl: string; sessionId?: string }) {
    this.client = new AgentClient({ baseUrl: options.serverUrl })
    this.sessionId = options.sessionId || this.generateSessionId()
    this.setupEventHandlers()
  }

  async run(): Promise<void> {
    console.log(chalk.cyan("🤖 Agent CLI"))
    console.log(chalk.gray(`Server: ${this.client.baseUrl}`))
    console.log(chalk.gray("输入 'exit' 或 'quit' 退出\n"))

    // Connect to SSE
    this.client.connect(this.sessionId)

    // Interactive loop
    while (true) {
      const input = await this.prompt("💬 ")
      
      if (!input.trim()) continue
      if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
        console.log(chalk.cyan("\n👋 再见!"))
        break
      }

      await this.sendQuery(input)
    }

    this.client.disconnect()
  }

  private async sendQuery(content: string): Promise<void> {
    this.isStreaming = true
    
    // Send to server
    await this.client.sendPrompt(this.sessionId, content)
    
    // Wait for stream to complete
    while (this.isStreaming) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    console.log() // New line after response
  }
}
```

#### 3.2.2 AgentClient (MVP)

```typescript
// src/client.ts
import { EventSource } from "eventsource"

export class AgentClient {
  baseUrl: string
  private eventSource: EventSource | null = null
  private handlers: Map<string, EventHandler[]> = new Map()

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl
  }

  // Connect to SSE
  connect(sessionId?: string): void {
    const url = new URL("/events", this.baseUrl)
    if (sessionId) url.searchParams.set("sessionId", sessionId)

    this.eventSource = new EventSource(url.toString())

    this.eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data)
      this.handleEvent(data)
    }

    this.eventSource.onerror = (e) => {
      console.error("SSE connection error, retrying...")
      setTimeout(() => this.connect(sessionId), 3000)
    }
  }

  disconnect(): void {
    this.eventSource?.close()
    this.eventSource = null
  }

  // Event subscription
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, [])
    }
    this.handlers.get(eventType)!.push(handler)

    return () => {
      const handlers = this.handlers.get(eventType)
      if (handlers) {
        const index = handlers.indexOf(handler)
        if (index > -1) handlers.splice(index, 1)
      }
    }
  }

  private handleEvent(event: any): void {
    const handlers = this.handlers.get(event.type) || []
    handlers.forEach(handler => handler(event))
    
    // Also trigger wildcard handlers
    const wildcardHandlers = this.handlers.get("*") || []
    wildcardHandlers.forEach(handler => handler(event))
  }

  // Send prompt to server
  async sendPrompt(sessionId: string, content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    if (!response.ok) throw new Error(`Failed to send prompt: ${response.statusText}`)
  }
}
```

## 4. 使用方式

### 4.1 命令行参数 (MVP)

```bash
# 基本用法 - 直接启动交互式对话
agent-cli

# 指定 Server
agent-cli --server http://localhost:3001

# 指定 Session
agent-cli --session abc123
```

### 4.2 交互命令

进入交互模式后：

| 命令 | 功能 |
|------|------|
| `<query>` | 发送消息给 AI |
| `exit` / `quit` | 退出程序 |
| `clear` | 清屏 |
| `help` | 显示帮助 |

## 5. 目录结构 (MVP)

```
app/cli/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── cli-engine.ts         # 交互式对话引擎
│   ├── client.ts             # AgentClient (SSE 连接)
│   └── types.ts              # 类型定义
├── bin/
│   └── agent-cli             # 可执行脚本
├── package.json
└── tsconfig.json
```

## 6. 依赖

CLI 集成在 `packages/core` 中，依赖：

```json
{
  "name": "agent-core",
  "bin": {
    "tong_work": "./bin/tong_work"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js"
    },
    "./cli": {
      "import": "./dist/cli/index.js"
    },
    "./server": {
      "import": "./dist/server/index.js"
    }
  }
}
```

## 7. 实现模式 (MVP)

### 7.1 交互式对话模式

CLI 启动后直接进入交互模式：

```
$ agent-cli

🤖 Agent CLI
Server: http://localhost:3000
输入 'exit' 或 'quit' 退出

💬 你好
🤖 你好！很高兴见到你。有什么我可以帮助你的吗？

💬 请介绍一下自己
🤖 我是一个 AI 助手，可以帮助你解答问题、编写代码、分析文件等。

💬 exit
👋 再见!
```

### 7.2 未来扩展

- 子命令系统 (`run`, `session`, `config`)
- TUI 富界面 (`@opentui/solid`)
- 文件引用 (`@filename`)
- Shell 命令 (`!command`)

## 8. 配置 (MVP)

```typescript
// ~/.agent-core-cli/config.json
{
  "serverUrl": "http://localhost:3000"
}
```

或通过环境变量：

```bash
export AGENT_SERVER_URL=http://localhost:3000
```

## 9. 开发指南

### 9.1 处理 SSE 事件

```typescript
const client = new AgentClient({ baseUrl: "http://localhost:3000" })

// Subscribe to stream events
client.on("stream.text", (event) => {
  process.stdout.write(event.properties?.delta || "")
})

client.on("stream.completed", (event) => {
  console.log("\n✅ [完成]")
})

client.on("stream.error", (event) => {
  console.error("\n❌ [错误]", event.properties?.error)
})

// Connect
client.connect("session-123")

// Send prompt
await client.sendPrompt("session-123", "你好")
```

## 10. 发布

### 10.1 本地开发

```bash
cd app/cli
bun link

# 使用
agent-cli --help
```

### 10.2 使用方式

```bash
# 直接运行
bun run app/cli/src/index.ts

# 或构建后运行
bun build --compile --outfile agent-cli app/cli/src/index.ts
./agent-cli
```

---

**当前实现 (MVP)**: 基础交互式对话 + SSE 连接

**参考**: 
- [整体架构](../architecture/overview.md)
- [Server 设计](./server-design.md)
- [SSE 设计](../architecture/sse-design.md)
