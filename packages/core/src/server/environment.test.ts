/**
 * @fileoverview ServerEnvironment integration tests
 * 
 * Tests that ServerEnvironment correctly publishes events to EventBus
 * when handling stream events from invoke_llm.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ServerEnvironment } from "./environment.js";
import * as Bus from "./eventbus/bus.js";
import * as BusEvent from "./eventbus/bus-event.js";
import {
  StreamStartEvent,
  StreamTextEvent,
  StreamCompletedEvent,
} from "./eventbus/events/stream.js";
import { z } from "zod";

// Mock LLM config for testing
const mockLLMConfig = {
  model: "gpt-4",
  baseURL: "https://api.openai.com/v1",
  apiKey: "test-key",
};

// Test event for verification
const TestEvent = BusEvent.define(
  "test.verification",
  z.object({ 
    sessionId: z.string(),
    message: z.string() 
  })
);

describe("ServerEnvironment", () => {
  let env: ServerEnvironment;

  beforeEach(() => {
    BusEvent.clearRegistry();
    env = new ServerEnvironment({
      model: "gpt-4",
      apiKey: "test-key",
      baseURL: "https://api.openai.com/v1",
    });
  });

  it("should create environment with onStreamEvent hook", () => {
    expect(env).toBeDefined();
    expect(typeof (env as any).onStreamEvent).toBe("function");
  });

  it("should handle stream events and publish to EventBus", async () => {
    const received: any[] = [];
    const sessionId = "test-session-123";

    // Subscribe to events for specific session
    const unsubscribe = Bus.subscribe(StreamStartEvent, (event) => {
      received.push({ type: "start", ...event.properties });
    }, sessionId);

    // Manually trigger stream event through env
    (env as any).emitStreamEvent(
      { type: "start", metadata: { model: "gpt-4" } },
      { session_id: sessionId }
    );

    // Wait for async publish
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("start");
    expect(received[0].sessionId).toBe(sessionId);
    expect(received[0].model).toBe("gpt-4");

    unsubscribe();
  });

  it("should handle multiple stream events", async () => {
    const events: string[] = [];
    const sessionId = "multi-event-test";

    const unsubStart = Bus.subscribe(StreamStartEvent, () => {
      events.push("start");
    }, sessionId);

    const unsubText = Bus.subscribe(StreamTextEvent, () => {
      events.push("text");
    }, sessionId);

    const unsubCompleted = Bus.subscribe(StreamCompletedEvent, () => {
      events.push("completed");
    }, sessionId);

    // Trigger multiple events
    (env as any).emitStreamEvent(
      { type: "start", metadata: { model: "gpt-4" } },
      { session_id: sessionId }
    );

    (env as any).emitStreamEvent(
      { type: "text", content: "Hello", delta: "Hello" },
      { session_id: sessionId }
    );

    (env as any).emitStreamEvent(
      { type: "completed" },
      { session_id: sessionId }
    );

    // Wait for async
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(events).toEqual(["start", "text", "completed"]);

    unsubStart();
    unsubText();
    unsubCompleted();
  });

  it("should implement abstract methods from BaseEnvironment", () => {
    // Test getDefaultTimeout
    const timeout = (env as any).getDefaultTimeout("bash");
    expect(timeout).toBe(30000);

    // Test getMaxRetries
    const maxRetries = (env as any).getMaxRetries("bash");
    expect(maxRetries).toBe(3);

    // Test isRetryableError
    const isRetryable = (env as any).isRetryableError("ETIMEDOUT error");
    expect(isRetryable).toBe(true);

    const isNotRetryable = (env as any).isRetryableError("Tool not found");
    expect(isNotRetryable).toBe(false);

    // Test getConcurrencyLimit
    const limit = (env as any).getConcurrencyLimit("bash");
    expect(limit).toBe(5);

    // Test getRecoveryStrategy
    const strategy = (env as any).getRecoveryStrategy("bash");
    expect(strategy.type).toBe("retry");
    expect(strategy.maxRetries).toBe(3);
  });

  it("should use sessionId from config", () => {
    const customEnv = new ServerEnvironment({
      sessionId: "custom-session",
      model: "gpt-4",
      apiKey: "test-key",
    });

    expect(customEnv).toBeDefined();
  });

  it("should handle stream events without session_id in context", async () => {
    const received: any[] = [];

    const unsubscribe = Bus.subscribe(StreamTextEvent, (event) => {
      received.push(event.properties);
    });

    // Emit without session_id in context (should use env default)
    (env as any).emitStreamEvent(
      { type: "text", content: "Test", delta: "Test" },
      {}  // Empty context
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(received.length).toBe(1);
    expect(received[0].sessionId).toBe("default");  // Default session

    unsubscribe();
  });
});

// Test the full flow: Environment -> EventBus -> GlobalBus
describe("ServerEnvironment EventBus Integration", () => {
  it("should publish to GlobalBus for SSE consumption", async () => {
    const globalEvents: any[] = [];
    const { subscribeGlobal } = await import("./eventbus/global.js");

    const unsubscribe = subscribeGlobal((data) => {
      globalEvents.push(data);
    });

    const env = new ServerEnvironment({
      sessionId: "sse-test",
      model: "gpt-4",
      apiKey: "test-key",
    });

    // Trigger stream event
    (env as any).emitStreamEvent(
      { type: "start", metadata: { model: "gpt-4" } },
      { session_id: "sse-test" }
    );

    // Wait for async
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(globalEvents.length).toBeGreaterThan(0);
    expect(globalEvents[0].sessionId).toBe("sse-test");
    expect(globalEvents[0].payload.type).toBe("stream.start");

    unsubscribe();
  });
});
