/**
 * @fileoverview Tests for ProviderManager
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { ProviderManager } from "./provider-manager.js";
import type { RawProviderConfig } from "./types.js";
import * as AuthModule from "../config/auth.js";
import * as ProvidersModule from "../config/sources/providers.js";

describe("ProviderManager", () => {
  let manager: ProviderManager;

  // Mock data
  let mockAuthConfig: Record<string, any> = {};
  let mockProvidersConfig: Record<string, any> = {};

  // Spies
  let authGetProviderSpy: any;
  let loadProvidersConfigSpy: any;

  beforeEach(() => {
    manager = new ProviderManager();
    
    // Reset mock data
    mockAuthConfig = {};
    mockProvidersConfig = {
      "zhipuai": {
        id: "zhipuai",
        name: "ZhipuAI",
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "${ZHIPUAI_API_KEY}",
        models: ["glm-5", "glm-4", "glm-4-plus"],
        defaultModel: "glm-4",
      },
      "openai": {
        id: "openai",
        name: "OpenAI",
        baseURL: "https://api.openai.com/v1",
        apiKey: "${OPENAI_API_KEY}",
        models: ["gpt-4o", "gpt-4-turbo"],
        defaultModel: "gpt-4o",
      },
    };

    // Mock Auth module
    authGetProviderSpy = spyOn(AuthModule, "Auth_getProvider").mockImplementation(async (id: string) => mockAuthConfig[id]);

    // Mock Providers module
    loadProvidersConfigSpy = spyOn(ProvidersModule, "loadProvidersConfig").mockImplementation(async () => ({
      providers: mockProvidersConfig,
    }));
  });

  afterEach(() => {
    manager.reset();
    authGetProviderSpy?.mockRestore();
    loadProvidersConfigSpy?.mockRestore();
  });

  describe("Environment Variable Resolution", () => {
    it("should resolve ${ENV_VAR} format to actual value", () => {
      process.env.TEST_API_KEY = "test-key-123";
      
      const result = (manager as any).resolveEnvVar("${TEST_API_KEY}");
      
      expect(result).toBe("test-key-123");
      delete process.env.TEST_API_KEY;
    });

    it("should return undefined for non-existent env var", () => {
      const result = (manager as any).resolveEnvVar("${NON_EXISTENT_VAR}");
      
      expect(result).toBeUndefined();
    });

    it("should return plain string as-is", () => {
      const result = (manager as any).resolveEnvVar("plain-api-key");
      
      expect(result).toBe("plain-api-key");
    });

    it("should return undefined for undefined input", () => {
      const result = (manager as any).resolveEnvVar(undefined);
      
      expect(result).toBeUndefined();
    });
  });

  describe("SDK Type Inference", () => {
    it("should infer 'openai' from provider ID", () => {
      const result = (manager as any).inferSDKType("openai", "https://api.example.com");
      expect(result).toBe("openai");
    });

    it("should infer 'anthropic' from base URL", () => {
      const result = (manager as any).inferSDKType("custom", "https://api.anthropic.com/v1");
      expect(result).toBe("anthropic");
    });

    it("should infer 'google' from base URL", () => {
      const result = (manager as any).inferSDKType("custom", "https://generativelanguage.googleapis.com");
      expect(result).toBe("google");
    });

    it("should default to 'openai-compatible' for unknown", () => {
      const result = (manager as any).inferSDKType("zhipuai", "https://open.bigmodel.cn/api/paas/v4");
      expect(result).toBe("openai-compatible");
    });
  });

  describe("Provider Management", () => {
    it("should have no providers before initialization", () => {
      expect(manager.getProviderIds()).toHaveLength(0);
      expect(manager.listProviders()).toHaveLength(0);
    });

    it("should check if provider exists", () => {
      expect(manager.hasProvider("openai")).toBe(false);
    });

    it("should return undefined for non-existent provider", () => {
      expect(manager.getProvider("non-existent")).toBeUndefined();
      expect(manager.getMetadata("non-existent")).toBeUndefined();
    });
  });

  describe("addProvider", () => {
    it("should successfully add a provider when API key exists in auth.json", async () => {
      // Set up auth config with API key
      mockAuthConfig["zhipuai"] = {
        type: "api",
        key: "test-zhipuai-key-123",
        baseURL: "https://open.bigmodel.cn/api/paas/v4",
      };

      const result = await manager.addProvider("zhipuai");

      expect(result).toBe(true);
      expect(manager.hasProvider("zhipuai")).toBe(true);
      
      const metadata = manager.getMetadata("zhipuai");
      expect(metadata).toBeDefined();
      expect(metadata?.id).toBe("zhipuai");
      expect(metadata?.name).toBe("ZhipuAI");
      expect(metadata?.baseURL).toBe("https://open.bigmodel.cn/api/paas/v4");
      expect(metadata?.models.length).toBeGreaterThan(0);
    });

    it("should use baseURL from auth.json if provided", async () => {
      mockAuthConfig["zhipuai"] = {
        type: "api",
        key: "test-key",
        baseURL: "https://custom.bigmodel.cn/api/paas/v4", // Custom baseURL
      };

      await manager.addProvider("zhipuai");

      const metadata = manager.getMetadata("zhipuai");
      expect(metadata?.baseURL).toBe("https://custom.bigmodel.cn/api/paas/v4");
    });

    it("should return false when provider not found in providers.jsonc", async () => {
      mockAuthConfig["unknown-provider"] = {
        type: "api",
        key: "test-key",
      };

      const result = await manager.addProvider("unknown-provider");

      expect(result).toBe(false);
      expect(manager.hasProvider("unknown-provider")).toBe(false);
    });

    it("should return false when no API key available", async () => {
      // No auth config set for zhipuai, and no env var
      const result = await manager.addProvider("zhipuai");

      expect(result).toBe(false);
      expect(manager.hasProvider("zhipuai")).toBe(false);
    });

    it("should overwrite existing provider when adding again", async () => {
      // First add
      mockAuthConfig["zhipuai"] = {
        type: "api",
        key: "first-key",
      };
      await manager.addProvider("zhipuai");
      expect(manager.hasProvider("zhipuai")).toBe(true);

      // Second add with different key
      mockAuthConfig["zhipuai"] = {
        type: "api",
        key: "second-key",
      };
      await manager.addProvider("zhipuai");

      // Provider should still exist (updated)
      expect(manager.hasProvider("zhipuai")).toBe(true);
    });

    it("should resolve environment variable in provider config apiKey", async () => {
      // Set env var
      process.env.ZHIPUAI_API_KEY = "env-api-key-123";
      
      // No auth config, should use env var from providers.jsonc
      mockAuthConfig["zhipuai"] = undefined;
      
      const result = await manager.addProvider("zhipuai");

      expect(result).toBe(true);
      expect(manager.hasProvider("zhipuai")).toBe(true);
      
      delete process.env.ZHIPUAI_API_KEY;
    });

    it("should prioritize auth.json apiKey over providers.jsonc", async () => {
      // Both have API key
      mockAuthConfig["zhipuai"] = {
        type: "api",
        key: "auth-key-123",
      };
      // providers.jsonc has env var placeholder

      await manager.addProvider("zhipuai");

      // Provider should be loaded (auth key takes precedence)
      expect(manager.hasProvider("zhipuai")).toBe(true);
    });
  });
});
