/**
 * @fileoverview Unit tests for Message Transform.
 */

import { describe, test, expect } from "bun:test";
import { transformMessages } from "../../src/llm/transform/messages.js";

describe("Message Transform", () => {
  describe("Anthropic provider", () => {
    test("should filter empty string content", () => {
      const messages = [
        { role: "user", content: "" },
        { role: "user", content: "Hello" },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Hello");
    });

    test("should filter empty array content parts", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "" },
            { type: "text", text: "Hello" },
          ],
        },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(1);
      expect((result[0].content as Array<{ type: string; text: string }>)[0].text).toBe("Hello");
    });

    test("should preserve non-empty messages", () => {
      const messages = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe("You are helpful.");
      expect(result[1].content).toBe("Hello");
    });

    test("should handle reasoning content", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "" },
            { type: "reasoning", text: "Thinking..." },
            { type: "text", text: "Answer" },
          ],
        },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      expect(result).toHaveLength(1);
      expect((result[0].content as Array<{ type: string }>)).toHaveLength(2);
    });
  });

  describe("Claude model", () => {
    test("should normalize toolCallId", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "abc-123@def",
              toolName: "test_tool",
              input: {},
            },
          ],
        },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      const content = result[0].content as Array<{ type: string; toolCallId: string }>;
      expect(content[0].toolCallId).toBe("abc-123_def");
    });

    test("should preserve valid toolCallId", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "valid_id_123",
              toolName: "test_tool",
              input: {},
            },
          ],
        },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      const content = result[0].content as Array<{ type: string; toolCallId: string }>;
      expect(content[0].toolCallId).toBe("valid_id_123");
    });
  });

  describe("Mistral provider", () => {
    test("should normalize toolCallId to 9 characters", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tool_call_with_long_id",
              toolName: "test_tool",
              input: {},
            },
          ],
        },
      ];

      const result = transformMessages(messages, "mistral", "mistral-small");

      const content = result[0].content as Array<{ type: string; toolCallId: string }>;
      expect(content[0].toolCallId.length).toBe(9);
    });

    test("should pad short toolCallId to 9 characters", () => {
      const messages = [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tc",
              toolName: "test_tool",
              input: {},
            },
          ],
        },
      ];

      const result = transformMessages(messages, "mistral", "mistral-small");

      const content = result[0].content as Array<{ type: string; toolCallId: string }>;
      expect(content[0].toolCallId).toBe("tc0000000");
    });
  });

  describe("Non-OpenAI providers", () => {
    test("should pass through OpenAI provider unchanged", () => {
      const messages = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const result = transformMessages(messages, "openai", "gpt-4o");

      expect(result).toEqual(messages);
    });

    test("should pass through Kimi unchanged", () => {
      const messages = [
        { role: "user", content: "你好" },
      ];

      const result = transformMessages(messages, "kimi", "kimi-k2.5");

      expect(result).toEqual(messages);
    });

    test("should pass through DeepSeek unchanged", () => {
      const messages = [
        { role: "user", content: "Hello" },
      ];

      const result = transformMessages(messages, "deepseek", "deepseek-chat");

      expect(result).toEqual(messages);
    });
  });

  describe("Edge cases", () => {
    test("should handle empty messages array", () => {
      const result = transformMessages([], "openai", "gpt-4o");
      expect(result).toEqual([]);
    });

    test("should handle tool result messages", () => {
      const messages = [
        {
          role: "tool",
          content: JSON.stringify({ result: "success" }),
          name: "test_tool",
        },
      ];

      const result = transformMessages(messages, "anthropic", "claude-sonnet-4");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("tool");
    });
  });
});
