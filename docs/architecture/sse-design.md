# SSE (Server-Sent Events) 设计文档

## 1. 概述

SSE (Server-Sent Events) 用于将 EventBus 的事件实时推送到客户端。客户端通过 HTTP 连接订阅事件流，服务器在有新事件时主动推送。

**参考**: OpenCode 使用 Hono 框架的 `streamSSE` 实现。

## 2. 架构设计

### 2.1 数据流

```
┌─────────────┐     HTTP GET /events     ┌─────────────┐
│   Client    │ ◄─────────────────────── │    Server   │
│  (Browser/  │    SSE Connection        │             │
│   CLI/      │    text/event-stream     │             │
│  Desktop)   │                          │             │
└──────┬──────┘                          └──────┬──────┘
       │                                         │
       │  2. receive events                      │  1. subscribe to EventBus
       │◄────────────────────────────────────────┤
       │                                         │
       │  data: {"type":"stream.text",...}       │
       │  data: {"type":"stream.completed",...}  │
       │                                         │
```

### 2.2 OpenCode 实现参考

OpenCode 使用 Hono 框架实现 SSE：

```typescript
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

const app = new Hono()

app.get("/events", async (c) => {
  return streamSSE(c, async (stream) => {
    // 1. Send initial connected event
    stream.writeSSE({
      data: JSON.stringify({
        type: "server.connected",
        properties: {},
      }),
    })

    // 2. Subscribe to EventBus
    const unsub = Bus.subscribeAll(async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
      })
    })

    // 3. Send heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      stream.writeSSE({
        data: JSON.stringify({
          type: "server.heartbeat",
          properties: {},
        }),
      })
    }, 30000)

    // 4. Handle client disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat)
        unsub()
        resolve()
      })
    })
  })
})
```

## 3. 关键设计要点

### 3.1 端点设计

```
GET /events
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

# Query Parameters
?sessionId=<optional>  # 可选，过滤特定 session 的事件
```

### 3.2 事件格式

```
data: {"type":"stream.start","properties":{"sessionId":"abc","model":"gpt-4"}}

data: {"type":"stream.text","properties":{"sessionId":"abc","content":"Hello","delta":"Hello"}}

data: {"type":"stream.completed","properties":{"sessionId":"abc"}}
```

### 3.3 心跳机制

- 每 30 秒发送一次 heartbeat 事件
- 防止连接超时（特别是移动端/WebView）
- 客户端可用于检测连接状态

```
data: {"type":"server.heartbeat","properties":{}}
```

### 3.4 连接管理

1. **客户端连接**: 发送 HTTP GET 请求建立 SSE 连接
2. **服务器订阅**: 订阅 EventBus (Bus.subscribeAll 或 Bus.subscribeToSession)
3. **事件推送**: EventBus 有新事件时，通过 SSE 推送到客户端
4. **客户端断开**: 取消订阅，清理资源

## 4. 技术选型

### 4.1 框架选择

| 框架 | 优势 | 适用场景 |
|------|------|----------|
| **Hono** | 轻量、高性能、TypeScript 友好 | 推荐 |
| **Express** | 生态丰富、成熟稳定 | 传统项目 |
| **Fastify** | 高性能、低开销 | 高性能需求 |
| **Elysia** | Bun 原生、极致性能 | Bun 环境 |

### 4.2 我们选择 Hono

- 参考 OpenCode 的实现
- 内置 `streamSSE` 支持
- 轻量且易于集成
- 良好的 TypeScript 支持

## 5. API 设计

### 5.1 GET /events

订阅所有事件流。

**Query Parameters**:
- `sessionId` (optional): 过滤特定 session 的事件

**Response**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"server.connected","properties":{}}

data: {"type":"stream.start","properties":{"sessionId":"abc","model":"gpt-4"}}

data: {"type":"stream.text","properties":{"sessionId":"abc","content":"Hello","delta":"Hello"}}

data: {"type":"stream.completed","properties":{"sessionId":"abc"}}

data: {"type":"server.heartbeat","properties":{}}
```

### 5.2 错误处理

连接错误时发送错误事件：

```
data: {"type":"server.error","properties":{"error":"Connection lost"}}
```

## 6. 实现要点

### 6.1 基础实现

```typescript
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { subscribeGlobal } from "./eventbus/global.js"
import { subscribeToSession } from "./eventbus/bus.js"

const app = new Hono()

app.get("/events", async (c) => {
  const sessionId = c.req.query("sessionId")
  
  return streamSSE(c, async (stream) => {
    // Send connected event
    stream.writeSSE({
      data: JSON.stringify({
        type: "server.connected",
        timestamp: Date.now(),
      }),
    })

    // Subscribe to events
    const unsubscribe = sessionId
      ? subscribeToSession(sessionId, (event) => {
          stream.writeSSE({ data: JSON.stringify(event) })
        })
      : subscribeGlobal((data) => {
          stream.writeSSE({ data: JSON.stringify(data.payload) })
        })

    // Heartbeat
    const heartbeat = setInterval(() => {
      stream.writeSSE({
        data: JSON.stringify({ type: "server.heartbeat" }),
      })
    }, 30000)

    // Wait for disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat)
        unsubscribe()
        resolve()
      })
    })
  })
})
```

### 6.2 客户端连接示例

```javascript
// Browser
const eventSource = new EventSource('/events?sessionId=abc')

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log('Received:', data)
}

eventSource.onerror = (error) => {
  console.error('SSE error:', error)
}

// Close connection
eventSource.close()
```

## 7. 目录结构

```
app/server/
├── src/
│   ├── index.ts              # Server 入口
│   ├── server.ts             # Hono HTTP Server
│   ├── eventbus/             # EventBus 实现
│   │   └── ...
│   └── routes/
│       ├── index.ts          # 路由注册
│       └── events.ts         # SSE 端点
├── package.json
└── tsconfig.json
```

## 8. 实现优先级

1. **P0**: 基础 Hono Server 框架
2. **P0**: `/events` SSE 端点
3. **P0**: EventBus 集成
4. **P1**: Session 过滤 (?sessionId)
5. **P1**: 心跳机制
6. **P2**: 连接统计/监控

## 9. 参考

- [OpenCode SSE 实现](../../../thirdparty/opencode/packages/opencode/src/server/server.ts)
- [Hono SSE Documentation](https://hono.dev/docs/helpers/streaming)
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

*文档版本: 1.0*
*基于 OpenCode 架构设计*
