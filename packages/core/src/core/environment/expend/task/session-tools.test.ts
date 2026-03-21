/**
 * @fileoverview Unit tests for session tools (list_sessions, grep_session, read_session).
 */

import { describe, test, expect, vi, beforeEach } from "bun:test";
import { createSessionTools } from "./session-tools.js";
import type { ServerEnvironment } from "../../../../server/environment.js";

describe("Session Tools", () => {
  let mockEnv: ServerEnvironment;
  let sessionTools: ReturnType<typeof createSessionTools>;

  // Mock with 10 messages for pagination testing (including "Hello world" for grep test)
  const mockMessages = [
    { info: { id: "msg-1", role: "user", timestamp: 1700000000000 }, parts: [{ type: "text", text: "Hello world" }] },
    ...Array.from({ length: 9 }, (_, i) => ({
      info: { id: `msg-${i + 2}`, role: (i + 1) % 2 === 0 ? "user" : "assistant", timestamp: 1700000000000 + (i + 1) * 1000 },
      parts: [{ type: "text", text: `Message ${i + 2}` }],
    })),
  ];

  const mockSession1 = {
    id: "session-1",
    info: {
      id: "session-1",
      title: "First Session",
      time: { created: 1700000000000, updated: 1700000100000 },
    },
    getMessages: vi.fn().mockReturnValue(mockMessages),
  };

  const mockSession2 = {
    id: "session-2",
    info: {
      id: "session-2",
      title: "Second Session",
      time: { created: 1700000200000, updated: 1700000300000 },
    },
    getMessages: vi.fn().mockReturnValue([]),
  };

  beforeEach(() => {
    mockEnv = {
      listSessions: vi.fn().mockReturnValue([mockSession1, mockSession2]),
      getSession: vi.fn().mockImplementation((id: string) => {
        if (id === "session-1") return mockSession1;
        if (id === "session-2") return mockSession2;
        return undefined;
      }),
    } as any;

    sessionTools = createSessionTools(mockEnv);
  });

  describe("list_sessions", () => {
    test("should have correct tool name", () => {
      expect(sessionTools.listSessionsTool.name).toBe("list_sessions");
    });

    test("should return list of sessions", async () => {
      const result = await sessionTools.listSessionsTool.execute(
        { limit: 10, offset: 0, reason: "Test list" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("session-1");
      expect(result.output).toContain("First Session");
    });

    test("should filter by query", async () => {
      const result = await sessionTools.listSessionsTool.execute(
        { limit: 10, offset: 0, query: "Second", reason: "Test filter" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("session-2");
      expect(result.output).toContain("Second Session");
    });

    test("should return error when listSessions not supported", async () => {
      const envWithoutList = { getSession: vi.fn() } as any;
      const tools = createSessionTools(envWithoutList);
      
      const result = await tools.listSessionsTool.execute(
        { limit: 10, reason: "Test" },
        {}
      );

      expect(result.success).toBe(false);
    });
  });

  describe("grep_session", () => {
    test("should have correct tool name", () => {
      expect(sessionTools.grepSessionTool.name).toBe("grep_session");
    });

    test("should find matching messages", async () => {
      const result = await sessionTools.grepSessionTool.execute(
        { session_id: "session-1", query: "Hello", limit: 10, reason: "Test grep" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Hello world");
    });

    test("should return error when session not found", async () => {
      const result = await sessionTools.grepSessionTool.execute(
        { session_id: "nonexistent", query: "test", reason: "Test" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("read_session", () => {
    test("should have correct tool name", () => {
      expect(sessionTools.readSessionTool.name).toBe("read_session");
    });

    test("should return session messages", async () => {
      const result = await sessionTools.readSessionTool.execute(
        { session_id: "session-1", limit: 50, reason: "Test read" },
        {}
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("session-1");
      expect(result.output).toContain("First Session");
    });

    test("should return error when session not found", async () => {
      const result = await sessionTools.readSessionTool.execute(
        { session_id: "nonexistent", reason: "Test" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("should support offset parameter for pagination", async () => {
      const result = await sessionTools.readSessionTool.execute(
        { session_id: "session-1", limit: 3, offset: 2, reason: "Test offset" },
        {}
      );

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.messages).toHaveLength(3);
      expect(output.messages[0].content).toBe("Message 3"); // offset=2 starts from index 2
      expect(output.total).toBe(10);
      expect(output.offset).toBe(2);
      expect(output.limit).toBe(3);
    });

    test("should default offset to 0 when not provided", async () => {
      const result = await sessionTools.readSessionTool.execute(
        { session_id: "session-1", limit: 5, reason: "Test default offset" },
        {}
      );

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.messages).toHaveLength(5);
      expect(output.messages[0].content).toBe("Hello world");
      expect(output.offset).toBe(0);
    });

    test("should handle offset beyond total messages", async () => {
      const result = await sessionTools.readSessionTool.execute(
        { session_id: "session-1", limit: 5, offset: 100, reason: "Test large offset" },
        {}
      );

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.messages).toHaveLength(0);
      expect(output.total).toBe(10);
      expect(output.offset).toBe(100);
    });
  });
});
