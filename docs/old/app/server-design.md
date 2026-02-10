# Server 应用设计文档

## 1. 概述

Server 是基于 agent-core 框架构建的后端服务，负责：
- 通过 HTTP API 暴露 Session 管理能力
- 通过 SSE 向客户端推送流式事件
- 管理 EventBus，接收并广播来自 agent-core 的事件

**架构定位**: Server 是服务端层，连接 agent-core 框架和各种客户端。

## 2. 核心组件

### 2.1 EventBus

```typescript
class EventBus {
  publish(event: StreamEvent, context: EventContext): void;
  subscribe(handler: EventHandler): () => void;
  subscribeToSession(sessionId: string, handler: EventHandler): () => void;
}
```

**事件类型**:
- `text`: 文本流
- `reasoning`: 推理过程
- `tool_call`: 工具调用
- `tool_result`: 工具结果
- `start`: 开始
- `completed`: 完成
- `error`: 错误

### 2.2 Environment 集成

在 BaseEnvironment 中通过 `onStreamEvent` hook 发布事件到 EventBus。

**invoke_llm 中的触发点**:
- 开始调用时: `publish({ type: 'start' })`
- 流式读取时: `publish({ type: 'text', delta })`
- 工具调用时: `publish({ type: 'tool_call', ... })`
- 完成时: `publish({ type: 'completed' })`

### 2.3 HTTP Server

**REST API**:
- `GET /sessions` - 列出会话
- `POST /sessions` - 创建会话
- `GET /sessions/:id` - 获取会话
- `DELETE /sessions/:id` - 删除会话
- `POST /sessions/:id/prompt` - 发送消息 (异步)

**SSE Endpoint**:
- `GET /events?sessionId=<optional>` - 事件流

## 3. API 设计

### 3.1 发送 Prompt

```bash
POST /sessions/:id/prompt
Content-Type: application/json

{
  "content": "Hello, how are you?",
  "history": [...],
  "model": "openai/gpt-4o"
}

# 响应 (立即返回)
{ "success": true, "sessionId": "abc123" }

# 客户端通过 SSE 接收流式响应
```

### 3.2 SSE 事件格式

```javascript
data: {
  "event": {
    "type": "text",
    "content": "累计内容",
    "delta": "新增片段"
  },
  "context": {
    "sessionId": "abc123",
    "messageId": "msg456",
    "timestamp": 1707234567890
  }
}
```

## 4. 目录结构

```
app/server/
├── src/
│   ├── index.ts              # Server 入口
│   ├── server.ts             # HTTP Server
│   ├── eventbus/
│   │   ├── index.ts
│   │   ├── eventbus.ts
│   │   └── types.ts
│   ├── session/
│   │   ├── session-manager.ts
│   │   └── types.ts
│   └── environment/
│       └── server-environment.ts
└── package.json
```

## 5. 依赖

```json
{
  "dependencies": {
    "agent-core": "workspace:*",
    "elysia": "^1.0.0",
    "@elysiajs/cors": "^1.0.0"
  }
}
```

## 6. 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | HTTP 端口 | `3000` |
| `LLM_MODEL` | 默认模型 | `openai/gpt-4o-mini` |
| `SESSIONS_DIR` | Session 存储目录 | `~/.agent-core-server/sessions` |

---

**参考**: [整体架构](../architecture/overview.md) | [CLI 设计](./cli-design.md)
