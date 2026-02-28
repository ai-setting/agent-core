# 日志规范实现方案

## 1. 背景与目标

### 1.1 需求
1. 日志输出带上源码文件和行号
2. TUI 发起的每次 fetch 请求带上 requestId，后续所有日志打印该 requestId
3. 支持后续升级接入 OpenTelemetry

### 1.2 调研结论

| 方案 | 核心概念 | 特点 |
|------|----------|------|
| **OpenTelemetry** | TraceId + SpanId | 行业标准，支持多语言，可对接 Jaeger/Zipkin/OTLP |
| **Langfuse** | TraceId | 专为 LLM 设计，异步上报无延迟 |
| **轻量级（推荐）** | RequestId | 零依赖，使用 Node.js 内置 `async_hooks` |

---

## 2. 架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      日志调用方                              │
│   logger.info("message", { data })                         │
│   logger.warn("error", { error })                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                 ITraceContext (接口层)                      │
│   - getRequestId(): string | undefined                     │
│   - runWithContext<T>(fn: () => T): T                      │
│   - getSpanContext(): SpanContext | undefined               │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│ LightweightImpl     │   │ OpenTelemetryImpl   │
│ (当前轻量级)         │   │ (未来接入 OTel)      │
│ async_hooks         │   │ OTel SDK             │
└─────────────────────┘   └─────────────────────┘
```

### 2.2 模块划分

```
packages/core/src/utils/
├── trace-context.ts      # ITraceContext 接口 + LightweightImpl 实现
├── trace-context-otel.ts  # (未来) OpenTelemetryImpl 实现
└── logger.ts              # Logger 类（集成 trace-context）
```

### 2.3 RequestId 传播流程

```
┌─────────────┐  requestId (生成) ┌─────────────┐
│    TUI      │ ─────────────────► │   Server    │
│  (Client)   │  Header:          │  (Backend)  │
│             │  X-Request-Id     │             │
└─────────────┘                    └─────────────┘
        │                                  │
        │ fetch()                          │ 中间件/Hono 拦截
        │ 自动注入                         │ 获取 Header
        ▼                                  ▼
┌─────────────────────┐   ┌─────────────────────┐
│ api-client.ts       │   │ runWithContext()    │
│ 生成 requestId      │   │ 注入 AsyncLocalStorage │
└─────────────────────┘   └─────────────────────┘
                                    │
                                    ▼
                            ┌─────────────────────┐
                            │ 所有业务代码 logger  │
                            │ 自动带 requestId     │
                            └─────────────────────┘
```

---

## 3. 接口设计

### 3.1 ITraceContext 接口

```typescript
// packages/core/src/utils/trace-context.ts

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface ITraceContext {
  /** 获取当前请求的 requestId */
  getRequestId(): string | undefined;
  
  /** 获取当前 Span 上下文（OTel 升级用） */
  getSpanContext(): SpanContext | undefined;
  
  /** 同步函数在追踪上下文中执行 */
  runWithContext<T>(fn: () => T): T;
  
  /** 异步函数在追踪上下文中执行 */
  runWithContextAsync<T>(fn: () => Promise<T>): Promise<T>;
  
  /** 生成新的 requestId */
  generateRequestId(): string;
  
  /** 创建新的追踪上下文（请求入口使用） */
  startNewContext(requestId: string, sessionId?: string): () => void;
}

/** 获取当前追踪上下文实例 */
export function getTraceContext(): ITraceContext;

/** 设置追踪上下文实现（用于测试/替换实现） */
export function setTraceContext(impl: ITraceContext): void;

/** 初始化追踪上下文 */
export function initTraceContext(options?: { impl?: "lightweight" | "opentelemetry" }): ITraceContext;
```

### 3.2 Logger 增强

```typescript
// packages/core/src/utils/logger.ts 扩展

class Logger {
  // ... 现有方法

  private formatMessage(
    level: LogLevel, 
    message: string, 
    data?: unknown,
    callerLocation?: { file: string; line: number }
  ): string {
    const timestamp = new Date().toISOString();
    const requestId = getTraceContext().getRequestId();
    const requestIdStr = requestId ? `[requestId=${requestId}]` : "";
    const locationStr = callerLocation ? `[${callerLocation.file}:${callerLocation.line}]` : "";
    // ... 组合输出
  }

