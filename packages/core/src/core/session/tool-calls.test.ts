/**
 * @fileoverview Tests for SessionPersistence with tool_calls
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import os from "os";
import path from "path";
import { SqlitePersistence } from "./sqlite/index.js";
import type { SessionInfo, MessageWithParts, ToolPart, TextPart } from "./types.js";

describe("SqlitePersistence with tool_calls", () => {
  let tempDir: string;
  let storage: SqlitePersistence;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `sqlite-test-${Date.now()}`);
    storage = new SqlitePersistence(path.join(tempDir, "test.db"));
    await storage.initialize({});
  });

  afterEach(async () => {
    await storage.clear();
  });

  describe("saveMessage / getMessage with tool calls", () => {
    it("should save and retrieve assistant message with tool_calls", async () => {
      const message: MessageWithParts = {
        info: {
          id: "msg-1",
          sessionID: "test-session-1",
          role: "assistant",
          timestamp: 1000,
        },
        parts: [
          {
            id: "prt-1",
            type: "text",
            text: "I'll help you search for files.",
          } as TextPart,
          {
            id: "prt-2",
            type: "tool",
            callID: "call_function_abc123",
            tool: "glob",
            state: "pending",
            input: { pattern: "**/*.ts" },
          } as ToolPart,
        ],
      };

      await storage.saveMessage("test-session-1", message);
      const retrieved = await storage.getMessage("test-session-1", "msg-1");

      expect(retrieved?.info.id).toBe(message.info.id);
      expect(retrieved?.parts).toHaveLength(2);
      expect((retrieved?.parts[1] as ToolPart).callID).toBe("call_function_abc123");
      expect((retrieved?.parts[1] as ToolPart).tool).toBe("glob");
    });

    it("should save and retrieve tool result message", async () => {
      const toolMessage: MessageWithParts = {
        info: {
          id: "msg-tool-1",
          sessionID: "test-session-1",
          role: "tool",
          timestamp: 2000,
        },
        parts: [
          {
            id: "prt-tool-1",
            type: "tool",
            callID: "call_function_abc123",
            tool: "glob",
            state: "completed",
            input: { pattern: "**/*.ts" },
            output: "file1.ts\nfile2.ts",
          } as ToolPart,
        ],
      };

      await storage.saveMessage("test-session-1", toolMessage);
      const retrieved = await storage.getMessage("test-session-1", "msg-tool-1");

      expect(retrieved?.info.role).toBe("tool");
      expect((retrieved?.parts[0] as ToolPart).callID).toBe("call_function_abc123");
      expect((retrieved?.parts[0] as ToolPart).output).toBe("file1.ts\nfile2.ts");
    });
  });
});
