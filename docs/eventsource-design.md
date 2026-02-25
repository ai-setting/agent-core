# EventSource 事件源实现方案

## 一、设计目标

参考现有的 `mcpservers` 目录机制，设计一套可扩展的 EventSource 系统：
- 通过文件夹维护 EventSource 配置（类似 `mcpservers`）
- 通过扩展的 MCP Server 协议暴露 EventSource 功能
- 支持 local（同一进程）和 remote（远程进程）两种部署方式
- 不同进程产生的 EnvEvent 被 Env MCP Client 订阅后，调用 ServerEnvironment.publishEvent()

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用进程 (ServerEnvironment)                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         ServerEnvironment                            │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │   │
│  │  │   EnvEventBus   │  │ publishEvent() │  │  EventMcpManager   │  │   │
│  │  │   (规则引擎)     │  │   (事件发布)    │  │  (MCP 事件客户端)   │  │   │
│  │  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │   │
│  └───────────┼────────────────────┼───────────────────────┼─────────────┘   │
│              │                    │                       │                  │
└──────────────┼────────────────────┼───────────────────────┼──────────────────┘
               │                    │                       │
               │  MCP stdio/http   │                       │
               ▼                    │                       ▼
┌────────────────────────────────────┴────────────────────────────────────────┐
│                          MCP 协议层                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  tools: emit_event, subscribe_event, list_events, unsubscribe_event │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
               │                                            ▲
               │         MCP stdio/http                     │
               ▼                                            │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EventSource MCP Server 进程                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ TimerEventSource│  │WebhookEventSource│  │  其他自定义 EventSource   │  │
│  │  (定时器事件)    │  │  (Webhook事件)   │  │  (用户扩展)                │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
               │                                            ▲
               │         本地进程或远程 HTTP                  │
               └────────────────────────────────────────────┘
```

---

## 三、目录结构

### 3.1 整体目录

```
test-env/
├── config.jsonc                          # 环境配置
├── mcpservers/                           # 现有的 MCP Servers (工具)
│   ├── hello/
│   └── todo/
└── eventsources/                         # 新增：EventSource 目录
    ├── timer/
    │   ├── server.mjs
    │   └── config.jsonc
    └── webhook/
```

### 3.2 env_spec/mcp 目录结构

```
packages/core/src/server/env_spec/mcp/
├── index.ts                              # 导出入口
├── types.ts                              # 类型定义 (已有)
├── manager.ts                            # McpManager (已有)
├── spec.ts                               # MCP Spec 规范定义
├── event-source/
│   ├── index.ts                          # 导出入口
│   ├── types.ts                          # EventSource 相关类型
│   ├── manager.ts                        # EventMcpManager
│   └── client.ts                         # EventMcpClient
└── eventsources/                        # 保留：本地 EventSource 基类 (可选)
    ├── index.ts
    ├── eventsource.ts
    ├── timer-source.ts
    └── webhook-source.ts
```

---

## 四、env_spec/mcp/event-source 模块

### 4.1 类型定义

```typescript
// src/server/env_spec/mcp/event-source/types.ts

import { EnvEvent } from "../../../../core/types/event.js";

/**
 * EventSource 配置
 * 复用现有的 McpClientConfig
 */
export interface EventSourceMcpConfig {
  /** 事件源名称 */
  name: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 自动启动 */
  autoStart?: boolean;
  /** MCP 客户端配置 */
  client: McpClientConfig;
  /** 事件源特定配置 */
  options?: {
    /** 事件类型过滤器 */
    eventTypes?: string[];
    /** 自定义元数据 */
    metadata?: Record<string, unknown>;
  };
}

/**
 * EventSource 状态
 */
export enum EventSourceStatus {
  STOPPED = "stopped",
  CONNECTING = "connecting",
  RUNNING = "running",
  DISCONNECTED = "disconnected",
  ERROR = "error"
}

---

## 五、配置文件格式

### 5.1 环境配置 (config.jsonc)

