/**
 * @fileoverview Unit tests for TimeoutManager.
 * Tests timeout configuration, retrieval, and execution behavior.
 */

import { TimeoutManager, executeWithTimeout, createTimeoutController } from "../../src/environment/base/timeout";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("TimeoutManager", () => {
  describe("constructor", () => {
    test("creates instance with default values", () => {
      const manager = new TimeoutManager();
      expect(manager).toBeDefined();
    });

    test("creates instance with custom config", () => {
      const manager = new TimeoutManager({
        defaultTimeoutMs: 30000,
      });
      expect(manager).toBeDefined();
    });
  });

  describe("getTimeout", () => {
    test("returns default timeout when no override exists", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      const timeout = manager.getTimeout("bash");
      expect(timeout).toBe(60000);
    });

    test("returns tool-specific override when set", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      manager.setTimeout("bash", 30000);
      expect(manager.getTimeout("bash")).toBe(30000);
    });

    test("returns different timeouts for different tools", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      manager.setTimeout("bash", 30000);
      manager.setTimeout("network", 15000);

      expect(manager.getTimeout("bash")).toBe(30000);
      expect(manager.getTimeout("network")).toBe(15000);
      expect(manager.getTimeout("unknown")).toBe(60000);
    });

    test("ignores action metadata for basic timeout", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      const timeout = manager.getTimeout("bash", {});
      expect(timeout).toBe(60000);
    });
  });

  describe("setTimeout", () => {
    test("sets timeout for a new tool", () => {
      const manager = new TimeoutManager();
      manager.setTimeout("network", 45000);
      expect(manager.getTimeout("network")).toBe(45000);
    });

    test("updates existing timeout", () => {
      const manager = new TimeoutManager();
      manager.setTimeout("bash", 30000);
      manager.setTimeout("bash", 60000);
      expect(manager.getTimeout("bash")).toBe(60000);
    });
  });

  describe("removeTimeout", () => {
    test("removes existing timeout override", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      manager.setTimeout("bash", 30000);

      expect(manager.removeTimeout("bash")).toBe(true);
      expect(manager.getTimeout("bash")).toBe(60000);
    });

    test("returns false when removing non-existent override", () => {
      const manager = new TimeoutManager();
      expect(manager.removeTimeout("unknown")).toBe(false);
    });
  });

  describe("clearOverrides", () => {
    test("removes all tool-specific overrides", () => {
      const manager = new TimeoutManager({ defaultTimeoutMs: 60000 });
      manager.setTimeout("bash", 30000);
      manager.setTimeout("network", 15000);
      manager.setTimeout("file", 10000);

      manager.clearOverrides();

      expect(manager.getTimeout("bash")).toBe(60000);
      expect(manager.getTimeout("network")).toBe(60000);
      expect(manager.getTimeout("file")).toBe(60000);
    });
  });

  describe("default static method", () => {
    test("creates manager with default timeout of 60 seconds", () => {
      const manager = TimeoutManager.default();
      expect(manager.getTimeout("test")).toBe(60000);
    });
  });
});

describe("createTimeoutController", () => {
  test("creates timer and abort handler", () => {
    const { timer, abortHandler } = createTimeoutController(5000);

    expect(timer).toBeDefined();
    expect(typeof abortHandler).toBe("function");
    expect(typeof timer.refresh).toBe("function");
  });

  test("abort handler clears timer", () => {
    const { timer, abortHandler } = createTimeoutController(5000);

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    abortHandler();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("executeWithTimeout", () => {
  test("resolves immediately when function completes before timeout", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const result = await executeWithTimeout(fn, 5000);

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("rejects when function throws error", async () => {
    const error = new Error("test error");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(executeWithTimeout(fn, 5000)).rejects.toThrow("test error");
  });
});
