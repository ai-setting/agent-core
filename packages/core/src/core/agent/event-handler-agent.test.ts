/**
 * @fileoverview EventHandlerAgent tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { EventHandlerAgent } from "../../core/agent/event-handler-agent.js";
import type { EnvEvent } from "../../core/types/event.js";
import { Session } from "../session/session.js";
import type { ModelMessage } from "ai";

describe("EventHandlerAgent", () => {
  let mockEnv: any;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      id: "session-1",
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      addAssistantMessageWithTool: vi.fn(),
      addToolMessage: vi.fn(),
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
        "[EventHandlerAgent] No trigger_session_id in event metadata and no active session available"
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

  describe("toHistory ModelMessage format", () => {
    it("should produce 3 ModelMessage format for feishu im.message.received event", async () => {
      const session = Session.create({
        title: "Test",
        directory: "/test",
      });

      const mockEnv = {
        getSession: vi.fn().mockResolvedValue(session),
        handle_query: vi.fn().mockResolvedValue("Processed"),
      };

      const agent = new EventHandlerAgent(mockEnv, "You are a helpful assistant");

      // 使用实际的飞书 im.message.received 事件格式
      const event: EnvEvent = {
        id: "e1f286a130d1c1d9954342276a1f14a5",
        type: "im.message.receive_v1",
        timestamp: 1772182445219,
        metadata: {
          trigger_session_id: session.id,
          source: "feishu",
          source_name: "feishu",
        },
        payload: {
          message: {
            message_id: "om_x100b5521f40760acc32c890e920d8ee",
            message_type: "text",
            content: "{\"text\":\"今天北京的限行尾号？\"}",
            chat_id: "oc_a8b45bfdb8c9ae3ab24a81466033c8f1",
            chat_type: "p2p",
          },
        },
      };

      await agent.handle(event);

      const history = session.toHistory() as ModelMessage[];

      // 验证有 3 条消息：user + assistant (with tool call) + tool
      expect(history.length).toBe(3);

      // 第1条：user message
      const userMsg = history[0];
      expect(userMsg.role).toBe("user");
      expect(userMsg.content).toBeDefined();
      let userContent = "";
      if (typeof userMsg.content === "string") {
        userContent = userMsg.content;
      } else if (Array.isArray(userMsg.content)) {
        const textPart = (userMsg.content as any[]).find((p: any) => p.type === "text");
        userContent = textPart?.text || "";
      } else if (typeof userMsg.content === "object") {
        userContent = (userMsg.content as any).text || "";
      }
      expect(userContent).toContain("im.message.receive_v1");
      expect(userContent).toContain("e1f286a130d1c1d9954342276a1f14a5");

      // 第2条：assistant message with tool call
      const assistantMsg = history[1];
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.content).toBeDefined();
      
      // content 可以是数组（多个parts）或单个对象（1个part）
      let toolCallPart: any;
      if (Array.isArray(assistantMsg.content)) {
        const assistantContent = assistantMsg.content as any[];
        toolCallPart = assistantContent.find((p: any) => p.type === "tool-call");
      } else if (typeof assistantMsg.content === "object") {
        const contentObj = assistantMsg.content as any;
        toolCallPart = contentObj.type === "tool-call" ? contentObj : null;
      } else {
        toolCallPart = null;
      }
      expect(toolCallPart).toBeDefined();
      expect(toolCallPart.toolCallId).toBe("call_e1f286a130d1c1d9954342276a1f14a5");
      expect(toolCallPart.toolName).toBe("get_event_info");
      expect(toolCallPart.input).toEqual({ event_ids: ["e1f286a130d1c1d9954342276a1f14a5"] });

      // 第3条：tool result message
      const toolMsg = history[2];
      expect(toolMsg.role).toBe("tool");
      expect((toolMsg as any).toolCallId).toBe("call_e1f286a130d1c1d9954342276a1f14a5");
      
      // 验证 tool result 包含事件 payload
      const toolContent = (toolMsg as any).content;
      if (Array.isArray(toolContent)) {
        const textPart = toolContent.find((p: any) => p.type === "text" || p.type === "tool-result");
        expect(textPart).toBeDefined();
      }
    });
  });
});
