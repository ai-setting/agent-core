/**
 * @fileoverview Unit tests for ModelLimitsManager
 *
 * Note: getLimits() relies on module-level preloadedLimits which is loaded
 * at module initialization, making it difficult to test with mocks.
 * We test the pure methods (getCompactionThreshold, getContextWindow) instead.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ModelLimitsManager } from "./model-limits.js";
import type { ModelLimits } from "../../config/sources/providers.js";

describe("ModelLimitsManager", () => {
  let manager: ModelLimitsManager;

  beforeEach(() => {
    manager = new ModelLimitsManager();
  });

  describe("getCompactionThreshold", () => {
    it("should return threshold from limits when present", () => {
      const limits: ModelLimits = {
        contextWindow: 200000,
        compactionThreshold: 0.75,
      };

      const threshold = manager.getCompactionThreshold("gpt-4o", limits);

      expect(threshold).toBe(0.75);
    });

    it("should return default threshold when not in limits", () => {
      const limits: ModelLimits = {
        contextWindow: 200000,
      };

      const threshold = manager.getCompactionThreshold("gpt-4o", limits);

      expect(threshold).toBe(0.8); // Default
    });

    it("should return default threshold when limits is undefined", () => {
      const threshold = manager.getCompactionThreshold("gpt-4o", undefined as any);

      expect(threshold).toBe(0.8); // Default
    });

    it("should return default threshold when limits is null", () => {
      const threshold = manager.getCompactionThreshold("gpt-4o", null as any);

      expect(threshold).toBe(0.8); // Default
    });
  });

  describe("getContextWindow", () => {
    it("should return context window from limits when present", () => {
      const limits: ModelLimits = {
        contextWindow: 128000,
      };

      const window = manager.getContextWindow("gpt-4o-mini", limits);

      expect(window).toBe(128000);
    });

    it("should return default when not in limits", () => {
      const limits: ModelLimits = {
        maxOutputTokens: 16384,
      };

      const window = manager.getContextWindow("gpt-4o", limits);

      expect(window).toBe(200000); // Default
    });

    it("should return default when limits is undefined", () => {
      const window = manager.getContextWindow("gpt-4o", undefined as any);

      expect(window).toBe(200000); // Default
    });
  });

  describe("clearCache", () => {
    it("should clear the instance cache", () => {
      // The instance cache is used when preloadedLimits doesn't have the model
      // We can verify the method exists and can be called without error
      expect(() => manager.clearCache()).not.toThrow();
    });
  });
});
