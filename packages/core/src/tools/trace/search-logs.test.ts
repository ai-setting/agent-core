import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createSearchLogsTool } from "./search-logs";
import type { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("search_logs tool", () => {
  const testLogDir = "/tmp/test_logs";
  const testLogFile = path.join(testLogDir, "test.log");
  
  const mockLogContent = `2026-03-01 10:00:00.000 [INFO] [server] Server started
2026-03-01 10:00:01.000 [INFO] [trace-context] [requestId=req_123] Request started
2026-03-01 10:00:01.001 [INFO] [traced:api.fetch] [TRACE] >>> api.fetch enter: ["test query"]
2026-03-01 10:00:01.010 [INFO] [traced:api.fetch] [TRACE] <<< api.fetch quit: {"result":"ok"}
2026-03-01 10:00:02.000 [INFO] [trace-context] [requestId=req_456] Request started
2026-03-01 10:00:02.001 [INFO] [traced:file.read] [TRACE] >>> file.read enter: ["/tmp/a.txt"]
2026-03-01 10:00:02.010 [ERROR] [traced:file.read] [TRACE] !!! file.read error: File not found
2026-03-01 10:00:03.000 [INFO] [server] Server closed
`;
  
  beforeEach(() => {
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
    fs.writeFileSync(testLogFile, mockLogContent);
  });
  
  afterEach(() => {
    if (fs.existsSync(testLogFile)) {
      fs.unlinkSync(testLogFile);
    }
    if (fs.existsSync(testLogDir)) {
      fs.rmdirSync(testLogDir);
    }
  });
  
  it("should read entire log file without filters", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
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
  
  it("should filter by trace enter", async () => {
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
  
  it("should filter by trace quit", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", traceFilter: "quit" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("[TRACE] <<<");
    expect(result.output).not.toContain("[TRACE] >>>");
  });
  
  it("should filter by trace error", async () => {
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
    // Filter by requestId only - both lines with req_123
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_123" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("req_123");
  });
  
  it("should limit lines with offset and limit", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    // Get lines from offset 0, limit 2
    const result = await tool.execute(
      { filename: "test.log", offset: 0, limit: 2 },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("should support offset pagination", async () => {
    const tool = createSearchLogsTool({ logDir: testLogDir });
    // First page
    const result1 = await tool.execute(
      { filename: "test.log", offset: 0, limit: 2 },
      {} as ToolContext
    );
    // Second page  
    const result2 = await tool.execute(
      { filename: "test.log", offset: 2, limit: 2 },
      {} as ToolContext
    );
    
    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    // Different pages should have different content
    expect(result1.output).not.toBe(result2.output);
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
