/**
 * @fileoverview Unit tests for stream event hook mechanism.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { BaseEnvironment } from "../../src/environment/base/base-environment.js";
import type { StreamEvent, Context, Action, Tool } from "../../src/types/index.js";

class TestEnv extends BaseEnvironment {
  receivedEvents: Array<StreamEvent & { timestamp: number }> = [];

  onStreamEvent(event: StreamEvent, context: Context): void | Promise<void> {
    this.receivedEvents.push({
      ...event,
      timestamp: Date.now(),
    });
  }

  clearEvents(): void {
    this.receivedEvents.length = 0;
  }

  protected getDefaultTimeout(toolName: string): number {
    return 5000;
  }

  protected getTimeoutOverride(action: Action): number | undefined {
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    return 3;
  }

  protected getRetryDelay(toolName: string): number {
    return 1000;
  }

  protected isRetryableError(error: string): boolean {
    return !error.includes("non-retryable");
  }

  protected getConcurrencyLimit(toolName: string): number {
    return 5;
  }

  protected getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "retry", maxRetries: 3 };
  }
}

describe("Stream Event Hook", () => {
  let env: TestEnv;
  let mockContext: Context;

  beforeEach(() => {
    env = new TestEnv();
    mockContext = { session_id: "test-session", workdir: "/test" };
  });

  test("emits text event through hook", () => {
    env.emitStreamEvent({ type: "text", content: "Hello!" }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("text");
    expect(env.receivedEvents[0].content).toBe("Hello!");
  });

  test("emits reasoning event through hook", () => {
    env.emitStreamEvent({ type: "reasoning", content: "Let me think..." }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("reasoning");
    expect(env.receivedEvents[0].content).toBe("Let me think...");
  });

  test("emits tool_call event through hook", () => {
    env.emitStreamEvent({
      type: "tool_call",
      tool_name: "get_weather",
      tool_args: { city: "Beijing" },
    }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("tool_call");
    expect(env.receivedEvents[0].tool_name).toBe("get_weather");
    expect(env.receivedEvents[0].tool_args).toEqual({ city: "Beijing" });
  });

  test("emits tool_result event through hook", () => {
    env.emitStreamEvent({
      type: "tool_result",
      tool_name: "get_weather",
      tool_result: "Sunny, 25°C",
    }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("tool_result");
    expect(env.receivedEvents[0].tool_result).toBe("Sunny, 25°C");
  });

  test("emits completed event through hook", () => {
    env.emitStreamEvent({ type: "completed" }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("completed");
  });

  test("emits error event through hook", () => {
    env.emitStreamEvent({ type: "error", content: "Something went wrong" }, mockContext);

    expect(env.receivedEvents.length).toBe(1);
    expect(env.receivedEvents[0].type).toBe("error");
    expect(env.receivedEvents[0].content).toBe("Something went wrong");
  });

  test("emits multiple events in sequence", () => {
    const events: StreamEvent[] = [
      { type: "start" },
      { type: "text", content: "Hello" },
      { type: "reasoning", content: "Thinking..." },
      { type: "tool_call", tool_name: "test_tool", tool_args: {} },
      { type: "completed" },
    ];

    for (const event of events) {
      env.emitStreamEvent(event, mockContext);
    }

    expect(env.receivedEvents.length).toBe(5);
    expect(env.receivedEvents.map((e) => e.type)).toEqual([
      "start",
      "text",
      "reasoning",
      "tool_call",
      "completed",
    ]);
  });

  test("events include timestamp", () => {
    const before = Date.now();
    env.emitStreamEvent({ type: "text", content: "Test" }, mockContext);
    const after = Date.now();

    expect(env.receivedEvents[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(env.receivedEvents[0].timestamp).toBeLessThanOrEqual(after);
  });

  test("clearEvents removes all events", () => {
    env.emitStreamEvent({ type: "text", content: "Test 1" }, mockContext);
    env.emitStreamEvent({ type: "text", content: "Test 2" }, mockContext);

    expect(env.receivedEvents.length).toBe(2);

    env.clearEvents();

    expect(env.receivedEvents.length).toBe(0);
  });
});

describe("Environment without onStreamEvent", () => {
  test("does not throw when hook is not implemented", () => {
    class NoHookEnv extends BaseEnvironment {
      protected getTool(name: string): Tool | undefined {
        return this.tools.get(name);
      }

      protected getDefaultModel(): string {
        return "test-model";
      }

      protected getDefaultTimeout(): number {
        return 5000;
      }

      protected getRetryDelay(toolName: string): number {
        return 1000;
      }

      protected isRetryableError(error: string): boolean {
        return true;
      }

      protected getConcurrencyLimit(toolName: string): number {
        return 5;
      }

      protected getRecoveryStrategy(toolName: string): {
        type: "retry" | "fallback" | "skip" | "error";
        maxRetries?: number;
        fallbackTool?: string;
      } {
        return { type: "retry" };
      }
    }

    const env = new NoHookEnv({
      workdir: "/test",
      apiKey: "test-key",
      defaultModel: "test-model",
    });

    const mockContext: Context = { session_id: "test", workdir: "/test" };

    // Should not throw
    expect(() => {
      env.emitStreamEvent({ type: "text", content: "Test" }, mockContext);
    }).not.toThrow();
  });
});
