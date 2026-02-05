/**
 * @fileoverview Unit tests for DefaultMetricsCollector.
 * Tests metrics recording, aggregation, and statistics calculation.
 */

import { DefaultMetricsCollector, NoOpMetricsCollector } from "../../src/environment/base/metrics";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("DefaultMetricsCollector", () => {
  describe("constructor", () => {
    test("creates instance with default values", () => {
      const collector = new DefaultMetricsCollector();
      expect(collector).toBeDefined();
    });

    test("creates instance with custom config", () => {
      const collector = new DefaultMetricsCollector({
        maxRecordsPerTool: 500,
        windowMs: 60000,
      });
      expect(collector).toBeDefined();
    });
  });

  describe("record", () => {
    test("records successful execution", () => {
      const collector = new DefaultMetricsCollector();
      collector.record("bash", {
        success: true,
        metadata: { execution_time_ms: 150 },
      });

      const metrics = collector.getMetrics("bash");
      expect(metrics).toBeDefined();
      expect(metrics?.successCount).toBe(1);
      expect(metrics?.failureCount).toBe(0);
      expect(metrics?.successRate).toBe(1);
    });

    test("records failed execution", () => {
      const collector = new DefaultMetricsCollector();
      collector.record("bash", {
        success: false,
        error: "Command failed",
        metadata: { execution_time_ms: 50 },
      });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.successCount).toBe(0);
      expect(metrics?.failureCount).toBe(1);
      expect(metrics?.successRate).toBe(0);
    });

    test("accumulates multiple records", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });
      collector.record("bash", { success: true, metadata: { execution_time_ms: 200 } });
      collector.record("bash", { success: false, metadata: { execution_time_ms: 50 } });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.totalCalls).toBe(3);
      expect(metrics?.successCount).toBe(2);
      expect(metrics?.failureCount).toBe(1);
      expect(metrics?.successRate).toBeCloseTo(0.667, 2);
    });

    test("tracks timing statistics", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });
      collector.record("bash", { success: true, metadata: { execution_time_ms: 200 } });
      collector.record("bash", { success: true, metadata: { execution_time_ms: 300 } });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.avgExecutionTimeMs).toBe(200);
      expect(metrics?.minExecutionTimeMs).toBe(100);
      expect(metrics?.maxExecutionTimeMs).toBe(300);
      expect(metrics?.totalExecutionTimeMs).toBe(600);
    });

    test("maintains max records per tool limit", () => {
      const collector = new DefaultMetricsCollector({ maxRecordsPerTool: 3 });

      for (let i = 0; i < 10; i++) {
        collector.record("bash", { success: true, metadata: { execution_time_ms: i * 100 } });
      }

      const metrics = collector.getMetrics("bash");
      expect(metrics?.totalCalls).toBe(3); // Only keeps last 3
    });
  });

  describe("getMetrics", () => {
    test("returns undefined for unknown tool", () => {
      const collector = new DefaultMetricsCollector();
      const metrics = collector.getMetrics("unknown");

      expect(metrics).toBeUndefined();
    });

    test("calculates percentiles correctly", () => {
      const collector = new DefaultMetricsCollector();

      // Record times: 100, 200, 300, 400, 500
      for (let i = 1; i <= 5; i++) {
        collector.record("bash", { success: true, metadata: { execution_time_ms: i * 100 } });
      }

      const metrics = collector.getMetrics("bash");
      expect(metrics?.p50ExecutionTimeMs).toBe(300); // Median
      expect(metrics?.p95ExecutionTimeMs).toBe(500);
      expect(metrics?.p99ExecutionTimeMs).toBe(500);
    });

    test("filters by time window", async () => {
      const collector = new DefaultMetricsCollector({ windowMs: 100 });

      // Old record
      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // New record
      collector.record("bash", { success: true, metadata: { execution_time_ms: 200 } });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.totalCalls).toBe(1);
    });

    test("tracks last called timestamp", async () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.lastCalledAt).toBeDefined();
    });
  });

  describe("getAllMetrics", () => {
    test("returns metrics for all tools", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });
      collector.record("network", { success: true, metadata: { execution_time_ms: 200 } });
      collector.record("file", { success: false, metadata: { execution_time_ms: 50 } });

      const allMetrics = collector.getAllMetrics();

      expect(allMetrics.size).toBe(3);
      expect(allMetrics.get("bash")).toBeDefined();
      expect(allMetrics.get("network")).toBeDefined();
      expect(allMetrics.get("file")).toBeDefined();
    });

    test("excludes tools with no data", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });

      const allMetrics = collector.getAllMetrics();

      expect(allMetrics.size).toBe(1);
    });
  });

  describe("reset", () => {
    test("clears all recorded metrics", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });
      collector.record("network", { success: true, metadata: { execution_time_ms: 200 } });

      collector.reset();

      expect(collector.getMetrics("bash")).toBeUndefined();
      expect(collector.getMetrics("network")).toBeUndefined();
      expect(collector.getAllMetrics().size).toBe(0);
    });
  });

  describe("recentFailures", () => {
    test("counts recent failures", () => {
      const collector = new DefaultMetricsCollector();

      collector.record("bash", { success: false, error: "error" });
      collector.record("bash", { success: false, error: "error" });
      collector.record("bash", { success: true });

      const metrics = collector.getMetrics("bash");
      expect(metrics?.recentFailures).toBe(2);
    });
  });
});

describe("NoOpMetricsCollector", () => {
  test("discards all recorded data", () => {
    const collector = new NoOpMetricsCollector();

    collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });

    expect(collector.getMetrics("bash")).toBeUndefined();
    expect(collector.getAllMetrics().size).toBe(0);
  });

  test("reset is no-op", () => {
    const collector = new NoOpMetricsCollector();
    expect(() => collector.reset()).not.toThrow();
  });
});
