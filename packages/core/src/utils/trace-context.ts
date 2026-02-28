/**
 * @fileoverview Trace Context 接口定义
 * 
 * 提供请求追踪的抽象接口，支持多种实现：
 * - LightweightImpl: 轻量级实现（默认，使用 async_hooks）
 * - OpenTelemetryImpl: 未来接入 OpenTelemetry
 */

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface TraceContextOptions {
  /** 追踪器实现类型 */
  impl?: "lightweight" | "opentelemetry";
}

export interface ITraceContext {
  /** 获取当前请求的 requestId */
  getRequestId(): string | undefined;
  
  /** 获取当前 Span 上下文 */
  getSpanContext(): SpanContext | undefined;
  
  /** 在已存在的追踪上下文中执行函数 */
  runWithContext<T>(fn: () => T): T;
  
  /** 在新追踪上下文中执行函数（同步） */
  runWithNewContext<T>(requestId: string, sessionId: string | undefined, fn: () => T): T;
  
  /** 在已存在的追踪上下文中执行异步函数 */
  runWithContextAsync<T>(fn: () => Promise<T>): Promise<T>;
  
  /** 在新追踪上下文中执行函数（异步） */
  runWithNewContextAsync<T>(requestId: string, sessionId: string | undefined, fn: () => Promise<T>): Promise<T>;
  
  /** 生成新的 requestId */
  generateRequestId(): string;
  
  /** 初始化追踪上下文（请求入口调用） */
  initContext(requestId: string, sessionId?: string): void;

  /** 创建并进入新的追踪上下文（请求入口使用，返回清理函数） */
  startNewContext(requestId: string, sessionId?: string): () => void;
}

let traceContextImpl: ITraceContext | null = null;

export function getTraceContext(): ITraceContext {
  if (!traceContextImpl) {
    traceContextImpl = createLightweightContext();
  }
  return traceContextImpl;
}

export function setTraceContext(impl: ITraceContext): void {
  traceContextImpl = impl;
}

export function initTraceContext(options?: TraceContextOptions): ITraceContext {
  if (options?.impl === "opentelemetry") {
    traceContextImpl = createOpenTelemetryContext();
  } else {
    traceContextImpl = createLightweightContext();
  }
  return traceContextImpl;
}

function createLightweightContext(): ITraceContext {
  return new LightweightTraceContext();
}

function createOpenTelemetryContext(): ITraceContext {
  // 未来实现：return new OpenTelemetryTraceContext();
  console.warn("[TraceContext] OpenTelemetry implementation not yet available, using lightweight");
  return new LightweightTraceContext();
}

// ============================================================================
// Lightweight Implementation (默认)
// ============================================================================

import { AsyncLocalStorage } from "async_hooks";

interface RequestContextData {
  requestId: string;
  sessionId?: string;
  timestamp: number;
  spanContext?: SpanContext;
}

const contextStore = new AsyncLocalStorage<RequestContextData>();

class LightweightTraceContext implements ITraceContext {
  getRequestId(): string | undefined {
    return contextStore.getStore()?.requestId;
  }

  getSpanContext(): SpanContext | undefined {
    return contextStore.getStore()?.spanContext;
  }

  runWithContext<T>(fn: () => T): T {
    const store = contextStore.getStore();
    if (store) {
      return contextStore.run(store, fn);
    }
    return fn();
  }

  runWithNewContext<T>(requestId: string, sessionId: string | undefined, fn: () => T): T {
    const context: RequestContextData = {
      requestId,
      sessionId,
      timestamp: Date.now(),
    };
    return contextStore.run(context, fn);
  }

  async runWithContextAsync<T>(fn: () => Promise<T>): Promise<T> {
    const store = contextStore.getStore();
    if (store) {
      return contextStore.run(store, fn);
    }
    return fn();
  }

  async runWithNewContextAsync<T>(requestId: string, sessionId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const context: RequestContextData = {
      requestId,
      sessionId,
      timestamp: Date.now(),
    };
    return contextStore.run(context, fn);
  }

  generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  initContext(requestId: string, sessionId?: string): void {
    const context: RequestContextData = {
      requestId,
      sessionId,
      timestamp: Date.now(),
    };
    contextStore.enterWith(context);
  }

  /** 创建并进入新的追踪上下文（请求入口使用，返回清理函数） */
  startNewContext(requestId: string, sessionId?: string): () => void {
    const context: RequestContextData = {
      requestId,
      sessionId,
      timestamp: Date.now(),
    };
    const previousStore = contextStore.getStore();
    contextStore.enterWith(context);
    return () => {
      if (previousStore) {
        contextStore.enterWith(previousStore);
      }
    };
  }
}
