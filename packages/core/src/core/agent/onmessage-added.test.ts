/**
 * @fileoverview Tests for Agent onMessageAdded callback functionality.
 * Verifies that intermediate messages are properly stored during agent execution.
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Agent } from "./index.js";
import type { Environment } from "../environment/index.js";
import type { Context } from "../types/context.js";
import type { Tool } from "../types/index.js";

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
      expect(assistantMessages[0].content).toBe("I'll use a tool to help.");
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
      expect(toolMessages[0].name).toBe("bash");
      expect(toolMessages[0].content).toBe("tool output");
      expect(toolMessages[0].tool_call_id).toBe("call_123");
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

      const toolErrorMessages = messages.filter(m => m.role === "tool" && m.content.includes("Error"));
      expect(toolErrorMessages.length).toBeGreaterThan(0);
      expect(toolErrorMessages[0].content).toContain("Command not found");
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
      expect(toolMessages[0].content).toBe("uptime output");
      expect(toolMessages[1].content).toBe("memory output");
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

      const errorMessages = messages.filter(m => m.role === "tool" && m.content.includes("Invalid JSON"));
      expect(errorMessages.length).toBeGreaterThan(0);
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

      const errorMessages = messages.filter(m => m.role === "tool" && m.content.includes("not available"));
      expect(errorMessages.length).toBeGreaterThan(0);
    });
  });
});
