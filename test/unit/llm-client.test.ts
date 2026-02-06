/**
 * @fileoverview Unit tests for LLM Client.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { LLMClient, createLLMClient } from "../../src/llm/client.js";

describe("LLMClient", () => {
  describe("constructor", () => {
    test("should parse model with provider prefix", () => {
      const client = new LLMClient({ model: "openai/gpt-4o" });
      expect((client as any).sdk.providerID).toBe("openai");
      expect((client as any).sdk.modelID).toBe("gpt-4o");
    });

    test("should default to openai provider when no prefix", () => {
      const client = new LLMClient({ model: "gpt-4o" });
      expect((client as any).sdk.providerID).toBe("openai");
      expect((client as any).sdk.modelID).toBe("gpt-4o");
    });

    test("should parse complex model names", () => {
      const client = new LLMClient({ model: "anthropic/claude-sonnet-4-20250514" });
      expect((client as any).sdk.providerID).toBe("anthropic");
      expect((client as any).sdk.modelID).toBe("claude-sonnet-4-20250514");
    });

    test("should set apiKey from options", () => {
      const client = new LLMClient({
        model: "test-model",
        apiKey: "test-key",
      });
      expect((client as any).options.apiKey).toBe("test-key");
    });

    test("should set baseURL from options", () => {
      const client = new LLMClient({
        model: "test-model",
        baseURL: "https://custom.api.com/v1",
      });
      expect((client as any).options.baseURL).toBe("https://custom.api.com/v1");
    });

    test("should set default maxTokens", () => {
      const client = new LLMClient({ model: "test-model" });
      expect((client as any).options.maxTokens).toBe(4096);
    });

    test("should override maxTokens", () => {
      const client = new LLMClient({
        model: "test-model",
        maxTokens: 8192,
      });
      expect((client as any).options.maxTokens).toBe(8192);
    });

    test("should set sessionID", () => {
      const client = new LLMClient({
        model: "test-model",
        sessionID: "session-123",
      });
      expect((client as any).options.sessionID).toBe("session-123");
    });
  });

  describe("createLLMClient", () => {
    test("should create LLMClient instance", () => {
      const client = createLLMClient({ model: "gpt-4o" });
      expect(client).toBeInstanceOf(LLMClient);
    });
  });

  describe("model parsing", () => {
    test("should handle single segment model", () => {
      const client = new LLMClient({ model: "llama-3" });
      const sdk = (client as any).sdk;
      expect(sdk.providerID).toBe("openai");
      expect(sdk.modelID).toBe("llama-3");
    });

    test("should handle multiple segments in model name", () => {
      const client = new LLMClient({ model: "openai/gpt-4o/turbo" });
      const sdk = (client as any).sdk;
      expect(sdk.providerID).toBe("openai");
      expect(sdk.modelID).toBe("gpt-4o/turbo");
    });

    test("should handle kimi provider", () => {
      const client = new LLMClient({ model: "kimi/kimi-k2.5" });
      const sdk = (client as any).sdk;
      expect(sdk.providerID).toBe("kimi");
      expect(sdk.modelID).toBe("kimi-k2.5");
    });

    test("should handle deepseek provider", () => {
      const client = new LLMClient({ model: "deepseek/deepseek-chat" });
      const sdk = (client as any).sdk;
      expect(sdk.providerID).toBe("deepseek");
      expect(sdk.modelID).toBe("deepseek-chat");
    });
  });
});

describe("LLMClient options", () => {
  test("should store temperature setting", () => {
    const client = new LLMClient({
      model: "test-model",
      temperature: 0.7,
    });
    expect((client as any).options.temperature).toBe(0.7);
  });

  test("should allow null temperature", () => {
    const client = new LLMClient({
      model: "test-model",
      temperature: null,
    });
    expect((client as any).options.temperature).toBeUndefined();
  });
});
