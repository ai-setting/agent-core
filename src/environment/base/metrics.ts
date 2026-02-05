/**
 * @fileoverview Metrics collection utilities for monitoring tool execution performance.
 * Provides aggregated statistics including success rates, latency percentiles, and failure tracking.
 */

/**
 * A single metric entry recording one tool execution.
 */
export interface MetricEntry {
  /** Name of the executed tool. */
  toolName: string;

  /** ISO timestamp of when the execution occurred. */
  timestamp: string;

  /** Whether the execution succeeded. */
  success: boolean;

  /** Duration of execution in milliseconds. */
  executionTimeMs: number;

  /** Error message if execution failed. */
  error?: string;

  /** Additional execution metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Aggregated metrics for a tool over a time window.
 */
export interface AggregatedMetrics {
  /** Name of the tool. */
  toolName: string;

  /** Total number of executions. */
  totalCalls: number;

  /** Number of successful executions. */
  successCount: number;

  /** Number of failed executions. */
  failureCount: number;

  /** Ratio of successful to total executions (0-1). */
  successRate: number;

  /** Average execution time in milliseconds. */
  avgExecutionTimeMs: number;

  /** Minimum execution time in milliseconds. */
  minExecutionTimeMs: number;

  /** Maximum execution time in milliseconds. */
  maxExecutionTimeMs: number;

  /** Total execution time in milliseconds. */
  totalExecutionTimeMs: number;

  /** 50th percentile execution time (median). */
  p50ExecutionTimeMs: number;

  /** 95th percentile execution time. */
  p95ExecutionTimeMs: number;

  /** 99th percentile execution time. */
  p99ExecutionTimeMs: number;

  /** ISO timestamp of the most recent execution. */
  lastCalledAt?: string;

  /** Number of failures in the last 60 seconds. */
  recentFailures: number;
}

/**
 * Interface for collecting and retrieving execution metrics.
 */
export interface MetricsCollector {
  /**
   * Records a single tool execution.
   *
   * @param toolName - Name of the executed tool
   * @param result - Execution result including success status and timing
   */
  record(toolName: string, result: { success: boolean; error?: string; metadata?: Record<string, unknown> }): void;

  /**
   * Gets aggregated metrics for a specific tool.
   *
   * @param toolName - Name of the tool
   * @returns Aggregated metrics or undefined if no data
   */
  getMetrics(toolName: string): AggregatedMetrics | undefined;

  /**
   * Gets aggregated metrics for all tools.
   *
   * @returns Map of tool names to their aggregated metrics
   */
  getAllMetrics(): Map<string, AggregatedMetrics>;

  /** Clears all recorded metrics. */
  reset(): void;
}

/**
 * Default implementation of MetricsCollector with in-memory storage.
 *
 * Maintains a rolling window of execution records and computes
 * aggregated statistics including percentiles and success rates.
 *
 * @example
 * ```typescript
 * const collector = new DefaultMetricsCollector({
 *   maxRecordsPerTool: 1000,
 *   windowMs: 3600000
 * });
 *
 * collector.record("bash", { success: true, metadata: { execution_time_ms: 150 } });
 *
 * const metrics = collector.getMetrics("bash");
 * console.log(`Success rate: ${metrics?.successRate}`);
 * ```
 */
export class DefaultMetricsCollector implements MetricsCollector {
  /** Per-tool execution records keyed by tool name. */
  private records: Map<string, MetricEntry[]>;

  /** Maximum records to keep per tool. */
  private maxRecordsPerTool: number;

  /** Time window in milliseconds for aggregation. */
  private windowMs: number;

  /**
   * Creates a new DefaultMetricsCollector instance.
   *
   * @param config - Optional configuration settings
   */
  constructor(config?: { maxRecordsPerTool?: number; windowMs?: number }) {
    this.maxRecordsPerTool = config?.maxRecordsPerTool ?? 1000;
    this.windowMs = config?.windowMs ?? 3600000;
    this.records = new Map();
  }

  /**
   * Records a single tool execution.
   *
   * @param toolName - Name of the executed tool
   * @param result - Execution result details
   */
  record(
    toolName: string,
    result: { success: boolean; error?: string; metadata?: Record<string, unknown> },
  ): void {
    const entry: MetricEntry = {
      toolName,
      timestamp: new Date().toISOString(),
      success: result.success,
      executionTimeMs: result.metadata?.execution_time_ms as number ?? 0,
      error: result.error,
      metadata: result.metadata,
    };

    const toolRecords = this.records.get(toolName) ?? [];
    toolRecords.push(entry);

    // Maintain rolling window size
    while (toolRecords.length > this.maxRecordsPerTool) {
      toolRecords.shift();
    }

    this.records.set(toolName, toolRecords);
  }

