# Trace Tools 设计文档

## 1. 概述

实现四个 Agent Trace Tool，用于日志分析和调用链追踪：

| 工具名 | 功能 | 关键代码路径 |
|--------|------|-------------|
| `list_request_ids` | 列出最近请求的 requestId 列表 | `packages/core/src/tools/trace/list-request-ids.ts` |
| `get_first_log_for_request` | 获取指定 requestId 的第一条日志 | `packages/core/src/tools/trace/get-first-log.ts` |
| `get_logs_for_request` | 获取指定 requestId 的所有关联日志 | `packages/core/src/tools/trace/get-logs-for-request.ts` |
| `get_trace` | 获取调用链可视化 | `packages/core/src/tools/trace/get-trace.ts` |

## 2. list_request_ids 工具

### 2.1 功能

- 扫描日志目录，提取所有唯一的 requestId
- 按时间倒序返回最近的 requestId 列表
- 支持按日志文件名过滤

### 2.2 参数设计

```typescript
const ListRequestIdsParamsSchema = z.object({
  /** 要搜索的日志文件名，如 "server.log", "tui.log"，默认扫描所有日志 */
  filename: z.string().optional().describe("Log filename to search (default: all logs)"),
  
  /** 返回的最大数量，默认 20 */
  limit: z.number().optional().default(20).describe("Maximum number of requestIds to return"),
});
```

### 2.3 文件位置

- 实现：`packages/core/src/tools/trace/list-request-ids.ts`
- 测试：`packages/core/src/tools/trace/list-request-ids.test.ts`

---

## 3. get_first_log_for_request 工具

### 3.1 功能

- 获取指定 requestId 的第一条日志
- 用于快速确认请求的开始时间

### 3.2 参数设计

```typescript
const GetFirstLogParamsSchema = z.object({
  /** requestId/traceId */
  requestId: z.string().describe("The requestId/traceId to query"),
  
  /** 日志文件名（可选） */
  filename: z.string().optional().describe("Log filename to search"),
});
```

### 3.3 文件位置

- 实现：`packages/core/src/tools/trace/get-first-log.ts`
- 测试：`packages/core/src/tools/trace/get-first-log.test.ts`

---

## 4. get_logs_for_request 工具

### 4.1 功能

- 获取指定 requestId 的所有关联日志
- 按时间顺序返回完整的调用链

### 4.2 参数设计

```typescript
const GetLogsForRequestParamsSchema = z.object({
  /** requestId/traceId */
  requestId: z.string().describe("The requestId/traceId to query"),
  
  /** 日志文件名（可选） */
  filename: z.string().optional().describe("Log filename to search"),
  
  /** 返回的最大行数，默认 500 */
  maxLines: z.number().optional().default(500).describe("Maximum lines to return"),
});
```

### 4.3 文件位置

- 实现：`packages/core/src/tools/trace/get-logs-for-request.ts`
- 测试：`packages/core/src/tools/trace/get-logs-for-request.test.ts`

---

## 5. get_trace 工具

### 5.1 功能

- 获取调用链可视化
- 解析日志中的 TRACE 标签（`>>>`, `<<<`, `!!!`）
- 生成格式化的调用链输出

### 5.2 参数设计

```typescript
const GetTraceParamsSchema = z.object({
  /** requestId/traceId */
  requestId: z.string().describe("The requestId/traceId to query"),
  
  /** 日志文件名（可选） */
  filename: z.string().optional().describe("Log filename to search"),
  
  /** 返回的最大行数，默认 500 */
  maxLines: z.number().optional().default(500).describe("Maximum lines to return"),
});
```

### 5.3 输出格式

```
=== Trace for requestId: req_abc123 ===
Time           Module              Action    Details
─────────────────────────────────────────────────────────
10:00:01.000   trace-context       START     Request started
10:00:01.001   api.fetch          >>>       enter: ["test query"]
10:00:01.010   api.fetch          <<<       quit: {"result":"ok"}
10:00:02.000   tool.execute       >>>       enter: {"name":"bash","args":{"command":"ls"}}
10:00:02.100   tool.execute       <<<       quit: {"output":"file1.txt\nfile2.txt"}
10:00:03.000   trace-context      END       Request completed
─────────────────────────────────────────────────────────
```

### 5.4 文件位置

- 实现：`packages/core/src/tools/trace/get-trace.ts`
- 测试：`packages/core/src/tools/trace/get-trace.test.ts`

---

## 6. 日志格式规范

为支持 Trace 工具，日志需要包含 requestId 和 TRACE 标签：

### 6.1 requestId 注入

使用 `trace-context` 模块自动注入 requestId：

```typescript
import { getTraceContext } from "./utils/trace-context.js";

const trace = getTraceContext();
const requestId = trace.getRequestId();

// 日志格式：[trace-context] [requestId=req_xxx] message
logger.info(`[trace-context] [requestId=${requestId}] Request started`);
```

### 6.2 TRACE 标签

| 标签 | 含义 | 日志格式 |
|------|------|---------|
| `>>>` | 方法进入 | `[TRACE] >>> method_name enter: <args>` |
| `<<<` | 方法退出 | `[TRACE] <<< method_name quit: <result>` |
| `!!!` | 方法错误 | `[TRACE] !!! method_name error: <error>` |

---

## 7. 与内置 Skill 集成

Trace 工具与 `trace_analysis` skill 配合使用，提供结构化的日志分析工作流：

- `list_request_ids` - 获取最近请求列表
- `get_first_log_for_request` - 确认请求开始时间
- `get_logs_for_request` - 获取完整日志
- `get_trace` - 获取可视化调用链

详见 `packages/core/src/server/built-in-skills.ts` 中的 `trace_analysis` skill 定义。
