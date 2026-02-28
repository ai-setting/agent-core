# SpanCollector 设计文档

## 1. 背景与目标

### 1.1 现状

当前项目已有 `trace-context.ts`，基于 `AsyncLocalStorage` 提供请求上下文传递能力：

- **已有能力**：在异步调用链中传递 `requestId` / `sessionId`
- **缺失部分**：
  - 无 `Span` 数据结构
  - 无父子 span 关系
  - 无调用树构建能力
  - 无法供 Agent 查询运行时轨迹

### 1.2 目标

1. **扩展 trace-context**：新增 Span 数据结构与 SpanCollector
2. **抽象存储层**：定义 `SpanStorage` 接口，支持多种存储实现
3. **Phase 1 实现**：SQLite 持久化存储 + 可视化读取 + 装饰器
4. **自动追踪**：提供 `wrapFunction()` + 装饰器自动创建/结束 span
5. **可视化**：提供命令行/API 查看 span 轨迹
6. **可扩展**：后续可对接远程 trace 服务

---

## 2. 核心概念

### 2.1 术语定义

| 术语 | 定义 |
|------|------|
| **Trace** | 一次完整请求的调用链，用 `traceId` 标识 |
| **Span** | 一次函数调用的最小单元，包含入参、返回值、耗时等 |
| **SpanContext** | Span 的元数据（traceId, spanId, parentSpanId） |
| **SpanStorage** | 存储抽象层，负责 span 的持久化 |
| **SpanCollector** | 收集器，协调 span 创建/结束与存储 |

### 2.2 关系图

```
traceId = "req_123" (一次请求)
│
├─ Span A (spanId: "s1", parentSpanId: null)  ← 根 span
│   │
│   ├─ Span B (spanId: "s2", parentSpanId: "s1")
│   │   │
│   │   └─ Span D (spanId: "s4", parentSpanId: "s2")
│   │
│   └─ Span C (spanId: "s3", parentSpanId: "s1")
```

### 2.3 日志 vs 追踪

| 维度 | 日志 (Logging) | 追踪 (Tracing) |
|------|----------------|----------------|
| 粒度 | 离散事件 | 完整调用链 |
| 串联方式 | requestId（人工串联） | parentSpanId（自动构建树） |
| 用途 | 排查问题 | 理解系统行为、Agent 轨迹分析 |

---

## 3. 接口设计

### 3.1 Span 数据结构

```typescript
// 文件: packages/core/src/utils/span.ts

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  // 上下文
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  
  // 语义信息
  name: string;                    // span 名称，如 "tool:read_file"
  kind: SpanKind;                  // CLIENT / SERVER
  status: SpanStatus;              // OK / ERROR
  
  // 时间
  startTime: number;               // Unix timestamp (ms)
  endTime?: number;
  
  // 数据
  attributes: SpanAttributes;      // 入参、额外信息
  result?: unknown;                // 返回值（可选，避免大对象）
  error?: string;                  // 错误信息
  
  // 树结构
  children?: Span[];               // 子 span
}

export enum SpanKind {
  CLIENT = "client",
  SERVER = "server",
  INTERNAL = "internal",
}

export enum SpanStatus {
  OK = "ok",
  ERROR = "error",
}
```

### 3.2 SpanStorage 存储抽象

```typescript
// 文件: packages/core/src/utils/span-storage.ts

import { Span } from "./span.js";

export interface SpanStorage {
  /**
   * 初始化存储
   */
  initialize(): Promise<void>;
  
  /**
   * 保存 span
   */
  save(span: Span): void;
  
  /**
   * 批量保存 span（提高性能）
   */
  saveBatch(spans: Span[]): void;
  
  /**
   * 根据 traceId 查询所有 span
   */
  findByTraceId(traceId: string): Span[];
  
  /**
   * 列出最近的 trace（用于可视化选择）
   */
  listTraces(limit?: number): TraceInfo[];
  
  /**
   * 根据 traceId 删除 span（清理）
   */
  deleteByTraceId(traceId: string): void;
  
  /**
   * 关闭连接
   */
  close(): void;
}

/**
 * Trace 摘要信息（用于列表展示）
 */
export interface TraceInfo {
  traceId: string;
  rootSpanName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  spanCount: number;
  status: "ok" | "error" | "mixed";
}
```

### 3.3 ISpanCollector 接口

```typescript
// 文件: packages/core/src/utils/span-collector.ts

import { Span, SpanContext, SpanAttributes } from "./span.js";
import { SpanStorage, TraceInfo } from "./span-storage.js";

export interface ISpanCollector {
  /**
   * 启动一个 span
   */
  startSpan(name: string, attributes?: SpanAttributes): SpanContext;
  
  /**
   * 结束一个 span
   */
  endSpan(context: SpanContext, result?: unknown, error?: Error): void;
  
  /**
   * 获取当前活跃的 span 上下文
   */
  getCurrentContext(): SpanContext | undefined;
  
  /**
   * 根据 traceId 获取完整调用树
   */
  getTrace(traceId: string): Span[];
  
  /**
   * 获取当前请求的完整调用树
   */
  getCurrentTrace(): Span[];
  
  /**
   * 列出最近的 trace（可视化用）
   */
  listTraces(limit?: number): TraceInfo[];
  
  /**
   * 清空指定 trace 的数据
   */
  clearTrace(traceId: string): void;
  
  /**
   * 导出指定 trace 为 JSON（供 Agent 分析）
   */
  exportTrace(traceId: string): string;
  
  /**
   * 导出为可视化格式（人类可读）
   */
  formatTrace(traceId: string): string;
}
```

---

## 4. 装饰器实现

### 4.1 装饰器设计

支持两种使用方式：
1. **`@Traced`** - 类方法装饰器，最常用
2. **`wrapFunction()`** - 函数包装，更灵活

### 4.2 装饰器实现