  /**
   * Gets aggregated metrics for a specific tool.
   *
   * Computes statistics over the configured time window,
   * filtering out older records for accurate current metrics.
   *
   * @param toolName - Name of the tool
   * @returns Aggregated metrics or undefined if no data exists
   */
  getMetrics(toolName: string): AggregatedMetrics | undefined {
    const toolRecords = this.records.get(toolName);
    if (!toolRecords || toolRecords.length === 0) {
      return undefined;
    }

    const now = Date.now();
    // Filter to records within the time window
    const windowRecords = toolRecords.filter(
      (r) => now - new Date(r.timestamp).getTime() < this.windowMs,
    );

    const executionTimes = windowRecords.map((r) => r.executionTimeMs).sort((a, b) => a - b);
    const successfulRecords = windowRecords.filter((r) => r.success);

    const totalCalls = windowRecords.length;
    const successCount = successfulRecords.length;
    const failureCount = totalCalls - successCount;
    const successRate = totalCalls > 0 ? successCount / totalCalls : 0;

    const totalTime = executionTimes.reduce((sum, t) => sum + t, 0);
    const avgExecutionTimeMs = totalTime / executionTimes.length || 0;

    // Count failures in the last 60 seconds
    const recentFailures = windowRecords.filter(
      (r) => !r.success && now - new Date(r.timestamp).getTime() < 60000,
    ).length;

    return {
      toolName,
      totalCalls,
      successCount,
      failureCount,
      successRate,
      avgExecutionTimeMs,
      minExecutionTimeMs: executionTimes[0] ?? 0,
      maxExecutionTimeMs: executionTimes[executionTimes.length - 1] ?? 0,
      totalExecutionTimeMs: totalTime,
      p50ExecutionTimeMs: this.percentile(executionTimes, 50),
      p95ExecutionTimeMs: this.percentile(executionTimes, 95),
      p99ExecutionTimeMs: this.percentile(executionTimes, 99),
      lastCalledAt: windowRecords[windowRecords.length - 1]?.timestamp,
      recentFailures,
    };
  }

  /**
   * Gets aggregated metrics for all tracked tools.
   *
   * @returns Map of tool names to their aggregated metrics
   */
  getAllMetrics(): Map<string, AggregatedMetrics> {
    const allMetrics = new Map<string, AggregatedMetrics>();

    for (const toolName of this.records.keys()) {
      const metrics = this.getMetrics(toolName);
      if (metrics) {
        allMetrics.set(toolName, metrics);
      }
    }

    return allMetrics;
  }

  /** Clears all recorded metrics. */
  reset(): void {
    this.records.clear();
  }

  /**
   * Calculates the p-th percentile of sorted values.
   *
   * @param sortedValues - Ascending-sorted array of values
   * @param p - Percentile to calculate (0-100)
   * @returns The percentile value
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, idx)] ?? 0;
  }
}

/**
 * No-op metrics collector that discards all data.
 *
 * Useful for testing or when metrics collection is not needed.
 */
export class NoOpMetricsCollector implements MetricsCollector {
  /** No-op record implementation. */
  record(): void {}

  /** Returns undefined. */
  getMetrics(): AggregatedMetrics | undefined { return undefined; }

  /** Returns empty map. */
  getAllMetrics(): Map<string, AggregatedMetrics> { return new Map(); }

  /** No-op reset implementation. */
  reset(): void {}
}

/**
 * Creates a metrics collector that logs to console.
 *
 * Useful for debugging and development. Logs each recorded
 * execution with its result and timing.
 *
 * @returns A metrics collector that logs to console
 *
 * @example
 * ```typescript
 * const collector = createConsoleMetricsCollector();
 * collector.record("bash", { success: true, metadata: { execution_time_ms: 100 } });
 * // Output: [METRICS] bash: SUCCESS (100ms)
 * ```
 */
export function createConsoleMetricsCollector(): MetricsCollector {
  return new (class implements MetricsCollector {
    private records: Map<string, MetricEntry[]> = new Map();

    record(toolName: string, result: { success: boolean; error?: string; metadata?: Record<string, unknown> }): void {
      const entry: MetricEntry = {
        toolName,
        timestamp: new Date().toISOString(),
        success: result.success,
        executionTimeMs: result.metadata?.execution_time_ms as number ?? 0,
        error: result.error,
        metadata: result.metadata,
      };

      const records = this.records.get(toolName) ?? [];
      records.push(entry);
      this.records.set(toolName, records);

      console.log(`[METRICS] ${toolName}: ${result.success ? "SUCCESS" : "FAILED"} (${entry.executionTimeMs}ms)`);
      if (!result.success && result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }

    getMetrics(): AggregatedMetrics | undefined { return undefined; }
    getAllMetrics(): Map<string, AggregatedMetrics> { return new Map(); }
    reset(): void { this.records.clear(); }
  })();
}
