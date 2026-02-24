/**
 * @fileoverview EnvEventBus tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { EnvEventBus, type EnvEventRule, type EnvEventHandler, type EnvAgentHandler } from "./bus.js";
import type { EnvEvent } from "../../core/types/event.js";

describe("EnvEventBus", () => {
  let bus: EnvEventBus;

  beforeEach(() => {
    bus = new EnvEventBus();
    bus.clearSeen();
  });

  describe("publish", () => {
    it("should publish event and process it", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: { message: "hello" },
      };

      await bus.publish(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should ignore duplicate events (idempotency)", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: { message: "hello" },
      };

      await bus.publish(event);
      await bus.publish(event); // duplicate
      await bus.publish(event); // duplicate

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should warn when no rule matches", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      const event: EnvEvent = {
        id: "event-1",
        type: "unknown.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);

      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls[0];
      expect(logCall[0]).toContain("[EnvEventBus] No rule matched for event: unknown.event");
      
      consoleSpy.mockRestore();
    });
  });

  describe("rule matching", () => {
    it("should match exact event type", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "user_query",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "user_query",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);
      expect(handler).toHaveBeenCalled();
    });

    it("should match event type array", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: ["session.created", "session.updated", "session.deleted"],
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "session.updated",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);
      expect(handler).toHaveBeenCalled();
    });

    it("should match wildcard rule", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "*",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "any.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);
      expect(handler).toHaveBeenCalled();
    });

    it("should match prefix wildcard rule", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "session.*",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "session.created",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);
      expect(handler).toHaveBeenCalled();
    });

    it("should select highest priority rule when multiple match", async () => {
      const lowPriorityHandler = vi.fn();
      const highPriorityHandler = vi.fn();
      
      bus.registerRule({
        eventType: "*",
        handler: {
          type: "function",
          fn: lowPriorityHandler,
        } as EnvEventHandler,
        options: { priority: 10 },
      });

      bus.registerRule({
        eventType: "user_query",
        handler: {
          type: "function",
          fn: highPriorityHandler,
        } as EnvEventHandler,
        options: { priority: 100 },
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "user_query",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);

      // Both rules match, but higher priority should be selected (exact match takes precedence over wildcard)
      expect(highPriorityHandler).toHaveBeenCalled();
    });
  });

  describe("handler types", () => {
    it("should execute function handler", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should skip disabled rule", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
        options: { enabled: false },
      });

      const event: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("queue mechanism", () => {
    it("should process events sequentially", async () => {
      const order: number[] = [];
      const handler = vi.fn(() => {
        order.push(1);
        return new Promise(resolve => setTimeout(resolve, 10));
      });
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: handler,
        } as EnvEventHandler,
      });

      const event1: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      const event2: EnvEvent = {
        id: "event-2",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await bus.publish(event1);
      await bus.publish(event2);

      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe("registerRule", () => {
    it("should register rule and sort by priority", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      bus.registerRule({
        eventType: "low",
        handler: { type: "function", fn: handler1 } as EnvEventHandler,
        options: { priority: 10 },
      });

      bus.registerRule({
        eventType: "high",
        handler: { type: "function", fn: handler2 } as EnvEventHandler,
        options: { priority: 100 },
      });

      bus.registerRule({
        eventType: "medium",
        handler: { type: "function", fn: handler3 } as EnvEventHandler,
        options: { priority: 50 },
      });

      const rules = bus.getRules();
      
      expect(rules[0].eventType).toBe("high");
      expect(rules[1].eventType).toBe("medium");
      expect(rules[2].eventType).toBe("low");
    });
  });

  describe("getQueueLength", () => {
    it("should return current queue length", async () => {
      const handler = vi.fn();
      
      bus.registerRule({
        eventType: "test.event",
        handler: {
          type: "function",
          fn: async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            handler();
          },
        } as EnvEventHandler,
      });

      // Publish multiple events rapidly
      const promises = [
        bus.publish({ id: "1", type: "test.event", timestamp: 1, metadata: {}, payload: {} }),
        bus.publish({ id: "2", type: "test.event", timestamp: 2, metadata: {}, payload: {} }),
        bus.publish({ id: "3", type: "test.event", timestamp: 3, metadata: {}, payload: {} }),
      ];

      await Promise.all(promises);
      
      expect(bus.getQueueLength()).toBe(0);
    });
  });
});
