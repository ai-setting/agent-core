import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGetLogsForRequestTool } from "./get-logs-for-request";
import type { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("get_logs_for_request tool", () => {
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
2026-03-04 10:00:08.000 [INFO] [trace-context] [requestId=req_456] Request processing done
2026-03-04 10:00:09.000 [INFO] [trace-context] [requestId=req_456] Request finished
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

  it("should get all logs for a requestId", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_456" },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("req_456");
    expect(result.output).toContain("test 456");
    expect(result.output).toContain("Request processing done");
    expect(result.output).toContain("Request finished");
  });

  it("should respect limit parameter", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_456", limit: 2 },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("should respect offset parameter", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_456", offset: 1, limit: 2 },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("should return no matching lines for non-existent requestId", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_nonexistent" },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("No matching lines found");
  });

  it("should return error for non-existent file", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "nonexistent.log", requestId: "req_123" },
      {} as ToolContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