```typescript
// 文件: packages/core/src/utils/wrap-function.ts

import { getSpanCollector, ISpanCollector } from "./span-collector.js";

export interface TracedOptions {
  /** span 名称，默认使用方法名 */
  name?: string;
  /** 是否记录入参，默认 true */
  recordParams?: boolean;
  /** 是否记录返回值，默认 false（避免大对象） */
  recordResult?: boolean;
  /** 是否记录错误，默认 true */
  recordError?: boolean;
  /** 是否打印 enter/quit/error 日志到 server.log，默认 false */
  log?: boolean;
  
  /** 
   * 日志和 trace 中参数/结果的最大截取长度，默认 500 字符
   * 同时限制：
   * - span.attributes.params 的大小
   * - span.result 的大小
   * - 日志打印的内容大小
   */
  maxLogSize?: number;
}

/**
 * 类方法装饰器：自动追踪方法调用
 * 
 * @param options 配置选项
 * 
 * @example
 * ```typescript
 * class FileService {
 *   @Traced()
 *   async readFile(path: string): Promise<string> {
 *     // ...
 *   }
 *   
 *   // 记录返回值，并打印日志
 *   @Traced({ recordResult: true, log: true })
 *   async processData(data: any): Promise<any> {
 *     // ...
 *   }
 *   
 *   // 打印日志，参数最多显示 200 字符
 *   @Traced({ log: true, maxLogSize: 200 })
 *   async search(query: string): Promise<any> {
 *     // ...
 *   }
 * }
 * ```
 * 
 * ## 异常处理
 * 
 * 装饰器会自动处理同步和异步异常：
 * - **同步异常**：在 try-catch 中捕获，记录 error 到 span 状态为 ERROR，记录错误信息到 span.error
 * - **异步异常**：在 Promise.catch 中捕获，同样记录 error
 * - **日志输出**：异常时打印 `[TRACE] !!! <name> error: <error_message>`
 * - **异常重抛**：异常会被重新抛出，不影响原有逻辑
 * 
 * @example
 * ```typescript
 * class Service {
 *   @Traced({ log: true })
 *   async mayFail(): Promise<string> {
 *     if (Math.random() > 0.5) {
 *       throw new Error("random error");
 *     }
 *     return "success";
 *   }
 * }
 * 
 * // 调用时：
 * try {
 *   await service.mayFail();
 * } catch (e) {
 *   // 异常被记录到 span，状态为 error
 *   // 日志输出：[TRACE] !!! Service.mayFail error: random error
 *   // 异常被重新抛出
 * }
 * ```
 */
export function Traced(options?: TracedOptions) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalFn = descriptor.value!;
    const spanName = options?.name || propertyKey;
    
    descriptor.value = wrapFunction(originalFn, spanName, {
      recordParams: options?.recordParams ?? true,
      recordResult: options?.recordResult ?? false,
      recordError: options?.recordError ?? true,
      log: options?.log ?? false,
      maxLogSize: options?.maxLogSize ?? 500,
    }) as T;
    
    return descriptor;
  };
}

/**
 * 装饰器工厂：使用指定的 span 名称
 * 
 * @example
 * ```typescript
 * class Agent {
 *   @TracedAs("agent.run", { log: true })
 *   async run(prompt: string) { ... }
 * }
 * ```
 */
export function TracedAs(name: string, options?: Omit<TracedOptions, "name">) {
  return Traced({ name, ...options });
}

/**
 * 装饰器工厂：仅记录错误，不记录参数和返回值（轻量级）
 * 但默认开启日志
 * 
 * @example
 * ```typescript
 * class Tool {
 *   @TracedLightweight({ log: true })
 *   execute() { ... }
 * }
 * ```
 */
export function TracedLightweight(options?: { log?: boolean; maxLogSize?: number }) {
  return Traced({ recordParams: false, recordResult: false, log: options?.log ?? false, maxLogSize: options?.maxLogSize });
}

/**
 * wrapFunction: 函数包装器
 * 
 * @param fn 要包装的函数
 * @param name span 名称
 * @param options 配置选项
 * 
 * @example
 * ```typescript
 * // 包装普通函数
 * const tracedRead = wrapFunction(readFile, "fs.read", { recordParams: true });
 * 
 * // 包装异步函数，记录返回值
 * const tracedFetch = wrapFunction(fetch, "http.fetch", { recordResult: true });
 * 
 * // 包装类方法，开启日志
 * class MyService {
 *   constructor() {
 *     this.method = wrapFunction(this.method.bind(this), "method", { log: true });
 *   }
 * }
 * 
 * // 开启日志，限制输出大小
 * const tracedSearch = wrapFunction(search, "search", { log: true, maxLogSize: 200 });
 * ```
 * 
 * ## 异常处理
 * 
 * 自动处理同步和异步异常：
 * - 同步异常：在 try-catch 中捕获，记录到 span.error，标记 status 为 ERROR
 * - 异步异常：在 Promise.catch 中捕获，同样记录 error
 * - 异常会被重新抛出，不影响原有逻辑
 * - 开启日志时，异常会打印 `[TRACE] !!! <name> error: <message>`
 */
export function wrapFunction<T extends (...args: any[]) => any>(
  fn: T,
  name: string,
  options?: {
    recordParams?: boolean;
    recordResult?: boolean;
    recordError?: boolean;
    log?: boolean;
    maxLogSize?: number;
  }
): T {
  const collector = getSpanCollector();
  const shouldLog = options?.log ?? false;
  const maxLogSize = options?.maxLogSize ?? 500;
  
  // 截取数据辅助函数（同时用于日志和 trace）
  const truncate = (obj: any): any => {
    if (obj === undefined) return undefined;
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    if (str.length > maxLogSize) {
      return str.slice(0, maxLogSize) + " [TRUNCATED]";
    }
    // 返回解析后的对象以便在 trace 中使用
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };
  
  // 截取字符串辅助函数（用于日志打印）
  const truncateString = (obj: any): string => {
    if (obj === undefined) return "";
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    return str.length > maxLogSize ? str.slice(0, maxLogSize) + " [TRUNCATED]" : str;
  };
  
  // 日志标签，方便 Agent 识别串联日志
  const TRACE_LOG_PREFIX = "[TRACE]";
  
  // 日志打印辅助函数
  const logFn = (event: "enter" | "quit" | "error", data?: any) => {
    if (!shouldLog) return;
    const logger = createLogger("traced:" + name, "server.log");
    
    const tag = event === "enter" ? ">>>" : event === "quit" ? "<<<" : "!!!";
    const prefix = `${TRACE_LOG_PREFIX} ${tag} ${name}`;
    
    if (data !== undefined) {
      logger.info(`${prefix} ${event}: ${truncateString(data)}`);
    } else {
      logger.info(`${prefix} ${event}`);
    }
  };
  
  if (!collector) {
    return fn;
  }
  
  return ((...args: any[]) => {
    const attributes: Record<string, any> = {};
    
    if (options?.recordParams !== false) {
      // 截取参数，限制 trace 中的大小
      attributes["params"] = truncate(args);
    }
    
    // 打印 enter 日志
    logFn("enter", args);
    
    const context = collector.startSpan(name, attributes);
    
    try {
      const result = fn(...args);
      
      if (result instanceof Promise) {
        return result.then((resolved) => {
          // 截取结果，限制 trace 中的大小
          collector.endSpan(context, options?.recordResult ? truncate(resolved) : undefined);
          // 打印 quit 日志
          logFn("quit", options?.recordResult ? resolved : undefined);
          return resolved;
        }).catch((error) => {
          collector.endSpan(context, undefined, error as Error);
          // 打印 error 日志
          logFn("error", (error as Error).message);
          throw error;
        });
      }
      
      // 截取结果，限制 trace 中的大小
      collector.endSpan(context, options?.recordResult ? truncate(result) : undefined);
      // 打印 quit 日志
      logFn("quit", options?.recordResult ? result : undefined);
      return result;
      
    } catch (error) {
      collector.endSpan(context, undefined, error as Error);
      // 打印 error 日志
      logFn("error", (error as Error).message);
      throw error;
    }
  }) as T;
}
```

