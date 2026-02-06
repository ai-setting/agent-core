/**
 * @fileoverview Integration tests for invoke-llm module.
 * Tests actual LLM API calls with real providers.
 * Requires .env file with valid API keys.
 * 
 * Usage:
 *   # For Kimi (Moonshot)
 *   export LLM_API_KEY="your-kimi-api-key"
 *   bun test test/integration/invoke-llm.test.ts --env LLM_API_KEY
 * 
 *   # For OpenAI
 *   export OPENAI_API_KEY="your-openai-api-key"
 *   bun test test/integration/invoke-llm.test.ts --env OPENAI_API_KEY
 * 
 *   # For DeepSeek
 *   export DEEPSEEK_API_KEY="your-deepseek-api-key"
 *   bun test test/integration/invoke-llm.test.ts --env DEEPSEEK_API_KEY
 */

import { describe, test, expect } from "bun:test";
import { createLLMConfigFromEnv, createSystem1IntuitiveReasoning, createInvokeLLM, type InvokeLLMConfig } from "../../src/environment/base/invoke-llm.js";

interface TestProvider {
  name: string;
  model: string;
  envVar: string;
  baseURL: string;
  prefix: string;
}

const providers: TestProvider[] = [
  { name: "OpenAI", model: "gpt-4o", envVar: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1", prefix: "openai" },
  { name: "Kimi", model: "kimi-k2.5", envVar: "KIMI_API_KEY", baseURL: "https://api.moonshot.cn/v1", prefix: "kimi" },
  { name: "DeepSeek", model: "deepseek-chat", envVar: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com", prefix: "deepseek" },
];

function getActiveProvider(): TestProvider | null {
  const model = process.env.LLM_MODEL || "";
  const apiKey = process.env.LLM_API_KEY || "";

  if (apiKey) {
    if (model.startsWith("kimi") || model.startsWith("moonshot")) {
      return { name: "Kimi", model: "kimi-k2.5", envVar: "LLM_API_KEY", baseURL: "https://api.moonshot.cn/v1", prefix: "kimi" };
    }
    if (model.startsWith("deepseek")) {
      return { name: "DeepSeek", model: "deepseek-chat", envVar: "LLM_API_KEY", baseURL: "https://api.deepseek.com", prefix: "deepseek" };
    }
    if (model.startsWith("openai") || !model) {
      return { name: "OpenAI", model: "gpt-4o", envVar: "LLM_API_KEY", baseURL: "https://api.openai.com/v1", prefix: "openai" };
    }
  }

  for (const p of providers) {
    if (process.env[p.envVar]) {
      return p;
    }
  }
  return null;
}

function getApiKey(): string | null {
  const active = getActiveProvider();
  if (!active) return null;
  return process.env[active.envVar] || process.env.LLM_API_KEY || null;
}

function getProviderPrefix(): string | null {
  const active = getActiveProvider();
  return active?.prefix || null;
}

const activeProvider = getActiveProvider();
const activeApiKey = getApiKey();

if (activeProvider && activeApiKey) {
  console.log(`\n🔑 Active Provider: ${activeProvider.name} (model: ${activeProvider.model})\n`);
} else {
  console.log(`\n⚠️  No API key found. Tests will be skipped.\n`);
}

describe("Integration Tests", () => {
  test("should have active provider", () => {
    if (!activeProvider) return expect(true).toBe(true);
    expect(activeProvider).not.toBeNull();
  });

  test("should load config from environment", () => {
    const config = createLLMConfigFromEnv(`${activeProvider?.prefix || "openai"}/${activeProvider?.model || "gpt-4o"}`);
    if (!activeApiKey) {
      expect(config).toBeUndefined();
    } else {
      expect(config).toBeDefined();
      if (config) {
        expect(config.apiKey).toBe(activeApiKey);
      }
    }
  });
});

describe("Text Generation", () => {
  test("should complete simple question", async () => {
    if (!activeApiKey || !activeProvider) {
      console.log("  ⏭️  Skipped - no API key");
      return;
    }

    const config: InvokeLLMConfig = {
      model: activeProvider.model,
      baseURL: activeProvider.baseURL,
      apiKey: activeApiKey,
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "What is 2+2?" }] },
      { abort: new AbortController().signal }
    );

    console.log(`\n📝 ${activeProvider.name} Response:`, result.success ? "OK" : result.error);

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(typeof result.output).toBe("string");
    expect((result.output as string).length).toBeGreaterThan(0);
    expect(result.metadata?.execution_time_ms).toBeGreaterThan(0);
  }, 30000);

  test("should handle system + user messages", async () => {
    if (!activeApiKey || !activeProvider) {
      console.log("  ⏭️  Skipped - no API key");
      return;
    }

    const config: InvokeLLMConfig = {
      model: activeProvider.model,
      baseURL: activeProvider.baseURL,
      apiKey: activeApiKey,
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello!" },
        ],
      },
      { abort: new AbortController().signal }
    );

    console.log(`\n📝 ${activeProvider.name} System+User:`, result.success ? "OK" : result.error);

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  }, 30000);

  test("should handle temperature parameter", async () => {
    if (!activeApiKey || !activeProvider) {
      console.log("  ⏭️  Skipped - no API key");
      return;
    }

    if (activeProvider.prefix === "kimi") {
      console.log(`  ⏭️  Skipped - Kimi only supports temperature=1`);
      return expect(true).toBe(true);
    }

    const config: InvokeLLMConfig = {
      model: activeProvider.model,
      baseURL: activeProvider.baseURL,
      apiKey: activeApiKey,
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "Say exactly: deterministic" }], temperature: 0.7 },
      { abort: new AbortController().signal }
    );

    console.log(`\n📝 ${activeProvider.name} Temperature=0.7:`, result.success ? "OK" : result.error);

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.output as string).length).toBeGreaterThan(0);
    }
  }, 30000);

  test("should respect maxTokens parameter", async () => {
    if (!activeApiKey || !activeProvider) {
      console.log("  ⏭️  Skipped - no API key");
      return;
    }

    const config: InvokeLLMConfig = {
      model: activeProvider.model,
      baseURL: activeProvider.baseURL,
      apiKey: activeApiKey,
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "Write one sentence." }], maxTokens: 10 },
      { abort: new AbortController().signal }
    );

    console.log(`\n📝 ${activeProvider.name} maxTokens=10:`, result.success ? "OK" : result.error);

    expect(result.success).toBe(true);
  }, 30000);
});

