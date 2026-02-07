/**
 * @fileoverview EventBus tests
 */

import { z } from "zod";
import * as BusEvent from "./bus-event.js";
import * as Bus from "./bus.js";
import * as GlobalBus from "./global.js";
import { describe, it, expect, beforeEach } from "bun:test";

// Define test event
const TestEvent = BusEvent.define(
  "test.event",
  z.object({ message: z.string() })
);

beforeEach(() => {
  // Clear registry before each test
  BusEvent.clearRegistry();
});

describe("BusEvent", () => {
  it("should define an event with type and schema", () => {
    const event = BusEvent.define(
      "user.created",
      z.object({ id: z.string(), name: z.string() })
    );

    expect(event.type).toBe("user.created");
    expect(event.properties).toBeDefined();
  });

  it("should track events in registry", () => {
    BusEvent.define("test.registry", z.object({ data: z.string() }));
    
    const registry = BusEvent.getRegistry();
    expect(registry.has("test.registry")).toBe(true);
  });
});

describe("Bus", () => {
  it("should publish and subscribe to events", async () => {
    const received: string[] = [];
    
    const unsubscribe = Bus.subscribe(TestEvent, (event) => {
      received.push(event.properties.message);
    });

    await Bus.publish(TestEvent, { message: "hello" });
    
    expect(received).toEqual(["hello"]);
    
    unsubscribe();
  });

  it("should support multiple subscribers", async () => {
    const received1: string[] = [];
    const received2: string[] = [];
    
    const unsub1 = Bus.subscribe(TestEvent, (event) => {
      received1.push(event.properties.message);
    });
    
    const unsub2 = Bus.subscribe(TestEvent, (event) => {
      received2.push(event.properties.message);
    });

    await Bus.publish(TestEvent, { message: "test" });
    
    expect(received1).toEqual(["test"]);
    expect(received2).toEqual(["test"]);
    
    unsub1();
    unsub2();
  });

  it("should unsubscribe correctly", async () => {
    const received: string[] = [];
    
    const unsubscribe = Bus.subscribe(TestEvent, (event) => {
      received.push(event.properties.message);
    });

    await Bus.publish(TestEvent, { message: "first" });
    expect(received).toEqual(["first"]);
    
    unsubscribe();
    
    await Bus.publish(TestEvent, { message: "second" });
    expect(received).toEqual(["first"]); // Should not receive second
  });

  it("should support subscribeAll", async () => {
    const events: string[] = [];
    
    const EventA = BusEvent.define("test.a", z.object({ data: z.string() }));
    const EventB = BusEvent.define("test.b", z.object({ data: z.string() }));
    
    const unsubscribe = Bus.subscribeAll((event) => {
      events.push(event.type);
    });

    await Bus.publish(EventA, { data: "a" });
    await Bus.publish(EventB, { data: "b" });
    
    expect(events).toEqual(["test.a", "test.b"]);
    
    unsubscribe();
  });

  it("should support once subscription", async () => {
    const received: string[] = [];
    
    Bus.once(TestEvent, (event) => {
      received.push(event.properties.message);
      return "done";
    });

    await Bus.publish(TestEvent, { message: "first" });
    await Bus.publish(TestEvent, { message: "second" });
    
    expect(received).toEqual(["first"]); // Only received once
  });

  it("should support session-scoped subscriptions", async () => {
    const receivedGlobal: string[] = [];
    const receivedSessionA: string[] = [];
    const receivedSessionB: string[] = [];
    
    const unsubscribeGlobal = Bus.subscribe(TestEvent, (event) => {
      receivedGlobal.push(event.properties.message);
    });
    
    const unsubscribeA = Bus.subscribe(TestEvent, (event) => {
      receivedSessionA.push(event.properties.message);
    }, "session-a");
    
    const unsubscribeB = Bus.subscribe(TestEvent, (event) => {
      receivedSessionB.push(event.properties.message);
    }, "session-b");

    // Publish without session
    await Bus.publish(TestEvent, { message: "global" });
    
    // Publish with session-a
    await Bus.publish(TestEvent, { message: "a" }, "session-a");
    
    // Publish with session-b
    await Bus.publish(TestEvent, { message: "b" }, "session-b");
    
    expect(receivedGlobal).toEqual(["global"]);
    expect(receivedSessionA).toEqual(["a"]);
    expect(receivedSessionB).toEqual(["b"]);
    
    unsubscribeGlobal();
    unsubscribeA();
    unsubscribeB();
  });
});

describe("GlobalBus", () => {
  it("should broadcast to global subscribers", async () => {
    const received: any[] = [];
    
    const unsubscribe = GlobalBus.subscribeGlobal((data) => {
      received.push(data);
    });

    await Bus.publish(TestEvent, { message: "test" }, "session-1");
    
    // Give some time for async
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].payload.type).toBe("test.event");
    expect(received[0].sessionId).toBe("session-1");
    
    unsubscribe();
  });

  it("should support subscribeToSession", async () => {
    const received: any[] = [];
    
    const unsubscribe = Bus.subscribeToSession("session-x", (event) => {
      received.push(event);
    });

    // Publish to session-x
    await Bus.publish(TestEvent, { message: "x" }, "session-x");
    
    // Publish to session-y (should not be received)
    await Bus.publish(TestEvent, { message: "y" }, "session-y");
    
    // Give some time for async
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(received.length).toBe(1);
    expect(received[0].type).toBe("test.event");
    
    unsubscribe();
  });
});
