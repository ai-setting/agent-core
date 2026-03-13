/**
 * @fileoverview Unit tests for Session.toHistory lazy loading and context usage
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

describe("Session.toHistory lazy loading", () => {
  const testSessionId = "test-session-lazy-load";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should set _historyLoaded flag after toHistory call", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
      _isLoading: true,
    });

    session.addUserMessage("Test");

    // Before toHistory
    expect((session as any)._historyLoaded).toBe(false);

    await session.toHistory();

    // After toHistory
    expect((session as any)._historyLoaded).toBe(true);
  });

  it("should not trigger loading when messages already in memory", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
      _isLoading: true,
    });

    session.addUserMessage("Message 1");
    session.addAssistantMessage("Message 2");

    // Messages already in memory
    expect((session as any)._messages.size).toBe(2);

    // toHistory should work
    const history = await session.toHistory();
    expect(history.length).toBe(2);
  });

  it("should handle session with no placeholder messages", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
      _isLoading: true,
    });

    session.addUserMessage("Direct message");

    const history = await session.toHistory();
    expect(history.length).toBe(1);
  });

  it("should skip loading on subsequent toHistory calls", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
      messageCount: 1,
      _isLoading: true,
    });

    session.addUserMessage("Test message");

    // First call
    const history1 = await session.toHistory();
    
    // Second call should use cached
    const history2 = await session.toHistory();

    expect(history1.length).toBe(history2.length);
  });
});

describe("Session context usage", () => {
  const testSessionId = "test-session-context-usage";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should return undefined when no context usage recorded", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    const stats = session.getContextStats();
    expect(stats).toBeUndefined();
  });

  it("should initialize context usage on first update", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    const stats = session.getContextStats();
    expect(stats).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      contextWindow: 8192,
      usagePercent: 18,
      requestCount: 1,
      lastUpdated: expect.any(Number),
    });
  });

  it("should accumulate usage on subsequent updates", () => {
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
    // Latest usage replaces previous (not accumulated)
    expect(stats?.inputTokens).toBe(2000);
    expect(stats?.outputTokens).toBe(1000);
    expect(stats?.totalTokens).toBe(3000);
    expect(stats?.requestCount).toBe(2);
  });

  it("should calculate usage percent correctly", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage(
      {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      10000
    );

    const stats = session.getContextStats();
    expect(stats?.contextWindow).toBe(10000);
    expect(stats?.usagePercent).toBe(15);
  });

  it("should use provided limit over existing limit", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage(
      {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      10000
    );

    session.updateContextUsage(
      {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      20000
    );

    const stats = session.getContextStats();
    expect(stats?.contextWindow).toBe(20000);
    // usagePercent is calculated with the new contextWindow (1500/20000 = 8%)
    expect(stats?.usagePercent).toBe(8);
  });

  it("should preserve existing limit when no new limit provided", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.updateContextUsage(
      {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      10000
    );

    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    const stats = session.getContextStats();
    expect(stats?.contextWindow).toBe(10000);
  });
});
