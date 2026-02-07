/**
 * @fileoverview EventBus usage examples
 * 
 * This file demonstrates how to use EventBus in different scenarios.
 */

import * as Bus from "./bus.js";
import * as BusEvent from "./bus-event.js";
import {
  StreamTextEvent,
  StreamToolCallEvent,
  StreamCompletedEvent,
} from "./events/stream.js";
import { subscribeToSession } from "./bus.js";

// ============================================================================
// Example 1: Basic publish/subscribe
// ============================================================================

async function example1_basic() {
  console.log("\n=== Example 1: Basic Publish/Subscribe ===\n");

  // Define a custom event
  const UserActionEvent = BusEvent.define(
    "user.action",
    z.object({ userId: z.string(), action: z.string() })
  );

  // Subscribe to the event
  const unsubscribe = Bus.subscribe(UserActionEvent, (event) => {
    console.log(`User ${event.properties.userId} performed: ${event.properties.action}`);
  });

  // Publish events
  await Bus.publish(UserActionEvent, { userId: "user-1", action: "login" });
  await Bus.publish(UserActionEvent, { userId: "user-2", action: "logout" });

  // Unsubscribe when done
  unsubscribe();
}

// ============================================================================
// Example 2: Session-scoped events (for SSE)
// ============================================================================

async function example2_sessionScoped() {
  console.log("\n=== Example 2: Session-Scoped Events ===\n");

  const sessionId = "session-abc-123";

  // Subscribe to events for a specific session
  const unsubscribe = subscribeToSession(sessionId, (event) => {
    console.log(`[Session ${sessionId}] Received: ${event.type}`);
  });

  // Publish events to this session
  await Bus.publish(StreamTextEvent, {
    sessionId,
    messageId: "msg-1",
    content: "Hello",
    delta: "Hello",
  });

  await Bus.publish(StreamToolCallEvent, {
    sessionId,
    messageId: "msg-1",
    toolName: "bash",
    toolArgs: { command: "ls" },
    toolCallId: "call-1",
  });

  unsubscribe();
}

// ============================================================================
// Example 3: Stream events (LLM streaming)
// ============================================================================

async function example3_streamEvents() {
  console.log("\n=== Example 3: Stream Events (LLM) ===\n");

  const sessionId = "stream-session";

  // Set up subscribers for different stream events
  const unsubText = Bus.subscribe(StreamTextEvent, (event) => {
    process.stdout.write(event.properties.delta);
  }, sessionId);

  const unsubTool = Bus.subscribe(StreamToolCallEvent, (event) => {
    console.log(`\n[Tool Call: ${event.properties.toolName}]`);
  }, sessionId);

  const unsubCompleted = Bus.subscribe(StreamCompletedEvent, (event) => {
    console.log("\n[Stream Completed]");
  }, sessionId);

  // Simulate streaming
  console.log("Streaming response:");
  await Bus.publish(StreamTextEvent, {
    sessionId,
    messageId: "msg-1",
    content: "Hello",
    delta: "Hello",
  }, sessionId);

  await Bus.publish(StreamTextEvent, {
    sessionId,
    messageId: "msg-1",
    content: "Hello, world",
    delta: ", world",
  }, sessionId);

  await Bus.publish(StreamToolCallEvent, {
    sessionId,
    messageId: "msg-1",
    toolName: "read",
    toolArgs: { path: "/tmp/test.txt" },
    toolCallId: "call-1",
  }, sessionId);

  await Bus.publish(StreamCompletedEvent, {
    sessionId,
    messageId: "msg-1",
    usage: {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    },
  }, sessionId);

  unsubText();
  unsubTool();
  unsubCompleted();
}

// ============================================================================
// Example 4: Wildcard subscription (subscribe to all events)
// ============================================================================

async function example4_wildcard() {
  console.log("\n=== Example 4: Wildcard Subscription ===\n");

  const allEvents: string[] = [];

  const unsubscribe = Bus.subscribeAll((event) => {
    allEvents.push(event.type);
  });

  await Bus.publish(StreamTextEvent, {
    sessionId: "test",
    messageId: "msg",
    content: "test",
    delta: "test",
  });

  await Bus.publish(StreamToolCallEvent, {
    sessionId: "test",
    messageId: "msg",
    toolName: "bash",
    toolArgs: {},
    toolCallId: "call",
  });

  console.log("All events received:", allEvents);

  unsubscribe();
}

// ============================================================================
// Example 5: One-time subscription
// ============================================================================

async function example5_once() {
  console.log("\n=== Example 5: One-Time Subscription ===\n");

  const received: string[] = [];

  Bus.once(StreamTextEvent, (event) => {
    received.push(event.properties.content);
    return "done"; // Auto-unsubscribe after first event
  });

  await Bus.publish(StreamTextEvent, {
    sessionId: "once-test",
    messageId: "msg",
    content: "first",
    delta: "first",
  });

  await Bus.publish(StreamTextEvent, {
    sessionId: "once-test",
    messageId: "msg",
    content: "second",
    delta: "second",
  });

  console.log("Received (should only be 'first'):", received);
}

// ============================================================================
// Example 6: Error handling
// ============================================================================

async function example6_errorHandling() {
  console.log("\n=== Example 6: Error Handling ===\n");

  const ErrorEvent = BusEvent.define(
    "error.occurred",
    z.object({ message: z.string(), code: z.string() })
  );

  // Subscribe to errors
  const unsubscribe = Bus.subscribe(ErrorEvent, (event) => {
    console.error(`Error [${event.properties.code}]: ${event.properties.message}`);
  });

  // Publish error
  await Bus.publish(ErrorEvent, {
    message: "Something went wrong",
    code: "ERR_001",
  });

  unsubscribe();
}

// ============================================================================
// Run all examples
// ============================================================================

import { z } from "zod";

async function main() {
  console.log("EventBus Usage Examples");
  console.log("=======================\n");

  try {
    await example1_basic();
    await example2_sessionScoped();
    await example3_streamEvents();
    await example4_wildcard();
    await example5_once();
    await example6_errorHandling();

    console.log("\n=== All examples completed ===\n");
  } catch (error) {
    console.error("Example failed:", error);
    process.exit(1);
  }
}

// Only run if executed directly
if (import.meta.main) {
  main();
}
