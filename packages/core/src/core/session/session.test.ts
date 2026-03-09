/**
 * @fileoverview Unit tests for Session.toHistory lazy loading
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
