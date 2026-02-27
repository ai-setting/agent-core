# Active Session 设计文档

## 1. 概述

### 1.1 问题背景

当前 agent-core 系统中，当 EventSource（如飞书消息）触发事件时，事件没有携带 `trigger_session_id`，导致事件无法路由到具体会话处理，只能被静默忽略。

### 1.2 解决方案

引入 **Active Session** 机制，记录当前活跃的会话：
- TUI 启动新会话时，自动设置为 Active Session
- 用户通过 `/sessions` 命令选择会话时，更新 Active Session
- 事件路由时，如果没有明确的 `trigger_session_id`，则使用 Active Session
- **ClientId** 从 `tong_work.jsonc` 配置中读取，用于标识用户身份

### 1.3 设计目标

1. **用户级标识**：通过配置指定 clientId，标识用户身份
2. **配置驱动**：ClientId 从 `tong_work.jsonc` 读取，遵循现有配置系统
3. 事件触发时自动使用 Active Session
4. 支持 TUI 和 Server 两种运行模式

## 2. ClientId 配置设计

### 2.1 配置文件

在 `~/.config/tong_work/agent-core/tong_work.jsonc` 中添加 `clientId` 字段：

```jsonc
{
  "activeEnvironment": "zst",
  "clientId": "dongzhaokun@2016.com",
  "defaultModel": "moonshot/kimi-k2.5",
  "baseURL": "https://api.moonshot.cn/v1",
  "apiKey": "${MOONSHOT_API_KEY}",
  "metadata": {
    "version": "1.0.0",
    "description": "Global configuration for tong_work agent-core"
  }
}
```

### 2.2 Config Schema 扩展

在 `packages/core/src/config/types.ts` 的 `ConfigInfo` 中添加 `clientId` 字段：

```typescript
// 主配置 Schema
export const ConfigInfo = z.object({
  // === 用户标识 ===
  clientId: z.string().optional().describe("User identifier for event routing (e.g., email)"),
  
  // ... 其他字段
});
```

### 2.3 配置加载

Server 启动时通过 `Config_get()` 获取 `clientId`：

```typescript
// packages/core/src/server/environment.ts
const config = await Config_get();
const clientId = config.clientId;
```

## 3. 总体架构

### 2.1 核心概念

- **Active Session**：当前客户端绑定的活跃会话 ID
- **Client Session 映射**：每个客户端连接（通过 session cookie 或 sessionId）对应一个 Active Session

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                         Server                                  │
│  ┌─────────────────┐    ┌──────────────────┐                  │
│  │  Client A       │    │  Client B        │                  │
│  │  ActiveSession: │    │  ActiveSession:  │                  │
│  │  session-A-1    │    │  session-B-1     │                  │
│  └────────┬────────┘    └────────┬─────────┘                  │
│           │                      │                             │
│           ↓                      ↓                             │
│  ┌────────────────────────────────────────┐                   │
│  │         ActiveSessionManager           │                   │
│  │  - getActiveSession(clientId)          │                   │
│  │  - setActiveSession(clientId, ssnId)  │                   │
│  │  - clearActiveSession(clientId)        │                   │
│  └────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
           │
           ↓ 事件路由
┌─────────────────────────────────────────────────────────────────┐
│                      Event Processing                            │
│  1. 事件.metadata.trigger_session_id                            │
│  2. 或 ActiveSessionManager.getActiveSession(clientId)         │
│  3. 或 创建新会话 / 拒绝处理                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 3. 实现方案

### 3.1 ActiveSessionManager

在 ServerEnvironment 中添加 ActiveSessionManager：

```typescript
// packages/core/src/server/environment.ts

class ActiveSessionManager {
  private activeSessions = new Map<string, string>(); // clientId -> sessionId
  
  constructor(private clientId: string) {}
  
  getActiveSession(): string | undefined {
    return this.activeSessions.get(this.clientId);
  }
  
  setActiveSession(sessionId: string): void {
    this.activeSessions.set(this.clientId, sessionId);
    console.log(`[ActiveSession] Client ${this.clientId} set active session: ${sessionId}`);
  }
  
  clearActiveSession(): void {
    this.activeSessions.delete(this.clientId);
  }
}
```

### 3.2 触发场景

#### 3.2.1 TUI 创建新会话

当 TUI 调用 `createSession` 时，自动设置为 Active Session：

```typescript
// packages/core/src/server/routes/sessions.ts
// Server 端处理
activeSessionManager.setActiveSession(sessionId);
```

#### 3.2.2 Sessions Command 选择会话

当用户通过 `/sessions` 命令选择会话时：

```typescript
// packages/core/src/server/command/built-in/sessions.ts
// select action
activeSessionManager.setActiveSession(action.sessionId);
```

#### 3.2.3 TUI 连接 Server

TUI 通过配置中的 clientId 连接 SSE：

```
GET /events?session=main
// Server 从配置获取 clientId
```

### 3.3 事件路由改进

修改事件处理逻辑，优先使用 Active Session：