  // 调用时自动获取源码位置
  private getCallerLocation(): { file: string; line: number } | null {
    // 使用 Error.stackTraceLimit 获取调用栈
  }
}
```

---

## 4. 实现方案

### 4.1 LightweightImpl（当前）

使用 Node.js 内置 `AsyncLocalStorage` 实现请求级别上下文隔离：

```typescript
class LightweightTraceContext implements ITraceContext {
  private storage = new AsyncLocalStorage<{
    requestId: string;
    sessionId?: string;
    timestamp: number;
  }>();

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  runWithContext<T>(fn: () => T): T {
    const store = this.storage.getStore();
    if (store) {
      return this.storage.run(store, fn);
    }
    return fn();
  }

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  startNewContext(requestId: string, sessionId?: string): () => void {
    this.storage.enterWith({ requestId, sessionId, timestamp: Date.now() });
    return () => { /* 恢复上下文 */ };
  }
}
```

### 4.2 TUI 端 API Client

```typescript
// packages/core/src/cli/tui/utils/api-client.ts

import { getTraceContext } from "../../../utils/trace-context";

function createApiClient(baseUrl: string) {
  const trace = getTraceContext();
  
  const apiCall = async (endpoint: string, options?: RequestInit): Promise<Response> => {
    const requestId = trace.generateRequestId();
    
    return fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options?.headers,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
    });
  };
  
  return { apiCall };
}
```

### 4.3 Server 端中间件

```typescript
// packages/core/src/server/index.ts (Hono 中间件)

import { getTraceContext } from "../../utils/trace-context";

app.use("*", async (c, next) => {
  const trace = getTraceContext();
  const requestId = c.req.header("X-Request-Id") || trace.generateRequestId();
  const sessionId = c.req.header("X-Session-Id");
  
  trace.runWithContext(() => {
    c.set("requestId", requestId);
    c.set("sessionId", sessionId);
    return next();
  });
});
```

---

## 5. 日志输出格式

### 5.1 完整格式

```
2026-02-28T10:30:45.123Z [INFO] [requestId=req_123456_abc123def] [command.tsx:84] [CommandContext] Refreshing commands from server {"count": 5}
2026-02-28T10:30:45.456Z [INFO] [requestId=req_123456_abc123def] [sessions.ts:170] Received prompt request {"sessionId": "abc", "contentLength": 100}
2026-02-28T10:30:46.789Z [ERROR] [requestId=req_123456_abc123def] [sessions.ts:180] Failed to process {"error": "timeout"}
```

### 5.2 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| timestamp | ISO 8601 格式时间 | `2026-02-28T10:30:45.123Z` |
| level | 日志级别 | `INFO`, `WARN`, `ERROR` |
| requestId | 请求追踪 ID | `req_123456_abc123def` |
| location | 源码位置 | `command.tsx:84` |
| module | 模块名 | `[CommandContext]` |
| message | 日志消息 | `Refreshing commands from server` |
| data | 附加数据 | `{"count": 5}` |

---

## 6. 后续 OTel 升级路径

### 6.1 升级步骤

1. 安装依赖：`npm install @opentelemetry/sdk-node @opentelemetry/api`
2. 创建 `trace-context-otel.ts` 实现 `ITraceContext`
3. 替换初始化：`initTraceContext({ impl: "opentelemetry" })`

### 6.2 OTel 实现示意

```typescript
// packages/core/src/utils/trace-context-otel.ts

import { trace, context as otelContext } from "@opentelemetry/api";

class OpenTelemetryTraceContext implements ITraceContext {
  private tracer = trace.getTracer("agent-core");
  
  getRequestId(): string | undefined {
    const span = trace.getSpan(otelContext.active());
    return span?.spanContext().traceId;
  }

  runWithContext<T>(fn: () => T): T {
    return otelContext.with(otelContext.active(), fn);
  }

  // ... 其他方法
}
```

---

## 7. 实施计划

| 阶段 | 任务 | 文件 |
|------|------|------|
| **Phase 1** | 创建 `trace-context.ts` 接口 + LightweightImpl | `utils/trace-context.ts` |
| **Phase 1** | 改造 Logger 集成 requestId 注入 | `utils/logger.ts` |
| **Phase 2** | 统一 TUI fetch 封装 | `cli/tui/utils/api-client.ts` |
| **Phase 2** | Server 中间件注入 Context | `server/index.ts` |
| **Phase 3** | (可选) 源码位置注入 | `utils/logger.ts` |
| **Future** | OTel 升级 | `utils/trace-context-otel.ts` |

---

## 8. 配置项

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOG_TO_FILE` | 是否写入文件 | `true` |
| `TRACE_IMPL` | 追踪实现 | `lightweight` |
| `XDG_DATA_HOME` | 日志目录 | `~/.local/share` |
