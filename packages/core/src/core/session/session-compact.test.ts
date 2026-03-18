/**
 * @fileoverview Unit tests for Session.compact with invokeLLM
 * 
 * 按照设计文档: 使用 invokeLLM 而不是 handle_query
 * - 一次 LLM 调用即可完成摘要
 * - 不触发 agent run，没有中间步骤
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { Session } from "./session.js";
import { Storage } from "./storage.js";

describe("Session.compact with invokeLLM", () => {
  const testSessionId = "test-session-compact";

  beforeEach(async () => {
    await Storage.initialize({ mode: "memory" });
  });

  afterEach(() => {
    Storage.clear();
  });

  it("should use invokeLLM instead of handle_query", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    // Add some messages to compact
    session.addUserMessage("Hello, I need help with coding");
    session.addAssistantMessage("Sure, I can help you with coding. What do you need?");
    session.addUserMessage("Can you help me write a function?");
    session.addAssistantMessage("Of course! Here's a function for you...");

    // Mock invokeLLM
    const mockInvokeLLM = mock(() => 
      Promise.resolve({
        success: true,
        output: "用户需要编码帮助，已提供函数示例。当前状态：完成。",
      })
    );

    const env = {
      invokeLLM: mockInvokeLLM,
    } as any;

    // Call compact
    const compactedSession = await session.compact(env, { keepMessages: 10 });

    // Verify invokeLLM was called (not handle_query)
    expect(mockInvokeLLM).toHaveBeenCalled();
    
    // Verify the compacted session was created
    expect(compactedSession).toBeDefined();
    expect(compactedSession.id).not.toBe(session.id);
    expect(compactedSession.parentID).toBe(session.id);
    
    // Verify summary message was added
    const messages = await compactedSession.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].info.role).toBe("system");
  });

  it("should pass correct parameters to invokeLLM", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.addUserMessage("Test message");

    let capturedParams: any = null;
    const mockInvokeLLM = mock((messages: any[], tools: any, context: any, options: any) => {
      capturedParams = { messages, tools, context, options };
      return Promise.resolve({
        success: true,
        output: "Summary",
      });
    });

    const env = {
      invokeLLM: mockInvokeLLM,
    } as any;

    await session.compact(env, { keepMessages: 5 });

    // Verify invokeLLM was called with correct parameters
    expect(capturedParams).not.toBeNull();
    expect(Array.isArray(capturedParams.messages)).toBe(true);
    expect(capturedParams.messages[0].role).toBe("user");
    expect(capturedParams.tools).toEqual([]); // No tools needed
    expect(capturedParams.context).toBeDefined();
    expect(capturedParams.options).toBeDefined();
    expect(capturedParams.options.maxTokens).toBe(2000);
  });

  it("should handle invokeLLM failure gracefully", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Test Session",
    });

    session.addUserMessage("Test message");

    const mockInvokeLLM = mock(() => 
      Promise.reject(new Error("LLM error"))
    );

    const env = {
      invokeLLM: mockInvokeLLM,
    } as any;

    // Should not throw, should use fallback summary
    const compactedSession = await session.compact(env);

    expect(compactedSession).toBeDefined();
    const messages = await compactedSession.getMessages();
    expect(messages[0].info.role).toBe("system");
  });

  it("should create child session with correct metadata", async () => {
    const session = new Session({
      id: testSessionId,
      title: "Original Session",
    });

    session.addUserMessage("Test");

    const mockInvokeLLM = mock(() => 
      Promise.resolve({ success: true, output: "Summary" })
    );

    const env = { invokeLLM: mockInvokeLLM } as any;

    const compactedSession = await session.compact(env);

    // Verify parent-child relationship
    expect(compactedSession.parentID).toBe(session.id);
    expect(compactedSession.title).toContain("Compacted:");
  });
});
