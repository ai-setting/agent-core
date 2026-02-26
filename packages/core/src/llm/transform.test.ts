/**
 * @fileoverview Tests for LLM Transform Layer
 */

import { describe, it, expect } from "bun:test";
import { LLMTransform } from "./transform.js";
import type { ProviderMetadata, ModelMetadata, ModelCapabilities } from "./types.js";
import type { ModelMessage } from "ai";

describe("LLMTransform", () => {
  const mockProvider = (sdkType: string): ProviderMetadata => ({
    id: "test",
    name: "Test Provider",
    baseURL: "https://api.test.com",
    apiKey: "test-key",
    models: [],
    defaultModel: "test-model",
    sdkType: sdkType as any,
  });

  const mockModel = (id: string): ModelMetadata => ({
    id,
    capabilities: {
      temperature: true,
      reasoning: false,
      toolcall: true,
      attachment: false,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false },
    },
    limits: { contextWindow: 8192 },
  });

  describe("normalizeMessages", () => {
    describe("Anthropic provider", () => {
      it("should filter out empty string messages", () => {
        const messages: ModelMessage[] = [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "" },
          { role: "user", content: "World" },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("anthropic"),
          mockModel("claude-3")
        );

        expect(result).toHaveLength(2);
        expect(result[0].content).toBe("Hello");
        expect(result[1].content).toBe("World");
      });

      it("should filter messages with all empty parts", () => {
        const messages: ModelMessage[] = [
          { role: "user", content: "Hello" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "" },
              { type: "text", text: "" },
            ] as any,
          },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("anthropic"),
          mockModel("claude-3")
        );

        expect(result).toHaveLength(1);
      });

      it("should normalize toolCallId to alphanumeric, underscore, hyphen", () => {
        const messages: ModelMessage[] = [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_abc-123.def",
                toolName: "testTool",
                args: {},
              },
            ] as any,
          },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("anthropic"),
          mockModel("claude-3")
        );

        const content = result[0].content as any[];
        expect(content[0].toolCallId).toBe("call_abc-123_def");
      });
    });

    describe("Mistral model", () => {
      it("should normalize toolCallId to exactly 9 alphanumeric characters", () => {
        const messages: ModelMessage[] = [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "very-long-id-123456789",
                toolName: "testTool",
                args: {},
              },
            ] as any,
          },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("openai-compatible"),
          mockModel("mistral-large")
        );

        const content = result[0].content as any[];
        expect(content[0].toolCallId).toBe("verylongi");
        expect(content[0].toolCallId).toHaveLength(9);
      });

      it("should pad short toolCallId with zeros", () => {
        const messages: ModelMessage[] = [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "abc",
                toolName: "testTool",
                args: {},
              },
            ] as any,
          },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("openai-compatible"),
          mockModel("mistral-large")
        );

        const content = result[0].content as any[];
        expect(content[0].toolCallId).toBe("abc000000");
        expect(content[0].toolCallId).toHaveLength(9);
      });

      it("should insert empty assistant message after tool message followed by user", () => {
        const messages: ModelMessage[] = [
          {
            role: "tool",
            content: [{ type: "tool-result", toolCallId: "abc123", toolName: "test", result: "ok" }] as any,
          },
          { role: "user", content: "Next question" },
        ];

        const result = LLMTransform.normalizeMessages(
          messages,
          mockProvider("openai-compatible"),
          mockModel("mistral-large")
        );

        expect(result).toHaveLength(3);
        expect(result[1].role).toBe("assistant");
        expect((result[1].content as any)[0].text).toBe("Done.");
      });
    });
  });

  describe("generateProviderOptions", () => {
    it("should include temperature when supported", () => {
      const result = LLMTransform.generateProviderOptions(
        mockProvider("openai"),
        mockModel("gpt-4"),
        { temperature: 0.7 }
      );

      expect(result.temperature).toBe(0.7);
    });

    it("should include maxTokens when provided", () => {
      const result = LLMTransform.generateProviderOptions(
        mockProvider("openai"),
        mockModel("gpt-4"),
        { maxTokens: 1000 }
      );

      expect(result.maxTokens).toBe(1000);
    });

    it("should cap maxTokens to model limit", () => {
      const model = mockModel("gpt-4");
      model.limits.maxOutputTokens = 500;

      const result = LLMTransform.generateProviderOptions(
        mockProvider("openai"),
        model,
        { maxTokens: 1000 }
      );

      expect(result.maxTokens).toBe(500);
    });

    it("should generate Anthropic thinking options for reasoning models", () => {
      const provider = mockProvider("anthropic");
      const model = mockModel("claude-3-opus");
      model.capabilities.reasoning = true;

      const result = LLMTransform.generateProviderOptions(
        provider,
        model,
        { variant: "high" }
      );

      expect(result.providerOptions).toBeDefined();
      expect(result.providerOptions.anthropic).toBeDefined();
      expect(result.providerOptions.anthropic.thinking).toBeDefined();
      expect(result.providerOptions.anthropic.thinking.type).toBe("enabled");
    });

    it("should generate OpenAI reasoning options for reasoning models", () => {
      const provider = mockProvider("openai");
      const model = mockModel("gpt-4");
      model.capabilities.reasoning = true;

      const result = LLMTransform.generateProviderOptions(
        provider,
        model,
        { variant: "high" }
      );

      expect(result.providerOptions).toBeDefined();
      expect(result.providerOptions.openai).toBeDefined();
      expect(result.providerOptions.openai.reasoningEffort).toBe("high");
    });
  });

  describe("applyCaching", () => {
    it("should return messages unchanged for non-Anthropic providers", () => {
      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
      ];

      const result = LLMTransform.applyCaching(
        messages,
        mockProvider("openai")
      );

      expect(result).toEqual(messages);
    });

    it("should apply cache control to system messages for Anthropic", () => {
      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
      ];

      const result = LLMTransform.applyCaching(
        messages,
        mockProvider("anthropic")
      );

      const systemMsg = result[0] as any;
      expect(systemMsg.providerOptions).toBeDefined();
      expect(systemMsg.providerOptions.anthropic.cacheControl.type).toBe("ephemeral");
    });

    it("should apply cache control to recent non-system messages for Anthropic", () => {
      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Question 1" },
        { role: "assistant", content: "Answer 1" },
        { role: "user", content: "Question 2" },
        { role: "assistant", content: "Answer 2" },
      ];

      const result = LLMTransform.applyCaching(
        messages,
        mockProvider("anthropic")
      );

      // System message should be cached
      expect((result[0] as any).providerOptions).toBeDefined();
      
      // Recent messages should be cached
      expect((result[3] as any).providerOptions).toBeDefined();
      expect((result[4] as any).providerOptions).toBeDefined();
      
      // Older messages should not be cached
      expect((result[1] as any).providerOptions).toBeUndefined();
      expect((result[2] as any).providerOptions).toBeUndefined();
    });
  });
});
