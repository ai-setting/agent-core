/**
 * @fileoverview Unit tests for LLM transform utilities.
 * Tests provider-specific parameter transformations.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  LLMTransform,
  parseModel,
  BUILTIN_PROVIDERS,
  getApiKeyFromEnv,
  type ModelInfo,
} from "../../src/environment/llm/index.js";

describe("parseModel", () => {
  test("parses provider/model format", () => {
    const result = parseModel("kimi/kimi-k2.5");
    expect(result.provider).toBe("kimi");
    expect(result.model).toBe("kimi-k2.5");
    expect(result.fullName).toBe("kimi/kimi-k2.5");
  });

  test("parses model without provider as openai", () => {
    const result = parseModel("gpt-4o");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.fullName).toBe("openai/gpt-4o");
  });

  test("handles nested model paths", () => {
    const result = parseModel("anthropic/claude-sonnet-4-20250514");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });

  test("handles deepseek format", () => {
    const result = parseModel("deepseek/deepseek-chat");
    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-chat");
  });
});

describe("LLMTransform.getDefaultTemperature", () => {
  test("returns 0.55 for Qwen models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "qwen", model: "qwen-plus", fullName: "qwen/qwen-plus" });
    expect(result).toBe(0.55);
  });

  test("returns undefined for Claude models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "anthropic", model: "claude-sonnet-4", fullName: "anthropic/claude-sonnet-4" });
    expect(result).toBeUndefined();
  });

  test("returns 1.0 for Gemini models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "google", model: "gemini-2.0-flash", fullName: "google/gemini-2.0-flash" });
    expect(result).toBe(1.0);
  });

  test("returns 1.0 for Kimi models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "kimi", model: "kimi-k2.5", fullName: "kimi/kimi-k2.5" });
    expect(result).toBe(1.0);
  });

  test("returns 0.95 for MiniMax models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "minimax", model: "minimax-m2", fullName: "minimax/minimax-m2" });
    expect(result).toBe(0.95);
  });

  test("returns undefined for unknown models", () => {
    const result = LLMTransform.getDefaultTemperature({ provider: "unknown", model: "unknown-model", fullName: "unknown/unknown-model" });
    expect(result).toBeUndefined();
  });
});

describe("LLMTransform.getDefaultTopP", () => {
  test("returns 1.0 for Qwen models", () => {
    const result = LLMTransform.getDefaultTopP({ provider: "qwen", model: "qwen-plus", fullName: "qwen/qwen-plus" });
    expect(result).toBe(1.0);
  });

  test("returns 0.95 for Kimi models", () => {
    const result = LLMTransform.getDefaultTopP({ provider: "kimi", model: "kimi-k2.5", fullName: "kimi/kimi-k2.5" });
    expect(result).toBe(0.95);
  });

  test("returns 0.95 for Gemini models", () => {
    const result = LLMTransform.getDefaultTopP({ provider: "google", model: "gemini-2.0-flash", fullName: "google/gemini-2.0-flash" });
    expect(result).toBe(0.95);
  });

  test("returns undefined for unknown models", () => {
    const result = LLMTransform.getDefaultTopP({ provider: "unknown", model: "unknown", fullName: "unknown/unknown" });
    expect(result).toBeUndefined();
  });
});

describe("LLMTransform.getDefaultTopK", () => {
  test("returns 20 for MiniMax M2", () => {
    const result = LLMTransform.getDefaultTopK({ provider: "minimax", model: "minimax-m2", fullName: "minimax/minimax-m2" });
    expect(result).toBe(20);
  });

  test("returns 40 for MiniMax M2.1", () => {
    const result = LLMTransform.getDefaultTopK({ provider: "minimax", model: "minimax-m2.1", fullName: "minimax/minimax-m2.1" });
    expect(result).toBe(40);
  });

  test("returns 64 for Gemini models", () => {
    const result = LLMTransform.getDefaultTopK({ provider: "google", model: "gemini-2.0-flash", fullName: "google/gemini-2.0-flash" });
    expect(result).toBe(64);
  });

  test("returns undefined for unknown models", () => {
    const result = LLMTransform.getDefaultTopK({ provider: "unknown", model: "unknown", fullName: "unknown/unknown" });
    expect(result).toBeUndefined();
  });
});

describe("LLMTransform.transformMessages", () => {
  test("returns messages unchanged for OpenAI models", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    const model = { provider: "openai", model: "gpt-4o", fullName: "openai/gpt-4o" };
    const result = LLMTransform.transformMessages(messages, model);
    expect(result).toEqual(messages);
  });

  test("filters empty messages for Anthropic", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "" },
      { role: "user" as const, content: "World" },
    ];
    const model = { provider: "anthropic", model: "claude-sonnet-4", fullName: "anthropic/claude-sonnet-4" };
    const result = LLMTransform.transformMessages(messages, model);
    expect(result.length).toBe(2);
    expect(result[1].content).toBe("World");
  });
});

describe("LLMTransform.transformConfig", () => {
  test("applies default temperature for Kimi", () => {
    const config = { temperature: undefined };
    const model = { provider: "kimi", model: "kimi-k2.5", fullName: "kimi/kimi-k2.5" };
    const result = LLMTransform.transformConfig(config, model);
    expect(result.temperature).toBe(1.0);
  });

  test("user temperature overrides default", () => {
    const config = { temperature: 0.5 };
    const model = { provider: "kimi", model: "kimi-k2.5", fullName: "kimi/kimi-k2.5" };
    const result = LLMTransform.transformConfig(config, model);
    expect(result.temperature).toBe(0.5);
  });

  test("applies default topP for Qwen", () => {
    const config = { topP: undefined };
    const model = { provider: "qwen", model: "qwen-plus", fullName: "qwen/qwen-plus" };
    const result = LLMTransform.transformConfig(config, model);
    expect(result.topP).toBe(1.0);
  });

  test("adds provider options for OpenAI", () => {
    const config = {};
    const model = { provider: "openai", model: "gpt-4o", fullName: "openai/gpt-4o" };
    const result = LLMTransform.transformConfig(config, model);
    expect(result.providerOptions?.store).toBe(false);
  });

  test("adds thinking config for Google", () => {
    const config = {};
    const model = { provider: "google", model: "gemini-2.0-flash", fullName: "google/gemini-2.0-flash" };
    const result = LLMTransform.transformConfig(config, model);
    expect((result.providerOptions?.thinkingConfig as any)?.includeThoughts).toBe(true);
  });
});

describe("BUILTIN_PROVIDERS", () => {
  test("contains OpenAI configuration", () => {
    const provider = BUILTIN_PROVIDERS.openai;
    expect(provider.id).toBe("openai");
    expect(provider.name).toBe("OpenAI");
    expect(provider.envVars).toContain("OPENAI_API_KEY");
    expect(provider.baseURL).toBe("https://api.openai.com/v1");
    expect(provider.defaultModel).toBe("gpt-4o");
  });

  test("contains Kimi configuration", () => {
    const provider = BUILTIN_PROVIDERS.kimi;
    expect(provider.id).toBe("kimi");
    expect(provider.name).toBe("Kimi (Moonshot)");
    expect(provider.envVars).toContain("KIMI_API_KEY");
    expect(provider.baseURL).toBe("https://api.moonshot.cn/v1");
    expect(provider.defaultModel).toBe("kimi-k2.5");
  });

  test("contains DeepSeek configuration", () => {
    const provider = BUILTIN_PROVIDERS.deepseek;
    expect(provider.id).toBe("deepseek");
    expect(provider.name).toBe("DeepSeek");
    expect(provider.envVars).toContain("DEEPSEEK_API_KEY");
    expect(provider.baseURL).toBe("https://api.deepseek.com");
    expect(provider.defaultModel).toBe("deepseek-chat");
  });

  test("contains Anthropic configuration", () => {
    const provider = BUILTIN_PROVIDERS.anthropic;
    expect(provider.id).toBe("anthropic");
    expect(provider.name).toBe("Anthropic");
    expect(provider.envVars).toContain("ANTHROPIC_API_KEY");
  });

  test("contains Google configuration", () => {
    const provider = BUILTIN_PROVIDERS.google;
    expect(provider.id).toBe("google");
    expect(provider.name).toBe("Google Gemini");
    expect(provider.envVars).toContain("GOOGLE_API_KEY");
  });

  test("contains Groq configuration", () => {
    const provider = BUILTIN_PROVIDERS.groq;
    expect(provider.id).toBe("groq");
    expect(provider.name).toBe("Groq");
    expect(provider.envVars).toContain("GROQ_API_KEY");
    expect(provider.baseURL).toBe("https://api.groq.com/openai/v1");
  });

  test("contains Cerebras configuration", () => {
    const provider = BUILTIN_PROVIDERS.cerebras;
    expect(provider.id).toBe("cerebras");
    expect(provider.name).toBe("Cerebras");
    expect(provider.envVars).toContain("CEREBRAS_API_KEY");
  });

  test("contains OpenRouter configuration", () => {
    const provider = BUILTIN_PROVIDERS.openrouter;
    expect(provider.id).toBe("openrouter");
    expect(provider.name).toBe("OpenRouter");
    expect(provider.envVars).toContain("OPENROUTER_API_KEY");
  });

  test("Ollama has no API key requirement", () => {
    const provider = BUILTIN_PROVIDERS.ollama;
    expect(provider.envVars.length).toBe(0);
    expect(provider.baseURL).toBe("http://localhost:11434/v1");
    expect(provider.defaultModel).toBe("llama3");
  });
});

describe("getApiKeyFromEnv", () => {
  const originalLLMApiKey = process.env.LLM_API_KEY;

  beforeAll(() => {
    delete process.env.LLM_API_KEY;
  });

  afterAll(() => {
    if (originalLLMApiKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalLLMApiKey;
    }
  });

  test("returns undefined for unknown provider", () => {
    const result = getApiKeyFromEnv("unknown_provider");
    expect(result).toBeUndefined();
  });

  test("checks OPENAI_API_KEY for openai", () => {
    const original = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "test-key";
      const result = getApiKeyFromEnv("openai");
      expect(result).toBe("test-key");
    } finally {
      if (original === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = original;
      }
    }
  });

  test("checks KIMI_API_KEY for kimi", () => {
    const original = process.env.KIMI_API_KEY;
    try {
      process.env.KIMI_API_KEY = "kimi-test-key";
      const result = getApiKeyFromEnv("kimi");
      expect(result).toBe("kimi-test-key");
    } finally {
      if (original === undefined) {
        delete process.env.KIMI_API_KEY;
      } else {
        process.env.KIMI_API_KEY = original;
      }
    }
  });

  test("prefers LLM_API_KEY over provider-specific key", () => {
    process.env.LLM_API_KEY = "universal-key";
    process.env.OPENAI_API_KEY = "provider-key";

    const result = getApiKeyFromEnv("openai");
    expect(result).toBe("universal-key");
  });
});
