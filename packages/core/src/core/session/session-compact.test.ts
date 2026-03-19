/**
 * @fileoverview Unit tests for Session.compact with handle_query
 *
 * 按照设计文档: 使用 handle_query 而不是 invokeLLM
 * - 压缩过程作为新 session 的对话完整记录
 * - 使用 handle_query 的完整 agent run 能力
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

describe("Session.compact with handle_query", () => {
  const testSessionId = "test-session-compact";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should use handle_query instead of invokeLLM", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // Add some messages to compact
    session.addUserMessage("Hello, I need help with coding");
    session.addAssistantMessage("Sure, I can help you with coding. What do you need?");
    session.addUserMessage("Can you help me write a function?");
    session.addAssistantMessage("Of course! Here's a function for you...");

    // Mock handle_query
    const mockHandleQuery = mock(() =>
      Promise.resolve("用户需要编码帮助，已提供函数示例。当前状态：完成。")
    );

    const env = {
      handle_query: mockHandleQuery,
    } as any;

    // Call compact
    const compactedSession = await session.compact(env, { keepMessages: 10 });

    // Verify handle_query was called (not invokeLLM)
    expect(mockHandleQuery).toHaveBeenCalled();

    // Verify the compacted session was created
    expect(compactedSession).toBeDefined();
    expect(compactedSession.id).not.toBe(session.id);
    expect(compactedSession.parentID).toBe(session.id);

    // Verify summary message was added as system message
    const messages = await compactedSession.getMessages();
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Should have system message with summary
    const systemMsg = messages.find(m => m.info.role === "system");
    expect(systemMsg).toBeDefined();
  });

  it("should pass correct parameters to handle_query", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.addUserMessage("Test message");

    let capturedParams: any = null;
    const mockHandleQuery = mock((query: string, context: any, history: any) => {
      capturedParams = { query, context, history };
      return Promise.resolve("Summary");
    });

    const env = {
      handle_query: mockHandleQuery,
    } as any;

    await session.compact(env, { keepMessages: 5 });

    // Verify handle_query was called with correct parameters
    expect(capturedParams).not.toBeNull();
    expect(typeof capturedParams.query).toBe("string");
    expect(capturedParams.context).toBeDefined();
    expect(capturedParams.context.session_id).toBeDefined();
    expect(Array.isArray(capturedParams.history)).toBe(true);
  });

  it("should handle handle_query failure gracefully", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.addUserMessage("Test message");

    const mockHandleQuery = mock(() =>
      Promise.reject(new Error("LLM error"))
    );

    const env = {
      handle_query: mockHandleQuery,
    } as any;

    // Should not throw, should use fallback summary
    const compactedSession = await session.compact(env);

    expect(compactedSession).toBeDefined();
    const messages = await compactedSession.getMessages();
    // Should still have messages (fallback summary)
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("should create child session with correct metadata", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Original Session",
    });

    session.addUserMessage("Test");

    const mockHandleQuery = mock(() =>
      Promise.resolve("Summary")
    );

    const env = { handle_query: mockHandleQuery } as any;

    const compactedSession = await session.compact(env);

    // Verify parent-child relationship
    expect(compactedSession.parentID).toBe(session.id);
    expect(compactedSession.title).toContain("Compacted:");

    // Verify metadata
    expect(compactedSession.getMetadata("parentSessionId")).toBe(session.id);
    expect(compactedSession.getMetadata("compactionTime")).toBeDefined();
  });
});

describe("Session.getLatestCompactedSession", () => {
  const testSessionId = "test-session-chain";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should return original session when not compacted", () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    Storage.saveSession(session);

    const result = Session.get(testSessionId);
    expect(result?.id).toBe(testSessionId);
  });

  it("should traverse compaction chain to find latest session", async () => {
    // Create parent session
    const parentSession = new Session({
      id: "parent-session",
      title: "Parent Session",
    });
    parentSession.addUserMessage("Parent message");
    Storage.saveSession(parentSession);

    // Mark parent as compacted
    parentSession._info.contextUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      contextWindow: 2000,
      usagePercent: 75,
      requestCount: 1,
      lastUpdated: Date.now(),
      compacted: true,
      compactedSessionId: "child-session-1",
    };
    Storage.saveSession(parentSession);

    // Create first child session
    const childSession1 = new Session({
      id: "child-session-1",
      title: "Compacted: Parent Session",
      parentID: "parent-session",
    });
    childSession1.addUserMessage("Child 1 message");
    Storage.saveSession(childSession1);

    // Mark first child as compacted too
    childSession1._info.contextUsage = {
      inputTokens: 800,
      outputTokens: 400,
      totalTokens: 1200,
      contextWindow: 2000,
      usagePercent: 60,
      requestCount: 1,
      lastUpdated: Date.now(),
      compacted: true,
      compactedSessionId: "child-session-2",
    };
    Storage.saveSession(childSession1);

    // Create second child session (latest)
    const childSession2 = new Session({
      id: "child-session-2",
      title: "Compacted: Compacted: Parent Session",
      parentID: "child-session-1",
    });
    childSession2.addUserMessage("Child 2 message");
    Storage.saveSession(childSession2);

    // Test: get should return the latest session
    const result = Session.get("parent-session");
    expect(result?.id).toBe("child-session-2");
  });

  it("should return exact session when using getWithoutChain", () => {
    // Create parent session
    const parentSession = new Session({
      id: "parent-session",
      title: "Parent Session",
    });
    Storage.saveSession(parentSession);

    // Mark parent as compacted
    parentSession._info.contextUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      contextWindow: 2000,
      usagePercent: 75,
      requestCount: 1,
      lastUpdated: Date.now(),
      compacted: true,
      compactedSessionId: "child-session",
    };
    Storage.saveSession(parentSession);

    // Create child session
    const childSession = new Session({
      id: "child-session",
      title: "Child Session",
      parentID: "parent-session",
    });
    childSession.addUserMessage("Child message");
    Storage.saveSession(childSession);

    // getWithoutChain should return exact session
    const result = Session.getWithoutChain("parent-session");
    expect(result?.id).toBe("parent-session");

    // get should return latest session (child)
    const latestResult = Session.get("parent-session");
    expect(latestResult?.id).toBe("child-session");
  });
});
