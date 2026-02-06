/**
 * @fileoverview Unit tests for Provider Registry.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getProviderConfig,
  listProviders,
  getEnvForProvider,
} from "../../src/llm/provider/registry.js";

describe("Provider Registry", () => {
  describe("getProviderConfig", () => {
    test("should return OpenAI config", () => {
      const config = getProviderConfig("openai");
      expect(config).toBeDefined();
      expect(config?.id).toBe("openai");
      expect(config?.name).toBe("OpenAI");
      expect(config?.npmPackage).toBe("@ai-sdk/openai");
      expect(config?.defaultModel).toBe("gpt-4o");
      expect(config?.defaultBaseURL).toBe("https://api.openai.com/v1");
    });

    test("should return Anthropic config", () => {
      const config = getProviderConfig("anthropic");
      expect(config).toBeDefined();
      expect(config?.id).toBe("anthropic");
      expect(config?.name).toBe("Anthropic");
      expect(config?.npmPackage).toBe("@ai-sdk/anthropic");
      expect(config?.defaultModel).toBe("claude-sonnet-4-20250514");
    });

    test("should return Google config", () => {
      const config = getProviderConfig("google");
      expect(config).toBeDefined();
      expect(config?.id).toBe("google");
      expect(config?.name).toBe("Google");
      expect(config?.npmPackage).toBe("@ai-sdk/google");
      expect(config?.defaultModel).toBe("gemini-2.5-flash");
    });

    test("should return Kimi config", () => {
      const config = getProviderConfig("kimi");
      expect(config).toBeDefined();
      expect(config?.id).toBe("kimi");
      expect(config?.name).toBe("Kimi (Moonshot)");
      expect(config?.npmPackage).toBe("@ai-sdk/openai-compatible");
      expect(config?.defaultModel).toBe("kimi-k2.5");
      expect(config?.defaultBaseURL).toBe("https://api.moonshot.cn/v1");
    });

    test("should return DeepSeek config", () => {
      const config = getProviderConfig("deepseek");
      expect(config).toBeDefined();
      expect(config?.id).toBe("deepseek");
      expect(config?.name).toBe("DeepSeek");
      expect(config?.defaultModel).toBe("deepseek-chat");
    });

    test("should return undefined for unknown provider", () => {
      const config = getProviderConfig("unknown");
      expect(config).toBeUndefined();
    });

    test("should return all configured providers", () => {
      const providers = ["openai", "anthropic", "google", "kimi", "deepseek", "mistral", "groq"];
      for (const p of providers) {
        const config = getProviderConfig(p);
        expect(config).toBeDefined();
        expect(config?.id).toBe(p);
      }
    });
  });

  describe("listProviders", () => {
    test("should return array of providers", () => {
      const providers = listProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
    });

    test("should include OpenAI", () => {
      const providers = listProviders();
      const openai = providers.find((p) => p.id === "openai");
      expect(openai).toBeDefined();
    });

    test("should include Anthropic", () => {
      const providers = listProviders();
      const anthropic = providers.find((p) => p.id === "anthropic");
      expect(anthropic).toBeDefined();
    });

    test("should include Kimi", () => {
      const providers = listProviders();
      const kimi = providers.find((p) => p.id === "kimi");
      expect(kimi).toBeDefined();
    });
  });

  describe("getEnvForProvider", () => {
    test("should return OpenAI env vars", () => {
      const envVars = getEnvForProvider("openai");
      expect(envVars).toContain("OPENAI_API_KEY");
      expect(envVars).toContain("OPENAI_BASE_URL");
    });

    test("should return Anthropic env vars", () => {
      const envVars = getEnvForProvider("anthropic");
      expect(envVars).toContain("ANTHROPIC_API_KEY");
      expect(envVars).toContain("ANTHROPIC_BASE_URL");
    });

    test("should return Kimi env vars", () => {
      const envVars = getEnvForProvider("kimi");
      expect(envVars).toContain("KIMI_API_KEY");
      expect(envVars).toContain("MOONSHOT_API_KEY");
    });

    test("should return DeepSeek env vars", () => {
      const envVars = getEnvForProvider("deepseek");
      expect(envVars).toContain("DEEPSEEK_API_KEY");
      expect(envVars).toContain("DEEPSEEK_BASE_URL");
    });

    test("should return empty array for unknown provider", () => {
      const envVars = getEnvForProvider("unknown");
      expect(envVars).toEqual([]);
    });
  });
});

describe("Provider Config Properties", () => {
  test("all providers should have required properties", () => {
    const providers = listProviders();
    for (const provider of providers) {
      expect(provider.id).toBeDefined();
      expect(provider.name).toBeDefined();
      expect(provider.npmPackage).toBeDefined();
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.name).toBe("string");
      expect(typeof provider.npmPackage).toBe("string");
    }
  });

  test("OpenAI-compatible providers should have correct baseURL", () => {
    const kimi = getProviderConfig("kimi");
    expect(kimi?.defaultBaseURL).toBe("https://api.moonshot.cn/v1");

    const deepseek = getProviderConfig("deepseek");
    expect(deepseek?.defaultBaseURL).toBe("https://api.deepseek.com");
  });

  test("official SDK providers should have default models", () => {
    const openai = getProviderConfig("openai");
    expect(openai?.defaultModel).toBe("gpt-4o");

    const anthropic = getProviderConfig("anthropic");
    expect(anthropic?.defaultModel).toBe("claude-sonnet-4-20250514");

    const google = getProviderConfig("google");
    expect(google?.defaultModel).toBe("gemini-2.5-flash");
  });
});