```typescript
// packages/core/src/core/event-processor.ts

async function processEventInSession(env, event) {
  let sessionId = event.metadata.trigger_session_id;
  
  // 1. 如果没有 trigger_session_id，尝试从 Active Session 获取
  if (!sessionId && env.activeSessionManager) {
    sessionId = env.activeSessionManager.getActiveSession();
  }
  
  // 2. 如果还是没有，记录警告日志，跳过处理
  if (!sessionId) {
    console.warn("[EventProcessor] No session available for event");
    return;
  }
  
  // ... 继续处理
}
```

### 3.4 ClientId 传递机制

#### 3.4.1 配置驱动

从 `tong_work.jsonc` 读取 `clientId`：

```typescript
// packages/core/src/server/environment.ts
const config = await Config_get();
const clientId = config.clientId; // "dongzhaokun@2016.com"
```

#### 3.4.2 Server 端设置环境变量

Server 启动时将配置中的 clientId 注入到环境变量：

```typescript
// packages/core/src/server/environment.ts
if (config.clientId) {
  process.env.CLIENT_ID = config.clientId;
}
```

#### 3.4.3 事件源读取

MCP Server（如飞书）从环境变量获取 clientId 并在事件中传递：

```typescript
// C:\Users\gddzh\.config\tong_work\agent-core\environments\zst\eventsources\feishu\server.mjs
// 从环境变量获取 clientId
const clientId = process.env.CLIENT_ID;

await this.server.server.sendNotification({
  method: "notifications/eventsource/emitted",
  params: {
    data: {
      id: randomUUID(),
      type: "im.message.received",
      timestamp: Date.now(),
      metadata: {
        source: "feishu",
        source_name: "feishu",
        clientId: clientId,
      },
      payload: { ... }
    }
  }
});
```

## 4. API 设计

### 4.1 Session 创建

```typescript
// Request
POST /sessions
Body: { title?: string }

// Response
{
  "id": "session-xxx",
  "title": "...",
  "createdAt": 1234567890
}
```

### 4.2 获取 Active Session

```typescript
// Request
GET /sessions/active

// Response
{ "sessionId": "session-xxx" | null }
```

## 5. 飞书消息事件集成

### 5.1 Server 端注入 ClientId

Server 启动时将配置中的 clientId 注入到环境变量：

```typescript
// packages/core/src/server/environment.ts
async initialize() {
  const config = await Config_get();
  
  // 将 clientId 注入环境变量，供 MCP Server 使用
  if (config.clientId) {
    process.env.CLIENT_ID = config.clientId;
  }
}
```

### 5.2 事件源读取

MCP Server 从环境变量获取 clientId 并在事件中传递：

```typescript
// C:\Users\gddzh\.config\tong_work\agent-core\environments\zst\eventsources\feishu\server.mjs

const clientId = process.env.CLIENT_ID;

await this.server.server.sendNotification({
  method: "notifications/eventsource/emitted",
  params: {
    data: {
      id: randomUUID(),
      type: "im.message.received",
      timestamp: Date.now(),
      metadata: {
        source: "feishu",
        source_name: "feishu",
        clientId: clientId,
      },
      payload: { ... }
    }
  }
});
```

### 5.2 事件规则改进

为飞书消息事件添加专门的 EventRule：

```typescript
// packages/core/src/server/environment.ts

bus.registerRule({
  eventType: "im.message.received",
  handler: {
    type: "function",
    fn: async (event) => {
      const { processEventInSession } = await import("../core/event-processor.js");
      const payload = event.payload as any;
      
      await processEventInSession(this, event, {
        prompt: `收到飞书消息:
        
发送者: ${payload.senderId}
内容: ${payload.content}

请回复用户消息或执行相应操作。`
      });
    }
  },
  options: { priority: 50 }
});
```

## 6. 待实现功能

- [x] Config Schema 添加 clientId 字段 ✅ 已完成
- [x] 更新 tong_work.jsonc 添加 clientId 配置 ✅ 已完成
- [x] Server 启动时注入 CLIENT_ID 环境变量 ✅ 已完成
- [x] ActiveSessionManager 类设计与实现 ✅ 已完成
- [x] Session 创建时自动设置 Active Session ✅ 已完成
- [x] Sessions Command 选择会话时更新 Active Session ✅ 已完成
- [x] 事件路由时使用 Active Session ✅ 已完成
- [x] 飞书事件源从环境变量获取 clientId 并传递 ✅ 已完成

## 7. 配置文件变更

### 7.1 tong_work.jsonc

添加 `clientId` 字段：

```jsonc
{
  "clientId": "dongzhaokun@2016.com"
}
```

### 7.2 Config Schema

在 `packages/core/src/config/types.ts` 中添加字段：

```typescript
clientId: z.string().optional().describe("User identifier for event routing"),
```

## 8. 测试计划

### 8.1 单元测试

- ActiveSessionManager 基本操作
- 事件路由 fallback 到 Active Session

### 8.2 集成测试

- TUI 创建会话 -> 设置 Active Session -> 事件路由
- Sessions Command 选择会话 -> 更新 Active Session -> 事件路由

### 8.3 手动测试

1. 启动 Server
2. 启动 TUI（创建新会话）
3. 向飞书发送消息
4. 验证 TUI 收到事件并处理
