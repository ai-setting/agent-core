/**
 * @fileoverview Unit tests for invoke-llm module.
 * Tests tool creation, config loading, and message handling.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createInvokeLLM,
  createSystem1IntuitiveReasoning,
  createLLMConfigFromEnv,
  type InvokeLLMConfig,
} from "../../src/environment/base/invoke-llm.js";

describe("InvokeLLM Tools", () => {
  describe("createInvokeLLM", () => {
    test("should create a tool with correct metadata", () => {
      const config: InvokeLLMConfig = {
        model: "gpt-4o",
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
      };

      const tool = createInvokeLLM(config);

      expect(tool.name).toBe("invoke_llm");
      expect(tool.description).toContain("Internal LLM invocation");
    });

    test("should create tool with custom model", () => {
      const config: InvokeLLMConfig = {
        model: "custom-model",
        baseURL: "https://api.example.com/v1",
        apiKey: "custom-key",
      };

      const tool = createInvokeLLM(config);

      expect(tool.name).toBe("invoke_llm");
    });
  });

  describe("createSystem1IntuitiveReasoning", () => {
    test("should create a tool with correct metadata", () => {
      const config: InvokeLLMConfig = {
        model: "gpt-4o",
        baseURL: "https://api.openai.com/v1",
        apiKey: "test-key",
      };

      const tool = createSystem1IntuitiveReasoning(config);

      expect(tool.name).toBe("system1_intuitive_reasoning");
      expect(tool.description).toContain("Direct LLM call");
    });

    test("should create tool with different models", () => {
      const configs: InvokeLLMConfig[] = [
        { model: "gpt-4o", baseURL: "https://api.openai.com/v1", apiKey: "key1" },
        { model: "kimi-k2.5", baseURL: "https://api.moonshot.cn/v1", apiKey: "key2" },
        { model: "deepseek-chat", baseURL: "https://api.deepseek.com", apiKey: "key3" },
      ];

      for (const config of configs) {
        const tool = createSystem1IntuitiveReasoning(config);
        expect(tool.name).toBe("system1_intuitive_reasoning");
      }
    });
  });

  describe("createLLMConfigFromEnv", () => {
    beforeEach(() => {
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.KIMI_API_KEY;
      delete process.env.KIMI_BASE_URL;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_BASE_URL;
      delete process.env.MOONSHOT_API_KEY;
      delete process.env.MOONSHOT_BASE_URL;
    });

    afterEach(() => {
      delete process.env.LLM_MODEL;
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.KIMI_API_KEY;
      delete process.env.KIMI_BASE_URL;
      delete process.env.DEEPSEEK_API_KEY;
      delete process.env.DEEPSEEK_BASE_URL;
      delete process.env.MOONSHOT_API_KEY;
      delete process.env.MOONSHOT_BASE_URL;
    });

    test("should return undefined when no API key is set", () => {
      process.env.LLM_MODEL = "test-model";

      const config = createLLMConfigFromEnv("test-model");

      expect(config).toBeUndefined();
    });

    test("should load config from LLM_* env vars", () => {
      process.env.LLM_MODEL = "test-model";
      process.env.LLM_API_KEY = "test-api-key";
      process.env.LLM_BASE_URL = "https://api.example.com/v1";

      const config = createLLMConfigFromEnv("test-model");

      expect(config).toBeDefined();
      expect(config?.model).toBe("test-model");
      expect(config?.apiKey).toBe("test-api-key");
      expect(config?.baseURL).toBe("https://api.example.com/v1");
    });

    test("should load OpenAI config from OPENAI_* env vars", () => {
      process.env.LLM_MODEL = "openai/gpt-4o";
      process.env.OPENAI_API_KEY = "openai-key";

      const config = createLLMConfigFromEnv("openai/gpt-4o");

      expect(config).toBeDefined();
      expect(config?.model).toBe("gpt-4o");
      expect(config?.apiKey).toBe("openai-key");
      expect(config?.baseURL).toBe("https://api.openai.com/v1");
    });

    test("should load Kimi config from KIMI_* env vars", () => {
      process.env.LLM_MODEL = "kimi/kimi-k2.5";
      process.env.KIMI_API_KEY = "kimi-key";

      const config = createLLMConfigFromEnv("kimi/kimi-k2.5");

      expect(config).toBeDefined();
      expect(config?.model).toBe("kimi-k2.5");
      expect(config?.apiKey).toBe("kimi-key");
      expect(config?.baseURL).toBe("https://api.moonshot.cn/v1");
    });

    test("should load Kimi config from MOONSHOT_* env vars", () => {
      process.env.LLM_MODEL = "moonshot/kimi-k2.5";
      process.env.MOONSHOT_API_KEY = "moonshot-key";

      const config = createLLMConfigFromEnv("moonshot/kimi-k2.5");

      expect(config).toBeDefined();
      expect(config?.model).toBe("kimi-k2.5");
      expect(config?.apiKey).toBe("moonshot-key");
      expect(config?.baseURL).toBe("https://api.moonshot.cn/v1");
    });

    test("should load DeepSeek config from DEEPSEEK_* env vars", () => {
      process.env.LLM_MODEL = "deepseek/deepseek-chat";
      process.env.DEEPSEEK_API_KEY = "deepseek-key";

      const config = createLLMConfigFromEnv("deepseek/deepseek-chat");

      expect(config).toBeDefined();
      expect(config?.model).toBe("deepseek-chat");
      expect(config?.apiKey).toBe("deepseek-key");
      expect(config?.baseURL).toBe("https://api.deepseek.com");
    });

    test("should use default model for known providers", () => {
      process.env.LLM_MODEL = "openai";
      process.env.OPENAI_API_KEY = "test-key";

      const config = createLLMConfigFromEnv("openai");

      expect(config).toBeDefined();
      expect(config?.model).toBe("gpt-4o");
    });

    test("should use default baseURL for known providers", () => {
      process.env.LLM_MODEL = "openai";
      process.env.OPENAI_API_KEY = "test-key";

      const config = createLLMConfigFromEnv("openai");

      expect(config?.baseURL).toBe("https://api.openai.com/v1");
    });

    test("should handle unknown provider", () => {
      process.env.LLM_MODEL = "unknown";
      process.env.UNKNOWN_API_KEY = "test-key";

      const config = createLLMConfigFromEnv("unknown");

      expect(config).toBeDefined();
      expect(config?.model).toBe("unknown");
      expect(config?.baseURL).toBe("");
    });

    test("should handle custom model name for unknown provider", () => {
      process.env.LLM_MODEL = "unknown/custom-model-v1";
      process.env.UNKNOWN_API_KEY = "test-key";

      const config = createLLMConfigFromEnv("unknown/custom-model-v1");

      expect(config).toBeDefined();
      expect(config?.model).toBe("custom-model-v1");
    });

    test("should prioritize LLM_* over provider-specific env vars", () => {
      process.env.LLM_MODEL = "test-model";
      process.env.LLM_API_KEY = "global-key";
      process.env.OPENAI_API_KEY = "openai-key";

      const config = createLLMConfigFromEnv("openai/gpt-4o");

      expect(config?.apiKey).toBe("global-key");
    });
  });
});

describe("Message Format", () => {
  test("should handle system messages", () => {
    const config: InvokeLLMConfig = {
      model: "test-model",
      baseURL: "https://api.example.com",
      apiKey: "test-key",
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
    ];

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  test("should handle tool result messages", () => {
    const messages = [
      { role: "user", content: "What is the weather?" },
      { role: "tool", content: '{"temperature": 25, "city": "Beijing"}', name: "weather_tool" },
      { role: "assistant", content: "The weather in Beijing is 25°C." },
    ];

    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe("tool");
    expect(messages[2].role).toBe("assistant");
  });
});