### 4.3 使用示例

#### 示例 1：装饰器方式（推荐）

```typescript
// 文件: example/file-service.ts

import { Traced, TracedAs, TracedLightweight } from "../utils/wrap-function.js";

class FileService {
  @Traced()  // 自动使用方法名 "readFile"
  async readFile(path: string): Promise<string> {
    const content = await Bun.file(path).text();
    return content;
  }
  
  @Traced({ recordResult: true })  // 记录返回值
  async writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }
  
  @TracedAs("file.copy")  // 自定义名称
  async copyFile(src: string, dest: string): Promise<void> {
    await Bun.copy(src, dest);
  }
  
  @TracedLightweight()  // 轻量级追踪
  async exists(path: string): Promise<boolean> {
    return await Bun.file(path).exists();
  }
  
  // 开启日志记录，自动打印 enter/quit 到 server.log
  @Traced({ log: true })
  async processWithLog(path: string): Promise<string> {
    return await Bun.file(path).text();
  }
  
  // 开启日志，限制输出大小为 200 字符
  @Traced({ log: true, maxLogSize: 200 })
  async searchWithLog(query: string): Promise<any> {
    return { results: [] };
  }
}

// 使用
const service = new FileService();
const content = await service.readFile("/tmp/test.txt");
// 自动记录: span "fileService.readFile" enter with params ["/tmp/test.txt"]
// 退出时记录: span "fileService.readFile" quit with result "..."
// 如果开启 log，还会输出到 server.log（带特殊标签方便 Agent 识别串联关系）:
// [TRACE] >>> fileService.readFile enter: ["/tmp/test.txt"]
// [TRACE] <<< fileService.readFile quit: "file content..."
// 如果出错:
// [TRACE] !!! fileService.readFile error: "some error"
```

#### 示例 2：函数包装方式

```typescript
// 文件: example/tools.ts

import { wrapFunction } from "../utils/wrap-function.js";

// 包装工具函数
export const tracedReadFile = wrapFunction(
  async (path: string) => {
    return await Bun.file(path).text();
  },
  "tool:read_file",
  { recordParams: true, recordResult: false }
);

export const tracedBash = wrapFunction(
  async (cmd: string) => {
    return await Bun.spawn(["sh", "-c", cmd]).text();
  },
  "tool:bash",
  { recordParams: true }
);
```

#### 示例 3：在 Agent 中使用

```typescript
// 文件: example/agent-usage.ts

import { getSpanCollector } from "../utils/span-collector.js";

class Agent {
  async run(prompt: string) {
    // 获取当前 trace
    const collector = getSpanCollector();
    const trace = collector.getCurrentTrace();
    
    // 转换为自然语言描述
    const description = collector.formatTrace(collector.getCurrentContext()?.traceId!);
    console.log("Current trace:\n", description);
    
    // 或者获取 JSON 供 Agent 分析
    const json = collector.exportTrace(collector.getCurrentContext()?.traceId!);
    
    return { trace: json, description };
  }
}
```

---

## 5. Phase 1 实现：SQLiteStorage + 可视化

### 5.1 设计参考

参考 `session` 模块的 `SqlitePersistence` 实现：
- 使用 `bun:sqlite`
- 通过 `ConfigPaths` 配置存储路径
- 使用 WAL 模式提升并发性能

### 5.2 配置设计

在 `ConfigPaths` 中新增 `traces` 路径：

```typescript
// packages/core/src/config/paths.ts
class ConfigPathsClass {
  // ...  get traces() {现有字段
  return getPaths().traces; }
 配置：

```typescript}
```

SpanCollector
// packages/core/src/config/trace-config.ts

export interface TraceConfig {
存储路径，默认使用  /** span  ConfigPaths.traces?: string;
  
 */
  storagePath  /** 是否启用追踪，默认 true */
  enabled?: boolean;
  
  /** 是否记录返回值，默认 false（避免大对象） */
  recordResult?: boolean;
  
  /** 是否记录参数，默认 true */
  recordParams?: boolean;
}
```

### 5.3 SQLiteStorage 实现（支持可视化查询）

