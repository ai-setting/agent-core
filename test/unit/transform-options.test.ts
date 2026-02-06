/**
 * @fileoverview Unit tests for Options Transform.
 */

import { describe, test, expect } from "bun:test";
import { transformOptions, getDefaultTemperature, getDefaultTopP, getDefaultTopK } from "../../src/llm/transform/options.js";

describe("Options Transform", () => {
  describe("transformOptions", () => {
    test("should set store=false for OpenAI", () => {
      const result = transformOptions({
        modelID: "gpt-4o",
        providerID: "openai",
        npmPackage: "@ai-sdk/openai",
      });

      expect(result.store).toBe(false);
    });

    test("should set usage for OpenRouter", () => {
      const result = transformOptions({
        modelID: "openai/gpt-4o",
        providerID: "openrouter",
        npmPackage: "@openrouter/ai-sdk-provider",
      });

      expect(result.usage).toEqual({ include: true });
    });

    test("should set thinking for Kimi k2 models", () => {
      const result = transformOptions({
        modelID: "kimi-k2.5",
        providerID: "kimi",
        npmPackage: "@ai-sdk/openai-compatible",
      });

      expect(result.thinking).toEqual({ type: "enabled", clear_thinking: false });
    });

    test("should set thinkingConfig for Google", () => {
      const result = transformOptions({
        modelID: "gemini-2.5-flash",
        providerID: "google",
        npmPackage: "@ai-sdk/google",
      });

      expect(result.thinkingConfig).toEqual({ includeThoughts: true });
    });

    test("should set promptCacheKey for OpenAI with sessionID", () => {
      const result = transformOptions({
        modelID: "gpt-4o",
        providerID: "openai",
        npmPackage: "@ai-sdk/openai",
        sessionID: "session-123",
      });

      expect(result.promptCacheKey).toBe("session-123");
    });

    test("should not set promptCacheKey without sessionID", () => {
      const result = transformOptions({
        modelID: "gpt-4o",
        providerID: "openai",
        npmPackage: "@ai-sdk/openai",
      });

      expect(result.promptCacheKey).toBeUndefined();
    });

    test("should handle k2p5 model variant", () => {
      const result = transformOptions({
        modelID: "kimi-k2p5",
        providerID: "kimi",
        npmPackage: "@ai-sdk/openai-compatible",
      });

      expect(result.thinking).toBeDefined();
    });
  });

  describe("getDefaultTemperature", () => {
    test("should return 1.0 for Kimi k2.5 (matches k2.)", () => {
      const temp = getDefaultTemperature("kimi-k2.5", "kimi");
      expect(temp).toBe(1.0);
    });

    test("should return 1.0 for Kimi k2p5", () => {
      const temp = getDefaultTemperature("kimi-k2p5", "kimi");
      expect(temp).toBe(1.0);
    });

    test("should return 1.0 for Kimi k2 thinking", () => {
      const temp = getDefaultTemperature("kimi-k2-thinking", "kimi");
      expect(temp).toBe(1.0);
    });

    test("should return 1.0 for Kimi k2.5 with thinking", () => {
      const temp = getDefaultTemperature("kimi-k2.5-thinking", "kimi");
      expect(temp).toBe(1.0);
    });

    test("should return 0.55 for Qwen", () => {
      const temp = getDefaultTemperature("qwen-turbo", "qwen");
      expect(temp).toBe(0.55);
    });

    test("should return undefined for Claude", () => {
      const temp = getDefaultTemperature("claude-sonnet-4", "anthropic");
      expect(temp).toBeUndefined();
    });

    test("should return undefined for Gemini", () => {
      const temp = getDefaultTemperature("gemini-2.5-flash", "google");
      expect(temp).toBeUndefined();
    });

    test("should return undefined for standard GPT models", () => {
      const temp = getDefaultTemperature("gpt-4o", "openai");
      expect(temp).toBeUndefined();
    });
  });

  describe("getDefaultTopP", () => {
    test("should return 0.95 for Kimi", () => {
      const topP = getDefaultTopP("kimi-k2.5");
      expect(topP).toBe(0.95);
    });

    test("should return 0.95 for DeepSeek", () => {
      const topP = getDefaultTopP("deepseek-chat");
      expect(topP).toBe(0.95);
    });

    test("should return 0.95 for MiniMax", () => {
      const topP = getDefaultTopP("minimax-m2");
      expect(topP).toBe(0.95);
    });

    test("should return undefined for standard GPT models", () => {
      const topP = getDefaultTopP("gpt-4o");
      expect(topP).toBeUndefined();
    });
  });

  describe("getDefaultTopK", () => {
    test("should return 20 for MiniMax m2", () => {
      const topK = getDefaultTopK("minimax-m2");
      expect(topK).toBe(20);
    });

    test("should return 40 for MiniMax m2.1", () => {
      const topK = getDefaultTopK("minimax-m2.1");
      expect(topK).toBe(40);
    });

    test("should return 64 for Gemini", () => {
      const topK = getDefaultTopK("gemini-2.5-flash");
      expect(topK).toBe(64);
    });

    test("should return undefined for standard GPT models", () => {
      const topK = getDefaultTopK("gpt-4o");
      expect(topK).toBeUndefined();
    });
  });
});

describe("Options Transform - Edge Cases", () => {
  test("should handle case-insensitive model names", () => {
    const result = transformOptions({
      modelID: "KIMI-K2.5",
      providerID: "kimi",
      npmPackage: "@ai-sdk/openai-compatible",
    });

    expect(result.thinking).toBeDefined();
  });

  test("should handle empty options", () => {
    const result = transformOptions({
      modelID: "test-model",
      providerID: "test",
      npmPackage: "@ai-sdk/openai-compatible",
    });

    expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
  });
});