describe("Streaming (invoke_llm)", () => {
  test("should handle streaming response", async () => {
    if (!activeApiKey || !activeProvider) {
      console.log("  ⏭️  Skipped - no API key");
      return;
    }

    const config: InvokeLLMConfig = {
      model: activeProvider.model,
      baseURL: activeProvider.baseURL,
      apiKey: activeApiKey,
    };

    const tool = createInvokeLLM(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "Count from 1 to 3." }], stream: true },
      { abort: new AbortController().signal }
    );

    console.log(`\n📝 ${activeProvider.name} Streaming:`, result.success ? "OK" : result.error);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.metadata?.execution_time_ms).toBeGreaterThan(0);
  }, 30000);
});

describe("Error Handling", () => {
  test("should handle invalid API key", async () => {
    const config: InvokeLLMConfig = {
      model: "gpt-4o",
      baseURL: "https://api.openai.com/v1",
      apiKey: "invalid-key-12345",
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      {}
    );

    console.log(`\n📝 Invalid Key Response:`, result.error?.substring(0, 50) || "OK");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }, 10000);

  test("should handle invalid baseURL", async () => {
    const config: InvokeLLMConfig = {
      model: "gpt-4o",
      baseURL: "https://invalid.api.example.com/v1",
      apiKey: "test-key",
    };

    const tool = createSystem1IntuitiveReasoning(config);
    const result = await tool.execute(
      { messages: [{ role: "user", content: "Hello" }] },
      {}
    );

    console.log(`\n📝 Invalid URL Response:`, result.error?.substring(0, 50) || "OK");

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }, 10000);
});

describe("Provider Config", () => {
  test("should use default OpenAI config", () => {
    const config = createLLMConfigFromEnv("openai");
    expect(config?.baseURL).toBe("https://api.openai.com/v1");
    expect(config?.model).toBe("gpt-4o");
  });

  test("should use default Kimi config", () => {
    const config = createLLMConfigFromEnv("kimi");
    expect(config?.baseURL).toBe("https://api.moonshot.cn/v1");
    expect(config?.model).toBe("kimi-k2.5");
  });

  test("should use default DeepSeek config", () => {
    const config = createLLMConfigFromEnv("deepseek");
    expect(config?.baseURL).toBe("https://api.deepseek.com");
    expect(config?.model).toBe("deepseek-chat");
  });
});