```jsonc
{
  "id": "test_env",
  "displayName": "Test Environment",
  "description": "测试环境，包含事件源功能",

  "mcp": {
    "clients": {
      "timer": {
        "type": "local",
        "command": ["bun", "run", "./eventsources/timer/server.mjs"],
        "enabled": true
      },
      "webhook": {
        "type": "remote",
        "url": "http://192.168.1.100:3000/mcp",
        "enabled": true
      },
      "remote-sensor": {
        "type": "remote",
        "url": "http://192.168.1.100:3001/mcp",
        "enabled": true
      }
    },
    "eventSources": {
      "enabled": true,
      "autoStart": true,
      "sources": {
        "timer": {
          "name": "timer",
          "enabled": true,
          "options": {
            "eventTypes": ["timer.heartbeat", "timer.tick"]
            // 注意：remote 类型时使用 Notification 实时推送，无需 pollInterval
          }
        },
        "webhook": {
          "name": "webhook",
          "enabled": true,
          "options": {
            "eventTypes": ["webhook.*"]
          }
        }
      }
    }
  }
}
```

### 5.2 EventSource 配置 (eventsources/*/config.jsonc)

```jsonc
{
  "name": "timer",
  "displayName": "Timer Event Source",
  "description": "定时产生心跳和定时事件",
  "enabled": true,
  "autoStart": true,
  
  // EventSource 特定配置
  "interval": 5000,
  "eventTypes": [
    "timer.heartbeat",
    "timer.tick"
  ],
  
  "metadata": {
    "location": "server-room-1"
  }
}
```

---

## 五、MCP 协议扩展

### 5.1 工具定义

EventSource MCP Server 需要实现以下工具：

```typescript
// 工具：发布事件
{
  name: "emit_event",
  description: "Emit an environment event",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", description: "Event type" },
      payload: { type: "object", description: "Event payload" },
      metadata: { type: "object", description: "Event metadata" }
    },
    required: ["type"]
  }
}

// 工具：订阅事件
{
  name: "subscribe_event",
  description: "Subscribe to events from environment",
  inputSchema: {
    type: "object",
    properties: {
      eventType: { type: "string", description: "Event type pattern (supports *)" }
    },
    required: ["eventType"]
  }
}

// 工具：列出可用事件类型
{
  name: "list_event_types",
  description: "List available event types from this source"
}

// 工具：获取事件源状态
{
  name: "get_source_status",
  description: "Get event source status"
}
```

### 5.2 资源定义

```typescript
// 资源：事件源状态
{
  uri: "event-source://timer/status",
  name: "Timer Status",
  description: "Current status of timer event source"
}

// 资源：可用事件类型
{
  uri: "event-source://timer/events",
  name: "Timer Events",
  description: "Available event types from timer source"
}
```

### 5.4 通知机制 (Server-Side Events)

MCP Server 可以通过 `notifications/message` 或自定义 SSE 机制向 Client 推送事件：

```typescript
// MCP Server 推送事件给 Client
await client.send({
  method: "notifications/message",
  params: {
    level: "info",
    data: {
      type: "timer.heartbeat",
      payload: { count: 10, timestamp: Date.now() }
    }
  }
})
```

---

## 六、EventSource MCP Server 实现

### 6.1 基础框架 (server.mjs)

基于现有的 `McpServer` 架构实现（与 mcpservers 目录下的 server.mjs 保持一致）：

> **重要更新**：MCP SDK 支持 Server → Client 的原生 Notification 推送机制！
> - 使用 Streamable HTTP 传输时，支持实时推送
> - 避免了轮询的延迟和资源浪费

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "crypto";

/**
 * 定时器 EventSource MCP Server
 * 每隔固定间隔产生环境事件并推送给 Client
 */
