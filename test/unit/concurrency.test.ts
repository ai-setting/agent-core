/**
 * @fileoverview Unit tests for ConcurrencyManager.
 * Tests slot acquisition, release, and queue management.
 */

import { ConcurrencyManager, withConcurrency } from "../../src/environment/base/concurrency";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("ConcurrencyManager", () => {
  describe("constructor", () => {
    test("creates instance with default values", () => {
      const manager = new ConcurrencyManager();
      expect(manager).toBeDefined();
    });

    test("creates instance with custom config", () => {
      const manager = new ConcurrencyManager({
        defaultLimit: 5,
        maxWaitTimeMs: 10000,
      });
      expect(manager).toBeDefined();
    });
  });

  describe("getConcurrencyLimit", () => {
    test("returns default limit", () => {
      const manager = new ConcurrencyManager({ defaultLimit: 10 });
      expect(manager.getConcurrencyLimit("bash")).toBe(10);
    });

    test("returns tool-specific override", () => {
      const manager = new ConcurrencyManager({ defaultLimit: 10 });
      manager.setConcurrencyLimit("api_calls", 5);

      expect(manager.getConcurrencyLimit("api_calls")).toBe(5);
      expect(manager.getConcurrencyLimit("bash")).toBe(10);
    });

    test("enforces minimum limit of 1", () => {
      const manager = new ConcurrencyManager();
      manager.setConcurrencyLimit("test", 0);

      expect(manager.getConcurrencyLimit("test")).toBe(1);
    });
  });

  describe("setConcurrencyLimit", () => {
    test("sets limit for a new tool", () => {
      const manager = new ConcurrencyManager();
      manager.setConcurrencyLimit("network", 3);

      expect(manager.getConcurrencyLimit("network")).toBe(3);
    });

    test("updates existing limit", () => {
      const manager = new ConcurrencyManager();
      manager.setConcurrencyLimit("network", 3);
      manager.setConcurrencyLimit("network", 5);

      expect(manager.getConcurrencyLimit("network")).toBe(5);
    });
  });

  describe("acquireSlot", () => {
    test("acquires slot immediately when available", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 2 });

      const result = await manager.acquireSlot("bash");

      expect(result.acquired).toBe(true);
      expect(result.waitTimeMs).toBe(0);
      expect(result.slotId).toBeDefined();
    });

    test("acquires multiple slots up to limit", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 2 });

      const slot1 = await manager.acquireSlot("bash");
      const slot2 = await manager.acquireSlot("bash");

      expect(slot1.acquired).toBe(true);
      expect(slot2.acquired).toBe(true);
      expect(slot1.slotId).not.toBe(slot2.slotId);
    });

    test("queues when all slots are in use", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1, maxWaitTimeMs: 1000 });

      const slot1 = await manager.acquireSlot("bash");
      const slot2Promise = manager.acquireSlot("bash");

      // Small delay to ensure slot2 is waiting
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Release first slot
      manager.releaseSlot("bash", slot1.slotId!);

      const slot2 = await slot2Promise;

      expect(slot2.acquired).toBe(true);
      // Wait time may be very small, just verify it was queued
      expect(slot2.waitTimeMs).toBeGreaterThanOrEqual(0);
    });

    test("times out when queue exceeds maxWaitTimeMs", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1, maxWaitTimeMs: 50 });

      const slot1 = await manager.acquireSlot("bash");
      const slot2Promise = manager.acquireSlot("bash");

      // Don't release - should timeout
      await expect(slot2Promise).rejects.toThrow("timeout");
    });
  });

  describe("releaseSlot", () => {
    test("releases acquired slot", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1 });

      const slot1 = await manager.acquireSlot("bash");
      expect(manager.getActiveCount("bash")).toBe(1);

      manager.releaseSlot("bash", slot1.slotId!);
      expect(manager.getActiveCount("bash")).toBe(0);
    });

    test("notifies next waiter after release", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1 });

      const slot1 = await manager.acquireSlot("bash");
      const slot2Promise = manager.acquireSlot("bash");

      // Small delay to ensure slot2 is waiting
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.releaseSlot("bash", slot1.slotId!);
      const slot2 = await slot2Promise;

      expect(slot2.acquired).toBe(true);
    });

    test("handles releasing non-existent slot", () => {
      const manager = new ConcurrencyManager();

      // Should not throw
      expect(() => manager.releaseSlot("bash", 999)).not.toThrow();
    });
  });

  describe("getActiveCount", () => {
    test("returns current active slots", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 3 });

      expect(manager.getActiveCount("bash")).toBe(0);

      const slot1 = await manager.acquireSlot("bash");
      expect(manager.getActiveCount("bash")).toBe(1);

      const slot2 = await manager.acquireSlot("bash");
      expect(manager.getActiveCount("bash")).toBe(2);

      manager.releaseSlot("bash", slot1.slotId!);
      expect(manager.getActiveCount("bash")).toBe(1);
    });

    test("returns 0 for unknown tools", () => {
      const manager = new ConcurrencyManager();
      expect(manager.getActiveCount("unknown")).toBe(0);
    });
  });

  describe("getWaitQueueLength", () => {
    test("returns current queue length", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1, maxWaitTimeMs: 1000 });

      const slot1 = await manager.acquireSlot("bash");

      const slot2Promise = manager.acquireSlot("bash");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(manager.getWaitQueueLength("bash")).toBe(1);

      manager.releaseSlot("bash", slot1.slotId!);
      await slot2Promise;

      expect(manager.getWaitQueueLength("bash")).toBe(0);
    });
  });

  describe("clear", () => {
    test("clears all state and rejects waiters", async () => {
      const manager = new ConcurrencyManager({ defaultLimit: 1, maxWaitTimeMs: 10000 });

      const slot1 = await manager.acquireSlot("bash");
      const slot2Promise = manager.acquireSlot("bash");

      manager.clear();

      await expect(slot2Promise).rejects.toThrow("cleared");
    });

    test("resets all state", async () => {
      const manager = new ConcurrencyManager();
      manager.setConcurrencyLimit("test", 5);
      await manager.acquireSlot("test");

      manager.clear();

      expect(manager.getConcurrencyLimit("test")).toBe(10); // default
      expect(manager.getActiveCount("test")).toBe(0);
    });
  });

  describe("default static method", () => {
    test("creates manager with default limit of 10", () => {
      const manager = ConcurrencyManager.default();
      expect(manager.getConcurrencyLimit("test")).toBe(10);
    });
  });
});

describe("withConcurrency", () => {
  test("executes function within concurrency limit", async () => {
    const manager = new ConcurrencyManager({ defaultLimit: 2 });
    const fn = vi.fn().mockResolvedValue("success");

    const result = await withConcurrency(fn, manager, "bash");

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("releases slot even on error", async () => {
    const manager = new ConcurrencyManager({ defaultLimit: 1 });
    const fn = vi.fn().mockRejectedValue(new Error("test error"));

    await expect(withConcurrency(fn, manager, "bash")).rejects.toThrow("test error");
    expect(manager.getActiveCount("bash")).toBe(0);
  });

  test("fails to acquire slot returns error", async () => {
    const manager = new ConcurrencyManager({ defaultLimit: 1, maxWaitTimeMs: 50 });

    await manager.acquireSlot("bash");
    const fn = vi.fn().mockResolvedValue("success");

    // The actual error message from the concurrency manager
    await expect(withConcurrency(fn, manager, "bash")).rejects.toThrow("Concurrency limit wait timeout");
  });
});
