/**
 * @fileoverview Markdown 渲染完整流程测试
 *
 * 完整的端到端测试，验证流式事件 -> 状态更新 -> Markdown 渲染 的完整流程
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { StreamEvent } from "../contexts/event-stream.js";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 真实场景模拟
// ============================================================================

interface CompleteMockStore {
  messages: Message[];
  parts: Record<string, MessagePart[]>;
  isStreaming: boolean;
  lastModelName: string | null;
  lastResponseTimeMs: number | null;
  error: string | null;
}

function createCompleteMockStore(): CompleteMockStore {
  return {
    messages: [],
    parts: {},
    isStreaming: false,
    lastModelName: null,
    lastResponseTimeMs: null,
    error: null,
  };
}

// 完整的事件处理器（包含 batch 模拟）
class EventStreamSimulator {
  private store: CompleteMockStore;
  private eventQueue: StreamEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlush = 0;

  constructor(store: CompleteMockStore) {
    this.store = store;
  }

  queueEvent(event: StreamEvent): void {
    this.eventQueue.push(event);
    const elapsed = Date.now() - this.lastFlush;

    if (this.flushTimer) return;

    if (elapsed < 16) {
      this.flushTimer = setTimeout(() => this.flushEvents(), 16 - elapsed);
    } else {
      this.flushEvents();
    }
  }

  private flushEvents(): void {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];
    this.flushTimer = null;
    this.lastFlush = Date.now();

    // 模拟 batch 更新
    for (const event of events) {
      this.handleEvent(event);
    }
  }

  private handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "stream.start": {
        const streamEvent = event as StreamEvent & { model?: string };
        this.store.isStreaming = true;
        if (streamEvent.model) this.store.lastModelName = streamEvent.model;

        if (event.messageId) {
          const assistantMessage: Message = {
            id: event.messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          };
          this.store.messages.push(assistantMessage);
          this.store.parts[event.messageId] = [];
        }
        break;
      }

      case "stream.text": {
        if (event.messageId && event.delta) {
          const message = this.store.messages.find(m => m.id === event.messageId);
          if (message) {
            message.content += event.delta;
          }
        }
        break;
      }

      case "stream.reasoning": {
        if (event.messageId) {
          const parts = this.store.parts[event.messageId] || [];
          const reasoningPart = parts.find(p => p.type === "reasoning");

          if (reasoningPart) {
            reasoningPart.content = event.content || "";
          } else {
            parts.push({
              id: `reasoning-${Date.now()}`,
              type: "reasoning",
              content: event.content || "",
              timestamp: Date.now(),
            });
          }
          this.store.parts[event.messageId] = parts;
        }
        break;
      }

      case "stream.completed": {
        this.store.isStreaming = false;
        this.store.lastResponseTimeMs = 1234;
        break;
      }

      case "stream.error": {
        this.store.error = event.error || "Unknown error";
        this.store.isStreaming = false;
        break;
      }
    }
  }

  // 同步处理所有队列中的事件
  flushSync(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushEvents();
  }
}

// ============================================================================
// MessageList 渲染逻辑模拟
// ============================================================================

class MessageListRenderer {
  private store: CompleteMockStore;
  private syntaxStyle: { getStyle: (name: string) => { foreground: string } } | null = null;

  constructor(store: CompleteMockStore) {
    this.store = store;
  }

  setSyntaxStyle(style: { getStyle: (name: string) => { foreground: string } } | null): void {
    this.syntaxStyle = style;
  }

  // 模拟 AssistantMessage 组件的渲染逻辑
  renderAssistantMessage(messageId: string): {
    displayContent: string;
    reasoningContent: string[];
    shouldUseMarkdown: boolean;
    isStreaming: boolean;
  } {
    const message = this.store.messages.find(m => m.id === messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const parts = this.store.parts[messageId] || [];
    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    // 计算 displayContent（模拟 createMemo）
    const texts = textParts.map(p => p.content || "").join("");
    const displayContent = texts || message.content || "";

    // 检查是否应该使用 markdown（模拟 validSyntaxStyle）
    const shouldUseMarkdown = this.syntaxStyle !== null && 
      typeof this.syntaxStyle.getStyle === "function";

    // 检查是否是最后一条消息且正在流式传输
    const isLastMessage = this.store.messages.length > 0 &&
      messageId === this.store.messages[this.store.messages.length - 1]?.id;
    const isStreaming = this.store.isStreaming && isLastMessage;

    return {
      displayContent,
      reasoningContent: reasoningParts.map(p => p.content || ""),
      shouldUseMarkdown,
      isStreaming,
    };
  }

  // 模拟完整的渲染输出
  render(messageId: string): {
    markdownContent: string;
    thinkingContent: string[];
    useMarkdown: boolean;
    streaming: boolean;
  } {
    const rendered = this.renderAssistantMessage(messageId);

    return {
      markdownContent: rendered.displayContent,  // 通过 markdown 渲染
      thinkingContent: rendered.reasoningContent,  // 通过普通 text 渲染（thinking 颜色）
      useMarkdown: rendered.shouldUseMarkdown,
      streaming: rendered.isStreaming,
    };
  }
}

// ============================================================================
// 测试套件：完整渲染流程
// ============================================================================

describe("Markdown 渲染完整流程", () => {
  let store: CompleteMockStore;
  let simulator: EventStreamSimulator;
  let renderer: MessageListRenderer;

  beforeEach(() => {
    store = createCompleteMockStore();
    simulator = new EventStreamSimulator(store);
    renderer = new MessageListRenderer(store);
  });

  it("完整流程：流式事件 -> Markdown 渲染（带 SyntaxStyle）", () => {
    const messageId = "msg-full-flow";
    const markdownContent = `# Hello World

This is **bold** and \`code\`.`;

    // 1. 发送流式事件
    simulator.queueEvent({
      type: "stream.start",
      messageId,
      sessionId: "test-session",
      model: "gpt-4",
    });

    simulator.queueEvent({
      type: "stream.text",
      messageId,
      delta: markdownContent,
    });

    simulator.queueEvent({
      type: "stream.completed",
      messageId,
    });

    simulator.flushSync();

    // 2. 设置有效的 SyntaxStyle
    renderer.setSyntaxStyle({
      getStyle: (name: string) => ({ foreground: "#ffffff" }),
    });

    // 3. 渲染消息
    const result = renderer.render(messageId);

    // 4. 验证结果
    expect(result.markdownContent).toBe(markdownContent);
    expect(result.useMarkdown).toBe(true);
    expect(result.thinkingContent).toEqual([]);
    expect(result.streaming).toBe(false);
  });

  it("完整流程：流式事件 -> 纯文本渲染（无 SyntaxStyle）", () => {
    const messageId = "msg-no-style";
    const content = "Plain text without markdown.";

    // 发送流式事件
    simulator.queueEvent({ type: "stream.start", messageId });
    simulator.queueEvent({ type: "stream.text", messageId, delta: content });
    simulator.queueEvent({ type: "stream.completed", messageId });
    simulator.flushSync();

    // 不设置 SyntaxStyle
    renderer.setSyntaxStyle(null);

    const result = renderer.render(messageId);

    // 应该回退到纯文本渲染
    expect(result.markdownContent).toBe(content);
    expect(result.useMarkdown).toBe(false);
  });

  it("完整流程：Thinking + Markdown 混合内容", () => {
    const messageId = "msg-thinking-markdown";

    // 发送流式事件序列
    simulator.queueEvent({ type: "stream.start", messageId });
    simulator.queueEvent({ type: "stream.reasoning", messageId, content: "让我思考..." });
    simulator.queueEvent({ type: "stream.reasoning", messageId, content: "让我思考一下这个问题" });
    simulator.queueEvent({ type: "stream.text", messageId, delta: "## 答案\n\n这是**最终结果**。" });
    simulator.queueEvent({ type: "stream.completed", messageId });
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });

    const result = renderer.render(messageId);

    // Markdown 渲染 text 内容
    expect(result.markdownContent).toBe("## 答案\n\n这是**最终结果**。");
    expect(result.markdownContent).toContain("##");
    expect(result.markdownContent).toContain("**最终结果**");

    // Thinking 内容单独存在，不通过 markdown 渲染
    expect(result.thinkingContent).toEqual(["让我思考一下这个问题"]);

    // 使用 Markdown
    expect(result.useMarkdown).toBe(true);
  });

  it("完整流程：复杂 Markdown 文档", () => {
    const messageId = "msg-complex-doc";

    const events: StreamEvent[] = [
      { type: "stream.start", messageId, model: "claude-3" },
      { type: "stream.text", messageId, delta: "# API 文档\n\n" },
      { type: "stream.text", messageId, delta: "## 安装\n\n" },
      { type: "stream.text", messageId, delta: "```bash\nnpm install my-lib\n```\n\n" },
      { type: "stream.text", messageId, delta: "## 用法\n\n" },
      { type: "stream.text", messageId, delta: "```typescript\n" },
      { type: "stream.text", messageId, delta: "import { MyClass } from 'my-lib';\n\n" },
      { type: "stream.text", messageId, delta: "const instance = new MyClass();\n" },
      { type: "stream.text", messageId, delta: "instance.run();\n" },
      { type: "stream.text", messageId, delta: "```\n\n" },
      { type: "stream.text", messageId, delta: "> 提示：详细文档请参考官网\n\n" },
      { type: "stream.text", messageId, delta: "## 配置\n\n" },
      { type: "stream.text", messageId, delta: "| 选项 | 类型 | 默认值 |\n" },
      { type: "stream.text", messageId, delta: "|------|------|--------|\n" },
      { type: "stream.text", messageId, delta: "| port | number | 3000 |\n" },
      { type: "stream.completed", messageId },
    ];

    for (const event of events) {
      simulator.queueEvent(event);
    }
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });

    const result = renderer.render(messageId);

    // 验证 Markdown 元素
    expect(result.markdownContent).toContain("# API 文档");
    expect(result.markdownContent).toContain("## 安装");
    expect(result.markdownContent).toContain("```bash");
    expect(result.markdownContent).toContain("```typescript");
    expect(result.markdownContent).toContain("> 提示：");
    expect(result.markdownContent).toContain("| 选项 | 类型 | 默认值 |");

    expect(result.useMarkdown).toBe(true);
  });

  it("完整流程：流式传输中的状态检查", () => {
    const messageId = "msg-streaming-state";

    simulator.queueEvent({ type: "stream.start", messageId });
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });

    // 检查流式状态
    let result = renderer.render(messageId);
    expect(result.streaming).toBe(true);

    // 发送部分内容
    simulator.queueEvent({ type: "stream.text", messageId, delta: "Hello" });
    simulator.flushSync();

    result = renderer.render(messageId);
    expect(result.markdownContent).toBe("Hello");
    expect(result.streaming).toBe(true);

    // 完成流式传输
    simulator.queueEvent({ type: "stream.completed", messageId });
    simulator.flushSync();

    result = renderer.render(messageId);
    expect(result.streaming).toBe(false);
  });

  it("完整流程：模型名称和时间跟踪", () => {
    const messageId = "msg-tracking";

    simulator.queueEvent({ type: "stream.start", messageId, model: "gpt-4-turbo" });
    simulator.queueEvent({ type: "stream.text", messageId, delta: "Response" });
    simulator.queueEvent({ type: "stream.completed", messageId });
    simulator.flushSync();

    expect(store.lastModelName).toBe("gpt-4-turbo");
    expect(store.lastResponseTimeMs).toBe(1234);
  });

  it("完整流程：错误处理", () => {
    const messageId = "msg-error";

    simulator.queueEvent({ type: "stream.start", messageId });
    simulator.queueEvent({ type: "stream.error", messageId, error: "API rate limit exceeded" });
    simulator.flushSync();

    expect(store.error).toBe("API rate limit exceeded");
    expect(store.isStreaming).toBe(false);

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });
    const result = renderer.render(messageId);
    expect(result.streaming).toBe(false);
  });

  it("完整流程：多条消息的顺序处理", () => {
    const messageIds = ["msg-1", "msg-2", "msg-3"];

    for (let i = 0; i < messageIds.length; i++) {
      simulator.queueEvent({ type: "stream.start", messageId: messageIds[i] });
      simulator.queueEvent({ type: "stream.text", messageId: messageIds[i], delta: `Message ${i + 1}` });
      simulator.queueEvent({ type: "stream.completed", messageId: messageIds[i] });
    }
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });

    // 只有最后一条消息在流式传输中才被认为是正在流式
    const result1 = renderer.render(messageIds[0]);
    const result2 = renderer.render(messageIds[1]);
    const result3 = renderer.render(messageIds[2]);

    expect(result1.streaming).toBe(false);
    expect(result2.streaming).toBe(false);
    expect(result3.streaming).toBe(false); // 所有都已完成
  });
});

// ============================================================================
// 测试套件：边界情况
// ============================================================================

describe("Markdown 渲染边界情况", () => {
  it("应该处理空内容", () => {
    const store = createCompleteMockStore();
    const simulator = new EventStreamSimulator(store);
    const renderer = new MessageListRenderer(store);

    simulator.queueEvent({ type: "stream.start", messageId: "empty" });
    simulator.queueEvent({ type: "stream.completed", messageId: "empty" });
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });
    const result = renderer.render("empty");

    expect(result.markdownContent).toBe("");
    expect(result.useMarkdown).toBe(true);
  });

  it("应该处理只有 thinking 没有 text 的情况", () => {
    const store = createCompleteMockStore();
    const simulator = new EventStreamSimulator(store);
    const renderer = new MessageListRenderer(store);

    simulator.queueEvent({ type: "stream.start", messageId: "thinking-only" });
    simulator.queueEvent({ type: "stream.reasoning", messageId: "thinking-only", content: "思考中..." });
    simulator.queueEvent({ type: "stream.completed", messageId: "thinking-only" });
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });
    const result = renderer.render("thinking-only");

    // 没有 text 内容，所以 markdownContent 为空
    expect(result.markdownContent).toBe("");
    expect(result.thinkingContent).toEqual(["思考中..."]);
  });

  it("应该处理只有 text 没有 thinking 的情况", () => {
    const store = createCompleteMockStore();
    const simulator = new EventStreamSimulator(store);
    const renderer = new MessageListRenderer(store);

    simulator.queueEvent({ type: "stream.start", messageId: "text-only" });
    simulator.queueEvent({ type: "stream.text", messageId: "text-only", delta: "Just text" });
    simulator.queueEvent({ type: "stream.completed", messageId: "text-only" });
    simulator.flushSync();

    renderer.setSyntaxStyle({ getStyle: () => ({ foreground: "#fff" }) });
    const result = renderer.render("text-only");

    expect(result.markdownContent).toBe("Just text");
    expect(result.thinkingContent).toEqual([]);
  });

  it("应该处理超长内容", () => {
    const store = createCompleteMockStore();
    const simulator = new EventStreamSimulator(store);

    const longContent = "A".repeat(10000);

    simulator.queueEvent({ type: "stream.start", messageId: "long" });
    simulator.queueEvent({ type: "stream.text", messageId: "long", delta: longContent });
    simulator.queueEvent({ type: "stream.completed", messageId: "long" });
    simulator.flushSync();

    expect(store.messages[0].content.length).toBe(10000);
  });

  it("应该处理包含 null 字符的内容", () => {
    const store = createCompleteMockStore();
    const simulator = new EventStreamSimulator(store);

    const contentWithNull = "Hello\x00World";

    simulator.queueEvent({ type: "stream.start", messageId: "null-chars" });
    simulator.queueEvent({ type: "stream.text", messageId: "null-chars", delta: contentWithNull });
    simulator.queueEvent({ type: "stream.completed", messageId: "null-chars" });
    simulator.flushSync();

    expect(store.messages[0].content).toContain("Hello");
    expect(store.messages[0].content).toContain("World");
  });
});

// ============================================================================
// 测试数据导出
// ============================================================================

export {
  createCompleteMockStore,
  EventStreamSimulator,
  MessageListRenderer,
};
