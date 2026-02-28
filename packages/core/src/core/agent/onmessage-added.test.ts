/**
 * @fileoverview Tests for Agent onMessageAdded callback functionality.
 * Verifies that intermediate messages are properly stored during agent execution.
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Agent } from "./index.js";
import type { Environment } from "../environment/index.js";
import type { Context } from "../types/context.js";
import type { Tool } from "../types/index.js";
import type { ModelMessage } from "ai";

describe("Agent onMessageAdded Callback", () => {
  let mockEnv: any;
  let messages: any[];
  let context: Context;
  const mockTools: Tool[] = [
    {
      name: "bash",
      description: "Run command",
      parameters: {} as any,
      execute: async () => ({ success: true, output: "test output" }),
    },
  ];

  beforeEach(() => {
    messages = [];
    
    context = {
      abort: new AbortController().signal,
      onMessageAdded: vi.fn((msg) => {
        messages.push(msg);
      }),
    };
    
    mockEnv = {
      invokeLLM: vi.fn(),
      getBehaviorSpec: vi.fn().mockResolvedValue({
        combinedPrompt: "You are a helpful assistant.",
      }),
      handle_action: vi.fn(),
    };
  });

  describe("with tool calls", () => {
    it("should store assistant message when LLM returns tool call", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValueOnce({
        success: true,
        output: {
          content: "I'll use a tool to help.",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "bash", arguments: '{"command": "echo test"}' },
            },
          ],
        },
      }).mockResolvedValueOnce({
        success: true,
        output: {
          content: "Final answer",
        },
      });

      mockEnv.handle_action = vi.fn().mockResolvedValue({
        success: true,
        output: "tool output",
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const assistantMessages = messages.filter(m => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
      const assistantContent = assistantMessages[0].content as any[];
      const textPart = assistantContent.find((p: any) => p.type === "text");
      expect(textPart?.text).toBe("I'll use a tool to help.");
    });

    it("should store tool message when tool executes successfully", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValueOnce({
        success: true,
        output: {
          content: "Using tool...",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "bash", arguments: '{"command": "echo test"}' },
            },
          ],
        },
      }).mockResolvedValueOnce({
        success: true,
        output: {
          content: "Final answer",
        },
      });

      mockEnv.handle_action = vi.fn().mockResolvedValue({
        success: true,
        output: "tool output",
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const toolMessages = messages.filter(m => m.role === "tool");
      expect(toolMessages.length).toBeGreaterThan(0);
      const toolContent = toolMessages[0].content as any[];
      const toolResultPart = toolContent.find((p: any) => p.type === "tool-result");
      expect(toolResultPart?.toolName).toBe("bash");
      expect(toolResultPart?.output?.value).toBe("tool output");
    });

    it("should store tool error message when tool execution fails", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValueOnce({
        success: true,
        output: {
          content: "Using tool...",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "bash", arguments: '{"command": "invalid"}' },
            },
          ],
        },
      }).mockResolvedValueOnce({
        success: true,
        output: {
          content: "Got error",
        },
      });

      mockEnv.handle_action = vi.fn().mockResolvedValue({
        success: false,
        output: "",
        error: "Command not found",
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const toolErrorMessages = messages.filter(m => m.role === "tool");
      expect(toolErrorMessages.length).toBeGreaterThan(0);
      const toolContent = toolErrorMessages[0].content as any[];
      const toolResultPart = toolContent.find((p: any) => p.type === "tool-result");
      expect(toolResultPart?.output?.value).toContain("Command not found");
    });
  });

  describe("without tool calls", () => {
    it("should store assistant message when LLM returns text only", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValue({
        success: true,
        output: {
          content: "Hello! How can I help you?",
        },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "hi", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        [],
        context
      );

      await agent.run();

      const assistantMessages = messages.filter(m => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages[0].content).toBe("Hello! How can I help you?");
    });

    it("should not store any tool messages when no tools called", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValue({
        success: true,
        output: {
          content: "Simple response",
        },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "hi", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        [],
        context
      );

      await agent.run();

      const toolMessages = messages.filter(m => m.role === "tool");
      expect(toolMessages.length).toBe(0);
    });
  });

  describe("with reasoning", () => {
    it("should store assistant message with reasoning content", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValue({
        success: true,
        output: {
          content: "The answer is 42.",
          reasoning: "Let me calculate: 20 + 22 = 42",
        },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "what is 20+22", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        [],
        context
      );

      await agent.run();

      const assistantMessages = messages.filter(m => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages[0].content).toBe("The answer is 42.");
    });
  });

  describe("without reasoning", () => {
    it("should store assistant message without reasoning", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValue({
        success: true,
        output: {
          content: "Plain response without reasoning",
        },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "hello", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        [],
        context
      );

      await agent.run();

      const assistantMessages = messages.filter(m => m.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages[0].content).toBe("Plain response without reasoning");
    });
  });

  describe("when interrupted", () => {
    it("should store messages before abort", async () => {
      const abortController = new AbortController();
      
      const interruptContext: Context = {
        abort: abortController.signal,
        onMessageAdded: vi.fn((msg) => {
          messages.push(msg);
        }),
      };

      let callCount = 0;
      mockEnv.invokeLLM = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            success: true,
            output: {
              content: "First response",
              tool_calls: [
                {
                  id: "call_1",
                  function: { name: "bash", arguments: '{"command": "echo test"}' },
                },
              ],
            },
          };
        }
        throw new Error("Aborted");
      });

      mockEnv.handle_action = vi.fn().mockImplementation(async () => {
        abortController.abort();
        return {
          success: true,
          output: "tool output before abort",
        };
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        interruptContext
      );

      try {
        await agent.run();
      } catch (e) {
        // Expected to be aborted
      }

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe("multiple tool calls", () => {
    it("should store multiple tool messages in sequence", async () => {
      mockEnv.invokeLLM = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          output: {
            content: "Checking system...",
            tool_calls: [
              { id: "call_1", function: { name: "bash", arguments: '{"command": "uptime"}' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          output: {
            content: "Now checking memory...",
            tool_calls: [
              { id: "call_2", function: { name: "bash", arguments: '{"command": "free"}' } },
            ],
          },
        })
        .mockResolvedValueOnce({
          success: true,
          output: { content: "All done" },
        });

      mockEnv.handle_action = vi.fn()
        .mockResolvedValueOnce({ success: true, output: "uptime output" })
        .mockResolvedValueOnce({ success: true, output: "memory output" });

      const agent = new Agent(
        { event_type: "user_query", content: "check system", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const toolMessages = messages.filter(m => m.role === "tool");
      expect(toolMessages.length).toBe(2);
      const toolContent1 = toolMessages[0].content as any[];
      const toolContent2 = toolMessages[1].content as any[];
      const toolResultPart1 = toolContent1.find((p: any) => p.type === "tool-result");
      const toolResultPart2 = toolContent2.find((p: any) => p.type === "tool-result");
      expect(toolResultPart1?.output?.value).toBe("uptime output");
      expect(toolResultPart2?.output?.value).toBe("memory output");
    });
  });

  describe("without onMessageAdded callback", () => {
    it("should work normally without callback", async () => {
      const contextWithoutCallback: Context = {
        abort: new AbortController().signal,
      };

      mockEnv.invokeLLM = vi.fn().mockResolvedValue({
        success: true,
        output: {
          content: "Response without callback",
        },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        [],
        contextWithoutCallback
      );

      const result = await agent.run();
      expect(result).toBe("Response without callback");
    });
  });

  describe("tool call validation errors", () => {
    it("should store error for invalid JSON arguments", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValueOnce({
        success: true,
        output: {
          content: "Trying tool...",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "bash", arguments: 'invalid json' },
            },
          ],
        },
      }).mockResolvedValueOnce({
        success: true,
        output: { content: "After error" },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const errorMessages = messages.filter(m => m.role === "tool");
      expect(errorMessages.length).toBeGreaterThan(0);
      const toolContent = errorMessages[0].content as any[];
      const toolResultPart = toolContent.find((p: any) => p.type === "tool-result");
      expect(toolResultPart?.output?.value).toContain("Invalid JSON");
    });

    it("should store error for disallowed tool", async () => {
      mockEnv.invokeLLM = vi.fn().mockResolvedValueOnce({
        success: true,
        output: {
          content: "Trying tool...",
          tool_calls: [
            {
              id: "call_123",
              function: { name: "disallowed_tool", arguments: '{}' },
            },
          ],
        },
      }).mockResolvedValueOnce({
        success: true,
        output: { content: "After error" },
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context
      );

      await agent.run();

      const errorMessages = messages.filter(m => m.role === "tool");
      expect(errorMessages.length).toBeGreaterThan(0);
      const toolContent = errorMessages[0].content as any[];
      const toolResultPart = toolContent.find((p: any) => p.type === "tool-result");
      expect(toolResultPart?.output?.value).toContain("not available");
    });
  });

  describe("with history parameter", () => {
    it("should include history messages in LLM call", async () => {
      const historyMessages: ModelMessage[] = [
        { role: "user", content: [{ type: "text", text: "Previous user message" }] },
        { role: "assistant", content: [{ type: "text", text: "Previous assistant response" }] },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "call_prev", toolName: "test_tool", output: { type: "text", value: "tool result" } }] as any },
      ];

      let capturedMessages: any[] = [];
      mockEnv.invokeLLM = vi.fn().mockImplementation((msgs: any[]) => {
        capturedMessages = msgs;
        return {
          success: true,
          output: { content: "Final answer" },
        };
      });

      const agent = new Agent(
        { event_type: "user_query", content: "new query", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context,
        {},
        historyMessages
      );

      await agent.run();

      // Verify history is included in messages sent to LLM
      // Should be: [system, user(history), assistant(history), tool(history), user(new query)]
      const roles = capturedMessages.map(m => m.role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
      expect(roles).toContain("tool");
      
      // Verify the new user query is at the end
      const lastUserMsg = capturedMessages[capturedMessages.length - 1];
      expect(lastUserMsg.role).toBe("user");
      expect(lastUserMsg.content).toBe("new query");
    });

    it("should work with empty history", async () => {
      let capturedMessages: any[] = [];
      mockEnv.invokeLLM = vi.fn().mockImplementation((msgs: any[]) => {
        capturedMessages = msgs;
        return {
          success: true,
          output: { content: "Final answer" },
        };
      });

      const agent = new Agent(
        { event_type: "user_query", content: "test query", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context,
        {},
        [] // empty history
      );

      await agent.run();

      // Should have: system + user
      expect(capturedMessages.length).toBe(2);
      expect(capturedMessages[0].role).toBe("system");
      expect(capturedMessages[1].role).toBe("user");
      expect(capturedMessages[1].content).toBe("test query");
    });

    it("should correctly order messages: system + history + new query", async () => {
      const historyMessages: ModelMessage[] = [
        { role: "user", content: [{ type: "text", text: "History user msg" }] },
        { role: "assistant", content: [{ type: "text", text: "History assistant msg" }] },
      ];

      let capturedMessages: any[] = [];
      mockEnv.invokeLLM = vi.fn().mockImplementation((msgs: any[]) => {
        capturedMessages = msgs;
        return {
          success: true,
          output: { content: "Done" },
        };
      });

      const agent = new Agent(
        { event_type: "user_query", content: "current query", timestamp: new Date().toISOString(), role: "user" },
        mockEnv as Environment,
        mockTools,
        context,
        {},
        historyMessages
      );

      await agent.run();

      // Order should be: system, history user, history assistant, current user
      expect(capturedMessages).toEqual([
        { role: "system", content: expect.any(String) },
        { role: "user", content: [{ type: "text", text: "History user msg" }] },
        { role: "assistant", content: [{ type: "text", text: "History assistant msg" }] },
        { role: "user", content: "current query" },
      ]);
    });
  });
});