```typescript
// 文件: packages/core/src/utils/span-storage.ts

import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { Span, SpanKind, SpanStatus } from "./span.js";
import { SpanStorage, TraceInfo } from "./span-storage.js";
import { ConfigPaths } from "../config/paths.js";
import { createLogger } from "./logger.js";

const traceLogger = createLogger("trace:sqlite", "server.log");

export class SQLiteSpanStorage implements SpanStorage {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;
  
  // 内存缓存
  private cache = new Map<string, Span[]>();
  private spanMap = new Map<string, Span>();
  
  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(ConfigPaths.traces, "spans.db");
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    this.db = new Database(this.dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    await this.migrate();
    this.initialized = true;
    traceLogger.info(`SQLite span storage initialized at ${this.dbPath}`);
  }
  
  private async migrate(): Promise<void> {
    if (!this.db) return;
    
    this.db.run(`
      CREATE TABLE IF NOT EXISTS span (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        attributes TEXT,
        result TEXT,
        error TEXT,
        time_created INTEGER NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_trace ON span(trace_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_parent ON span(parent_span_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_start_time ON span(start_time DESC)`);
  }
  
  save(span: Span): void {
    if (!this.cache.has(span.traceId)) {
      this.cache.set(span.traceId, []);
    }
    this.cache.get(span.traceId)!.push(span);
    this.spanMap.set(span.spanId, span);
    this.persistSpan(span);
  }
  
  saveBatch(spans: Span[]): void {
    if (!this.db || spans.length === 0) return;
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO span 
      (span_id, trace_id, parent_span_id, name, kind, status, start_time, end_time, attributes, result, error, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((spans: Span[]) => {
      for (const span of spans) {
        stmt.run(
          span.spanId,
          span.traceId,
          span.parentSpanId ?? null,
          span.name,
          span.kind,
          span.status,
          span.startTime,
          span.endTime ?? null,
          JSON.stringify(span.attributes),
          span.result !== undefined ? JSON.stringify(span.result) : null,
          span.error ?? null,
          Date.now()
        );
      }
    });
    
    insertMany(spans);
  }
  
  private persistSpan(span: Span): void {
    this.saveBatch([span]);
  }
  
  findByTraceId(traceId: string): Span[] {
    const cached = this.cache.get(traceId);
    if (cached && cached.length > 0) {
      return this.buildTree(cached);
    }
    
    if (!this.db) return [];
    
    const stmt = this.db.prepare("SELECT * FROM span WHERE trace_id = ? ORDER BY start_time");
    const rows = stmt.all(traceId) as any[];
    
    const spans = rows.map(row => this.rowToSpan(row));
    return this.buildTree(spans);
  }
  
  listTraces(limit: number = 10): TraceInfo[] {
    if (!this.db) return [];
    
    // 查询每个 trace 的摘要信息
    const stmt = this.db.prepare(`
      SELECT 
        trace_id,
        MIN(start_time) as start_time,
        MAX(end_time) as end_time,
        COUNT(*) as span_count,
        GROUP_CONCAT(DISTINCT status) as statuses,
        (SELECT name FROM span WHERE trace_id = spans.trace_id AND parent_span_id IS NULL LIMIT 1) as root_name
      FROM span as spans
      GROUP BY trace_id
      ORDER BY start_time DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(limit) as any[];
    
    return rows.map(row => {
      const statuses = row.statuses?.split(",") || [];
      let status: "ok" | "error" | "mixed" = "ok";
      if (statuses.includes("error")) {
        status = statuses.length > 1 ? "mixed" : "error";
      }
      
      return {
        traceId: row.trace_id,
        rootSpanName: row.root_name || "unknown",
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.end_time ? row.end_time - row.start_time : undefined,
        spanCount: row.span_count,
        status,
      };
    });
  }
  
  deleteByTraceId(traceId: string): void {
    const spans = this.cache.get(traceId) || [];
    for (const span of spans) {
      this.spanMap.delete(span.spanId);
    }
    this.cache.delete(traceId);
    
    if (this.db) {
      this.db.prepare("DELETE FROM span WHERE trace_id = ?").run(traceId);
    }
  }
  
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
  
  private rowToSpan(row: any): Span {
    return {
      spanId: row.span_id,
      traceId: row.trace_id,
      parentSpanId: row.parent_span_id,
      name: row.name,
      kind: row.kind as SpanKind,
      status: row.status as SpanStatus,
      startTime: row.start_time,
      endTime: row.end_time,
      attributes: JSON.parse(row.attributes || "{}"),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
    };
  }
  
  private buildTree(spans: Span[]): Span[] {
    const spanMap = new Map<string, Span>();
    const roots: Span[] = [];
    
    for (const span of spans) {
      spanMap.set(span.spanId, { ...span, children: [] });
    }
    
    for (const span of spanMap.values()) {
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children!.push(span);
        } else {
          roots.push(span);
        }
      } else {
        roots.push(span);
      }
    }
    
    return roots;
  }
}
```

### 5.4 SpanCollector 实现（带可视化格式化）

```typescript
// 文件: packages/core/src/utils/span-collector.ts

import { Span, SpanContext, SpanAttributes, SpanKind, SpanStatus } from "./span.js";
import { SpanStorage, SQLiteSpanStorage, TraceInfo } from "./span-storage.js";
import { ISpanCollector } from "./span-collector.js";
import { getTraceContext } from "./trace-context.js";
import chalk from "chalk";

export class SpanCollector implements ISpanCollector {
  private storage: SpanStorage;
  private currentContext: SpanContext | undefined;
  private activeSpans = new Map<string, Span>();
  
  constructor(storage?: SpanStorage) {
    this.storage = storage || new SQLiteSpanStorage();
  }
  
  async initialize(): Promise<void> {
    await this.storage.initialize();
  }
  
  startSpan(name: string, attributes?: SpanAttributes): SpanContext {
    const traceCtx = getTraceContext();
    const traceId = traceCtx?.getRequestId() || this.generateTraceId();
    const spanId = this.generateSpanId();
    
    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId: this.currentContext?.spanId,
    };
    
    const span: Span = {
      traceId,
      spanId,
      parentSpanId: context.parentSpanId,
      name,
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: Date.now(),
      attributes: attributes || {},
      children: [],
    };
    
    if (context.parentSpanId) {
      const parentSpan = this.activeSpans.get(context.parentSpanId);
      if (parentSpan) {
        parentSpan.children!.push(span);
      }
    }
    
    this.activeSpans.set(spanId, span);
    this.currentContext = context;
    this.storage.save(span);
    
