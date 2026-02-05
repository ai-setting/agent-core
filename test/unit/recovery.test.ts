/**
 * @fileoverview Unit tests for ErrorRecovery.
 * Tests recovery strategies, fallback execution, and error handling.
 */

import { ErrorRecovery } from "../../src/environment/base/recovery";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("ErrorRecovery", () => {
  describe("constructor", () => {
    test("creates instance with default strategy", () => {
      const recovery = new ErrorRecovery();
      expect(recovery).toBeDefined();
    });

    test("creates instance with custom config", () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "retry", maxRetries: 3 },
        maxHistorySize: 50,
      });
      expect(recovery).toBeDefined();
    });
  });

  describe("setStrategy", () => {
    test("sets retry strategy for a tool", () => {
      const recovery = new ErrorRecovery();
      recovery.setStrategy("api_call", { type: "retry", maxRetries: 3 });

      const strategy = recovery.getStrategy("api_call");
      expect(strategy.type).toBe("retry");
      expect(strategy.maxRetries).toBe(3);
    });

    test("sets fallback strategy for a tool", () => {
      const recovery = new ErrorRecovery();
      recovery.setStrategy("api_call", {
        type: "fallback",
        fallbackTool: "cache",
      });

      const strategy = recovery.getStrategy("api_call");
      expect(strategy.type).toBe("fallback");
      expect(strategy.fallbackTool).toBe("cache");
    });

    test("overrides existing strategy", () => {
      const recovery = new ErrorRecovery();
      recovery.setStrategy("api_call", { type: "retry", maxRetries: 2 });
      recovery.setStrategy("api_call", { type: "skip", fallbackValue: "default" });

      const strategy = recovery.getStrategy("api_call");
      expect(strategy.type).toBe("skip");
    });
  });

  describe("getStrategy", () => {
    test("returns tool-specific strategy", () => {
      const recovery = new ErrorRecovery();
      recovery.setStrategy("api", { type: "retry", maxRetries: 5 });

      expect(recovery.getStrategy("api").type).toBe("retry");
    });

    test("returns default strategy for unknown tools", () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "error" },
      });

      expect(recovery.getStrategy("unknown").type).toBe("error");
    });
  });

  describe("removeStrategy", () => {
    test("removes tool-specific strategy", () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "error" },
      });
      recovery.setStrategy("api", { type: "retry", maxRetries: 3 });

      expect(recovery.removeStrategy("api")).toBe(true);
      expect(recovery.getStrategy("api").type).toBe("error");
    });

    test("returns false when removing non-existent strategy", () => {
      const recovery = new ErrorRecovery();
      expect(recovery.removeStrategy("unknown")).toBe(false);
    });
  });

  describe("executeWithRecovery", () => {
    test("succeeds on first attempt", async () => {
      const recovery = new ErrorRecovery();
      const fn = vi.fn().mockResolvedValue("success");

      const result = await recovery.executeWithRecovery(fn, "test", "action1", {});

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test("fails immediately for error strategy", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "error" },
      });
      const fn = vi.fn().mockRejectedValue(new Error("test error"));

      await expect(recovery.executeWithRecovery(fn, "test", "action1", {})).rejects.toThrow(
        "test error",
      );
    });

    test("retries on retry strategy", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "retry", maxRetries: 3 },
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary error"))
        .mockResolvedValue("success");

      const result = await recovery.executeWithRecovery(fn, "test", "action1", {});

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test("fails after max retries exhausted", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "retry", maxRetries: 2 },
      });

      const fn = vi.fn().mockRejectedValue(new Error("persistent error"));

      await expect(recovery.executeWithRecovery(fn, "test", "action1", {})).rejects.toThrow(
        "persistent error",
      );
    });

    test("throws for unimplemented fallback", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "fallback", fallbackTool: "cache" },
      });
      const fn = vi.fn().mockRejectedValue(new Error("error"));

      await expect(recovery.executeWithRecovery(fn, "test", "action1", {})).rejects.toThrow(
        "Fallback execution not implemented",
      );
    });

    test("returns skip value when strategy is skip", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "skip" },
      });
      const fn = vi.fn().mockRejectedValue(new Error("error"));

      const result = await recovery.executeWithRecovery(fn, "test", "action1", {});

      expect(result).toBeUndefined();
    });

    test("passes correct context to onError handler", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: {
          type: "error",
          onError: async (error, context) => {
            expect(context.toolName).toBe("api_call");
            expect(context.actionId).toBe("action123");
            expect(context.attempt).toBe(1);
            expect(error.message).toBe("test error");
            return { action: "error", error };
          },
        },
      });
      const fn = vi.fn().mockRejectedValue(new Error("test error"));

      await expect(
        recovery.executeWithRecovery(fn, "api_call", "action123", { param: "value" }),
      ).rejects.toThrow("test error");
    });
  });

  describe("getExecutionHistory", () => {
    test("records execution attempts", async () => {
      const recovery = new ErrorRecovery();
      const fn = vi.fn().mockResolvedValue("success");

      await recovery.executeWithRecovery(fn, "test", "action1", {});
      await recovery.executeWithRecovery(fn, "test", "action2", {});

      const history1 = recovery.getExecutionHistory("test", "action1");
      const history2 = recovery.getExecutionHistory("test", "action2");

      expect(history1.length).toBe(1);
      expect(history1[0].success).toBe(true);
      expect(history2.length).toBe(1);
    });

    test("returns empty array for unknown action", () => {
      const recovery = new ErrorRecovery();
      const history = recovery.getExecutionHistory("unknown", "action");

      expect(history).toEqual([]);
    });
  });

  describe("getRecentFailures", () => {
    test("counts recent failures", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "error" },
      });
      const fn = vi.fn().mockRejectedValue(new Error("error"));

      // Record some failures
      await recovery.executeWithRecovery(fn, "api", "action1", {}).catch(() => {});
      await recovery.executeWithRecovery(fn, "api", "action2", {}).catch(() => {});

      const failures = recovery.getRecentFailures("api", 60000);

      expect(failures).toBe(2);
    });

    test("filters by time window", async () => {
      const recovery = new ErrorRecovery({
        defaultStrategy: { type: "error" },
      });
      const fn = vi.fn().mockRejectedValue(new Error("error"));

      await recovery.executeWithRecovery(fn, "api", "action1", {}).catch(() => {});

      const failures = recovery.getRecentFailures("api", 1000);

      expect(failures).toBe(1);
    });
  });

  describe("clear", () => {
    test("clears execution history", async () => {
      const recovery = new ErrorRecovery();
      const fn = vi.fn().mockResolvedValue("success");

      await recovery.executeWithRecovery(fn, "test", "action1", {});
      recovery.clear();

      const history = recovery.getExecutionHistory("test", "action1");
      expect(history.length).toBe(0);
    });
  });

  describe("static factory methods", () => {
    test("default creates error-first strategy", () => {
      const recovery = ErrorRecovery.default();
      expect(recovery.getStrategy("test").type).toBe("error");
    });

    test("withFallback creates fallback strategy", () => {
      const recovery = ErrorRecovery.withFallback("cache");
      expect(recovery.getStrategy("test").type).toBe("fallback");
      expect(recovery.getStrategy("test").fallbackTool).toBe("cache");
    });

    test("withRetry creates retry strategy", () => {
      const recovery = ErrorRecovery.withRetry(5);
      const strategy = recovery.getStrategy("test");
      expect(strategy.type).toBe("retry");
      expect(strategy.maxRetries).toBe(5);
    });
  });
});
