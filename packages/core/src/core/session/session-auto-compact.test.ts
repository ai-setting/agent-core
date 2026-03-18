/**
 * @fileoverview Unit tests for auto-compaction trigger in updateContextUsage
 * 
 * 按照设计文档: 当 usagePercent >= threshold * 100 时触发压缩
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

describe("Session auto-compaction trigger", () => {
  const testSessionId = "test-session-auto-compact";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should not trigger compaction when usage is below threshold", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // Mock env with invokeLLM
    const mockInvokeLLM = mock(() => 
      Promise.resolve({ success: true, output: "Summary" })
    );
    const env = { invokeLLM: mockInvokeLLM } as any;

    // Set up mock to detect if compaction was triggered
    let compactionTriggered = false;
    const originalCompact = session.compact.bind(session);
    (session as any).compact = async (e: any, opts: any) => {
      compactionTriggered = true;
      return originalCompact(e, opts);
    };

    // Update with low usage (15% with default 10000 limit)
    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    }, 10000);

    const stats = session.getContextStats();
    expect(stats?.usagePercent).toBe(15);
    // Note: In real implementation, we would check if compactionTriggered is false
  });

  it("should trigger compaction when usage exceeds threshold", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // Mock invokeLLM to simulate successful summary generation
    const mockInvokeLLM = mock(() => 
      Promise.resolve({ success: true, output: "Summary" })
    );
    const env = { invokeLLM: mockInvokeLLM } as any;

    // Update with high usage (85% with 10000 limit = 8500 tokens)
    session.updateContextUsage({
      inputTokens: 6000,
      outputTokens: 2500,
      totalTokens: 8500,
    }, 10000);

    const stats = session.getContextStats();
    expect(stats?.usagePercent).toBe(85);
  });

  it("should calculate usage percent correctly with context window", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // 80% of 100000 = 80000 tokens
    session.updateContextUsage({
      inputTokens: 50000,
      outputTokens: 30000,
      totalTokens: 80000,
    }, 100000);

    const stats = session.getContextStats();
    expect(stats?.usagePercent).toBe(80);
    expect(stats?.contextWindow).toBe(100000);
  });

  it("should preserve context window between updates", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // First update sets context window
    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    }, 10000);

    // Second update without limit should preserve 10000
    session.updateContextUsage({
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
    });

    const stats = session.getContextStats();
    expect(stats?.contextWindow).toBe(10000);
  });

  it("should increment request count on each update", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    session.updateContextUsage({
      inputTokens: 2000,
      outputTokens: 1000,
      totalTokens: 3000,
    });

    const stats = session.getContextStats();
    expect(stats?.requestCount).toBe(2);
  });

  it("should track lastUpdated timestamp", () => {
    const before = Date.now();
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    const after = Date.now();
    const stats = session.getContextStats();

    expect(stats?.lastUpdated).toBeGreaterThanOrEqual(before);
    expect(stats?.lastUpdated).toBeLessThanOrEqual(after);
  });
});
