/**
 * @fileoverview Tests for history conversion with tool_calls
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Session } from "./session.js";
import { sessionToHistory } from "./history.js";
import type { MessageWithParts, ToolPart, TextPart } from "./types.js";

describe("sessionToHistory with tool_calls", () => {
  it("should convert assistant message with pending tool calls to history with tool_calls", () => {
    const session = Session.create({
      title: "Test",
      directory: "/test",
    });

    session.addUserMessage("Search for files");

    session.addMessage({
      id: "msg-1",
      sessionID: session.id,
      role: "assistant",
      timestamp: Date.now(),
    }, [
      {
        id: "prt-1",
        type: "text",
        text: "I'll search for files.",
      } as TextPart,
      {
        id: "prt-2",
        type: "tool",
        callID: "call_function_abc123",
        tool: "glob",
        state: "pending",
        input: { pattern: "**/*.ts" },
      } as ToolPart,
    ]);

    const history = sessionToHistory(session);
    
    const assistantMsg = history.find(h => h.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.tool_calls).toBeDefined();
    expect(assistantMsg?.tool_calls).toHaveLength(1);
    expect(assistantMsg?.tool_calls?.[0].id).toBe("call_function_abc123");
    expect(assistantMsg?.tool_calls?.[0].function.name).toBe("glob");
  });

  it("should convert tool result message to history with tool_call_id", () => {
    const session = Session.create({
      title: "Test",
      directory: "/test",
    });

    session.addMessage({
      id: "msg-tool-1",
      sessionID: session.id,
      role: "tool",
      timestamp: Date.now(),
    }, [
      {
        id: "prt-tool-1",
        type: "tool",
        callID: "call_function_abc123",
        tool: "glob",
        state: "completed",
        input: { pattern: "**/*.ts" },
        output: "file1.ts\nfile2.ts",
      } as ToolPart,
    ]);

    const history = sessionToHistory(session);
    
    const toolMsg = history.find(h => h.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe("call_function_abc123");
    expect(toolMsg?.name).toBe("glob");
  });

  it("should preserve tool_call_id in history after multiple turns", () => {
    const session = Session.create({
      title: "Test",
      directory: "/test",
    });

    session.addUserMessage("Search for files");
    
    session.addMessage({
      id: "msg-assistant-1",
      sessionID: session.id,
      role: "assistant",
      timestamp: Date.now(),
    }, [
      {
        id: "prt-1",
        type: "tool",
        callID: "call_function_xyz789",
        tool: "glob",
        state: "pending",
        input: { pattern: "*.ts" },
      } as ToolPart,
    ]);

    session.addMessage({
      id: "msg-tool-1",
      sessionID: session.id,
      role: "tool",
      timestamp: Date.now(),
    }, [
      {
        id: "prt-tool-1",
        type: "tool",
        callID: "call_function_xyz789",
        tool: "glob",
        state: "completed",
        input: { pattern: "*.ts" },
        output: "found 2 files",
      } as ToolPart,
    ]);

    session.addAssistantMessage("Found 2 TypeScript files.");

    const history = sessionToHistory(session);
    
    const toolMsg = history.find(h => h.role === "tool" && h.tool_call_id === "call_function_xyz789");
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe("call_function_xyz789");
  });
});
