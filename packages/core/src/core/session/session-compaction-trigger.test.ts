/**
 * @fileoverview Unit tests for auto-compaction trigger with threshold detection
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

describe("Session auto-compaction trigger with threshold", () => {
  const testSessionId = "test-session-trigger";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should trigger compaction when usage exceeds threshold with env provided", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // Add messages to compress
    session.addUserMessage("Message 1");
    session.addAssistantMessage("Response 1");

    // Mock handle_query (new signature with additionInfo parameter)
    const mockHandleQuery = mock(() => 
      Promise.resolve("Summary of the conversation")
    );
    
    let compactionCalled = false;
    const env = { 
      handle_query: mockHandleQuery,
      session: session,
    } as any;

    // Mock the session's compact method to track call
    const originalCompact = session.compact.bind(session);
    (session as any).compact = async (e: any, opts: any) => {
      compactionCalled = true;
      return originalCompact(e, opts);
    };

    // Update with high usage (85% = above 80% threshold)
    // Provide env to enable auto-compaction
    session.updateContextUsage({
      inputTokens: 6000,
      outputTokens: 2500,
      totalTokens: 8500,
    }, 10000, env, "gpt-4o");

    // Wait a bit for async compaction
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have triggered compaction
    expect(compactionCalled).toBe(true);
  });

  it("should not trigger compaction when usage is below threshold", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    let compactionCalled = false;
    const env = {} as any;

    (session as any).compact = async () => {
      compactionCalled = true;
      return {} as Session;
    };

    // Update with low usage (15% = below 80% threshold)
    session.updateContextUsage({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    }, 10000, env, "gpt-4o");

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(compactionCalled).toBe(false);
  });

  it("should not trigger compaction twice", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.addUserMessage("Message");

    let compactionCallCount = 0;
    const mockHandleQuery = mock(() => Promise.resolve("Summary"));
    const env = { handle_query: mockHandleQuery } as any;

    const originalCompact = session.compact.bind(session);
    (session as any).compact = async (e: any, opts: any) => {
      compactionCallCount++;
      return originalCompact(e, opts);
    };

    // First trigger - 85%
    session.updateContextUsage({
      inputTokens: 6000,
      outputTokens: 2500,
      totalTokens: 8500,
    }, 10000, env, "gpt-4o");

    await new Promise(resolve => setTimeout(resolve, 50));

    // Second trigger attempt - should be blocked (compacted flag should be set)
    session.updateContextUsage({
      inputTokens: 7000,
      outputTokens: 3000,
      totalTokens: 10000,
    }, 10000, env, "gpt-4o");

    await new Promise(resolve => setTimeout(resolve, 50));

    // Should only trigger once due to compacted flag
    expect(compactionCallCount).toBe(1);
  });

  it("should use default threshold when model not found", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    let compactionCalled = false;
    const mockHandleQuery = mock(() => Promise.resolve("Summary"));
    const env = { handle_query: mockHandleQuery } as any;

    const originalCompact = session.compact.bind(session);
    (session as any).compact = async (e: any, opts: any) => {
      compactionCalled = true;
      return originalCompact(e, opts);
    };

    // 75% usage - should NOT trigger with default 80% threshold
    session.updateContextUsage({
      inputTokens: 6000,
      outputTokens: 1500,
      totalTokens: 7500,
    }, 10000, env, "unknown-model");

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(compactionCalled).toBe(false);

    // 85% usage - SHOULD trigger with default 80% threshold
    session.updateContextUsage({
      inputTokens: 7000,
      outputTokens: 1500,
      totalTokens: 8500,
    }, 10000, env, "unknown-model");

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(compactionCalled).toBe(true);
  });
});
