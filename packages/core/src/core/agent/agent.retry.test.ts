/**
 * @fileoverview Agent retry mechanism tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Agent } from "./index.js";
import type { Event, Tool, ToolContext } from "../types/index.js";

// Helper to create a minimal mock environment
function createMockEnv(overrides: any = {}) {
  return {
    getBehaviorSpec: vi.fn().mockResolvedValue({
      combinedPrompt: "You are a helpful assistant.",
    }),
    getProviderLLMOptions: vi.fn().mockResolvedValue({
      temperature: 0.7,
      maxTokens: 4000,
    }),
    getDefaultModel: vi.fn().mockReturnValue("minimax/MiniMax-M2.5"),
    invokeLLM: vi.fn(),
    handle_action: vi.fn(),
    ...overrides,
  };
}

// Helper to create a basic event
function createMockEvent(content: string = "test query"): Event {
  return {
    event_type: "test.event",
    timestamp: new Date().toISOString(),
    role: "user",
    content,
  };
}

describe("Agent retry mechanism", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isRateLimitError", () => {
    // Import isRateLimitError for testing
    const { isRateLimitError } = require("./index.js");

    it("should detect MiniMax 2062 rate limit error", () => {
      const errorMessage = "当前处于高峰时段，Token Plan 的速率限制可能会临时收紧。请稍后重试，并请适当控制请求并发度。 (2062)";
      expect(isRateLimitError(errorMessage)).toBe(true);
    });

    it("should detect 2062 in plain error message", () => {
      expect(isRateLimitError("LLM call failed: API error: 2062")).toBe(true);
    });

    it("should return false for non-rate-limit errors", () => {
      expect(isRateLimitError("Connection refused")).toBe(false);
      expect(isRateLimitError("Invalid API key")).toBe(false);
      expect(isRateLimitError("")).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isRateLimitError(null as any)).toBe(false);
      expect(isRateLimitError(undefined as any)).toBe(false);
    });
  });

  describe("exponential backoff delay", () => {
    it("should calculate correct delays for normal errors", async () => {
      const mockInvokeLLM = vi.fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({ success: true, output: { content: "done", tool_calls: [] } });

      const mockEnv = createMockEnv({
        invokeLLM: mockInvokeLLM,
      });

      const agent = new Agent(
        createMockEvent("test"),
        mockEnv as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime = Date.now();
      await agent.run();
      
      // Should have waited at least 2s (base delay) before retry
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(1900); // 1.9s to account for timing variance
    });

    it("should use longer delay for rate limit errors", async () => {
      const rateLimitError = new Error(
        "当前处于高峰时段，Token Plan 的速率限制可能会临时收紧。请稍后重试，并请适当控制请求并发度。 (2062)"
      );

      const mockInvokeLLM = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue({ success: true, output: { content: "done", tool_calls: [] } });

      const mockEnv = createMockEnv({
        invokeLLM: mockInvokeLLM,
      });

      const agent = new Agent(
        createMockEvent("test"),
        mockEnv as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime = Date.now();
      await agent.run();
      
      // Should have waited at least 4s (2x base delay) for rate limit
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(3900); // 3.9s to account for timing variance
    });
  });

  describe("retry with rate limit errors", () => {
    it("should retry on rate limit error with extra delay", async () => {
      const rateLimitError = new Error(
        "当前处于高峰时段，Token Plan 的速率限制可能会临时收紧。请稍后重试，并请适当控制请求并发度。 (2062)"
      );

      let callCount = 0;
      const mockInvokeLLM = async () => {
        callCount++;
        if (callCount < 3) {
          throw rateLimitError;
        }
        return { success: true, output: { content: "done", tool_calls: [] } };
      };

      const mockEnv = createMockEnv({
        invokeLLM: mockInvokeLLM,
      });

      const agent = new Agent(
        createMockEvent("test"),
        mockEnv as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime = Date.now();
      const result = await agent.run();
      
      // Should succeed on third attempt
      expect(result).toBe("done");
      expect(callCount).toBe(3);
      
      // Total delay: retry 1 (4s) + retry 2 (8s) = ~12s (with some variance)
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(11500);
    }, 30000);

    it("should eventually fail after max retries on rate limit", async () => {
      const rateLimitError = new Error(
        "当前处于高峰时段，Token Plan 的速率限制可能会临时收紧。请稍后重试，并请适当控制请求并发度。 (2062)"
      );

      // Use vi.fn to track calls
      const mockInvokeLLM = vi.fn().mockRejectedValue(rateLimitError);

      const mockEnv = createMockEnv({
        invokeLLM: mockInvokeLLM,
      });

      const agent = new Agent(
        createMockEvent("test"),
        mockEnv as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime = Date.now();
      
      await expect(agent.run()).rejects.toThrow(/Max error retries \(3\) exceeded/);
      
      // Should have been called exactly 3 times
      expect(mockInvokeLLM).toHaveBeenCalledTimes(3);
      
      // Total delay: retry 1 (4s) + retry 2 (8s) = ~12s
      // Note: After 2 retries fail, the 3rd error throws immediately (no delay before throwing)
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(11000);
    }, 30000);
  });

  describe("retry with normal errors", () => {
    it("should retry on transient errors", async () => {
      const mockInvokeLLM = vi.fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValue({ success: true, output: { content: "done", tool_calls: [] } });

      const mockEnv = createMockEnv({
        invokeLLM: mockInvokeLLM,
      });

      const agent = new Agent(
        createMockEvent("test"),
        mockEnv as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const result = await agent.run();
      
      expect(result).toBe("done");
      expect(mockInvokeLLM).toHaveBeenCalledTimes(2);
    });

    it("should use shorter delays for normal errors vs rate limit", async () => {
      const normalError = new Error("Network error");
      const rateLimitError = new Error("Rate limit (2062)");

      // Mock with normal error
      const mockInvokeLLM1 = vi.fn()
        .mockRejectedValueOnce(normalError)
        .mockResolvedValue({ success: true, output: { content: "done", tool_calls: [] } });

      const mockEnv1 = createMockEnv({
        invokeLLM: mockInvokeLLM1,
      });

      const agent1 = new Agent(
        createMockEvent("test"),
        mockEnv1 as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime1 = Date.now();
      await agent1.run();
      const elapsed1 = Date.now() - startTime1;

      // Mock with rate limit error
      const mockInvokeLLM2 = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue({ success: true, output: { content: "done", tool_calls: [] } });

      const mockEnv2 = createMockEnv({
        invokeLLM: mockInvokeLLM2,
      });

      const agent2 = new Agent(
        createMockEvent("test"),
        mockEnv2 as any,
        [] as Tool[],
        {},
        { maxIterations: 10, maxErrorRetries: 3 }
      );

      const startTime2 = Date.now();
      await agent2.run();
      const elapsed2 = Date.now() - startTime2;

      // Rate limit delay should be approximately 2x normal delay
      expect(elapsed2).toBeGreaterThan(elapsed1);
    }, 10000); // 10 second timeout for rate limit delay
  });
});
