/**
 * @fileoverview Unit tests for invoke_llm tools (System 1 & System 2).
 * Tests return values and tool call handling.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  createSystem1IntuitiveReasoning,
  createInvokeLLM,
} from "../../src/environment/base/invoke-llm.js";
import type { LLMAdapter } from "../../src/environment/llm/index.js";

function createMockAdapter(): LLMAdapter {
  let customContent = "Hello, world!";
  let simulateError = false;
  let customUsage = { inputTokens: 10, outputTokens: 5 };

  return {
    name: "openai" as const,
    displayName: "OpenAI",
    configured: true,
    defaultModel: "gpt-4o",

    isConfigured() {
      return this.configured;
    },

    getDefaultModel() {
      return this.defaultModel;
    },

    async complete() {
      return { success: true as const, content: customContent, usage: customUsage };
    },

    async stream(_params: any, callbacks) {
      callbacks.onStart?.();

      if (simulateError) {
        callbacks.onError?.(new Error("Test simulated error"));
        return;
      }

      const words = customContent.split(" ");
      for (let i = 0; i < words.length; i++) {
        callbacks.onContent?.(words[i] + (i < words.length - 1 ? " " : ""), "text");
      }

      callbacks.onUsage?.(customUsage);
      callbacks.onComplete?.(customUsage);
    },
  };
}

describe("createSystem1IntuitiveReasoning (System 1)", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
  });

  test("creates tool with correct name", () => {
    const tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    expect(tool.name).toBe("system1_intuitive_reasoning");
  });

  test("has correct description", () => {
    const tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    expect(tool.description).toContain("System 1");
    expect(tool.description).toContain("Intuitive");
    expect(tool.description).toContain("simple tasks");
  });

  test("returns success for basic call", async () => {
    const tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
  });

  test("returns content in output", async () => {
    mockAdapter = createMockAdapter();
    const tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    if (result.output && typeof result.output === "object") {
      const output = result.output as Record<string, unknown>;
      expect(output.content).toContain("Hello");
      expect(output.model).toBe("gpt-4o");
      expect(output.provider).toBe("openai");
    }
  });

  test("handles error gracefully", async () => {
    let callCount = 0;
    const adapter = {
      name: "openai" as const,
      displayName: "OpenAI",
      configured: true,
      defaultModel: "gpt-4o",

      isConfigured() { return true; },
      getDefaultModel() { return "gpt-4o"; },

      async stream(_params: any, callbacks) {
        callCount++;
        callbacks.onError?.(new Error("API error"));
      },
    } as unknown as LLMAdapter;

    const tool = createSystem1IntuitiveReasoning({
      adapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("handles reasoning content", async () => {
    const adapter = {
      name: "openai" as const,
      displayName: "OpenAI",
      configured: true,
      defaultModel: "gpt-4o",

      isConfigured() { return true; },
      getDefaultModel() { return "gpt-4o"; },

      async stream(_params: any, callbacks) {
        callbacks.onStart?.();
        callbacks.onContent?.("Let me think...", "reasoning");
        callbacks.onContent?.("Here's the answer.", "text");
        callbacks.onComplete?.({ inputTokens: 10, outputTokens: 5 });
      },
    } as unknown as LLMAdapter;

    const tool = createSystem1IntuitiveReasoning({
      adapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Test" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
    if (result.output && typeof result.output === "object") {
      const output = result.output as Record<string, unknown>;
      expect(output.reasoning).toBe("Let me think...");
    }
  });
});

describe("createInvokeLLM", () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
  });

  test("creates tool with correct name", () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    expect(tool.name).toBe("invoke_llm");
  });

  test("has internal LLM description", () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    expect(tool.description).toContain("Internal");
    expect(tool.description).toContain("tool_calls");
    expect(tool.description).toContain("Framework internal");
  });

  test("returns success for basic call", async () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
  });

  test("returns content in output", async () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
    if (result.output && typeof result.output === "object") {
      const output = result.output as Record<string, unknown>;
      expect(output.content).toContain("Hello");
      expect(output.model).toBe("gpt-4o");
    }
  });

  test("includes usage in metadata", async () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata?.execution_time_ms).toBeGreaterThanOrEqual(0);
  });

  test("handles error gracefully", async () => {
    const adapter = {
      name: "openai" as const,
      displayName: "OpenAI",
      configured: true,
      defaultModel: "gpt-4o",

      isConfigured() { return true; },
      getDefaultModel() { return "gpt-4o"; },

      async stream(_params: any, callbacks) {
        callbacks.onError?.(new Error("API error"));
      },
    } as unknown as LLMAdapter;

    const tool = createInvokeLLM({
      adapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("uses model from args when provided", async () => {
    const tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }], model: "custom-model" },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
    if (result.output && typeof result.output === "object") {
      const output = result.output as Record<string, unknown>;
      expect(output.model).toBe("custom-model");
    }
  });

  test("accepts all common parameters", async () => {
    const tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }], temperature: 0.7, maxTokens: 100, topP: 0.9 },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
  });

  test("handles reasoning content", async () => {
    let reasoningContent = "";

    const adapter = {
      name: "openai" as const,
      displayName: "OpenAI",
      configured: true,
      defaultModel: "gpt-4o",

      isConfigured() { return true; },
      getDefaultModel() { return "gpt-4o"; },

      async stream(_params: any, callbacks) {
        callbacks.onStart?.();
        callbacks.onContent?.("Let me think...", "reasoning");
        callbacks.onContent?.("Here's the answer.", "text");
        callbacks.onComplete?.({ inputTokens: 10, outputTokens: 5 });
      },
    } as unknown as LLMAdapter;

    const tool = createInvokeLLM({
      adapter,
      defaultModel: "gpt-4o",
    });

    const result = await tool.execute(
      { messages: [{ role: "user", content: "Test" }] },
      { session_id: "test-session" }
    );

    expect(result.success).toBe(true);
    if (result.output && typeof result.output === "object") {
      const output = result.output as Record<string, unknown>;
      expect(output.reasoning).toBe("Let me think...");
    }
  });
});

describe("Both tools comparison", () => {
  test("have same parameter schema", () => {
    const mockAdapter = createMockAdapter();

    const system1Tool = createSystem1IntuitiveReasoning({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const system2Tool = createInvokeLLM({
      adapter: mockAdapter,
      defaultModel: "gpt-4o",
    });

    const testData = {
      messages: [{ role: "user" as const, content: "Hello" }],
      model: "test-model",
      temperature: 0.7,
      maxTokens: 100,
      topP: 0.9,
      stop: ["\n"],
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
    };

    expect(system1Tool.parameters.safeParse(testData).success).toBe(true);
    expect(system2Tool.parameters.safeParse(testData).success).toBe(true);
  });
});
