/**
 * @fileoverview Tests for history conversion with tool_calls (AI SDK ModelMessage format)
 */

import { describe, it, expect } from "bun:test";
import { Session } from "./session.js";
import { sessionToHistory } from "./history.js";
import type { MessageWithParts, ToolPart, TextPart } from "./types.js";

describe("sessionToHistory with tool_calls", () => {
  it("should convert assistant message with pending tool calls to history with tool-call parts", () => {
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
    
    // In AI SDK ModelMessage format, tool calls are in content array as tool-call parts
    const content = assistantMsg?.content as any[];
    expect(content).toBeDefined();
    expect(Array.isArray(content)).toBe(true);
    
    const toolCallPart = content?.find((part: any) => part.type === "tool-call");
    expect(toolCallPart).toBeDefined();
    expect(toolCallPart?.toolCallId).toBe("call_function_abc123");
    expect(toolCallPart?.toolName).toBe("glob");
  });

  it("should convert tool result message to history with toolCallId", () => {
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
    
    // In AI SDK ModelMessage format, tool messages have toolCallId field
    expect((toolMsg as any).toolCallId).toBe("call_function_abc123");
  });

  it("should preserve toolCallId in history after multiple turns", () => {
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
    
    // Find tool message by checking toolCallId field
    const toolMsg = history.find(h => {
      if (h.role !== "tool") return false;
      return (h as any).toolCallId === "call_function_xyz789";
    });
    expect(toolMsg).toBeDefined();
  });
});