    return context;
  }
  
  endSpan(context: SpanContext, result?: unknown, error?: Error): void {
    const span = this.activeSpans.get(context.spanId);
    if (!span) return;
    
    span.endTime = Date.now();
    span.status = error ? SpanStatus.ERROR : SpanStatus.OK;
    
    if (result !== undefined) {
      span.result = result;
    }
    if (error) {
      span.error = error.message;
    }
    
    this.storage.save(span);
    
    if (context.parentSpanId) {
      const parentSpan = this.activeSpans.get(context.parentSpanId);
      this.currentContext = parentSpan ? {
        traceId: context.traceId,
        spanId: context.parentSpanId,
        parentSpanId: parentSpan.parentSpanId,
      } : undefined;
    } else {
      this.currentContext = undefined;
    }
  }
  
  getCurrentContext(): SpanContext | undefined {
    return this.currentContext;
  }
  
  getTrace(traceId: string): Span[] {
    return this.storage.findByTraceId(traceId);
  }
  
  getCurrentTrace(): Span[] {
    if (!this.currentContext) return [];
    return this.getTrace(this.currentContext.traceId);
  }
  
  listTraces(limit?: number): TraceInfo[] {
    return this.storage.listTraces(limit);
  }
  
  clearTrace(traceId: string): void {
    for (const [spanId, span] of this.activeSpans) {
      if (span.traceId === traceId) {
        this.activeSpans.delete(spanId);
      }
    }
    this.storage.deleteByTraceId(traceId);
  }
  
  exportTrace(traceId: string): string {
    const spans = this.getTrace(traceId);
    return JSON.stringify(spans, null, 2);
  }
  
  /**
   * 格式化 trace 为人类可读的形式
   */
  formatTrace(traceId: string): string {
    const spans = this.getTrace(traceId);
    if (spans.length === 0) {
      return "No trace found";
    }
    
    const lines: string[] = [];
    lines.push(chalk.bold(`\nTrace: ${traceId}\n`));
    
    const formatSpan = (span: Span, indent: string = "") => {
      const duration = span.endTime ? span.endTime - span.startTime : 0;
      const statusIcon = span.status === SpanStatus.OK ? chalk.green("✓") : chalk.red("✗");
      const durationStr = chalk.gray(`${duration}ms`);
      
      let line = `${indent}${statusIcon} ${span.name} ${durationStr}`;
      if (span.error) {
        line += chalk.red(` - ${span.error}`);
      }
      lines.push(line);
      
      if (span.children) {
        for (const child of span.children) {
          formatSpan(child, indent + "  ");
        }
      }
    };
    
    for (const span of spans) {
      formatSpan(span);
    }
    
    return lines.join("\n");
  }
  
  /**
   * 格式化 trace 为简洁表格形式（适合终端）
   */
  formatTraceTable(traceId: string): string {
    const traces = this.listTraces(100);
    if (traces.length === 0) {
      return "No traces found";
    }
    
    const lines: string[] = [];
    lines.push(chalk.bold("\nRecent Traces:\n"));
    lines.push(chalk.gray("  Trace ID                    | Root Span          | Duration | Spans | Status"));
    lines.push(chalk.gray("  " + "-".repeat(80)));
    
    for (const trace of traces) {
      const traceIdShort = trace.traceId.slice(0, 26);
      const rootName = trace.rootSpanName.slice(0, 18);
      const duration = trace.duration ? `${trace.duration}ms` : "-";
      const spanCount = trace.spanCount.toString();
      const statusColor = trace.status === "ok" ? chalk.green : trace.status === "error" ? chalk.red : chalk.yellow;
      
      lines.push(`  ${traceIdShort.padEnd(26)} | ${rootName.padEnd(18)} | ${duration.padEnd(8)} | ${spanCount.padEnd(5)} | ${statusColor(trace.status)}`);
    }
    
    return lines.join("\n");
  }
  
  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
  
  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}
```

---

## 6. 全局单例与初始化

```typescript
// packages/core/src/utils/span-collector.ts

let collector: SpanCollector | null = null;

export function setSpanCollector(c: SpanCollector): void {
  collector = c;
}

export function getSpanCollector(): SpanCollector | null {
  return collector;
}

export async function initializeSpanCollector(config?: TraceConfig): Promise<void> {
  const storage = new SQLiteSpanStorage(config?.storagePath);
  collector = new SpanCollector(storage);
  await collector.initialize();
}
```

---

## 7. 可视化工具命令

### 7.1 命令行工具

```bash
# 查看最近 traces
agent-core trace list

# 查看指定 trace 的详细调用树
agent-core trace show <trace_id>

# 查看当前活跃的 trace
agent-core trace current

# 格式化输出（JSON）
agent-core trace json <trace_id>
```

### 7.2 输出示例

```
$ agent-core trace list

Recent Traces:

  Trace ID                    | Root Span          | Duration | Spans | Status
  --------------------------------------------------------------------------------
  trace_1234567890_abc123def  | agent.run          | 1523ms   | 5     | ok
  trace_1234567890_xyz789ghi  | tool:read_file     | 45ms     | 1     | ok
  trace_1234567890_qwerty123  | agent.run          | 890ms    | 3     | error
```

```
$ agent-core trace show trace_1234567890_abc123def

Trace: trace_1234567890_abc123def

✓ agent.run 1523ms
  ✓ tool:read_file 45ms
  ✓ llm.invoke 823ms
  ✓ tool:write_file 30ms
    ✓ fs.write 20ms
```

---

## 8. Agent 使用方式

### 8.1 Agent 查询运行时轨迹

```typescript
const collector = getSpanCollector();

// 获取当前 trace
const trace = collector.getCurrentTrace();

// 格式化输出
const description = collector.formatTrace(collector.getCurrentContext()?.traceId!);

// JSON 导出供 Agent 分析
const json = collector.exportTrace(traceId);
```

### 8.2 输出示例

```
Agent 视角的系统轨迹：
✓ agent.run (1500ms)
  ✓ tool:read_file (50ms)
  ✓ llm.invoke (800ms)
  ✓ tool:write_file (30ms)
    ✓ fs.write (20ms)
```

---

## 9. 文件结构

```
packages/core/src/utils/
├── trace-context.ts        # 现有，保持兼容
├── span.ts                 # 新增：Span 数据结构
├── span-storage.ts         # 新增：SpanStorage 接口 + SQLiteSpanStorage
├── span-collector.ts       # 新增：SpanCollector 实现 + 格式化输出
├── wrap-function.ts        # 新增：装饰器 + wrapFunction
└── index.ts                # 统一导出

packages/core/src/config/
├── paths.ts                # 新增：traces 路径
└── trace-config.ts         # 新增：TraceConfig 配置
```

---

## 10. 测试设计

### 10.1 测试文件结构

```
packages/core/src/utils/
├── span.test.ts               # Span 数据结构测试
├── span-storage.test.ts       # SpanStorage 接口测试
├── span-collector.test.ts     # SpanCollector 核心功能测试
├── wrap-function.test.ts      # 装饰器与 wrapFunction 测试
└── span-integration.test.ts    # 端到端集成测试
```

### 10.2 单元测试设计

#### 10.2.1 Span 数据结构测试

```typescript
// 文件: packages/core/src/utils/span.test.ts

import { describe, it, expect } from "bun:test";
import { Span, SpanKind, SpanStatus } from "./span";

