/**
 * @fileoverview Unit tests for ModelLimitsManager
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { ModelLimitsManager } from "./model-limits.js";
import * as providers from "../../config/sources/providers.js";

// Mock providers config
const mockProvidersConfig = {
  providers: {
    "openai-compatible": {
      id: "openai-compatible",
      name: "OpenAI Compatible",
      baseURL: "https://api.example.com/v1",
      models: ["gpt-4o", "gpt-4o-mini"],
      limits: {
        "gpt-4o": {
          contextWindow: 200000,
          maxOutputTokens: 16384,
          maxInputTokens: 100000,
          compactionThreshold: 0.8,
        },
        "gpt-4o-mini": {
          contextWindow: 128000,
          maxOutputTokens: 16384,
          compactionThreshold: 0.75,
        },
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      baseURL: "https://api.anthropic.com",
      models: ["claude-3-5-sonnet-20241022"],
      limits: {
        "claude-3-5-sonnet-20241022": {
          contextWindow: 200000,
          maxOutputTokens: 8192,
          compactionThreshold: 0.85,
        },
      },
    },
  },
};

describe("ModelLimitsManager", () => {
  let manager: ModelLimitsManager;

  beforeEach(() => {
    manager = new ModelLimitsManager();
    // Mock the config loader
    spyOn(providers, "loadProvidersConfig").mockImplementation(
      async () => mockProvidersConfig as any
    );
  });

  afterEach(() => {
    // Clear cache between tests
    manager.clearCache();
    // Reset mocks
    (providers.loadProvidersConfig as any).mockClear();
  });

  describe("getLimits", () => {
    it("should return limits from config when available", async () => {
      const limits = await manager.getLimits("gpt-4o");

      expect(limits.contextWindow).toBe(200000);
      expect(limits.maxOutputTokens).toBe(16384);
      expect(limits.maxInputTokens).toBe(100000);
      expect(limits.compactionThreshold).toBe(0.8);
    });

    it("should return limits for model in any provider", async () => {
      const limits = await manager.getLimits("claude-3-5-sonnet-20241022");

      expect(limits.contextWindow).toBe(200000);
      expect(limits.compactionThreshold).toBe(0.85);
    });

    it("should return default limits when model not found", async () => {
      const limits = await manager.getLimits("unknown-model");

      expect(limits.contextWindow).toBe(200000);
      expect(limits.compactionThreshold).toBe(0.8); // Default threshold
    });

    it("should cache limits after first fetch", async () => {
      await manager.getLimits("gpt-4o");
      await manager.getLimits("gpt-4o");

      // Verify cache was used (only one config load)
      expect(providers.loadProvidersConfig).toHaveBeenCalledTimes(1);
    });

    it("should return model-specific threshold when present", async () => {
      const limits = await manager.getLimits("gpt-4o-mini");

      expect(limits.contextWindow).toBe(128000);
      expect(limits.compactionThreshold).toBe(0.75);
    });
  });

  describe("getCompactionThreshold", () => {
    it("should return threshold from limits when present", () => {
      const limits = {
        contextWindow: 200000,
        compactionThreshold: 0.75,
      } as providers.ModelLimits;

      const threshold = manager.getCompactionThreshold("gpt-4o", limits);

      expect(threshold).toBe(0.75);
    });

    it("should return default threshold when not in limits", () => {
      const limits = {
        contextWindow: 200000,
      } as providers.ModelLimits;

      const threshold = manager.getCompactionThreshold("gpt-4o", limits);

      expect(threshold).toBe(0.8); // Default
    });

    it("should return default threshold when limits is undefined", () => {
      const threshold = manager.getCompactionThreshold("gpt-4o", undefined as any);

      expect(threshold).toBe(0.8); // Default
    });
  });

  describe("getContextWindow", () => {
    it("should return context window from limits when present", () => {
      const limits = {
        contextWindow: 128000,
      } as providers.ModelLimits;

      const window = manager.getContextWindow("gpt-4o-mini", limits);

      expect(window).toBe(128000);
    });

    it("should return default when not in limits", () => {
      const limits = {} as providers.ModelLimits;

      const window = manager.getContextWindow("gpt-4o", limits);

      expect(window).toBe(200000); // Default
    });
  });

  describe("clearCache", () => {
    it("should clear cached limits", async () => {
      await manager.getLimits("gpt-4o");
      expect(providers.loadProvidersConfig).toHaveBeenCalledTimes(1);

      manager.clearCache();
      await manager.getLimits("gpt-4o");
      
      // Should load again after cache clear
      expect(providers.loadProvidersConfig).toHaveBeenCalledTimes(2);
    });
  });
});
