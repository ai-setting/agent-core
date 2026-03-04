import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGetFirstLogTool } from "./get-first-log";
import type { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("get_first_log_for_request tool", () => {
  const testLogDir = "/tmp/test_trace_tools";
  const testLogFile = path.join(testLogDir, "test.log");

  const mockLogContent = `2026-03-04 10:00:00.000 [INFO] [trace-context] [requestId=req_123] Request started: query 'test 123'
2026-03-04 10:00:01.000 [INFO] [traced:api.fetch] [TRACE] >>> api.fetch enter: ["test"]
2026-03-04 10:00:02.000 [INFO] [traced:api.fetch] [TRACE] <<< api.fetch quit: {"result":"ok"}
2026-03-04 10:00:03.000 [INFO] [trace-context] [requestId=req_456] Request started: query 'test 456'
2026-03-04 10:00:04.000 [INFO] [traced:file.read] [TRACE] >>> file.read enter: ["/tmp/a.txt"]
2026-03-04 10:00:05.000 [ERROR] [traced:file.read] [TRACE] !!! file.read error: File not found
2026-03-04 10:00:06.000 [INFO] [trace-context] [requestId=req_789] Request started: query 'test 789'
2026-03-04 10:00:07.000 [INFO] [server] Server closed
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

  it("should get first log for single requestId", async () => {
    const tool = createGetFirstLogTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestIds: ["req_123"] },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.req_123).toContain("req_123");
    expect(parsed.req_123).toContain("Request started");
  });

  it("should get first log for multiple requestIds", async () => {
    const tool = createGetFirstLogTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestIds: ["req_123", "req_456"] },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.req_123).toContain("test 123");
    expect(parsed.req_456).toContain("test 456");
  });

  it("should return NOT FOUND for non-existent requestId", async () => {
    const tool = createGetFirstLogTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestIds: ["req_nonexistent"] },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    expect(parsed.req_nonexistent).toBe("[NOT FOUND]");
  });

  it("should return error for non-existent file", async () => {
    const tool = createGetFirstLogTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "nonexistent.log", requestIds: ["req_123"] },
      {} as ToolContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
