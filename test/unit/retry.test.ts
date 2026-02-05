/**
 * @fileoverview Unit tests for RetryManager.
 * Tests retry configuration, delay calculation, and error handling.
 */

import { RetryManager, executeWithRetry } from "../../src/environment/base/retry";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("RetryManager", () => {
  describe("constructor", () => {
    test("creates instance with default values", () => {
      const manager = new RetryManager();
      expect(manager).toBeDefined();
    });

    test("creates instance with custom config", () => {
      const manager = new RetryManager({
        maxRetries: 5,
        baseDelayMs: 500,
        jitter: false,
      });
      expect(manager).toBeDefined();
    });

    test("includes default retryable error patterns", () => {
      const manager = new RetryManager();

      expect(manager.isRetryableError("ECONNRESET")).toBe(true);
      expect(manager.isRetryableError("ETIMEDOUT")).toBe(true);
      expect(manager.isRetryableError("Rate limit exceeded")).toBe(true);
    });
  });

  describe("getMaxRetries", () => {
    test("returns default max retries", () => {
      const manager = new RetryManager({ maxRetries: 3 });
      expect(manager.getMaxRetries("bash")).toBe(3);
    });

    test("returns tool-specific override", () => {
      const manager = new RetryManager({ maxRetries: 3 });
      manager.configure("network_call", { maxRetries: 5 });

      expect(manager.getMaxRetries("network_call")).toBe(5);
      expect(manager.getMaxRetries("bash")).toBe(3);
    });
  });

  describe("getRetryDelay", () => {
    test("calculates exponential backoff", () => {
      const manager = new RetryManager({
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(manager.getRetryDelay("bash", 0)).toBe(1000);
      expect(manager.getRetryDelay("bash", 1)).toBe(2000);
      expect(manager.getRetryDelay("bash", 2)).toBe(4000);
    });

    test("caps delay at maxDelayMs", () => {
      const manager = new RetryManager({
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        jitter: false,
      });

      expect(manager.getRetryDelay("bash", 0)).toBe(1000);
      expect(manager.getRetryDelay("bash", 1)).toBe(2000);
      expect(manager.getRetryDelay("bash", 2)).toBe(4000);
      expect(manager.getRetryDelay("bash", 3)).toBe(5000);
      expect(manager.getRetryDelay("bash", 4)).toBe(5000);
    });

    test("applies jitter when enabled", () => {
      const manager = new RetryManager({
        baseDelayMs: 1000,
        jitter: true,
      });

      // With jitter, delay should be between 500 and 1000
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        delays.add(manager.getRetryDelay("bash", 0));
      }

      // All delays should be between 500 and 1000 (50%-100% of base)
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    test("respects tool-specific overrides", () => {
      const manager = new RetryManager({
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
      });
      manager.configure("fast_retry", { baseDelayMs: 200, backoffMultiplier: 3, jitter: false });

      expect(manager.getRetryDelay("fast_retry", 0)).toBe(200);
      expect(manager.getRetryDelay("fast_retry", 1)).toBe(600);
      expect(manager.getRetryDelay("bash", 0)).toBe(1000);
    });
  });

  describe("isRetryableError", () => {
    test("recognizes network errors", () => {
      const manager = new RetryManager();

      expect(manager.isRetryableError("ECONNRESET")).toBe(true);
      expect(manager.isRetryableError("ETIMEDOUT")).toBe(true);
      expect(manager.isRetryableError("ENOTFOUND")).toBe(true);
      expect(manager.isRetryableError("ECONNREFUSED")).toBe(true);
    });

    test("recognizes rate limit errors", () => {
      const manager = new RetryManager();

      expect(manager.isRetryableError("rate limit exceeded")).toBe(true);
      expect(manager.isRetryableError("Too Many Requests")).toBe(true);
    });

    test("does not retry validation errors", () => {
      const manager = new RetryManager();

      expect(manager.isRetryableError("Invalid JSON")).toBe(false);
      expect(manager.isRetryableError("Unauthorized")).toBe(false);
      expect(manager.isRetryableError("Bad Request")).toBe(false);
    });

    test("is case insensitive", () => {
      const manager = new RetryManager();

      expect(manager.isRetryableError("ECONNRESET")).toBe(true);
      expect(manager.isRetryableError("ETIMEDOUT")).toBe(true);
      expect(manager.isRetryableError("timeout")).toBe(true);
    });
  });

  describe("custom retryable errors", () => {
    test("adds custom retryable error pattern", () => {
      const manager = new RetryManager();
      manager.setRetryableError("service unavailable");

      expect(manager.isRetryableError("service unavailable")).toBe(true);
      expect(manager.isRetryableError("Service Unavailable")).toBe(true);
    });

    test("removes retryable error pattern", () => {
      const manager = new RetryManager();
      manager.setRetryableError("custom error");

      expect(manager.removeRetryableError("custom error")).toBe(true);
      expect(manager.isRetryableError("custom error")).toBe(false);
    });
  });

  describe("configure", () => {
    test("configures tool-specific settings", () => {
      const manager = new RetryManager({ jitter: false });
      manager.configure("api_call", {
        maxRetries: 5,
        baseDelayMs: 500,
        maxDelayMs: 10000,
      });

      expect(manager.getMaxRetries("api_call")).toBe(5);
      expect(manager.getRetryDelay("api_call", 0)).toBe(500);
    });

    test("merges partial configurations", () => {
      const manager = new RetryManager({ jitter: false });
      manager.configure("api_call", { maxRetries: 5 });
      manager.configure("api_call", { baseDelayMs: 500 });

      expect(manager.getMaxRetries("api_call")).toBe(5);
      expect(manager.getRetryDelay("api_call", 0)).toBe(500);
    });
  });

  describe("clearOverrides", () => {
    test("removes all tool-specific configurations", () => {
      const manager = new RetryManager();
      manager.configure("api_call", { maxRetries: 5 });
      manager.configure("db_query", { maxRetries: 3 });

      manager.clearOverrides();

      expect(manager.getMaxRetries("api_call")).toBe(3); // default
      expect(manager.getMaxRetries("db_query")).toBe(3); // default
    });
  });

  describe("default static method", () => {
    test("creates manager with default settings", () => {
      const manager = RetryManager.default();

      expect(manager.getMaxRetries("test")).toBe(3);
      const delay = manager.getRetryDelay("test", 0);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(1000);
    });
  });
});

describe("executeWithRetry", () => {
  test("succeeds on first attempt", async () => {
    const manager = new RetryManager({ jitter: false });
    const fn = vi.fn().mockResolvedValue("success");

    const result = await executeWithRetry(fn, manager, "test");

    expect(result.success).toBe(true);
    expect(result.result).toBe("success");
    expect(result.attempts).toBe(1);
  });

  test("fails immediately for non-retryable errors", async () => {
    const manager = new RetryManager({ jitter: false });
    const fn = vi.fn().mockRejectedValue(new Error("Invalid input"));

    const result = await executeWithRetry(fn, manager, "test");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid input");
    expect(result.attempts).toBe(1);
  });

  test("retries on retryable errors", async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      baseDelayMs: 10,
      jitter: false,
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue("success");

    const result = await executeWithRetry(fn, manager, "test");

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });

  test("fails after max retries exhausted", async () => {
    const manager = new RetryManager({
      maxRetries: 2,
      baseDelayMs: 5,
      jitter: false,
    });

    const fn = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await executeWithRetry(fn, manager, "test");

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // initial + 2 retries
  });

  test("records attempt count", async () => {
    const manager = new RetryManager({
      maxRetries: 1,
      baseDelayMs: 5,
      jitter: false,
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ETIMEDOUT"))
      .mockResolvedValue("success");

    const result = await executeWithRetry(fn, manager, "test");

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });
});
