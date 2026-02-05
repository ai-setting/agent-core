/**
 * @fileoverview Unit tests for OpenAI adapter.
 * Tests streaming, content parsing, and reasoning support.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";
import { OpenAIAdapter } from "../../src/environment/llm/adapters/openai.js";
import type { LLMCallbacks } from "../../src/environment/llm/index.js";

describe("OpenAIAdapter", () => {
  describe("constructor", () => {
    test("creates adapter with API key", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
      });
      expect(adapter).toBeDefined();
    });

    test("sets default base URL to OpenAI", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
      });
      expect((adapter as any).config.baseURL).toBe("https://api.openai.com/v1");
    });

    test("uses custom base URL when provided", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        baseURL: "https://custom.api.com/v1",
      });
      expect((adapter as any).config.baseURL).toBe("https://custom.api.com/v1");
    });

    test("sets default model to gpt-4", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
      });
      expect((adapter as any).config.defaultModel).toBe("gpt-4");
    });
  });

  describe("isConfigured", () => {
    test("returns true when API key is set", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      expect(adapter.isConfigured()).toBe(true);
    });

    test("returns false when API key is empty", () => {
      const adapter = new OpenAIAdapter({ apiKey: "" });
      expect(adapter.isConfigured()).toBe(false);
    });

    test("returns false when API key is undefined", () => {
      const adapter = new OpenAIAdapter({ apiKey: undefined as any });
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe("getDefaultModel", () => {
    test("returns configured default model", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        defaultModel: "gpt-4o",
      });
      expect(adapter.getDefaultModel()).toBe("gpt-4o");
    });
  });

  describe("stream parsing", () => {
    test("parses content chunk correctly", () => {
      const line = 'data: {"id":"test","object":"chat.completion.chunk","created":123,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let contentReceived = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk, type) => {
          contentReceived += chunk;
        },
      };

      (adapter as any).parseChunk(line, callbacks);
      expect(contentReceived).toBe("Hello");
    });

    test("parses reasoning_content as reasoning type", () => {
      const line = 'data: {"id":"test","object":"chat.completion.chunk","created":123,"model":"kimi-k2.5","choices":[{"index":0,"delta":{"reasoning_content":"Thinking..."},"finish_reason":null}]}';
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let receivedType = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk, type) => {
          receivedType = type;
        },
      };

      (adapter as any).parseChunk(line, callbacks);
      expect(receivedType).toBe("reasoning");
    });

    test("parses content as text type", () => {
      const line = 'data: {"id":"test","object":"chat.completion.chunk","created":123,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}';
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let receivedType = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk, type) => {
          receivedType = type;
        },
      };

      (adapter as any).parseChunk(line, callbacks);
      expect(receivedType).toBe("text");
    });

    test("handles both reasoning and content in same response", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      const chunks: Array<{ type: string; text: string }> = [];
      const callbacks: LLMCallbacks = {
        onContent: (chunk, type) => {
          chunks.push({ type, text: chunk });
        },
      };

      (adapter as any).parseChunk(
        'data: {"id":"test","choices":[{"delta":{"reasoning_content":"Thinking..."}}]}',
        callbacks
      );
      (adapter as any).parseChunk(
        'data: {"id":"test","choices":[{"delta":{"content":"Hello"}}]}',
        callbacks
      );

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toEqual({ type: "reasoning", text: "Thinking..." });
      expect(chunks[1]).toEqual({ type: "text", text: "Hello" });
    });

    test("ignores [DONE] marker", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let completeCalled = false;
      const callbacks: LLMCallbacks = {
        onComplete: () => {
          completeCalled = true;
        },
      };

      (adapter as any).parseChunk("[DONE]", callbacks);
      expect(completeCalled).toBe(true);
    });

    test("ignores data: [DONE] marker", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let completeCalled = false;
      const callbacks: LLMCallbacks = {
        onComplete: () => {
          completeCalled = true;
        },
      };

      (adapter as any).parseChunk("data: [DONE]", callbacks);
      expect(completeCalled).toBe(true);
    });

    test("ignores empty lines", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let contentReceived = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk) => {
          contentReceived += chunk;
        },
      };

      (adapter as any).parseChunk("", callbacks);
      (adapter as any).parseChunk("   ", callbacks);
      expect(contentReceived).toBe("");
    });

    test("ignores lines without data prefix", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let contentReceived = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk) => {
          contentReceived += chunk;
        },
      };

      (adapter as any).parseChunk('{"id":"test"}', callbacks);
      expect(contentReceived).toBe("");
    });

    test("calls onComplete when finish_reason is set", () => {
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let completeCalled = false;
      const callbacks: LLMCallbacks = {
        onComplete: () => {
          completeCalled = true;
        },
      };

      (adapter as any).parseChunk(
        'data: {"id":"test","choices":[{"finish_reason":"stop"}]}',
        callbacks
      );
      expect(completeCalled).toBe(true);
    });

    test("handles tool calls", () => {
      const line = 'data: {"id":"test","choices":[{"delta":{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Beijing\\"}"}}]}}]}';
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let toolName = "";
      let toolArgs = {};
      let toolId = "";
      const callbacks: LLMCallbacks = {
        onToolCall: (name, args, id) => {
          toolName = name;
          toolArgs = args;
          toolId = id;
        },
      };

      (adapter as any).parseChunk(line, callbacks);
      expect(toolName).toBe("get_weather");
      expect(toolArgs).toEqual({ city: "Beijing" });
      expect(toolId).toBe("call-1");
    });

    test("handles message.role initial delta", () => {
      const line = 'data: {"id":"test","choices":[{"message":{"role":"assistant","content":""},"finish_reason":null}]}';
      const adapter = new OpenAIAdapter({ apiKey: "test-key" });
      
      let contentReceived = "";
      const callbacks: LLMCallbacks = {
        onContent: (chunk) => {
          contentReceived += chunk;
        },
      };

      (adapter as any).parseChunk(line, callbacks);
      expect(contentReceived).toBe("");
    });
  });

  describe("getHeaders", () => {
    test("includes Content-Type and Authorization", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
      });
      
      const headers = (adapter as any).getHeaders();
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Authorization"]).toBe("Bearer test-key");
    });

    test("includes organization header when set", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        organization: "org-123",
      });
      
      const headers = (adapter as any).getHeaders();
      expect(headers["OpenAI-Organization"]).toBe("org-123");
    });

    test("merges custom headers", () => {
      const adapter = new OpenAIAdapter({
        apiKey: "test-key",
        headers: {
          "X-Custom-Header": "custom-value",
        },
      });
      
      const headers = (adapter as any).getHeaders();
      expect(headers["X-Custom-Header"]).toBe("custom-value");
    });
  });
});
