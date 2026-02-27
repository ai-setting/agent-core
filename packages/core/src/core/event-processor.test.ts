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
      addAssistantMessageWithTool: vi.fn(),
      toHistory: vi.fn().mockReturnValue([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ]),
    };

    mockEnv = {
      getSession: vi.fn().mockReturnValue(mockSession),
      handle_query: vi.fn().mockResolvedValue("Processed event"),
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
      expect(mockSession.addUserMessage).toHaveBeenCalled();
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
        "[EventProcessor] No trigger_session_id in event metadata"
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

      const userMessageCall = mockSession.addUserMessage.mock.calls[0][0];
      expect(userMessageCall).toContain("Observed event: test.event");
      expect(userMessageCall).toContain("event-123");
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

      expect(mockSession.addAssistantMessage).toHaveBeenCalled();
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
        { session_id: "session-1" },
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
        { session_id: "session-1" },
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

      const assistantMessage = mockSession.addAssistantMessage.mock.calls[0]?.[0];
      if (assistantMessage && typeof assistantMessage === "string") {
        expect(assistantMessage).toContain("custom_tool");
      } else {
        const calls = mockSession.addAssistantMessage.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
      }
    });
  });
});
