/**
 * @fileoverview EventProcessor tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { processEventInSession, type EventProcessorEnv } from "./event-processor.js";
import type { EnvEvent } from "./types/event.js";

describe("processEventInSession", () => {
  let mockEnv: EventProcessorEnv;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      id: "session-1",
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      addMessageFromModelMessage: vi.fn(),
      toHistory: vi.fn().mockReturnValue([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]),
    };

    mockEnv = {
      getSession: vi.fn().mockReturnValue(mockSession),
      handle_query: vi.fn().mockImplementation(async (_query: string, ctx: any) => {
        if (ctx.onMessageAdded) {
          await ctx.onMessageAdded({ role: "assistant", content: [{ type: "text", text: "Test response" }] });
        }
        return "Processed event";
      }),
    };
  });

  describe("basic processing", () => {
    it("should process event and call handle_query", async () => {
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

      await processEventInSession(mockEnv, event);

      expect(mockEnv.getSession).toHaveBeenCalledWith("session-1");
      expect(mockSession.addMessageFromModelMessage).toHaveBeenCalled();
      expect(mockEnv.handle_query).toHaveBeenCalled();
    });

    it("should warn if no trigger_session_id", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      };

      await processEventInSession(mockEnv, event);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[EventProcessor] No trigger_session_id in event metadata and no active session available"
      );

      consoleSpy.mockRestore();
    });

    it("should warn if session not found", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mockEnv.getSession = vi.fn().mockReturnValue(undefined);

      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "nonexistent-session",
        },
        payload: {},
      };

      await processEventInSession(mockEnv, event);

      expect(consoleSpy).toHaveBeenCalledWith(
        "[EventProcessor] Session not found: nonexistent-session"
      );

      consoleSpy.mockRestore();
    });
  });

  describe("message construction", () => {
    it("should construct user message with event info", async () => {
      const event: EnvEvent = {
        id: "event-123",
        type: "test.event",
        timestamp: 1700000000000,
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: { data: "test" },
      };

      await processEventInSession(mockEnv, event);

      const userMessageCall = mockSession.addMessageFromModelMessage.mock.calls[0][0];
      expect(userMessageCall.content).toContain("Observed event: test.event");
      expect(userMessageCall.content).toContain("event-123");
    });

    it("should include tool call by default", async () => {
      const event: EnvEvent = {
        id: "event-1",
        type: "environment.switched",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: { fromEnv: "env1", toEnv: "env2" },
      };

      await processEventInSession(mockEnv, event);

      expect(mockSession.addMessageFromModelMessage).toHaveBeenCalled();
    });

    it("should skip tool call when includeToolCall is false", async () => {
      const event: EnvEvent = {
        id: "event-1",
        type: "environment.switched",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: { fromEnv: "env1", toEnv: "env2" },
      };

      await processEventInSession(mockEnv, event, { includeToolCall: false });

      expect(mockSession.addAssistantMessage).not.toHaveBeenCalled();
    });
  });

  describe("prompt customization", () => {
    it("should use custom prompt", async () => {
      const event: EnvEvent = {
        id: "event-1",
        type: "background_task.completed",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: { taskId: "task-1" },
      };

      const customPrompt = "Custom prompt for this event";
      await processEventInSession(mockEnv, event, { prompt: customPrompt });

      expect(mockEnv.handle_query).toHaveBeenCalledWith(
        customPrompt,
        expect.objectContaining({ 
          session_id: "session-1",
          onMessageAdded: expect.any(Function)
        }),
        expect.any(Array)
      );
    });

    it("should use default prompt if not provided", async () => {
      const event: EnvEvent = {
        id: "event-1",
        type: "custom.event",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: {},
      };

      await processEventInSession(mockEnv, event);

      expect(mockEnv.handle_query).toHaveBeenCalledWith(
        "Process event: custom.event",
        expect.objectContaining({ 
          session_id: "session-1",
          onMessageAdded: expect.any(Function)
        }),
        expect.any(Array)
      );
    });
  });

  describe("tool name customization", () => {
    it("should use custom tool name", async () => {
      const event: EnvEvent = {
        id: "event-1",
        type: "test.event",
        timestamp: Date.now(),
        metadata: {
          trigger_session_id: "session-1",
        },
        payload: {},
      };

      await processEventInSession(mockEnv, event, { toolName: "custom_tool" });

      expect(mockSession.addMessageFromModelMessage).toHaveBeenCalled();
    });
  });
});