describe("Span", () => {
  it("should create span with required fields", () => {
    const span: Span = {
      traceId: "trace_1",
      spanId: "span_1",
      name: "test",
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: Date.now(),
      attributes: {},
    };
    
    expect(span.traceId).toBe("trace_1");
    expect(span.name).toBe("test");
    expect(span.status).toBe(SpanStatus.OK);
  });
  
  it("should support optional fields", () => {
    const span: Span = {
      traceId: "trace_1",
      spanId: "span_1",
      parentSpanId: "span_0",
      name: "child",
      kind: SpanKind.CLIENT,
      status: SpanStatus.ERROR,
      startTime: Date.now(),
      endTime: Date.now() + 100,
      attributes: { key: "value" },
      result: { data: "result" },
      error: "some error",
    };
    
    expect(span.parentSpanId).toBe("span_0");
    expect(span.error).toBe("some error");
  });
});
```

#### 10.2.2 InMemorySpanStorage 测试

```typescript
// 文件: packages/core/src/utils/span-storage.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { InMemorySpanStorage } from "./span-storage";
import { Span, SpanKind, SpanStatus } from "./span";

describe("InMemorySpanStorage", () => {
  let storage: InMemorySpanStorage;
  
  beforeEach(() => {
    storage = new InMemorySpanStorage();
  });
  
  it("should save and retrieve spans", async () => {
    await storage.initialize();
    
    const span: Span = {
      traceId: "trace_1",
      spanId: "span_1",
      name: "test",
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: Date.now(),
      attributes: {},
    };
    
    storage.save(span);
    const result = storage.findByTraceId("trace_1");
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test");
  });
  
  it("should build tree structure", async () => {
    await storage.initialize();
    
    const parentSpan: Span = {
      traceId: "trace_1",
      spanId: "span_1",
      name: "parent",
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: 1000,
      endTime: 2000,
      attributes: {},
      children: [],
    };
    
    const childSpan: Span = {
      traceId: "trace_1",
      spanId: "span_2",
      parentSpanId: "span_1",
      name: "child",
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: 1100,
      endTime: 1500,
      attributes: {},
      children: [],
    };
    
    storage.save(parentSpan);
    storage.save(childSpan);
    
    const result = storage.findByTraceId("trace_1");
    
    // 应该构建成树结构
    expect(result).toHaveLength(1); // 1个根 span
    expect(result[0].children).toHaveLength(1); // 1个子 span
    expect(result[0].children![0].name).toBe("child");
  });
  
  it("should list traces", async () => {
    await storage.initialize();
    
    // 创建多个 trace
    for (let i = 0; i < 5; i++) {
      storage.save({
        traceId: `trace_${i}`,
        spanId: `span_${i}`,
        name: `span_${i}`,
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now() - i * 1000,
        endTime: Date.now() - i * 1000 + 100,
        attributes: {},
      });
    }
    
    const traces = storage.listTraces(3);
    
    expect(traces).toHaveLength(3);
    // 应该按时间倒序
    expect(traces[0].traceId).toBe("trace_4");
  });
  
  it("should delete trace", async () => {
    await storage.initialize();
    
    storage.save({
      traceId: "trace_1",
      spanId: "span_1",
      name: "test",
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: Date.now(),
      attributes: {},
    });
    
    storage.deleteByTraceId("trace_1");
    
    expect(storage.findByTraceId("trace_1")).toHaveLength(0);
  });
});
```

#### 10.2.3 SpanCollector 核心功能测试

```typescript
// 文件: packages/core/src/utils/span-collector.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { SpanCollector } from "./span-collector";
import { InMemorySpanStorage } from "./span-storage";
import { SpanKind, SpanStatus } from "./span";

describe("SpanCollector", () => {
  let collector: SpanCollector;
  let storage: InMemorySpanStorage;
  
  beforeEach(async () => {
    storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
  });
  
  describe("startSpan / endSpan", () => {
    it("should create span with auto-generated ids", () => {
      const ctx = collector.startSpan("test_span");
      
      expect(ctx.traceId).toBeDefined();
      expect(ctx.spanId).toBeDefined();
      expect(ctx.parentSpanId).toBeUndefined(); // 第一个 span 无父级
    });
    
    it("should track parent-child relationship", () => {
      const parentCtx = collector.startSpan("parent");
      const childCtx = collector.startSpan("child");
      
      expect(childCtx.parentSpanId).toBe(parentCtx.spanId);
    });
    
    it("should update current context after start/end", () => {
      const ctx1 = collector.startSpan("span1");
      expect(collector.getCurrentContext()?.spanId).toBe(ctx1.spanId);
      
      collector.endSpan(ctx1);
      expect(collector.getCurrentContext()?.spanId).toBeUndefined();
    });
    
    it("should restore parent context after child ends", () => {
      const parentCtx = collector.startSpan("parent");
      const childCtx = collector.startSpan("child");
      
      collector.endSpan(childCtx);
      
      // 当前上下文应该回到 parent
      expect(collector.getCurrentContext()?.spanId).toBe(parentCtx.spanId);
    });
  });
  
  describe("result and error tracking", () => {
    it("should record result", () => {
      const ctx = collector.startSpan("test");
      collector.endSpan(ctx, { data: "result" });
      
      const trace = collector.getTrace(ctx.traceId);
      expect(trace[0].result).toEqual({ data: "result" });
    });
    
    it("should record error", () => {
      const ctx = collector.startSpan("test");
      collector.endSpan(ctx, undefined, new Error("test error"));
      
      const trace = collector.getTrace(ctx.traceId);
      expect(trace[0].status).toBe(SpanStatus.ERROR);
      expect(trace[0].error).toBe("test error");
    });
    
    it("should track duration", () => {
      const ctx = collector.startSpan("test");
      
      // 模拟一些处理时间
      const start = ctx.traceId; // just for delay
      
      collector.endSpan(ctx);
      
      const trace = collector.getTrace(ctx.traceId);
      expect(trace[0].endTime).toBeGreaterThan(trace[0].startTime);
    });
  });
  
  describe("trace operations", () => {
    it("should get current trace", () => {
      collector.startSpan("span1");
      collector.endSpan(collector.getCurrentContext()!);
      
      collector.startSpan("span2");
      collector.endSpan(collector.getCurrentContext()!);
      
      const currentTrace = collector.getCurrentTrace();
      expect(currentTrace).toHaveLength(2);
    });
    
    it("should export trace as JSON", () => {
      const ctx = collector.startSpan("test");
      collector.endSpan(ctx);
      
      const json = collector.exportTrace(ctx.traceId);
      const parsed = JSON.parse(json);
      
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("test");
    });
    
    it("should clear trace", () => {
      const ctx = collector.startSpan("test");
      collector.endSpan(ctx);
      
      collector.clearTrace(ctx.traceId);
      
      expect(collector.getTrace(ctx.traceId)).toHaveLength(0);
    });
  });
});
```

### 10.3 装饰器测试

```typescript
// 文件: packages/core/src/utils/wrap-function.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { wrapFunction, Traced, TracedAs, TracedLightweight } from "./wrap-function";
import { SpanCollector } from "./span-collector";
import { InMemorySpanStorage } from "./span-storage";
import { setSpanCollector, getSpanCollector } from "./span-collector";

