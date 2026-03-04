# Trace Tools 优化实现文档

## 1. 概述

### 1.1 背景

现有 `search_logs` 工具过于复杂，参数众多（filename, requestId, traceFilter, keyword, offset, limit, tail），用户体验不佳：
- 无法快速罗列出不同的 requestId
-
- 查询最新 无法按时间段过滤日志时看到的是自己的调用日志

### 1.2 优化方案

1. **拆分为细粒度子工具**：将复杂工具拆分为职责单一的工具
2. **新增 trace_analysis skill**：定义日志查询场景的行为规范
3. **移除 search_logs**：不再暴露底层复杂工具

---

## 2. 新工具设计

### 2.1 list_request_ids

列出日志文件中所有不同的 requestId。

```typescript
const ListRequestIdsParamsSchema = z.object({
  filename: z.string().describe("Log filename (e.g., server.log, tui.log, tools.log)"),
  limit: z.number().optional().default(50).describe("Maximum number of requestIds to return"),
});
```

**返回格式**（时间戳格式：`2026-03-04 10:00:00.000`）：
```json
[
  { "requestId": "req_abc123", "firstLogTime": "2026-03-04 10:00:00.000", "lastLogTime": "2026-03-04 10:05:00.000" },
  { "requestId": "req_def456", "firstLogTime": "2026-03-04 09:30:00.000", "lastLogTime": "2026-03-04 09:35:00.000" }
]
```

### 2.2 get_first_log_for_request

获取指定 requestId 的第一条日志（通常包含用户 query）。

```typescript
const GetFirstLogParamsSchema = z.object({
  filename: z.string().describe("Log filename"),
  requestIds: z.array(z.string()).describe("List of requestIds to get first log for"),
});
```

**返回格式**：
```json
{
  "req_abc123": "2026-03-04 10:00:00.000 [INFO] [trace-context] [requestId=req_abc123] Request started: query '帮我总结一下今天的会议'",
  "req_def456": "2026-03-04 09:30:00.000 [INFO] [trace-context] [requestId=req_def456] Request started: query '查找文件'"
}
```

### 2.3 get_logs_for_request

获取指定 requestId 的所有日志。

```typescript
const GetLogsForRequestParamsSchema = z.object({
  filename: z.string().describe("Log filename"),
  requestId: z.string().describe("The requestId to get all logs for"),
  offset: z.number().optional().default(0).describe("Line offset to start from"),
  limit: z.number().optional().default(500).describe("Maximum lines to return"),
});
```

---

## 3. trace_analysis Skill 设计

### 3.1 Skill 定义

```yaml
id: trace_analysis
name: trace_analysis
description: Analyze logs and traces for debugging. Use this skill when users want to investigate issues, view request history, or analyze trace data.
```

### 3.2 行为规范

#### 场景 1：查询最新日志

当用户说"查看最新日志"、"帮我看看最近发生了什么"：

1. 调用 `list_request_ids` 获取最近的 requestId 列表（默认 5 个）
2. 对每个 requestId 调用 `get_first_log_for_request` 获取首条日志
3. 展示给用户，让用户选择要查看哪个 requestId 的完整日志
4. 用户选择后，调用 `get_logs_for_request` 获取完整日志

#### 场景 2：查询指定 requestId 的日志

当用户提供了 requestId：

1. 调用 `get_first_log_for_request` 获取首条日志（展示用户 query）
2. 调用 `get_logs_for_request` 获取完整日志
3. 可以根据需要进一步过滤（如只看 error）

### 3.3 Skill Content

```markdown
# trace_analysis

This skill provides log and trace analysis capabilities for debugging.

## Tools

### list_request_ids
List all unique requestIds in a log file, sorted by time (newest first).

### get_first_log_for_request  
Get the first log entry for each specified requestId. The first entry typically contains the user's query.

### get_logs_for_request
Get all log entries for a specific requestId.

## Workflows

### View Recent Logs
1. Call list_request_ids to get recent requestIds
2. Call get_first_log_for_request to show first log (with query) for each
3. Let user select which requestId to investigate
4. Call get_logs_for_request to get full logs

### View Specific Request
1. Call get_first_log_for_request to show the query
2. Call get_logs_for_request to get all logs

---

*Current agent-core version info: Version 0.1.0 (dev)*
```

---

## 4. 修改清单

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/tools/trace/list-request-ids.ts` | list_request_ids 工具 |
| `packages/core/src/tools/trace/get-first-log.ts` | get_first_log_for_request 工具 |
| `packages/core/src/tools/trace/get-logs-for-request.ts` | get_logs_for_request 工具 |

### 4.2 删除文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/tools/trace/search-logs.ts` | 移除旧工具 |
| `packages/core/src/tools/trace/search-logs.test.ts` | 移除旧测试 |

### 4.3 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/server/environment.ts` | 移除 search_logs，注册 3 个新工具 |
| `packages/core/src/server/built-in-skills.ts` | 新增 trace_analysis skill，更新 tong_work_help |

---

## 5. 实现步骤

### Step 1: 创建新工具

1. 创建 `list-request-ids.ts`
2. 创建 `get-first-log.ts`
3. 创建 `get-logs-for-request.ts`

### Step 2: 注册工具

在 `environment.ts` 中：
- 移除 `searchLogsTool` 导入和注册
- 新增 3 个工具的导入和注册

### Step 3: 创建 Skill

在 `built-in-skills.ts` 中：
- 新增 `trace_analysis` skill
- 更新 `tong_work_help` 中 debugging tools 部分

### Step 4: 清理

- 删除 `search-logs.ts` 和 `search-logs.test.ts`

### Step 5: 测试

- 运行 `bun run test` 验证
- 运行 `bun run typecheck` 验证类型
