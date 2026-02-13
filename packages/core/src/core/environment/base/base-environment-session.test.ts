/**
 * @fileoverview Unit tests for BaseEnvironment session event hooks
 *
 * Tests that createSession, updateSession, deleteSession emit SessionEvent
 * via onSessionEvent when the hook is configured.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  BaseEnvironment,
  type BaseEnvironmentConfig,
  type SessionEvent,
} from "./base-environment.js";
import type { Action, Context, ToolResult } from "../../types/index.js";

class TestEnv extends BaseEnvironment {
  constructor(config?: BaseEnvironmentConfig) {
    super(config);
  }

  protected getDefaultTimeout(): number {
    return 1000;
  }
  protected getTimeoutOverride(_action: Action): number | undefined {
    return undefined;
  }
  protected getMaxRetries(): number {
    return 0;
  }
  protected getRetryDelay(): number {
    return 0;
  }
  protected isRetryableError(): boolean {
    return false;
  }
  protected getConcurrencyLimit(): number {
    return 1;
  }
  protected getRecoveryStrategy(): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "error" };
  }
}

describe("BaseEnvironment session event hooks", () => {
  let events: SessionEvent[];

  beforeEach(() => {
    events = [];
  });

  it("should emit session.created when createSession is called", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    const session = env.createSession({ title: "My Session" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session.created");
    expect(events[0].sessionId).toBe(session.id);
    expect((events[0] as Extract<SessionEvent, { type: "session.created" }>).title).toBe("My Session");
    expect((events[0] as Extract<SessionEvent, { type: "session.created" }>).directory).toBeDefined();
  });

  it("should emit session.updated when updateSession succeeds", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    const session = env.createSession({ title: "Original" });
    events.length = 0; // clear created event

    env.updateSession(session.id, { title: "Updated Title" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session.updated");
    expect(events[0].sessionId).toBe(session.id);
    expect((events[0] as Extract<SessionEvent, { type: "session.updated" }>).updates.title).toBe("Updated Title");
  });

  it("should NOT emit session.updated when session not found", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    env.updateSession("non-existent-id", { title: "Ignored" });

    expect(events.length).toBe(0);
  });

  it("should emit session.deleted when deleteSession succeeds", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    const session = env.createSession({ title: "To Delete" });
    events.length = 0;

    env.deleteSession(session.id);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session.deleted");
    expect(events[0].sessionId).toBe(session.id);
  });

  it("should NOT emit session.deleted when session not found", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    env.deleteSession("non-existent-session-id");

    expect(events.length).toBe(0);
  });

  it("should not emit when onSessionEvent is not configured", () => {
    const env = new TestEnv(); // no onSessionEvent

    const session = env.createSession({ title: "Test" });
    env.updateSession(session.id, { title: "Updated" });
    env.deleteSession(session.id);

    expect(events.length).toBe(0);
  });

  it("should preserve createSession return value", () => {
    const env = new TestEnv({
      onSessionEvent: () => {},
    });

    const session = env.createSession({ title: "Verify Return" });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.title).toBe("Verify Return");
  });

  it("should support updateSession with metadata", () => {
    const env = new TestEnv({
      onSessionEvent: (e) => { events.push(e); },
    });

    const session = env.createSession({ title: "With Meta" });
    events.length = 0;

    env.updateSession(session.id, { metadata: { key: "value" } });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("session.updated");
    expect((events[0] as Extract<SessionEvent, { type: "session.updated" }>).updates.metadata).toEqual({ key: "value" });
  });
});
