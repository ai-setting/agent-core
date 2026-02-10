/**
 * @fileoverview Markdown 渲染流式事件触发测试
 *
 * 测试通过流式事件构造来触发 Markdown 渲染逻辑
 * 只渲染 text 部分内容，不渲染 thinking 的流式内容
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { StreamEvent } from "../contexts/event-stream.js";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 模拟 Store 和事件处理逻辑
// ============================================================================

interface MockStore {
  messages: Message[];
  parts: Record<string, MessagePart[]>;
  isStreaming: boolean;
  lastModelName: string | null;
  lastResponseTimeMs: number | null;
}

function createMockStore(): MockStore {
  return {
    messages: [],
    parts: {},
    isStreaming: false,
    lastModelName: null,
    lastResponseTimeMs: null,
  };
}

// 模拟 event-stream.tsx 中的 handleEvent 逻辑
function handleStreamEvent(store: MockStore, event: StreamEvent): void {
  switch (event.type) {
    case "stream.start": {
      const streamEvent = event as StreamEvent & { model?: string };
      store.isStreaming = true;
      if (streamEvent.model) store.lastModelName = streamEvent.model;

      // 创建助手消息占位符
      if (event.messageId) {
        const assistantMessage: Message = {
          id: event.messageId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };
        store.messages.push(assistantMessage);
        store.parts[event.messageId] = [];
      }
      break;
    }

    case "stream.text": {
      // 追加文本内容到 message.content
      if (event.messageId && event.delta) {
        const message = store.messages.find(m => m.id === event.messageId);
        if (message) {
          message.content += event.delta;
        }
      }
      break;
    }

    case "stream.reasoning": {
      // 添加或更新 reasoning part（thinking 内容不通过 markdown 渲染）
      if (event.messageId) {
        const parts = store.parts[event.messageId] || [];
        const reasoningPart = parts.find(p => p.type === "reasoning");

        if (reasoningPart) {
          // reasoning 事件发送的是累积的 content，直接替换
          reasoningPart.content = event.content || "";
        } else {
          parts.push({
            id: `reasoning-${Date.now()}`,
            type: "reasoning",
            content: event.content || "",
            timestamp: Date.now(),
          });
        }
        store.parts[event.messageId] = parts;
      }
      break;
    }

    case "stream.completed": {
      store.isStreaming = false;
      store.lastResponseTimeMs = 1500; // 模拟耗时
      break;
    }

    case "stream.error": {
      store.isStreaming = false;
      break;
    }
  }
}

// ============================================================================
// 模拟 MessageList 渲染逻辑
// ============================================================================

function getDisplayContent(message: Message, parts: MessagePart[]): string {
  // 优先使用 text parts 的内容
  const textParts = parts.filter(p => p.type === "text");
  const texts = textParts.map(p => p.content || "").join("");
  if (texts) return texts;
  return message.content || "";
}

function getReasoningParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter(p => p.type === "reasoning");
}

// 模拟 Markdown 渲染判断逻辑
function shouldRenderMarkdown(syntaxStyle: unknown): boolean {
  if (!syntaxStyle) return false;
  return typeof (syntaxStyle as { getStyle?: unknown }).getStyle === "function";
}

// ============================================================================
// 测试数据构造
// ============================================================================

function createStreamStartEvent(messageId: string, model?: string): StreamEvent {
  return {
    type: "stream.start",
    messageId,
    sessionId: "session-test",
    ...(model && { model }),
  };
}

function createStreamTextEvent(messageId: string, delta: string): StreamEvent {
  return {
    type: "stream.text",
    messageId,
    delta,
  };
}

function createStreamReasoningEvent(messageId: string, content: string): StreamEvent {
  return {
    type: "stream.reasoning",
    messageId,
    content,
  };
}

function createStreamCompletedEvent(messageId: string): StreamEvent {
  return {
    type: "stream.completed",
    messageId,
  };
}

// ============================================================================
// 测试套件：流式事件触发 Markdown 渲染
// ============================================================================

describe("流式事件触发 Markdown 渲染", () => {
  let store: MockStore;

  beforeEach(() => {
    store = createMockStore();
  });

  it("应该通过 stream.text 事件触发 text 内容的 markdown 渲染", () => {
    const messageId = "msg-markdown-test";
    const markdownContent = `# 标题

这是**粗体**文本和*斜体*文本。

\`\`\`typescript
const x = 1;
\`\`\`

> 引用内容`;

    // 步骤 1: 发送 stream.start 事件
    handleStreamEvent(store, createStreamStartEvent(messageId, "gpt-4"));
    expect(store.messages.length).toBe(1);
    expect(store.messages[0].content).toBe("");

    // 步骤 2: 模拟流式发送 markdown 内容（分块）
    const chunks = [
      "# 标题\n\n",
      "这是**粗体**文本",
      "和*斜体*文本。\n\n",
      "```typescript\n",
      "const x = 1;\n",
      "```\n\n",
      "> 引用内容",
    ];

    for (const chunk of chunks) {
      handleStreamEvent(store, createStreamTextEvent(messageId, chunk));
    }

    // 验证内容已累积
    expect(store.messages[0].content).toBe(markdownContent);

    // 步骤 3: 发送 stream.completed 事件
    handleStreamEvent(store, createStreamCompletedEvent(messageId));
    expect(store.isStreaming).toBe(false);

    // 验证 displayContent 逻辑
    const displayContent = getDisplayContent(store.messages[0], store.parts[messageId] || []);
    expect(displayContent).toBe(markdownContent);

    // 验证 Markdown 元素存在
    expect(displayContent).toContain("# 标题");
    expect(displayContent).toContain("**粗体**");
    expect(displayContent).toContain("*斜体*");
    expect(displayContent).toContain("```typescript");
    expect(displayContent).toContain("> 引用内容");
  });

  it("应该通过流式事件构建复杂 Markdown 文档", () => {
    const messageId = "msg-complex-markdown";

    // 发送开始事件
    handleStreamEvent(store, createStreamStartEvent(messageId));

    // 模拟逐步构建复杂 Markdown 文档
    const eventSequence: StreamEvent[] = [
      createStreamTextEvent(messageId, "# 项目文档\n\n"),
      createStreamTextEvent(messageId, "## 简介\n\n"),
      createStreamTextEvent(messageId, "这是一个**重要的**项目。\n\n"),
      createStreamTextEvent(messageId, "## 功能列表\n\n"),
      createStreamTextEvent(messageId, "- 功能 A\n"),
      createStreamTextEvent(messageId, "- 功能 B\n"),
      createStreamTextEvent(messageId, "- 功能 C\n\n"),
      createStreamTextEvent(messageId, "## 代码示例\n\n"),
      createStreamTextEvent(messageId, "```javascript\n"),
      createStreamTextEvent(messageId, "function hello() {\n"),
      createStreamTextEvent(messageId, '  return "world";\n'),
      createStreamTextEvent(messageId, "}\n"),
      createStreamTextEvent(messageId, "```\n\n"),
      createStreamTextEvent(messageId, "> 提示：请阅读文档\n\n"),
      createStreamTextEvent(messageId, "访问 [官网](https://example.com)"),
    ];

    for (const event of eventSequence) {
      handleStreamEvent(store, event);
    }

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    const content = store.messages[0].content;

    // 验证各种 Markdown 元素
    expect(content).toContain("# 项目文档");
    expect(content).toContain("## 简介");
    expect(content).toContain("**重要的**");
    expect(content).toContain("- 功能 A");
    expect(content).toContain("```javascript");
    expect(content).toContain("> 提示：");
    expect(content).toContain("[官网](https://example.com)");
  });

  it("应该正确处理 thinking 内容（不通过 markdown 渲染）", () => {
    const messageId = "msg-thinking-test";

    // 发送开始事件
    handleStreamEvent(store, createStreamStartEvent(messageId));

    // 发送 thinking 内容（reasoning 事件）
    const thinkingEvents: StreamEvent[] = [
      createStreamReasoningEvent(messageId, "让我思考一下"),
      createStreamReasoningEvent(messageId, "让我思考一下这个问题"),
      createStreamReasoningEvent(messageId, "让我思考一下这个问题..."),
    ];

    for (const event of thinkingEvents) {
      handleStreamEvent(store, event);
    }

    // 发送 text 内容（会被 markdown 渲染）
    handleStreamEvent(store, createStreamTextEvent(messageId, "这是最终答案"));

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    // 验证 thinking 内容存储在 parts 中
    const reasoningParts = getReasoningParts(store.parts[messageId] || []);
    expect(reasoningParts.length).toBe(1);
    expect(reasoningParts[0].content).toBe("让我思考一下这个问题...");

    // 验证 text 内容存储在 message.content 中
    expect(store.messages[0].content).toBe("这是最终答案");

    // 验证 displayContent 使用 text 内容（会被 markdown 渲染）
    const displayContent = getDisplayContent(store.messages[0], store.parts[messageId] || []);
    expect(displayContent).toBe("这是最终答案");

    // 重要：thinking 内容不通过 markdown 渲染，而是单独显示
    // 在真实组件中，reasoningParts 会渲染为 <text fg={theme.thinking}><i>{content}</i></text>
  });

  it("应该正确处理 interleaved thinking 和 text 内容", () => {
    const messageId = "msg-interleaved";

    handleStreamEvent(store, createStreamStartEvent(messageId));

    // 交错发送 thinking 和 text
    handleStreamEvent(store, createStreamReasoningEvent(messageId, "开始思考..."));
    handleStreamEvent(store, createStreamTextEvent(messageId, "第一部分答案。"));
    handleStreamEvent(store, createStreamReasoningEvent(messageId, "继续思考..."));
    handleStreamEvent(store, createStreamTextEvent(messageId, "第二部分答案。"));
    handleStreamEvent(store, createStreamReasoningEvent(messageId, "完成思考"));

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    // 验证所有内容
    expect(store.messages[0].content).toBe("第一部分答案。第二部分答案。");

    const reasoningParts = getReasoningParts(store.parts[messageId] || []);
    expect(reasoningParts.length).toBe(1);
    expect(reasoningParts[0].content).toBe("完成思考");
  });

  it("应该根据 validSyntaxStyle 决定是否渲染 markdown", () => {
    // 有效的 SyntaxStyle（有 getStyle 方法）
    const validStyle = { getStyle: (name: string) => ({ foreground: "#fff" }) };
    expect(shouldRenderMarkdown(validStyle)).toBe(true);

    // 无效的 SyntaxStyle
    expect(shouldRenderMarkdown(null)).toBe(false);
    expect(shouldRenderMarkdown(undefined)).toBe(false);
    expect(shouldRenderMarkdown({})).toBe(false);
    expect(shouldRenderMarkdown({ getStyle: "not a function" })).toBe(false);
  });

  it("应该正确处理空流式内容", () => {
    const messageId = "msg-empty";

    handleStreamEvent(store, createStreamStartEvent(messageId));
    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    expect(store.messages[0].content).toBe("");
    expect(getDisplayContent(store.messages[0], store.parts[messageId] || [])).toBe("");
  });

  it("应该正确处理包含特殊字符的 Markdown", () => {
    const messageId = "msg-special";

    handleStreamEvent(store, createStreamStartEvent(messageId));

    const specialContent = `# 特殊字符测试

- 代码: \`console.log("hello")\`
- HTML: \`<div>content</div>\`
- 转义: \\*不是斜体\\*
- Emoji: 🎉 🚀
- Unicode: 中文 日本語`;

    handleStreamEvent(store, createStreamTextEvent(messageId, specialContent));
    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    const content = store.messages[0].content;
    expect(content).toContain("`console.log");
    expect(content).toContain("<div>");
    expect(content).toContain("🎉");
    expect(content).toContain("中文");
  });

  it("应该正确跟踪流式状态", () => {
    const messageId = "msg-state";

    expect(store.isStreaming).toBe(false);

    handleStreamEvent(store, createStreamStartEvent(messageId));
    expect(store.isStreaming).toBe(true);
    expect(store.lastModelName).toBeNull(); // 没有提供 model

    handleStreamEvent(store, createStreamTextEvent(messageId, "内容"));
    expect(store.isStreaming).toBe(true);

    handleStreamEvent(store, createStreamCompletedEvent(messageId));
    expect(store.isStreaming).toBe(false);
    expect(store.lastResponseTimeMs).toBe(1500);
  });

  it("应该正确跟踪带模型的流式状态", () => {
    const messageId = "msg-with-model";

    handleStreamEvent(store, createStreamStartEvent(messageId, "claude-3-opus"));
    expect(store.lastModelName).toBe("claude-3-opus");
  });
});

// ============================================================================
// 测试套件：Markdown 渲染内容类型分离
// ============================================================================

describe("Markdown 渲染内容类型分离", () => {
  it("应该只渲染 text 类型的内容", () => {
    const messageId = "msg-type-separation";
    const store = createMockStore();

    handleStreamEvent(store, createStreamStartEvent(messageId));

    // 添加各种类型的内容
    handleStreamEvent(store, createStreamReasoningEvent(messageId, "thinking content"));
    handleStreamEvent(store, createStreamTextEvent(messageId, "markdown **bold** content"));

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    // 只有 text 内容会被 markdown 渲染
    const displayContent = getDisplayContent(store.messages[0], store.parts[messageId] || []);
    expect(displayContent).toBe("markdown **bold** content");
    expect(displayContent).toContain("**bold**");

    // thinking 内容不在 displayContent 中
    expect(displayContent).not.toContain("thinking");
  });

  it("应该正确处理只有 text parts 的情况", () => {
    const parts: MessagePart[] = [
      { id: "p1", type: "text", content: "Text with **markdown**", timestamp: Date.now() },
    ];

    const message: Message = {
      id: "msg-text-only",
      role: "assistant",
      content: "fallback content",
      timestamp: Date.now(),
    };

    // 有 text parts 时优先使用
    const displayContent = getDisplayContent(message, parts);
    expect(displayContent).toBe("Text with **markdown**");
  });

  it("应该在没有 text parts 时回退到 message.content", () => {
    const parts: MessagePart[] = [
      { id: "p1", type: "reasoning", content: "thinking", timestamp: Date.now() },
    ];

    const message: Message = {
      id: "msg-fallback",
      role: "assistant",
      content: "fallback **markdown**",
      timestamp: Date.now(),
    };

    // 没有 text parts 时使用 message.content
    const displayContent = getDisplayContent(message, parts);
    expect(displayContent).toBe("fallback **markdown**");
  });
});

// ============================================================================
// 测试套件：性能测试
// ============================================================================

describe("Markdown 渲染性能测试", () => {
  it("应该高效处理大量流式事件", () => {
    const store = createMockStore();
    const messageId = "msg-performance";

    handleStreamEvent(store, createStreamStartEvent(messageId));

    const startTime = performance.now();

    // 模拟 1000 个流式 text 事件
    for (let i = 0; i < 1000; i++) {
      handleStreamEvent(store, createStreamTextEvent(messageId, `chunk ${i} `));
    }

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    const endTime = performance.now();
    const duration = endTime - startTime;

    // 验证处理完成
    expect(store.messages[0].content.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(1000); // 应该在 1 秒内完成
  });

  it("应该正确处理大型 Markdown 文档的流式传输", () => {
    const store = createMockStore();
    const messageId = "msg-large-doc";

    handleStreamEvent(store, createStreamStartEvent(messageId));

    // 模拟大型 Markdown 文档
    const largeContent = `# ${"标题".repeat(100)}\n\n${"内容段落\n\n".repeat(50)}`;
    const chunkSize = 100;

    for (let i = 0; i < largeContent.length; i += chunkSize) {
      const chunk = largeContent.slice(i, i + chunkSize);
      handleStreamEvent(store, createStreamTextEvent(messageId, chunk));
    }

    handleStreamEvent(store, createStreamCompletedEvent(messageId));

    // 验证完整内容
    expect(store.messages[0].content).toBe(largeContent);
  });
});

// ============================================================================
// 测试数据导出
// ============================================================================

export {
  createMockStore,
  handleStreamEvent,
  getDisplayContent,
  getReasoningParts,
  shouldRenderMarkdown,
  createStreamStartEvent,
  createStreamTextEvent,
  createStreamReasoningEvent,
  createStreamCompletedEvent,
};
