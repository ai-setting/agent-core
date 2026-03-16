import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createListRequestIdsTool } from "./list-request-ids";
import { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("list_request_ids tool", () => {
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

  it("should list all unique requestIds", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log" }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    expect(requestIds).toHaveLength(3);
    expect(requestIds.map((r: any) => r.requestId)).toContain("req_123");
    expect(requestIds.map((r: any) => r.requestId)).toContain("req_456");
    expect(requestIds.map((r: any) => r.requestId)).toContain("req_789");
  });

  it("should sort by lastLogTime descending", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log" }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    expect(requestIds[0].requestId).toBe("req_789");
    expect(requestIds[1].requestId).toBe("req_456");
    expect(requestIds[2].requestId).toBe("req_123");
  });

  it("should respect limit parameter", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log", limit: 2 }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    expect(requestIds).toHaveLength(2);
  });

  it("should respect offset parameter", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log", offset: 1, limit: 2 }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0].requestId).toBe("req_456");
    expect(requestIds[1].requestId).toBe("req_123");
  });

  it("should return first and last log time for each requestId", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log" }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    const req123 = requestIds.find((r: any) => r.requestId === "req_123");
    expect(req123.firstLogTime).toBe("2026-03-04 10:00:00.000");
    expect(req123.lastLogTime).toBe("2026-03-04 10:00:02.000");
  });

  it("should include firstLog by default", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log" }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    const req123 = requestIds.find((r: any) => r.requestId === "req_123");
    expect(req123).toBeDefined();
    expect(req123.firstLog).toBeTruthy();
    expect(req123.firstLog).toContain("req_123");
    expect(req123.firstLog).toContain("test 123");
  });

  it("should include firstLog when includeFirstLog is true", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log", includeFirstLog: true }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    const req123 = requestIds.find((r: any) => r.requestId === "req_123");
    expect(req123.firstLog).toContain("req_123");
    expect(req123.firstLog).toContain("test 123");
  });

  it("should not include firstLog when includeFirstLog is false", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "test.log", includeFirstLog: false }, {} as ToolContext);

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output as string);
    const requestIds = parsed.requestIds;
    const req123 = requestIds.find((r: any) => r.requestId === "req_123");
    expect(req123.firstLog).toBeUndefined();
  });

  it("should return error for non-existent file", async () => {
    const tool = createListRequestIdsTool({ logDir: testLogDir });
    const result = await tool.execute({ filename: "nonexistent.log" }, {} as ToolContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