class TimerEventSourceServer {
  constructor(options = {}) {
    this.interval = options.interval || 5000;
    this.eventTypes = options.eventTypes || ["timer.heartbeat", "timer.tick"];
    this.tickCount = 0;
    this.timerId = null;

    // 使用 McpServer (与现有 mcpservers 架构一致)
    this.server = new McpServer(
      { name: "timer-eventsource", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );

    // 保存 session 用于发送 notification
    this.session = null;

    this.setupHandlers();
  }

  setupHandlers() {
    // 注册工具: 手动触发事件
    this.server.registerTool("emit_event", {
      description: "手动触发一个环境事件",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "事件类型",
            enum: this.eventTypes
          },
          payload: {
            type: "object",
            description: "事件载荷"
          }
        },
        required: ["type"]
      }
    }, async (args) => {
      const event = this.createEvent(args.type, args.payload);

      // 立即推送给 Client（通过 notification）
      await this.sendEventNotification(event);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: true, eventId: event.id })
        }]
      };
    });

    // 注册工具: 列出可用事件类型
    this.server.registerTool("list_event_types", {
      description: "列出可产生的事件类型"
    }, async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(this.eventTypes)
        }]
      };
    });

    // 注册工具: 获取事件源状态
    this.server.registerTool("get_source_status", {
      description: "获取事件源状态"
    }, async () => {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: this.timerId ? "running" : "stopped",
            eventsEmitted: this.tickCount,
            interval: this.interval
          })
        }]
      };
    });

    // 注册资源: 事件源状态
    this.server.registerResource(
      "status",
      "event-source://timer/status",
      {
        name: "Timer Status",
        description: "当前定时器事件源状态",
        mimeType: "application/json"
      },
      async () => {
        return JSON.stringify({
          status: this.timerId ? "running" : "stopped",
          eventsEmitted: this.tickCount,
          interval: this.interval
        });
      }
    );

    // 设置 Session 回调 - 用于发送 notification
    this.server.setSessionCallback((session) => {
      this.session = session;
    });
  }

  /**
   * 通过 MCP Notification 推送事件给 Client
   * 这是核心！实现了 Server → Client 的实时推送
   */
  async sendEventNotification(event) {
    if (this.session) {
      try {
        await this.session.send({
          method: "notifications/eventsource/emitted",
          params: {
            level: "info",
            data: event
          }
        });
      } catch (error) {
        console.error("Failed to send notification:", error);
      }
    }
  }

  /**
   * 创建事件对象
   */
  createEvent(type, payload = {}) {
    return {
      id: randomUUID(),
      type,
      timestamp: Date.now(),
      metadata: {
        source: "timer",
        source_name: "timer-eventsource"
      },
      payload
    };
  }

  /**
   * 启动事件生成
   */
  start() {
    if (this.timerId) return;

    this.timerId = setInterval(async () => {
      this.tickCount++;
      const event = this.createEvent("timer.heartbeat", {
        count: this.tickCount,
        timestamp: Date.now()
      });

      // 立即推送 - 无需等待 Client 轮询！
      await this.sendEventNotification(event);
    }, this.interval);
  }

  /**
   * 停止事件生成
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * 启动服务器
   */
  async run() {
    this.start();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// 从 config.jsonc 或环境变量读取配置
const config = JSON.parse(process.env.MCP_SERVER_CONFIG || "{}");
const server = new TimerEventSourceServer(config);
server.run();
```

### 6.2 配置文件 (config.jsonc)

```jsonc
// eventsources/timer/config.jsonc
{
  "name": "timer",
  "displayName": "Timer Event Source",
  "description": "定时产生心跳和定时事件",
  "enabled": true,

  // EventSource 特定配置
  "interval": 5000,
  "eventTypes": [
    "timer.heartbeat",
    "timer.tick"
  ]
}
```

### 6.3 启动方式

```bash
# 直接运行
bun run server.mjs

# 或通过配置运行 (McpServerLoader 会自动处理)
```

### 6.4 传输方式选择

| 传输方式 | Notification 支持 | 适用场景 |
|---------|------------------|---------|
| **Streamable HTTP** | ✅ 完全支持 | 远程部署、实时推送 |
| **stdio** | ⚠️ 不支持 | 本地进程、需要轮询 fallback |

> **注意**：当前 stdio 传输模式下，Notification 可能无法送达 Client。
> 如果需要实时推送，请使用 `type: "remote"` 配置 HTTP 端点。

---

### 6.5 轮询 Fallback 方案 (仅 stdio)

如果必须使用 stdio 传输，可以使用轮询作为 fallback：

```javascript
// 在上述 server.mjs 中添加 list_pending_events 工具
this.server.registerTool("list_pending_events", {
  description: "获取待处理的事件列表"
}, async () => {
  const events = [...this.pendingEvents];
  this.pendingEvents = []; // 清空
  return {
    content: [{
      type: "text",
      text: JSON.stringify(events)
    }]
  };
});

// 修改 start() 方法 - 改为存入队列
start() {
  if (this.timerId) return;

  this.timerId = setInterval(() => {
    this.tickCount++;
    const event = this.createEvent("timer.heartbeat", {
      count: this.tickCount,
      timestamp: Date.now()
    });

    // stdio 模式：存入队列等待 Client 轮询
    this.pendingEvents = this.pendingEvents || [];
    this.pendingEvents.push(event);
  }, this.interval);
}
```

---

## 七、event-source 模块实现

### 7.1 EventMcpManager

```typescript
// src/server/env_spec/mcp/event-source/manager.ts

import { ServerEnvironment } from "../../../environment.js";
import { McpClientConfig } from "../types.js";
import { EventMcpClient } from "./client.js";
import { EventSourceMcpConfig, EventSourceStatus } from "./types.js";

/**
 * EventSource MCP 管理器
 * 负责加载、连接、管理 EventSource MCP Clients
 * 核心职责：
 * 1. 从 mcp.clients 配置中筛选事件源
 * 2. 创建并连接 EventMcpClient
 * 3. EventMcpClient 内部直接调用 env.publishEvent()，无需 Manager 转发
 */
export class EventMcpManager {
  private env: ServerEnvironment;
  private clients: Map<string, EventMcpClient> = new Map();
  private status: Map<string, EventSourceStatus> = new Map();

  constructor(env: ServerEnvironment) {
    this.env = env;
  }

  /**
   * 加载 EventSource MCP Clients
   * 从 mcp.clients 配置中筛选需要作为事件源的客户端
   */
  async loadClients(
    mcpClientsConfig: Record<string, McpClientConfig>,
    eventSourceConfig?: Record<string, EventSourceMcpConfig>
  ): Promise<void> {
    // 如果没有单独配置，则默认所有 MCP 客户端都可能是事件源
    const targetConfigs = eventSourceConfig || Object.keys(mcpClientsConfig).reduce((acc, name) => {
      acc[name] = { name, client: mcpClientsConfig[name], enabled: true };
      return acc;
    }, {} as Record<string, EventSourceMcpConfig>);

    for (const [name, config] of Object.entries(targetConfigs)) {
      if (!config.enabled || !mcpClientsConfig[name]) continue;

      try {
        // 创建客户端并连接
        // 注意：EventMcpClient 内部收到事件后直接调用 env.publishEvent()
        // 无需 Manager 额外处理
        const client = new EventMcpClient(this.env, name, config.client, config.options);
        await client.connect();
        
        this.clients.set(name, client);
        this.status.set(name, EventSourceStatus.RUNNING);
        
        console.log(`[EventMcpManager] Loaded EventSource: ${name}`);
      } catch (error) {
        console.error(`[EventMcpManager] Failed to load ${name}:`, error);
        this.status.set(name, EventSourceStatus.ERROR);
      }
    }
  }

  /**
   * 断开所有 EventSource Clients
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => client.disconnect());
    await Promise.all(promises);
    this.clients.clear();
    this.status.clear();
  }

  /**
   * 获取客户端状态
   */
  getStatus(name: string): EventSourceStatus | undefined {
    return this.status.get(name);
  }

  /**
   * 获取所有客户端
   */
  getClients(): Map<string, EventMcpClient> {
    return new Map(this.clients);
  }

  /**
   * 获取所有事件源名称
   */
  getEventSourceNames(): string[] {
    return Array.from(this.clients.keys());
  }
}
```

### 7.2 EventMcpClient

```typescript
// src/server/env_spec/mcp/event-source/client.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ServerEnvironment } from "../../../environment.js";
import { EnvEvent } from "../../../../core/types/event.js";
import { McpClientConfig } from "../types.js";
import { EventSourceStatus } from "./types.js";

/**
 * EventSource MCP Client
 * 封装与 EventSource MCP Server 的连接和事件处理
 * 核心职责：
 * 1. 连接到 MCP Server
 * 2. 接收 Server 推送的事件 (Notification 或轮询)
 * 3. 直接调用 env.publishEvent() 发布到 EnvEventBus
 * 
 * 注意：不再需要 onEvent 中间层，收到事件后直接发布
 */
export class EventMcpClient {
  private env: ServerEnvironment;
  private name: string;
  private config: McpClientConfig;
  private options?: Record<string, unknown>;
  private client?: Client;
  private transport?: StdioClientTransport | StreamableHTTPClientTransport;
  private status: EventSourceStatus = EventSourceStatus.STOPPED;
  private pollInterval?: NodeJS.Timeout;
  private useNotification = false;

  constructor(
    env: ServerEnvironment,
    name: string,
    config: McpClientConfig,
    options?: Record<string, unknown>
  ) {
    this.env = env;
    this.name = name;
    this.config = config;
    this.options = options;
  }

  /**
   * 连接到 EventSource MCP Server
   */
  async connect(): Promise<void> {
    this.status = EventSourceStatus.CONNECTING;
    this.transport = this.createTransport();
    this.client = new Client({ name: `eventsource-${this.name}`, version: "1.0.0" });

    await this.client.connect(this.transport);

    // 初始化并开始接收事件
    await this.initialize();

    this.status = EventSourceStatus.RUNNING;
    console.log(`[EventMcpClient] Connected to ${this.name} (notification: ${this.useNotification})`);
  }

  /**
   * 创建传输层
   */
  private createTransport(): StdioClientTransport | StreamableHTTPClientTransport {
    if (this.config.type === "local") {
      const [cmd, ...args] = this.config.command!;
      return new StdioClientTransport({
        command: cmd,
        args,
        env: { ...process.env as Record<string, string>, ...this.config.environment },
        stderr: "pipe",
      });
    } else {
      return new StreamableHTTPClientTransport(new URL(this.config.url!), {
        requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
      });
    }
  }

  /**
   * 初始化事件接收
   * 优先使用 Notification 机制，fallback 到轮询
   */
  private async initialize(): Promise<void> {
    // 检查传输类型 - 只有 HTTP 支持 Notification
    if (this.config.type === "remote") {
      // 使用 Notification 机制 - 实时推送！
      this.useNotification = true;
      this.setupNotificationHandler();
    } else {
      // stdio 传输 - 使用轮询 fallback
      console.log(`[EventMcpClient] ${this.name} using stdio, falling back to polling`);
      const pollInterval = (this.options?.pollInterval as number) || 1000;
      this.startPolling(pollInterval);
    }
  }

  /**
   * 设置 Notification 处理器
   * 接收 Server 推送的事件
   */
  private setupNotificationHandler(): void {
    if (!this.client) return;

    // 注册 notification 处理器
    this.client.on("notification", async (notification: { method: string; params?: Record<string, unknown> }) => {
      if (notification.method === "notifications/eventsource/emitted") {
        const data = notification.params?.["data"] as Record<string, unknown>;
        if (data) {
          await this.handleEvent(data);
        }
      }
    });
  }

  /**
   * 轮询获取待处理事件 (仅 stdio fallback)
   */
  private startPolling(interval: number): void {
    this.pollInterval = setInterval(async () => {
      try {
        if (!this.client) return;

        // 调用 MCP Server 的 list_pending_events 工具
        const result = await this.client.request(
          { method: "tools/call", params: { name: "list_pending_events", arguments: {} } },
          { content: [] }
        );

        if (result?.content?.[0]?.text) {
          const events = JSON.parse(result.content[0].text);
          for (const rawEvent of events) {
            await this.handleEvent(rawEvent);
          }
        }
      } catch {
        // 静默处理轮询错误
      }
    }, interval);
  }

  /**
   * 处理收到的事件
   * 直接调用 env.publishEvent() 发布到 EnvEventBus
   */
  private async handleEvent(rawEvent: Record<string, unknown>): Promise<void> {
    const envEvent: EnvEvent = {
      id: (rawEvent.id as string) || crypto.randomUUID(),
      type: rawEvent.type as string,
      timestamp: (rawEvent.timestamp as number) || Date.now(),
      metadata: {
        source: (rawEvent.metadata as Record<string, unknown>)?.source as string || this.name,
        source_name: this.name,
        ...(rawEvent.metadata as Record<string, unknown>),
      },
      payload: rawEvent.payload || {},
    };

    // 直接发布到 EnvEventBus，无需中间层
    await this.env.publishEvent(envEvent);
    console.log(`[EventMcpClient] Published event: ${envEvent.type} from ${this.name}`);
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
    
    this.status = EventSourceStatus.STOPPED;
  }

  /**
   * 获取状态
   */
  getStatus(): EventSourceStatus {
    return this.status;
  }

  /**
   * 获取名称
   */
  getName(): string {
    return this.name;
  }
}
```

### 7.3 导出入口

```typescript
// src/server/env_spec/mcp/event-source/index.ts

export { EventMcpManager } from "./manager.js";
export { EventMcpClient } from "./client.js";
export type { EventSourceMcpConfig, EventSourceStatus } from "./types.js";
```

---

## 八、ServerEnvironment 集成

```typescript
// src/server/environment.ts 部分代码

import { EventMcpManager } from "./env_spec/mcp/event-source/manager.js";
import type { EventSourceMcpConfig } from "./env_spec/mcp/event-source/types.js";

export class ServerEnvironment extends BaseEnvironment {
  /** EventSource MCP 管理器 */
  private eventMcpManager: EventMcpManager;
  
  /** 事件源配置 */
  private eventSourceConfig?: EventSourceMcpConfig;

  constructor(config: ServerEnvironmentConfig) {
    super(config);
    
    // 初始化 EventSource 管理器
    this.eventMcpManager = new EventMcpManager(this);
    
    // 解析事件源配置
    this.eventSourceConfig = config.mcp?.eventSources;
    
    // 如果配置了自动启动
    if (this.eventSourceConfig?.autoStart) {
      this.initEventSources(config.mcp?.clients);
    }
  }

  /**
   * 初始化事件源 MCP Clients
   */
  private async initEventSources(mcpClientsConfig?: Record<string, McpClientConfig>): Promise<void> {
    if (!mcpClientsConfig) {
      console.log("[ServerEnvironment] No MCP clients config for EventSources");
      return;
    }

    // 加载 EventSource MCP Clients
    await this.eventMcpManager.loadClients(
      mcpClientsConfig, 
      this.eventSourceConfig?.sources
    );
  }

  /**
   * 获取 EventSource 管理器
   */
  getEventMcpManager(): EventMcpManager {
    return this.eventMcpManager;
  }

  /**
   * 手动添加 EventSource
   */
  async addEventSource(name: string, config: McpClientConfig): Promise<void> {
    await this.eventMcpManager.loadClients({ [name]: config }, {
      [name]: { name, client: config, enabled: true }
    });
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.eventMcpManager.disconnectAll();
    await super.dispose();
  }
}
```

---

## 九、事件流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EventSource MCP Server 进程                        │
│                                                                             │
│  TimerEventSource.emit()                                                    │
│         │                                                                   │
│         ▼                                                                   │
│  server.notification({ method: "eventsource/event", params: event })       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ MCP 协议 (stdio/http)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EventMcpClient 进程                                │
│                                                                             │
│  接收 notification                                                          │
│         │                                                                   │
│         ▼                                                                   │
│  handleEvent() → 构建 EnvEvent                                              │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ServerEnvironment 进程                             │
│                                                                             │
│  env.publishEvent(envEvent)                                                 │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         EnvEventBus                                  │   │
│  │  规则匹配 → USER_QUERY → handle_query()                             │   │
│  │           → timer.heartbeat → (自定义处理)                          │   │
│  │           → * → AI Agent 处理                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 十、使用示例

### 10.1 创建定时器事件源

```bash
# 创建 eventsources/timer 目录
mkdir -p test-env/eventsources/timer
```

```javascript
// test-env/eventsources/timer/server.mjs
// 实现一个每 5 秒发送心跳事件的 MCP Server
```

```jsonc
// test-env/eventsources/timer/config.jsonc
{
  "name": "timer",
  "displayName": "Timer Event Source", 
  "description": "定时产生心跳事件",
  "enabled": true,
  "interval": 5000,
  "eventTypes": ["timer.heartbeat"]
}
```

### 10.2 配置环境

```jsonc
// test-env/config.jsonc
{
  "id": "test_env",
  "mcp": {
    "clients": {
      "timer": {
        "type": "local",
        "command": ["bun", "run", "./eventsources/timer/server.mjs"],
        "enabled": true
      },
      "remote-weather": {
        "type": "remote",
        "url": "http://weather-sensor.local:3000/mcp",
        "enabled": true
      }
    }
  },
  "eventsources": {
    "enabled": true,
    "autoStart": true
  }
}
```

---

## 十一、扩展建议

### 11.1 本地文件事件源

监听文件变化产生事件：

```javascript
// eventsources/file-watcher/server.mjs
import chokidar from "chokidar";

const watcher = chokidar.watch("/path/to/watch", {
  persistent: true,
  ignoreInitial: true
});

watcher.on("add", (path) => emit("file.created", { path }));
watcher.on("change", (path) => emit("file.changed", { path }));
watcher.on("unlink", (path) => emit("file.deleted", { path }));
```

### 11.2 数据库事件源

监听数据库变化：

```javascript
// eventsources/database/server.mjs
// 监听 PostgreSQL NOTIFY / MySQL binlog 等
```

### 11.3 IoT 设备事件源

```javascript
// eventsources/iot/server.mjs
// 监听 MQTT 主题，转换为 EnvEvent
```

---

## 十二、文件清单

```
packages/core/src/server/env_spec/mcp/
├── index.ts                              # 导出入口 (已有)
├── types.ts                              # 类型定义 (已有)
├── manager.ts                            # McpManager (已有)
├── spec.ts                               # MCP Spec 规范定义
├── event-source/
│   ├── index.ts                          # 导出入口
│   ├── types.ts                          # EventSource 相关类型
│   ├── manager.ts                        # EventMcpManager
│   └── client.ts                         # EventMcpClient
└── eventsources/                        # 保留：本地 EventSource 基类 (可选，本地进程使用)
    ├── index.ts
    ├── eventsource.ts
    ├── timer-source.ts
    └── webhook-source.ts
```

---

## 十三、与现有 MCP 系统的关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              config.jsonc                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  mcp  ──────────────────────────────────────────────────────────────  │ │
│  │    ├─ clients:                         (MCP 工具客户端)              │ │
│  │    │   ├─ hello: { type: "local" }                                  │ │
│  │    │   └─ todo:  { type: "local" }                                  │ │
│  │    │                                                                  │ │
│  │    └─ eventSources:                   (MCP 事件源客户端)              │ │
│  │        ├─ timer:     { type: "local", pollInterval: 1000 }          │ │
│  │        └─ webhook:   { type: "remote", url: "..." }                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 解析
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │    McpManager      │    │       EventMcpManager                   │   │
│  │  (现有工具管理)     │    │      (新增事件管理)                       │   │
│  │  - getTools()      │    │  - loadClients()                        │   │
│  │  - executeTool()   │    │  - 管理连接和状态                         │   │
│  └─────────────────────┘    └─────────────────────────────────────────┘   │
│           │                              │                                  │
│           ▼                              ▼                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │   Tool Definitions  │    │   EventMcpClient (每个事件源)            │   │
│  │   (工具定义)         │    │   - 接收 Server 事件                    │   │
│  └─────────────────────┘    │   - 直接调用 env.publishEvent()         │   │
│                             └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

本方案保持了与现有 MCP 架构的一致性，同时扩展了事件源功能，支持灵活的事件产生和订阅机制。
