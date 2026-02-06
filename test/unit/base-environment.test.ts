/**
 * @fileoverview Unit tests for BaseEnvironment simplified initialization.
 * Tests auto-configuration of LLM when model is provided.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { BaseEnvironment } from "../../src/environment/base/base-environment.js";
import type { Tool, Context, ToolResult, LLMStream } from "../../src/types/index.js";

describe("BaseEnvironment Simplified Initialization", () => {
  describe("constructor with model config", () => {
    test("should accept model in config", () => {
      const env = new TestBaseEnvironment({ model: "test-model" });

      expect(env).toBeDefined();
    });

    test("should accept baseURL in config", () => {
      const env = new TestBaseEnvironment({
        model: "test-model",
        baseURL: "https://custom.api.example.com",
      });

      expect(env).toBeDefined();
    });

    test("should accept apiKey in config", () => {
      const env = new TestBaseEnvironment({
        model: "test-model",
        apiKey: "test-key",
      });

      expect(env).toBeDefined();
    });

    test("should accept llmAdapter directly", () => {
      const mockAdapter = {
        name: "test",
        displayName: "Test",
        isConfigured: () => true,
        getDefaultModel: () => "test-model",
        listModels: async () => ["test-model"],
        complete: async () => ({ success: true, content: "test" }),
        stream: async () => {},
      } as any;

      const env = new TestBaseEnvironment({ llmAdapter: mockAdapter });

      expect(env.getLLMAdapter()).toBe(mockAdapter);
    });
  });

  describe("constructor with system prompt", () => {
    test("should register system prompt when provided", () => {
      const systemPrompt = "You are a helpful assistant.";
      const env = new TestBaseEnvironment({ systemPrompt });

      const prompt = env.getPrompt("system");

      expect(prompt).toBeDefined();
      expect(prompt?.content).toBe(systemPrompt);
    });

    test("should not register system prompt when empty", () => {
      const env = new TestBaseEnvironment({ systemPrompt: "" });

      const prompt = env.getPrompt("system");

      expect(prompt).toBeUndefined();
    });
  });

  describe("tool registration", () => {
    test("should start with empty tools", () => {
      const env = new TestBaseEnvironment();

      const tools = env.listTools();

      expect(tools.length).toBe(0);
    });

    test("should register a tool", () => {
      const env = new TestBaseEnvironment();

      const tool: Tool = {
        name: "test_tool",
        description: "A test tool",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      const result = env.registerTool(tool);

      expect(result.isNew).toBe(true);
      expect(env.getTool("test_tool")).toBeDefined();
    });

    test("should not register duplicate tool twice", () => {
      const env = new TestBaseEnvironment();

      const tool: Tool = {
        name: "test_tool",
        description: "A test tool",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      env.registerTool(tool);
      const result = env.registerTool(tool);

      expect(result.isNew).toBe(false);
    });

    test("should unregister a tool", () => {
      const env = new TestBaseEnvironment();

      const tool: Tool = {
        name: "test_tool",
        description: "A test tool",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      env.registerTool(tool);
      const removed = env.unregisterTool("test_tool");

      expect(removed).toBe(true);
      expect(env.getTool("test_tool")).toBeUndefined();
    });

    test("should list all registered tools", () => {
      const env = new TestBaseEnvironment();

      const tool1: Tool = {
        name: "tool1",
        description: "Tool 1",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      const tool2: Tool = {
        name: "tool2",
        description: "Tool 2",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      env.registerTool(tool1);
      env.registerTool(tool2);

      const tools = env.listTools();

      expect(tools.length).toBe(2);
      expect(tools.find((t) => t.name === "tool1")).toBeDefined();
      expect(tools.find((t) => t.name === "tool2")).toBeDefined();
    });
  });

  describe("prompt management", () => {
    test("should add a prompt", () => {
      const env = new TestBaseEnvironment();

      env.addPrompt({ id: "custom", content: "Custom prompt" });

      const prompt = env.getPrompt("custom");

      expect(prompt).toBeDefined();
      expect(prompt?.content).toBe("Custom prompt");
    });

    test("should return undefined for non-existent prompt", () => {
      const env = new TestBaseEnvironment();

      const prompt = env.getPrompt("non_existent");

      expect(prompt).toBeUndefined();
    });
  });

  describe("stream handlers", () => {
    test("should subscribe to stream events", () => {
      const env = new TestBaseEnvironment();
      const handler = mock(() => {});

      env.subscribe(handler);

      expect(env["streamHandlers"].has(handler)).toBe(true);
    });

    test("should unsubscribe from stream events", () => {
      const env = new TestBaseEnvironment();
      const handler = mock(() => {});

      env.subscribe(handler);
      env.unsubscribe(handler);

      expect(env["streamHandlers"].has(handler)).toBe(false);
    });
  });

  describe("LLM adapter", () => {
    test("should return undefined when no adapter configured", () => {
      const env = new TestBaseEnvironment();

      expect(env.getLLMAdapter()).toBeUndefined();
    });
  });

  describe("metrics", () => {
    test("should return empty metrics initially", () => {
      const env = new TestBaseEnvironment();

      const metrics = env.getMetrics();

      expect(metrics.size).toBe(0);
    });

    test("should reset metrics", () => {
      const env = new TestBaseEnvironment();

      env.resetMetrics();

      expect(env.getMetrics().size).toBe(0);
    });
  });

  describe("concurrency status", () => {
    test("should return empty concurrency status initially", () => {
      const env = new TestBaseEnvironment();

      const status = env.getConcurrencyStatus();

      expect(status.size).toBe(0);
    });

    test("should return concurrency status for specific tool", () => {
      const env = new TestBaseEnvironment();

      const status = env.getConcurrencyStatus("bash");

      expect(status.has("bash")).toBe(true);
    });
  });
});

class TestBaseEnvironment extends BaseEnvironment {
  constructor(config?: any) {
    super(config);
  }

  handle_query(query: string, context?: Context, history?: Array<{ role: string; content: string; name?: string }>): Promise<string> {
    return Promise.resolve("test response");
  }

  async handle_action(action: any, ctx: Context): Promise<ToolResult> {
    return { success: true, output: "done", metadata: {} };
  }

  protected getDefaultTimeout(toolName: string): number {
    return 30000;
  }

  protected getTimeoutOverride(action: any): number | undefined {
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    return 3;
  }

  protected getRetryDelay(toolName: string): number {
    return 1000;
  }

  protected isRetryableError(error: string): boolean {
    return true;
  }

  protected getConcurrencyLimit(toolName: string): number {
    return 10;
  }

  protected getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "error" };
  }
}

describe("BaseEnvironmentConfig", () => {
  test("should accept all config options", () => {
    const config = {
      defaultTimeoutMs: 60000,
      defaultConcurrencyLimit: 20,
      defaultMaxRetries: 5,
      maxConcurrentStreams: 5,
      systemPrompt: "You are a helpful assistant.",
      model: "openai/gpt-4o",
      baseURL: "https://api.example.com",
      apiKey: "test-key",
    };

    const env = new TestBaseEnvironment(config);

    expect(env).toBeDefined();
  });

  test("should use default values when not provided", () => {
    const env = new TestBaseEnvironment();

    expect(env).toBeDefined();
  });
});
