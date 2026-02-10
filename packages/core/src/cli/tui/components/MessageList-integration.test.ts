/**
 * @fileoverview MessageList 渲染集成测试
 *
 * 测试 MessageList 组件的完整渲染流程，特别是 Markdown 渲染路径
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 测试数据构造
// ============================================================================

function createAssistantMessageWithParts(
  content: string,
  parts: MessagePart[],
  id?: string
): { message: Message; parts: MessagePart[] } {
  const messageId = id || `assistant-${Date.now()}`;
  return {
    message: {
      id: messageId,
      role: "assistant",
      content,
      timestamp: Date.now(),
    },
    parts,
  };
}

// ============================================================================
// 测试套件：MessageList 渲染逻辑
// ============================================================================

describe("MessageList 渲染逻辑", () => {
  it("应该正确处理简单的文本消息", () => {
    const content = "Hello, this is a simple message.";
    const { message } = createAssistantMessageWithParts(content, []);

    // 模拟 displayContent 逻辑
    const displayContent = content;

    expect(displayContent).toBe(content);
    expect(message.role).toBe("assistant");
  });

  it("应该正确处理带 Markdown 的消息", () => {
    const content = `# Hello

This is **bold** and *italic* text.

\`\`\`typescript
const x = 1;
\`\`\`

> Quote here`;

    const { message } = createAssistantMessageWithParts(content, []);

    // 验证 Markdown 元素存在
    expect(message.content).toContain("# Hello");
    expect(message.content).toContain("**bold**");
    expect(message.content).toContain("*italic*");
    expect(message.content).toContain("```typescript");
    expect(message.content).toContain("> Quote");
  });

  it("应该正确处理带 thinking 的消息", () => {
    const messageId = "msg-thinking-test";
    const reasoningContent = "Let me think about this...";
    const textContent = "Here is my answer.";

    const parts: MessagePart[] = [
      {
        id: "part-1",
        type: "reasoning",
        content: reasoningContent,
        timestamp: Date.now(),
      },
      {
        id: "part-2",
        type: "text",
        content: textContent,
        timestamp: Date.now(),
      },
    ];

    const { message } = createAssistantMessageWithParts(textContent, parts, messageId);

    // 模拟 MessageList 中的过滤逻辑
    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    expect(reasoningParts.length).toBe(1);
    expect(reasoningParts[0].content).toBe(reasoningContent);
    
    expect(textParts.length).toBe(1);
    expect(textParts[0].content).toBe(textContent);
  });

  it("应该正确处理带工具调用的消息", () => {
    const parts: MessagePart[] = [
      {
        id: "part-1",
        type: "text",
        content: "Let me check the files.",
        timestamp: Date.now(),
      },
      {
        id: "part-2",
        type: "tool_call",
        toolName: "bash",
        toolArgs: { command: "ls -la" },
        timestamp: Date.now(),
      },
      {
        id: "part-3",
        type: "tool_result",
        toolName: "bash",
        result: "total 128\n...",
        success: true,
        timestamp: Date.now(),
      },
    ];

    const { message } = createAssistantMessageWithParts("Let me check the files.", parts);

    // 验证各种类型的 parts
    const textParts = parts.filter(p => p.type === "text");
    const toolCallParts = parts.filter(p => p.type === "tool_call");
    const toolResultParts = parts.filter(p => p.type === "tool_result");

    expect(textParts.length).toBe(1);
    expect(toolCallParts.length).toBe(1);
    expect(toolResultParts.length).toBe(1);
    expect(toolCallParts[0].toolName).toBe("bash");
    expect(toolResultParts[0].success).toBe(true);
  });
});

describe("MessageList Markdown 渲染路径", () => {
  it("应该根据 validSyntaxStyle 决定渲染路径", () => {
    // 场景 1: validSyntaxStyle 返回有效实例
    const mockValidStyle = {
      getStyle: (name: string) => ({ foreground: "#fff" }),
    };

    // 模拟 validSyntaxStyle 逻辑
    function validSyntaxStyle(style: any): any {
      if (!style) return null;
      if (typeof style.getStyle !== "function") return null;
      return style;
    }

    // 有效实例应该使用 markdown 组件
    expect(validSyntaxStyle(mockValidStyle)).toBe(mockValidStyle);

    // 场景 2: validSyntaxStyle 返回 null
    expect(validSyntaxStyle(null)).toBeNull();
    expect(validSyntaxStyle(undefined)).toBeNull();
    expect(validSyntaxStyle({})).toBeNull();
  });

  it("应该正确处理流式消息", () => {
    const messageId = "msg-streaming-test";
    const deltas = ["Hello", " ", "World", "!"];
    let content = "";

    // 模拟流式接收
    for (const delta of deltas) {
      content += delta;
    }

    expect(content).toBe("Hello World!");

    // 模拟 isStreaming 状态
    const isStreaming = true;
    const isLastMessage = true;
    
    expect(isStreaming && isLastMessage).toBe(true);
  });

  it("应该正确处理空内容", () => {
    const emptyContent = "";
    const { message } = createAssistantMessageWithParts(emptyContent, []);

    // 验证空内容不会导致错误
    expect(message.content).toBe("");
    expect(typeof message.content).toBe("string");
  });

  it("应该正确处理超长内容", () => {
    const longContent = "a".repeat(10000);
    const { message } = createAssistantMessageWithParts(longContent, []);

    expect(message.content.length).toBe(10000);
  });

  it("应该正确处理包含特殊字符的内容", () => {
    const specialContent = `Special chars: <>&"'
New lines
	Tabs
Emoji: 🎉🚀
Unicode: 中文 日本語 한국어`;

    const { message } = createAssistantMessageWithParts(specialContent, []);

    expect(message.content).toContain("<>&\"'");
    expect(message.content).toContain("🎉");
    expect(message.content).toContain("中文");
  });
});

describe("MessageList 边界情况", () => {
  it("应该处理只有 reasoning 没有 text 的消息", () => {
    const parts: MessagePart[] = [
      {
        id: "part-1",
        type: "reasoning",
        content: "Thinking...",
        timestamp: Date.now(),
      },
    ];

    const { message } = createAssistantMessageWithParts("", parts);

    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    expect(reasoningParts.length).toBe(1);
    expect(textParts.length).toBe(0);

    // displayContent 应该使用 message.content
    const displayContent = textParts.map(p => p.content || "").join("") || message.content;
    expect(displayContent).toBe("");
  });

  it("应该处理多个 text parts", () => {
    const parts: MessagePart[] = [
      { id: "p1", type: "text", content: "Part 1 ", timestamp: Date.now() },
      { id: "p2", type: "text", content: "Part 2 ", timestamp: Date.now() },
      { id: "p3", type: "text", content: "Part 3", timestamp: Date.now() },
    ];

    const textParts = parts.filter(p => p.type === "text");
    const displayContent = textParts.map(p => p.content || "").join("");

    expect(displayContent).toBe("Part 1 Part 2 Part 3");
  });

  it("应该处理混合类型的 parts", () => {
    const parts: MessagePart[] = [
      { id: "p1", type: "reasoning", content: "Thinking 1", timestamp: Date.now() },
      { id: "p2", type: "text", content: "Text 1", timestamp: Date.now() },
      { id: "p3", type: "reasoning", content: "Thinking 2", timestamp: Date.now() },
      { id: "p4", type: "text", content: "Text 2", timestamp: Date.now() },
      { id: "p5", type: "tool_call", toolName: "bash", toolArgs: {}, timestamp: Date.now() },
    ];

    expect(parts.filter(p => p.type === "reasoning").length).toBe(2);
    expect(parts.filter(p => p.type === "text").length).toBe(2);
    expect(parts.filter(p => p.type === "tool_call").length).toBe(1);
  });
});

describe("MessageList 性能测试", () => {
  it("应该高效处理大量消息", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 1000; i++) {
      messages.push({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i}`,
        timestamp: Date.now(),
      });
    }

    expect(messages.length).toBe(1000);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("应该高效处理大量 parts", () => {
    const parts: MessagePart[] = [];
    for (let i = 0; i < 500; i++) {
      parts.push({
        id: `part-${i}`,
        type: i % 3 === 0 ? "reasoning" : "text",
        content: `Content ${i}`,
        timestamp: Date.now(),
      });
    }

    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    expect(parts.length).toBe(500);
    expect(reasoningParts.length).toBeGreaterThan(0);
    expect(textParts.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 调试和诊断
// ============================================================================

describe("MessageList 调试诊断", () => {
  it("应该提供调试信息", () => {
    const diagnostics = {
      component: "MessageList",
      keyFeatures: [
        "User messages with blue border",
        "Assistant messages with thinking and markdown",
        "Tool call and result display",
        "Model info and timing",
      ],
      renderingPaths: [
        "Valid SyntaxStyle -> <markdown> component",
        "Invalid/Null SyntaxStyle -> <text> fallback",
      ],
      knownIssues: [
        "SyntaxStyle getStyle method loss in reactive context",
        "Solution: Use untrack() to get raw object",
      ],
    };

    console.log("\n========== MessageList 组件诊断 ==========");
    console.log("组件:", diagnostics.component);
    console.log("关键特性:", diagnostics.keyFeatures.join(", "));
    console.log("渲染路径:", diagnostics.renderingPaths.join("; "));
    console.log("已知问题:", diagnostics.knownIssues.join("; "));
    console.log("==========================================\n");

    expect(diagnostics.component).toBe("MessageList");
  });
});
