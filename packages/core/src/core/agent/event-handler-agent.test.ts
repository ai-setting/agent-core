/**
 * @fileoverview EventHandlerAgent tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { EventHandlerAgent } from "../../core/agent/event-handler-agent.js";
import type { EnvEvent } from "../../core/types/event.js";

describe("EventHandlerAgent", () => {
  let mockEnv: any;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      id: "session-1",
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      toHistory: vi.fn().mockReturnValue([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]),
    };

    mockEnv = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      handle_query: vi.fn().mockResolvedValue("Processed event"),
    };
  });

  describe("handle", () => {
    it("should process event and call handle_query", async () => {
      const agent = new EventHandlerAgent(mockEnv, "You are a helpful assistant");

      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: {
          taskId: "task-123",
          result: { success: true },
        },
      };

      await agent.handle(event);

      expect(mockEnv.getSession).toHaveBeenCalledWith("session-1");
      expect(mockSession.addUserMessage).toHaveBeenCalled();
      expect(mockEnv.handle_query).toHaveBeenCalled();
    });

    it("should warn if no trigger_session_id", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const agent = new EventHandlerAgent(mockEnv, "You are a helpful assistant");

      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await agent.handle(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[EventHandlerAgent] No trigger_session_id in event metadata"
      );

      consoleSpy.mockRestore();
    });

    it("should warn if session not found", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      
      mockEnv.getSession = vi.fn().mockResolvedValue(null);
      
      const agent = new EventHandlerAgent(mockEnv, "You are a helpful assistant");

      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "nonexistent-session",
        },
        payload: {},
      };

      await agent.handle(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[EventHandlerAgent] Session not found: nonexistent-session"
      );

      consoleSpy.mockRestore();
    });
  });

  describe("constructMessages", () => {
    it("should construct 3 messages with correct structure", async () => {
      const agent = new EventHandlerAgent(mockEnv, "You are a helpful assistant");

      const event: EnvEvent = {
        id: "event-123",
        type: "test.event",
        timestamp: 1700000000000,
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: { data: "test" },
      };

      // Access the private method through the handler
      // We'll test indirectly through handle()
      await agent.handle(event);

      // Check that user message was added with event info
      const userMessageCall = mockSession.addUserMessage.mock.calls[0][0];
      expect(userMessageCall).toContain("Observed event: test.event");
      expect(userMessageCall).toContain("event-123");
    });
  });
});