describe("wrapFunction", () => {
  let collector: SpanCollector;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
  });
  
  it("should wrap sync function", () => {
    const fn = wrapFunction((x: number) => x * 2, "multiply");
    const result = fn(5);
    
    expect(result).toBe(10);
    
    const trace = collector.getCurrentTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0].name).toBe("multiply");
  });
  
  it("should wrap async function", async () => {
    const fn = wrapFunction(async (x: number) => {
      await new Promise(r => setTimeout(r, 10));
      return x * 2;
    }, "async_multiply");
    
    const result = await fn(5);
    
    expect(result).toBe(10);
    
    const trace = collector.getCurrentTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0].status).toBe("ok");
  });
  
  it("should record params", () => {
    const fn = wrapFunction((a: number, b: number) => a + b, "add");
    fn(1, 2);
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].attributes.params).toEqual([1, 2]);
  });
  
  it("should record result when option enabled", () => {
    const fn = wrapFunction((x: number) => x * 2, "multiply", { recordResult: true });
    fn(5);
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].result).toBe(10);
  });
  
  it("should record error", () => {
    const fn = wrapFunction(() => {
      throw new Error("test error");
    }, "error_fn");
    
    expect(() => fn()).toThrow();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].status).toBe("error");
    expect(trace[0].error).toBe("test error");
  });
  
  it("should build parent-child relationship for wrapped functions", () => {
    const parent = wrapFunction(() => {
      const child = wrapFunction(() => "child result", "child");
      return child();
    }, "parent");
    
    parent();
    
    const trace = collector.getCurrentTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0].children).toHaveLength(1);
    expect(trace[0].children![0].name).toBe("child");
  });
  
  it("should return original function when no collector", () => {
    setSpanCollector(null as any);
    
    const original = (x: number) => x * 2;
    const wrapped = wrapFunction(original, "test");
    
    expect(wrapped(5)).toBe(10);
  });
});

describe("Traced decorator", () => {
  let collector: SpanCollector;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
  });
  
  it("should use method name as span name", () => {
    class TestService {
      @Traced()
      async myMethod() {
        return "result";
      }
    }
    
    const service = new TestService();
    service.myMethod();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("myMethod");
  });
  
  it("should support custom name via TracedAs", () => {
    class TestService {
      @TracedAs("custom.name")
      async method() {}
    }
    
    const service = new TestService();
    service.method();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("custom.name");
  });
  
  it("should support TracedLightweight", () => {
    class TestService {
      @TracedLightweight()
      async lightMethod() {}
    }
    
    const service = new TestService();
    service.lightMethod();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("lightMethod");
    expect(trace[0].attributes.params).toBeUndefined();
  });
});

describe("wrapFunction logging options", () => {
  let collector: SpanCollector;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
  });
  
  it("should not log by default", () => {
    const fn = wrapFunction((x: number) => x * 2, "test");
    fn(5);
    // 默认不打印日志到 server.log（通过 logger 验证）
    const trace = collector.getCurrentTrace();
    expect(trace).toHaveLength(1);
  });
  
  it("should log enter and quit with special tags for agent awareness", () => {
    // 使用 mock logger 验证日志输出
    const fn = wrapFunction((x: number) => x * 2, "test_log", { log: true });
    fn(5);
    
    // 验证日志包含特殊标签 [TRACE] >>> enter / [TRACE] <<< quit
    // 方便 Agent 识别这是串联日志
    // expect(logger.info).toHaveBeenCalledWith("[TRACE] >>> test_log enter: [5]");
    // expect(logger.info).toHaveBeenCalledWith("[TRACE] <<< test_log quit: 10");
  });
  
  it("should log error with special tag", () => {
    const fn = wrapFunction(() => {
      throw new Error("test error");
    }, "error_log", { log: true });
    
    expect(() => fn()).toThrow();
    
    // 验证错误日志包含特殊标签
    // expect(logger.error).toHaveBeenCalledWith("[TRACE] !!! error_log error: test error");
  });
  
  it("should truncate long parameters in both log and trace", () => {
    const longString = "a".repeat(1000);
    const fn = wrapFunction((s: string) => s.length, "truncate_test", { 
      log: true, 
      maxLogSize: 100 
    });
    
    fn(longString);
    
    const trace = collector.getCurrentTrace();
    // 验证 trace 中参数被截断
    const paramsStr = JSON.stringify(trace[0].attributes.params);
    expect(paramsStr.length).toBeLessThan(1000);
    expect(paramsStr).toContain("[TRUNCATED]");
    
    // 验证日志中有截断标记
    // expect(logger.info).toHaveBeenCalledWith(
    //   expect.stringContaining("[TRUNCATED]")
    // );
  });
  
  it("should truncate long results in both log and trace", () => {
    const longResult = "b".repeat(1000);
    const fn = wrapFunction(() => longResult, "truncate_result", { 
      log: true, 
      recordResult: true,
      maxLogSize: 100 
    });
    
    fn();
    
    const trace = collector.getCurrentTrace();
    // 验证 trace 中结果被截断
    const resultStr = JSON.stringify(trace[0].result);
    expect(resultStr.length).toBeLessThan(1000);
    expect(resultStr).toContain("[TRUNCATED]");
    
    // 验证日志中有截断标记
    // expect(logger.info).toHaveBeenCalledWith(
    //   expect.stringContaining("[TRUNCATED]")
    // );
  });
  
  it("should work with async functions and logging", async () => {
    const fn = wrapFunction(async (x: number) => {
      await new Promise(r => setTimeout(r, 5));
      return x * 2;
    }, "async_log", { log: true });
    
    const result = await fn(5);
    
    expect(result).toBe(10);
    // 验证异步日志
    // expect(logger.info).toHaveBeenCalledWith("async_log enter: [5]");
    // expect(logger.info).toHaveBeenCalledWith("async_log quit: 10");
  });
  
  it("should log async error", async () => {
    const fn = wrapFunction(async () => {
      await new Promise(r => setTimeout(r, 5));
      throw new Error("async error");
    }, "async_error_log", { log: true });
    
    await expect(fn()).rejects.toThrow("async error");
    
    // 验证异步错误日志
    // expect(logger.error).toHaveBeenCalledWith("async_error_log error: async error");
  });
});

