/**
 * @fileoverview TUI 数据流集成测试
 *
 * 测试从事件到渲染的完整数据流
 */

import { describe, it, expect } from "bun:test";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 模拟事件类型
// ============================================================================

interface StreamEvent {
  type: string;
  messageId?: string;
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
}

// ============================================================================
// 模拟 Store 状态管理
// ============================================================================

class MockStore {
  messages: Message[] = [];
  parts: Record<string, MessagePart[]> = {};
  isStreaming = false;
  streamingMessageId: string | null = null;

  addMessage(message: Message) {
    this.messages.push(message);
    this.parts[message.id] = [];
  }

  appendMessageContent(messageId: string, delta: string) {
    const message = this.messages.find(m => m.id === messageId);
    if (message) {
      message.content += delta;
    }
  }

  addPart(messageId: string, part: MessagePart) {
    if (!this.parts[messageId]) {
      this.parts[messageId] = [];
    }
    this.parts[messageId].push(part);
  }

  updatePart(messageId: string, partId: string, updates: Partial<MessagePart>) {
    const parts = this.parts[messageId] || [];
    const part = parts.find(p => p.id === partId);
    if (part) {
      Object.assign(part, updates);
    }
  }

  // 模拟 handleEvent 逻辑
  handleEvent(event: StreamEvent) {
    switch (event.type) {
      case "stream.start": {
        this.isStreaming = true;
        this.streamingMessageId = event.messageId || null;
        if (event.messageId) {
          this.addMessage({
            id: event.messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "stream.text": {
        if (event.messageId && event.delta) {
          this.appendMessageContent(event.messageId, event.delta);
        }
        break;
      }

      case "stream.reasoning": {
        if (event.messageId) {
          const parts = this.parts[event.messageId] || [];
          const reasoningPart = parts.find(p => p.type === "reasoning");
          
          if (reasoningPart) {
            this.updatePart(event.messageId, reasoningPart.id, {
              content: event.content || "",
            });
          } else {
            this.addPart(event.messageId, {
              id: `reasoning-${Date.now()}`,
              type: "reasoning",
              content: event.content || "",
              timestamp: Date.now(),
            });
          }
        }
        break;
      }

      case "stream.tool.call": {
        if (event.messageId) {
          this.addPart(event.messageId, {
            id: `tool-${Date.now()}`,
            type: "tool_call",
            toolName: event.toolName || "unknown",
            toolArgs: event.toolArgs,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "stream.tool.result": {
        if (event.messageId) {
          this.addPart(event.messageId, {
            id: `result-${Date.now()}`,
            type: "tool_result",
            toolName: event.toolName || "unknown",
            result: event.result,
            success: event.success,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "stream.completed": {
        this.isStreaming = false;
        this.streamingMessageId = null;
        break;
      }
    }
  }

  // 获取用于渲染的数据
  getRenderData(messageId: string) {
    const message = this.messages.find(m => m.id === messageId);
    const messageParts = this.parts[messageId] || [];
    
    return {
      message,
      reasoningParts: messageParts.filter(p => p.type === "reasoning"),
      textParts: messageParts.filter(p => p.type === "text"),
      toolCallParts: messageParts.filter(p => p.type === "tool_call"),
      toolResultParts: messageParts.filter(p => p.type === "tool_result"),
      displayContent: messageParts
        .filter(p => p.type === "text")
        .map(p => p.content || "")
        .join("") || message?.content || "",
    };
  }
}

// ============================================================================
// 测试场景
// ============================================================================

describe("TUI 数据流集成测试 - 简单文本流", () => {
  it("应该正确处理简单的文本流式响应", () => {
    const store = new MockStore();
    const messageId = "msg-simple-text";

    // 模拟事件序列
    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.text", messageId, delta: "Hello" },
      { type: "stream.text", messageId, delta: " " },
      { type: "stream.text", messageId, delta: "World" },
      { type: "stream.text", messageId, delta: "!" },
      { type: "stream.completed" },
    ];

    // 处理所有事件
    for (const event of events) {
      store.handleEvent(event);
    }

    // 验证最终状态
    const renderData = store.getRenderData(messageId);
    
    expect(store.messages.length).toBe(1);
    expect(renderData.message?.content).toBe("Hello World!");
    expect(store.isStreaming).toBe(false);
  });

  it("应该正确处理带 Markdown 的文本流", () => {
    const store = new MockStore();
    const messageId = "msg-markdown-text";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.text", messageId, delta: "# 标题\n\n" },
      { type: "stream.text", messageId, delta: "这是**粗体**文本。\n\n" },
      { type: "stream.text", messageId, delta: "```typescript\nconst x = 1;\n```" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);
    
    expect(renderData.message?.content).toContain("# 标题");
    expect(renderData.message?.content).toContain("**粗体**");
    expect(renderData.message?.content).toContain("```typescript");
  });
});

describe("TUI 数据流集成测试 - 思考过程", () => {
  it("应该正确处理思考过程", () => {
    const store = new MockStore();
    const messageId = "msg-with-reasoning";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.reasoning", messageId, content: "让我思考一下" },
      { type: "stream.reasoning", messageId, content: "让我思考一下这个问题" },
      { type: "stream.reasoning", messageId, content: "让我思考一下这个问题..." },
      { type: "stream.text", messageId, delta: "答案是 42" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);

    expect(renderData.reasoningParts.length).toBe(1);
    expect(renderData.reasoningParts[0].content).toBe("让我思考一下这个问题...");
    expect(renderData.message?.content).toBe("答案是 42");
  });

  it("应该正确处理只有思考过程没有文本的情况", () => {
    const store = new MockStore();
    const messageId = "msg-only-reasoning";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.reasoning", messageId, content: "正在深度思考中..." },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);

    expect(renderData.reasoningParts.length).toBe(1);
    expect(renderData.reasoningParts[0].content).toBe("正在深度思考中...");
    expect(renderData.displayContent).toBe(""); // 没有 text parts
  });
});

describe("TUI 数据流集成测试 - 工具调用", () => {
  it("应该正确处理工具调用流程", () => {
    const store = new MockStore();
    const messageId = "msg-tool-flow";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.text", messageId, delta: "我来查看一下" },
      { type: "stream.tool.call", messageId, toolName: "bash", toolArgs: { command: "ls -la" } },
      { type: "stream.tool.result", messageId, toolName: "bash", result: "file1.txt\nfile2.txt", success: true },
      { type: "stream.text", messageId, delta: "目录中有两个文件" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);

    expect(renderData.toolCallParts.length).toBe(1);
    expect(renderData.toolCallParts[0].toolName).toBe("bash");
    expect(renderData.toolResultParts.length).toBe(1);
    expect(renderData.toolResultParts[0].success).toBe(true);
    expect(renderData.message?.content).toContain("目录中有两个文件");
  });

  it("应该正确处理多个工具调用", () => {
    const store = new MockStore();
    const messageId = "msg-multi-tools";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.tool.call", messageId, toolName: "readFile", toolArgs: { path: "/etc/hosts" } },
      { type: "stream.tool.result", messageId, toolName: "readFile", result: "127.0.0.1 localhost", success: true },
      { type: "stream.tool.call", messageId, toolName: "readFile", toolArgs: { path: "/etc/passwd" } },
      { type: "stream.tool.result", messageId, toolName: "readFile", result: "root:x:0:0:root:/root:/bin/bash", success: true },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);

    expect(renderData.toolCallParts.length).toBe(2);
    expect(renderData.toolResultParts.length).toBe(2);
  });
});

describe("TUI 数据流集成测试 - 完整对话", () => {
  it("应该正确处理完整的问答对话", () => {
    const store = new MockStore();

    // 用户消息（直接添加，不通过事件）
    store.addMessage({
      id: "user-1",
      role: "user",
      content: "你好，请介绍一下自己",
      timestamp: Date.now(),
    });

    // 助手回复
    const assistantMessageId = "assistant-1";
    const events: StreamEvent[] = [
      { type: "stream.start", messageId: assistantMessageId },
      { type: "stream.reasoning", messageId: assistantMessageId, content: "用户想了解我是谁" },
      { type: "stream.text", messageId: assistantMessageId, delta: "你好！我是 AI 助手。" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    expect(store.messages.length).toBe(2);
    expect(store.messages[0].role).toBe("user");
    expect(store.messages[1].role).toBe("assistant");

    const assistantRenderData = store.getRenderData(assistantMessageId);
    expect(assistantRenderData.reasoningParts.length).toBe(1);
    expect(assistantRenderData.message?.content).toBe("你好！我是 AI 助手。");
  });

  it("应该正确处理多轮对话", () => {
    const store = new MockStore();

    // 第一轮
    store.addMessage({ id: "user-1", role: "user", content: "问题 1", timestamp: Date.now() });
    store.handleEvent({ type: "stream.start", messageId: "assistant-1" });
    store.handleEvent({ type: "stream.text", messageId: "assistant-1", delta: "回答 1" });
    store.handleEvent({ type: "stream.completed" });

    // 第二轮
    store.addMessage({ id: "user-2", role: "user", content: "问题 2", timestamp: Date.now() });
    store.handleEvent({ type: "stream.start", messageId: "assistant-2" });
    store.handleEvent({ type: "stream.text", messageId: "assistant-2", delta: "回答 2" });
    store.handleEvent({ type: "stream.completed" });

    expect(store.messages.length).toBe(4);
    expect(store.messages[0].content).toBe("问题 1");
    expect(store.messages[1].content).toBe("回答 1");
    expect(store.messages[2].content).toBe("问题 2");
    expect(store.messages[3].content).toBe("回答 2");
  });
});

describe("TUI 数据流集成测试 - 边界情况", () => {
  it("应该正确处理空 delta", () => {
    const store = new MockStore();
    const messageId = "msg-empty-delta";

    store.handleEvent({ type: "stream.start", messageId });
    store.handleEvent({ type: "stream.text", messageId, delta: "" });
    store.handleEvent({ type: "stream.text", messageId, delta: "实际内容" });
    store.handleEvent({ type: "stream.completed" });

    const renderData = store.getRenderData(messageId);
    expect(renderData.message?.content).toBe("实际内容");
  });

  it("应该正确处理没有 messageId 的事件", () => {
    const store = new MockStore();

    // 不应该抛出错误
    store.handleEvent({ type: "stream.text", delta: "内容" });
    store.handleEvent({ type: "stream.reasoning", content: "思考" });

    expect(store.messages.length).toBe(0);
  });

  it("应该正确处理重复的事件类型", () => {
    const store = new MockStore();
    const messageId = "msg-duplicate";

    store.handleEvent({ type: "stream.start", messageId });
    store.handleEvent({ type: "stream.start", messageId }); // 重复
    store.handleEvent({ type: "stream.completed" });
    store.handleEvent({ type: "stream.completed" }); // 重复

    expect(store.messages.length).toBe(2); // 两个 assistant 消息
    expect(store.isStreaming).toBe(false);
  });
});

describe("TUI 数据流集成测试 - Markdown 渲染数据", () => {
  it("应该生成适合 Markdown 渲染的数据结构", () => {
    const store = new MockStore();
    const messageId = "msg-markdown-render";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId },
      { type: "stream.reasoning", messageId, content: "用户要求 Markdown 示例" },
      { type: "stream.text", messageId, delta: "# 示例\n\n**粗体**和*斜体*\n\n`代码`\n\n```js\nconst x = 1;\n```" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      store.handleEvent(event);
    }

    const renderData = store.getRenderData(messageId);

    // 验证数据结构适合渲染
    expect(renderData.message).toBeDefined();
    expect(renderData.reasoningParts).toBeDefined();
    expect(Array.isArray(renderData.reasoningParts)).toBe(true);
    expect(typeof renderData.displayContent).toBe("string");

    // 验证 Markdown 内容完整
    expect(renderData.displayContent).toContain("# 示例");
    expect(renderData.displayContent).toContain("**粗体**");
    expect(renderData.displayContent).toContain("*斜体*");
    expect(renderData.displayContent).toContain("`代码`");
    expect(renderData.displayContent).toContain("```js");
  });
});
