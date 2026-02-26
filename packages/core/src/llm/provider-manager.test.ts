/**
 * @fileoverview Tests for ProviderManager
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ProviderManager } from "./provider-manager.js";
import type { RawProviderConfig } from "./types.js";

describe("ProviderManager", () => {
  let manager: ProviderManager;

  beforeEach(() => {
    manager = new ProviderManager();
  });

  afterEach(() => {
    manager.reset();
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
});