describe("Traced decorator with logging", () => {
  let collector: SpanCollector;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
  });
  
  it("should support log option via Traced", () => {
    class TestService {
      @Traced({ log: true })
      async methodWithLog() {
        return "result";
      }
    }
    
    const service = new TestService();
    service.methodWithLog();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("methodWithLog");
    // 验证日志输出
  });
  
  it("should support maxLogSize option", () => {
    class TestService {
      @Traced({ log: true, maxLogSize: 100 })
      async methodWithSize(data: string) {
        return data;
      }
    }
    
    const service = new TestService();
    service.methodWithSize("a".repeat(500));
    
    const trace = collector.getCurrentTrace();
    // 验证截断行为
  });
  
  it("should support log option via TracedAs", () => {
    class TestService {
      @TracedAs("custom.logged", { log: true })
      async loggedMethod() {}
    }
    
    const service = new TestService();
    service.loggedMethod();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("custom.logged");
  });
  
  it("should support log option via TracedLightweight", () => {
    class TestService {
      @TracedLightweight({ log: true })
      async lightLogged() {}
    }
    
    const service = new TestService();
    service.lightLogged();
    
    const trace = collector.getCurrentTrace();
    expect(trace[0].name).toBe("lightLogged");
    expect(trace[0].attributes.params).toBeUndefined();
    // 验证日志输出
  });
});
```

### 10.4 集成测试

```typescript
// 文件: packages/core/src/utils/span-integration.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { SpanCollector } from "./span-collector";
import { SQLiteSpanStorage } from "./span-storage";
import { wrapFunction, Traced } from "./wrap-function";
import path from "path";
import fs from "fs";

describe("SpanCollector Integration", () => {
  const testDbPath = "/tmp/test_spans.db";
  let collector: SpanCollector;
  
  beforeEach(async () => {
    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    const storage = new SQLiteSpanStorage(testDbPath);
    collector = new SpanCollector(storage);
    await collector.initialize();
  });
  
  it("should persist spans to SQLite", async () => {
    const ctx = collector.startSpan("test");
    collector.endSpan(ctx, { result: "data" });
    
    // 重新创建 collector，从 DB 加载
    const storage2 = new SQLiteSpanStorage(testDbPath);
    const collector2 = new SpanCollector(storage2);
    await collector2.initialize();
    
    const spans = collector2.getTrace(ctx.traceId);
    
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("test");
    expect(spans[0].result).toEqual({ result: "data" });
  });
  
  it("should work with wrapped functions in real scenario", async () => {
    // 模拟真实场景：嵌套调用
    const fileService = {
      @Traced()
      async readFile(path: string): Promise<string> {
        return `content of ${path}`;
      },
      
      @Traced()
      async processFile(path: string): Promise<string> {
        const content = await this.readFile(path);
        return content.toUpperCase();
      },
    };
    
    await fileService.processFile("/tmp/test.txt");
    
    const trace = collector.getCurrentTrace();
    
    // 应该有两个 span：processFile (父) -> readFile (子)
    expect(trace).toHaveLength(1);
    expect(trace[0].name).toBe("processFile");
    expect(trace[0].children).toHaveLength(1);
    expect(trace[0].children![0].name).toBe("readFile");
  });
  
  it("should handle async chain correctly", async () => {
    async function step1() {
      return collector.startSpan("step1");
    }
    
    async function step2(ctx: any) {
      await new Promise(r => setTimeout(r, 5));
      collector.endSpan(ctx, { step: 2 });
    }
    
    const ctx = await step1();
    await step2(ctx);
    
    const trace = collector.getTrace(ctx.traceId);
    expect(Length(2);
 trace).toHave });
});
```

### 10.5 测试覆盖矩阵

| 测试类别 | 测试项 | 覆盖 |
|----------|--------|------|
| **Span 数据结构** | 创建、必填/可选字段 | ✅ |
| **InMemorySpanStorage** | save、findByTraceId、listTraces、delete、树构建 | ✅ |
| **SQLiteSpanStorage** | 持久化、迁移、查询 | ✅ |
| **SpanCollector** | start/end、父子关系、context 切换、result/error | ✅ |
| **wrapFunction** | sync/async、params、result、error、嵌套 | ✅ |
| **装饰器** | @Traced、@TracedAs、@TracedLightweight | ✅ |
| **日志选项** | log、maxLogSize、enter/quit 日志、截断、async 日志 | ✅ |
| **集成** | SQLite 持久化、真实场景嵌套调用 | ✅ |

---

## 11. Phase 划分

### Phase 1（当前）
- [x] Span 数据结构
- [x] SpanStorage 抽象接口
- [x] SQLiteSpanStorage 实现
- [x] SpanCollector 实现（双缓存：activeSpans + cache）
- [x] wrapFunction 工具
- [x] 装饰器实现（`@Traced`, `@TracedAs`, `@TracedLightweight`）
- [x] 日志选项（`log`, `maxLogSize`, enter/quit 日志）
- [x] 可视化输出（`formatTrace()`, `formatTraceTable()`, `listTraces()`）
- [x] Config 配置
- [x] 单元测试设计

### Phase 2（后续）
- [ ] BufferedSpanCollector（批量写入优化）
- [ ] Exporter 接口与实现（OpenTelemetry / Jaeger）
- [ ] 采样策略

### Phase 3（未来）
- [ ] 远程 trace 服务对接
- [ ] TUI 可视化

---

## 12. 验收标准

1. ✅ `@Traced()` 装饰器自动追踪方法调用
2. ✅ `wrapFunction(fn, "name")` 包装任意函数
3. ✅ 父子 span 关系正确建立（双缓存 activeSpans + cache）
4. ✅ `getCurrentTrace()` 返回完整调用树
5. ✅ `formatTrace()` 输出人类可读的调用树
6. ✅ `listTraces()` 列出最近的 trace 摘要
7. ✅ 数据持久化到 SQLite（重启不丢失）
8. ✅ 可通过配置自定义存储路径
9. ✅ 与现有日志系统共存
10. ✅ 装饰器支持 `log` 选项，自动打印 enter/quit 到 server.log
11. ✅ 装饰器支持 `maxLogSize` 选项，同时限制日志和 trace 中的参数/结果大小
12. ✅ 日志使用特殊标签 `[TRACE] >>>`, `[TRACE] <<<`, `[TRACE] !!!`，方便 Agent 识别串联关系
13. ✅ 截断时添加 `[TRUNCATED]` 标记
14. ✅ 单元测试覆盖核心功能（包括日志选项）
