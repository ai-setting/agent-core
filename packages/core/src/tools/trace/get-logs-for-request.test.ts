import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGetLogsForRequestTool } from "./get-logs-for-request";
import type { ToolContext } from "../../core/types/tool";
import fs from "fs";
import path from "path";

describe("get_logs_for_request tool", () => {
  const testLogDir = "/tmp/test_trace_tools_time";
  const testLogFile = path.join(testLogDir, "test.log");

  // Realistic log format matching actual server logs
  const mockLogContent = `2026-03-16 11:43:59.157 [INFO] [src/server/routes/sessions.ts:175][session] Received prompt request {"sessionId":"ses_abc","content":"hello3"}
2026-03-16 11:43:59.160 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1060][traced:session.addUserMessage] [TRACE] >>> session.addUserMessage enter: ["hello3"]
2026-03-16 11:43:59.170 [INFO] [src/core/session/sqlite/index.ts:118][session:sqlite] [SQLite] saveSession: id=ses_abc, messageCount=4
2026-03-16 11:43:59.175 [INFO] [src/core/session/session.ts:216][session:addMessage] [Session] addMessage: sessionId=ses_abc
2026-03-16 11:43:59.176 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1066][traced:env.handle_query] [TRACE] >>> env.handle_query enter: ["hello3"]
2026-03-16 11:43:59.186 [DEBUG][requestId=req_1773632639152_b8ya088ok][traced:agent.run] [TRACE] >>> agent.run enter: []
2026-03-16 11:43:59.186 [INFO] [src/core/agent/index.ts:136][agent] Starting agent run {"queryLength":6,"toolCount":100}
2026-03-16 11:43:59.200 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/core/agent/index.ts:150][agent] Processing query
2026-03-16 11:44:00.500 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/core/environment/invoke-llm.ts:200] LLM request started
2026-03-16 11:44:00.900 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/core/environment/invoke-llm.ts:250] LLM response received
2026-03-16 11:44:00.938 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/core/environment/base/base-environment.ts:1211][traced:session.get] [TRACE] >>> session.get enter: ["ses_abc"]
2026-03-16 11:44:00.939 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/core/environment/base/base-environment.ts:1211][traced:session.get] [TRACE] <<< session.get quit
2026-03-16 11:44:00.948 [INFO] [src/core/session/sqlite/index.ts:118][session:sqlite] [SQLite] saveSession: id=ses_abc, messageCount=5
2026-03-16 11:44:00.951 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1069][traced:session.addMessage] [TRACE] >>> session.addMessage enter
2026-03-16 11:44:00.960 [DEBUG][requestId=req_1773632639152_b8ya088ok][traced:agent.run] [TRACE] <<< agent.run quit
2026-03-16 11:44:00.960 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1066][traced:env.handle_query] [TRACE] <<< env.handle_query quit
2026-03-16 11:44:00.961 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1077][traced:session.addAssistantMessage] [TRACE] >>> session.addAssistantMessage enter
2026-03-16 11:44:00.970 [INFO][requestId=req_1773632639152_b8ya088ok] [src/core/session/sqlite/index.ts:325][session:sqlite] [SQLite] saveMessage: sessionId=ses_abc
2026-03-16 11:44:00.971 [DEBUG][requestId=req_1773632639152_b8ya088ok] [src/server/environment.ts:1077][traced:session.addAssistantMessage] [TRACE] <<< session.addAssistantMessage quit
2026-03-16 11:44:01.100 [INFO] [src/server/routes/sessions.ts:200][session] Response sent to client
2026-03-16 11:44:02.000 [INFO] [src/server/server.ts:100] Server heartbeat
2026-03-16 11:44:03.000 [INFO] [src/server/server.ts:100] Server heartbeat
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
      { filename: "test.log", requestId: "req_1773632639152_b8ya088ok" },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("req_1773632639152_b8ya088ok");
    expect(result.output).toContain("hello3");
    expect(result.output).toContain("agent.run");
  });

  it("should respect limit parameter", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_1773632639152_b8ya088ok", limit: 5 },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("should respect offset parameter", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { filename: "test.log", requestId: "req_1773632639152_b8ya088ok", offset: 5, limit: 5 },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBeLessThanOrEqual(5);
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

  // ==================== Time Range Filtering Tests ====================

  it("should filter by startTime with time-only format (HH:MM:SS)", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    // Start from 11:44:00 (exclude logs before this time)
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:44:00");
    expect(result.output).not.toContain("11:43:59");
    expect(result.output).toContain("session.get");
    // Note: Lines without requestId are not included in filtered results
    expect(result.output).not.toContain("Response sent");
  });

  it("should filter by endTime with time-only format (HH:MM:SS)", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    // End at 11:44:00 (include logs before this time)
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        endTime: "11:44:00"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:43:59");
    expect(result.output).not.toContain("11:44:00.500"); // Should be filtered out
    expect(result.output).not.toContain("11:44:01");
    expect(result.output).toContain("hello3");
  });

  it("should filter by startTime and endTime (time-only format)", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00",
        endTime: "11:44:00.960"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:44:00.500");
    expect(result.output).toContain("11:44:00.938");
    expect(result.output).toContain("11:44:00.960");
    expect(result.output).not.toContain("11:43:59");
    expect(result.output).not.toContain("11:44:01");
  });

  it("should filter by startTime with full date format (YYYY-MM-DD HH:MM:SS)", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "2026-03-16 11:44:00"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:44:00");
    expect(result.output).not.toContain("11:43:59");
  });

  it("should filter by endTime with full date format", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        endTime: "2026-03-16 11:44:00.500"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:43:59");
    expect(result.output).not.toContain("11:44:00.900");
  });

  it("should filter by exact timestamp", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    // Get logs at exactly 11:44:00
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00.500",
        endTime: "11:44:00.500"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("11:44:00.500");
    expect(result.output).not.toContain("11:44:00.938");
  });

  it("should show time filter info in output when time filter is applied", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00",
        endTime: "11:44:01"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("Time filter:");
    expect(result.output).toContain("from 11:44:00");
    expect(result.output).toContain("until 11:44:01");
  });

  it("should return empty when time filter excludes all logs", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "12:00:00"
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("No matching lines found");
    expect(result.output).toContain("Time filter:");
  });

  it("should combine time filter with limit", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00",
        limit: 3
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    const lines = (result.output as string).split("\n").filter((l: string) => l.trim() && !l.includes("Time filter"));
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("should combine time filter with offset", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    // Get all logs in time range
    const allResult = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00"
      },
      {} as ToolContext
    );
    
    const allLines = (allResult.output as string).split("\n").filter((l: string) => l.trim() && !l.includes("Time filter"));
    const totalCount = allLines.length;
    
    // Get with offset
    const offsetResult = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00",
        offset: 2,
        limit: 2
      },
      {} as ToolContext
    );

    expect(offsetResult.success).toBe(true);
    const offsetLines = (offsetResult.output as string).split("\n").filter((l: string) => l.trim() && !l.includes("Time filter"));
    expect(offsetLines.length).toBeLessThanOrEqual(2);
  });

  it("should handle different date for time-only filter", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    
    // Test with different date format - should still work because we prepend today's date
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        startTime: "11:44:00"
      },
      {} as ToolContext
    );

    // Should match logs with today's date + time-only filter
    expect(result.success).toBe(true);
    // The log has 2026-03-16, today's date should be used for time-only format
    expect(result.output).toContain("11:44:00");
  });

  it("should use logDir from args parameter", async () => {
    // Create a tool without logDir in config
    const tool = createGetLogsForRequestTool();
    // Pass logDir via args
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        logDir: testLogDir 
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("req_1773632639152_b8ya088ok");
  });

  it("should return error for non-absolute logDir", async () => {
    const tool = createGetLogsForRequestTool({ logDir: testLogDir });
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        logDir: "relative/path" 
      },
      {} as ToolContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("must be an absolute path");
  });

  it("should prioritize args logDir over config logDir", async () => {
    // Create tool with config logDir pointing to non-existent dir
    const tool = createGetLogsForRequestTool({ logDir: "/nonexistent" });
    // Pass valid logDir via args - should use args value
    const result = await tool.execute(
      { 
        filename: "test.log", 
        requestId: "req_1773632639152_b8ya088ok",
        logDir: testLogDir 
      },
      {} as ToolContext
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("req_1773632639152_b8ya088ok");
  });
});
