# Trace Tools 设计文档

## 1. 概述

实现两个 Agent Tool：

1. **search_logs** - 日志检索工具，类似 grep
2. **get_trace** - Trace 查询工具，获取调用链可视化

## 2. search_logs 工具

### 2.1 功能

- 读取并检索日志文件
- 支持 requestId 过滤
- 支持 TRACE 标签过滤（`>>>`, `<<<`, `!!!`）
- 返回匹配的日志行

### 2.2 参数设计

```typescript
const SearchLogsParamsSchema = z.object({
  /** 要搜索的日志文件名，如 "server.log", "tui.log" */
  filename: z.string().describe("Log filename to search"),
  
  /** 可选：按 requestId/traceId 过滤 */
  requestId: z.string().optional().describe("Filter by requestId/traceId"),
  
  /** 可选：TRACE 标签过滤类型 */
  traceFilter: z.enum(["all", "enter", "quit", "error"]).default("all")
    .describe("Filter by TRACE tag type: enter (>>>), quit (<<<), error (!!!)"),
  
  /** 可选：搜索关键词 */
  keyword: z.string().optional().describe("Additional keyword to search"),
  
  /** 可选：返回的最大行数，默认 100 */
  maxLines: z.number().optional().default(100).describe("Maximum lines to return"),
});
```

### 2.3 测试设计

```typescript
// 文件: packages/core/src/tools/trace/search-logs.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSearchLogsTool } from "./search-logs";
import { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("search_logs tool", () => {
  const testLogDir = "/tmp/test_logs";
  const testLogFile = path.join(testLogDir, "test.log");
  
  // 模拟日志内容
  const mockLogContent = `
2026-03-01 10:00:00.000 [INFO] [server] Server started
2026-03-01 10:00:01.000 [INFO] [trace-context] [requestId=req_123] Request started
2026-03-01 10:00:01.001 [INFO] [traced:api.fetch] [TRACE] >>> api.fetch enter: ["test query"]
2026-03-01 10:00:01.010 [INFO] [traced:api.fetch] [TRACE] <<< api.fetch quit: {"result":"ok"}
2026-03-01 10:00:02.000 [INFO] [trace-context] [requestId=req_456] Request started
2026-03-01 10:00:02.001 [INFO] [traced:file.read] [TRACE] >>> file.read enter: ["/tmp/a.txt"]
2026-03-01 10:00:02.010 [ERROR] [traced:file.read] [TRACE] !!! file.read error: File not found
2026-03-01 10:00:03.000 [INFO] [server] Server closed
`;
  
  beforeEach(async () => {
    // 创建测试日志目录和文件
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
    fs.writeFileSync(testLogFile, mockLogContent);
  });
  
  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testLogFile)) {
      fs.unlinkSync(testLogFile);
    }
    if (fs.existsSync(testLogDir)) {
      fs.rmdirSync(testLogDir);
    }
  });
  
  it("should read entire log file without filters", async () => {
    const tool = createSearchLogsTool();
    const result = await tool.execute({ filename: "test.log" }, {} as ToolContext);
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Server started");
    expect(result.output).toContain("Server closed");
  });
  
  it("should filter by requestId", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_123" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("req_123");
    expect(result.output).not.toContain("req_456");
  });
  
  it("should filter by trace enter (>>>)", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", traceFilter: "enter" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("[TRACE] >>>");
    expect(result.output).not.toContain("[TRACE] <<<");
    expect(result.output).not.toContain("[TRACE] !!!");
  });
  
  it("should filter by trace quit (<<<)", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", traceFilter: "quit" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("[TRACE] <<<");
    expect(result.output).not.toContain("[TRACE] >>>");
  });
  
  it("should filter by trace error (!!!)", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", traceFilter: "error" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("[TRACE] !!!");
    expect(result.output).toContain("File not found");
  });
  
  it("should combine requestId and keyword filters", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_123", keyword: "fetch" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("req_123");
    expect(result.output).toContain("fetch");
    expect(result.output).not.toContain("req_456");
  });
  
  it("should limit max lines", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", maxLines: 2 },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    const lines = result.output.split("\n").filter(l => l.trim());
    expect(lines.length).toBeLessThanOrEqual(2);
  });
  
  it("should return error for non-existent file", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "nonexistent.log" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
```

## 3. get_trace 工具

### 3.1 功能

- 根据 requestId（traceId）查询 trace
- 返回格式化的调用链可视化
- 支持 JSON 格式输出

### 3.2 参数设计

```typescript
const GetTraceParamsSchema = z.object({
  /** requestId/traceId */
  requestId: z.string().describe("The requestId/traceId to query"),
  
  /** 输出格式：text 或 json，默认 text */
  format: z.enum(["text", "json"]).default("text").describe("Output format"),
});
```

### 3.3 测试设计

```typescript
// 文件: packages/core/src/tools/trace/get-trace.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { createGetTraceTool } from "./get-trace";
import { ToolContext } from "../../core/types/tool";
import { SpanCollector, setSpanCollector, InMemorySpanStorage } from "../../utils/span-collector";

describe("get_trace tool", () => {
  let collector: SpanCollector;
  
  beforeEach(async () => {
    // Setup collector with test data
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
    
    // Create test trace
    collector.startSpan("agent.run");
    collector.startSpan("tool:read");
    collector.endSpan(collector.getCurrentContext()!);
    collector.startSpan("tool:write");
    collector.endSpan(collector.getCurrentContext()!);
    collector.endSpan(collector.getCurrentContext()!);
  });
  
  it("should return formatted trace in text format", async () => {
    const tool = createGetTraceTool();
    const traceId = collector.getCurrentContext()?.traceId;
    
    const result = await tool.execute(
      { requestId: traceId!, format: "text" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("agent.run");
    expect(result.output).toContain("tool:read");
    expect(result.output).toContain("tool:write");
  });
  
  it("should return trace in JSON format", async () => {
    const tool = createGetTraceTool();
    const traceId = collector.getCurrentContext()?.traceId;
    
    const result = await tool.execute(
      { requestId: traceId!, format: "json" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("agent.run");
  });
  
  it("should return error for non-existent trace", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: "non_existent_trace_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
  
  it("should return error when no collector is initialized", async () => {
    setSpanCollector(null as any);
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: "any_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });
});
```

## 4. 文件结构

```
packages/core/src/tools/trace/
├── search-logs.ts      # 日志检索工具
├── search-logs.test.ts # 测试
├── get-trace.ts       # Trace 查询工具
└── get-trace.test.ts  # 测试
```

## 5. 验收标准

### search_logs
- [ ] 能读取指定日志文件
- [ ] 能按 requestId 过滤
- [ ] 能按 TRACE 标签类型过滤（enter/quit/error）
- [ ] 能结合关键词过滤
- [ ] 能限制返回行数
- [ ] 文件不存在时返回错误

### get_trace
- [ ] 能根据 requestId 查询 trace
- [ ] 能返回 text 格式的调用链
- [ ] 能返回 JSON 格式的调用链
- [ ] trace 不存在时返回错误
- [ ] 未初始化 collector 时返回错误
